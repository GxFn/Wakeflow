import { deepEqual, equal } from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { renderDeterministicJsonDocument } from "../../src/foundation/data/deterministic-json-document.js";
import { parseJsonValue } from "../../src/foundation/data/json-value.js";
import type { UtcInstant } from "../../src/foundation/time/utc-instant.js";
import {
  createHostHookObservation,
  readHostHookObservationRecord,
  readHostHookObservations,
  scanHostHookObservations,
  writeHostHookObservation,
} from "../../src/kernel/hook-observations.js";
import { hostHookObservationsRootRef } from "../../src/kernel/layout.js";
import { useDisposableDurability } from "../support/disposable-durability.js";
import { loadSensitive } from "../support/load-sensitive.js";
import {
  AT,
  ago,
  compact,
  DAY,
  fillOversizedDirectory,
  fixture,
  hookEntries,
  hooksDirectory,
  NOW,
  OVERSIZED_EXPIRED,
  OVERSIZED_UNRECOGNIZED,
  observation,
} from "./hook-observations.fixture.js";

useDisposableDurability();

/**
 * hook 观察的负载敏感用例（1 级，`.load` 文件，§13.206 D3）：上万条目的真实目录树在 8 个 worker 下超时，
 * 所以单独成文件进隔离道；断言与 `hook-observations.test.ts` 时期完全相同（§13.97 D7b、§13.161 H2）。
 */

test("旧目录超过 16384 项仍可分页完整读取与按龄修剪，未知条目不被删除", {
  timeout: 120_000,
}, async (t) => {
  if (
    loadSensitive(
      t,
      "oversized real directory tree with 16384+ entries; times out at eight file workers",
    )
  )
    return;
  const { root, path: workspace } = await fixture(t);
  const directory = hooksDirectory(workspace, "claude-code");
  const kept = await writeHostHookObservation(root, observation(workspace, ago(DAY)));
  fillOversizedDirectory(directory);
  const before = 1 + OVERSIZED_UNRECOGNIZED + OVERSIZED_EXPIRED;
  equal(hookEntries(directory).length, before);
  const beforeRead = await readHostHookObservations(root, "claude-code");
  equal(beforeRead.complete, true);
  equal(beforeRead.skipped, OVERSIZED_UNRECOGNIZED + OVERSIZED_EXPIRED);
  deepEqual(
    beforeRead.records.map((record) => record.recordId),
    [kept.record.recordId],
  );
  const latest = await writeHostHookObservation(root, observation(workspace, ago(0)));
  equal(latest.disposition, "created");
  equal(hookEntries(directory).length, before + 1 - OVERSIZED_EXPIRED);
  const inventory = await readHostHookObservations(root, "claude-code");
  deepEqual(
    inventory.records.map((record) => record.recordId),
    [kept.record.recordId, latest.record.recordId],
  );
  // 修剪永远不动无法识别的条目（它们留给 verify 的门），所以修剪之后 skipped 仍然恰好等于
  // 填充进去的那批文件数：少一个就说明修剪越界删掉了不属于它的东西，多一个就说明有记录读不出。
  equal(inventory.skipped, OVERSIZED_UNRECOGNIZED);
});

test("旧平铺目录的 16385 条近期有效记录可完整扫描，目标查询与逐条证据读取不截断", {
  timeout: 240_000,
}, async (t) => {
  if (loadSensitive(t, "16385-entry real directory scan; times out at eight file workers")) return;
  const { root, path: workspace } = await fixture(t);
  const directory = hooksDirectory(workspace, "codex");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  let target: ReturnType<typeof createHostHookObservation> | undefined;
  for (let index = 0; index < 16_385; index += 1) {
    const record = createHostHookObservation({
      hostId: "codex",
      event: index === 16_384 ? "session-start" : "stop",
      sessionId: `synthetic-${index}`,
      cwd: workspace,
      recordedAt: AT(0),
    });
    const name = `${compact(record.recordedAt)}-${record.event}-${record.recordId}.json`;
    writeFileSync(
      path.join(directory, name),
      renderDeterministicJsonDocument(parseJsonValue(record)),
      { mode: 0o600 },
    );
    if (index === 16_384) target = record;
  }
  if (target === undefined) throw new Error("Missing synthetic target");
  const selected = await readHostHookObservations(root, "codex", {
    event: "session-start",
    sessionId: target.sessionId,
    limit: 1,
  });
  equal(selected.complete, true);
  deepEqual(selected.records, [target]);
  equal(
    (await readHostHookObservationRecord(root, "codex", target.recordId))?.record.recordId,
    target.recordId,
  );
  const scan = await scanHostHookObservations(root, "codex", {}, () => {});
  deepEqual(scan, { records: 16_385, skipped: 0, unreadable: 0 });
  // Upgrading does not copy or rewrite an already durable legacy fact.
  const retry = await writeHostHookObservation(root, target);
  equal(retry.disposition, "current");
  equal(
    retry.resourceRef.split("/").length,
    hostHookObservationsRootRef("codex").split("/").length + 1,
  );
  equal(readdirSync(directory).length, 16_385);
});

test("密集历史也按龄退役：基准取最新的另一条记录，只走截止日之前的日目录，清空的分片与日目录随手回收（§13.161 H2-01/H2-02）", {
  timeout: 120_000,
}, async (t) => {
  if (
    loadSensitive(t, "8000-record real history tree pruned by age; times out at eight file workers")
  )
    return;
  const { root, path: workspace } = await fixture(t);
  const directory = hooksDirectory(workspace, "claude-code");
  // 40 天、每天 200 条，远高于旧实现约 137 条/天的饥饿阈值：最旧的 4096 个叶子跨不到 30 天，
  // 旧实现的截止基准会被钉在陈旧历史上，永远修剪不到任何东西。
  const perDay = 150;
  const days = 40;
  const dayDirectory = (day: number): string =>
    path.join(
      directory,
      compact(new Date(NOW - day * DAY).toISOString() as UtcInstant).slice(0, 8),
    );
  for (let day = days; day >= 1; day -= 1) {
    for (let index = 0; index < perDay; index += 1) {
      const at = new Date(NOW - day * DAY + index * 60_000).toISOString() as UtcInstant;
      const recordId = `${(index % 256).toString(16).padStart(2, "0")}000000-0000-4000-8000-${day
        .toString(16)
        .padStart(6, "0")}${index.toString(16).padStart(6, "0")}`;
      const shard = path.join(dayDirectory(day), recordId.slice(0, 2));
      mkdirSync(shard, { recursive: true, mode: 0o700 });
      writeFileSync(path.join(shard, `${compact(at)}-stop-${recordId}.json`), "garbage\n", {
        mode: 0o600,
      });
    }
  }
  const total = perDay * days;
  equal(hookEntries(directory).length, total);
  const latest = await writeHostHookObservation(root, observation(workspace, ago(0)));
  equal(latest.disposition, "created");
  // 基准是最新的另一条（昨天的最后一条），截止在 30 天多一点之前：40…32 天前的 9 天（1800 条）
  // 整天过期，都在 4096 的检查预算之内，一次写入全部退役；31 天前那天跨过截止时刻，整天保留到下次。
  equal(hookEntries(directory).length, total + 1 - 9 * perDay);
  equal(existsSync(dayDirectory(40)), false);
  equal(existsSync(dayDirectory(32)), false);
  equal(existsSync(dayDirectory(31)), true);
  equal(existsSync(dayDirectory(1)), true);
});
