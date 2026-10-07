import { deepEqual, equal, rejects, throws } from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  lstatSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { type TestContext, test } from "node:test";
import { renderDeterministicJsonDocument } from "../../src/foundation/data/deterministic-json-document.js";
import { parseJsonValue } from "../../src/foundation/data/json-value.js";
import { type Sha256Digest, Sha256Error } from "../../src/foundation/crypto/sha256.js";
import { parseDurableAtomicFileStageFileName } from "../../src/foundation/filesystem/durable-atomic-file-stage-address.js";
import { RootedDirectory } from "../../src/foundation/filesystem/rooted-directory.js";
import type { UtcInstant } from "../../src/foundation/time/utc-instant.js";
import { isWakeflowError } from "../../src/kernel/error.js";
import {
  createHostHookObservation,
  HOST_HOOK_ABANDONED_STAGE_MILLISECONDS,
  HOST_HOOK_RECORDS_MAXIMUM,
  HOST_HOOK_RETENTION_MILLISECONDS,
  type HostHookObservationInput,
  readHostHookObservations,
  readHostHookObservationRecord,
  scanHostHookObservations,
  readHostHookObservationsInterleaved,
  writeHostHookObservation,
} from "../../src/kernel/hook-observations.js";
import { hostHookObservationsRootRef } from "../../src/kernel/layout.js";

async function fixture(
  t: TestContext,
): Promise<{ readonly root: RootedDirectory; readonly path: string }> {
  const absolutePath = realpathSync(mkdtempSync(path.join(os.tmpdir(), "wakeflow-hooks-")));
  const root = await RootedDirectory.open(absolutePath);
  t.after(async () => {
    await root.close();
    rmSync(absolutePath, { recursive: true, force: true });
  });
  return { root, path: absolutePath };
}

const SESSION = "0d1e2f30-1111-4222-8333-444455556666";
const AT = (offset: number): UtcInstant =>
  new Date(Date.UTC(2026, 8, 4, 12, 0, offset)).toISOString() as UtcInstant;

test("hook 观察记录：确定性标识、私有文件、按事件与会话有界读取", async (t) => {
  const { root, path: workspace } = await fixture(t);
  const start = await writeHostHookObservation(root, {
    hostId: "claude-code",
    event: "session-start",
    sessionId: SESSION,
    cwd: `${workspace}/product`,
    recordedAt: AT(0),
  });
  equal(start.disposition, "created");
  equal(start.record.recordId, createHostHookObservation({ ...start.record }).recordId);
  const again = await writeHostHookObservation(root, {
    hostId: "claude-code",
    event: "session-start",
    sessionId: SESSION,
    cwd: `${workspace}/product`,
    recordedAt: AT(0),
  });
  equal(again.disposition, "current");
  await writeHostHookObservation(root, {
    hostId: "claude-code",
    event: "stop",
    sessionId: SESSION,
    cwd: `${workspace}/product`,
    recordedAt: AT(5),
    turnId: "turn-1",
    lastAssistantMessageDigest: `sha256:${"a".repeat(64)}` as Sha256Digest,
  });
  await writeHostHookObservation(root, {
    hostId: "claude-code",
    event: "session-start",
    sessionId: "other-session",
    cwd: `${workspace}/design`,
    recordedAt: AT(9),
  });
  const directory = path.join(
    workspace,
    ".wakeflow-local/runtime/hosts/claude-code/observations/hooks",
  );
  equal(statSync(directory).mode & 0o777, 0o700);
  for (const name of readdirSync(directory, { recursive: true }) as string[]) {
    const node = lstatSync(path.join(directory, name));
    equal(node.mode & 0o777, node.isDirectory() ? 0o700 : 0o600);
  }
  writeFileSync(path.join(directory, "20260904T120010000Z-stop-not-a-uuid.json"), "{}\n");
  writeFileSync(path.join(directory, "stray.txt"), "x\n");

  const all = await readHostHookObservations(root, "claude-code");
  deepEqual(
    all.records.map((record) => [record.event, record.sessionId]),
    [
      ["session-start", SESSION],
      ["stop", SESSION],
      ["session-start", "other-session"],
    ],
  );
  equal(all.skipped, 2);
  const starts = await readHostHookObservations(root, "claude-code", {
    event: "session-start",
    sessionId: SESSION,
  });
  equal(starts.records.length, 1);
  equal(starts.records[0]?.cwd, `${workspace}/product`);
  // 被过滤掉的记录不算 skipped：计数只反映证据通道里读不出来的条目。
  equal(starts.skipped, 2);
  const late = await readHostHookObservations(root, "claude-code", { since: AT(5) });
  deepEqual(
    late.records.map((record) => record.event),
    ["stop", "session-start"],
  );
  equal(late.skipped, 2);
  const limited = await readHostHookObservations(root, "claude-code", { limit: 1 });
  equal(limited.records.length, 1);
  const codex = await readHostHookObservations(root, "codex");
  deepEqual(codex, { records: [], skipped: 0, unreadable: 0, complete: true });
});

test("hook 观察记录拒绝越界输入与同名不同内容", async (t) => {
  const { root, path: workspace } = await fixture(t);
  for (const [patch, reason] of [
    [{ sessionId: "has space" }, "hook-identifier"],
    [{ cwd: "relative/path" }, "hook-cwd"],
    [{ event: "unknown" }, "hook-event"],
    [{ hostId: "vim" }, "host-id"],
    [{ promptDigest: "md5:abc" }, "digest-format"],
  ] as const) {
    throws(
      () =>
        createHostHookObservation({
          hostId: "codex",
          event: "stop",
          sessionId: SESSION,
          cwd: `${workspace}`,
          recordedAt: AT(0),
          ...(patch as object),
        }),
      (error: unknown) =>
        reason === "digest-format"
          ? error instanceof Sha256Error && error.reason === reason
          : isWakeflowError(error) && error.reason === reason,
    );
  }
  const written = await writeHostHookObservation(root, {
    hostId: "codex",
    event: "session-start",
    sessionId: SESSION,
    cwd: workspace,
    recordedAt: AT(0),
  });
  const file = path.join(workspace, written.resourceRef);
  writeFileSync(file, '{\n  "tampered": true\n}\n');
  await rejects(
    writeHostHookObservation(root, {
      hostId: "codex",
      event: "session-start",
      sessionId: SESSION,
      cwd: workspace,
      recordedAt: AT(0),
    }),
    (error: unknown) =>
      isWakeflowError(error) &&
      error.code === "precondition-failed" &&
      error.reason === "observation-conflict",
  );
  const inventory = await readHostHookObservations(root, "codex");
  equal(inventory.records.length, 0);
  equal(inventory.skipped, 1);
});

// ---- §13.97 D7：毫秒精度、按龄修剪、列举后消失 ----------------------------------------

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 8, 18, 12, 0, 0);
/** 相对固定"现在"的毫秒形时刻；测试不读墙钟。 */
const ago = (milliseconds: number): UtcInstant =>
  new Date(NOW - milliseconds).toISOString() as UtcInstant;
const compact = (instant: UtcInstant): string => instant.replace(/[-:.]/gu, "");
const OLD_UUID = "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f";
const OLD_UUID_OTHER = "0e0e0e0e-0e0e-4e0e-8e0e-0e0e0e0e0e0e";

function hooksDirectory(workspace: string, hostId: "codex" | "claude-code"): string {
  return path.join(workspace, ...hostHookObservationsRootRef(hostId).split("/"));
}

function hookEntries(directory: string): string[] {
  const entries: string[] = [];
  for (const name of readdirSync(directory)) {
    const child = path.join(directory, name);
    if (/^\d{8}$/u.test(name) && lstatSync(child).isDirectory()) {
      for (const shard of readdirSync(child)) {
        const shardPath = path.join(child, shard);
        if (/^[0-9a-f]{2}$/u.test(shard) && lstatSync(shardPath).isDirectory()) {
          for (const leaf of readdirSync(shardPath)) entries.push(`${name}/${shard}/${leaf}`);
        } else entries.push(`${name}/${shard}`);
      }
    } else entries.push(name);
  }
  return entries.sort();
}

function observation(
  workspace: string,
  recordedAt: UtcInstant,
  patch: Partial<HostHookObservationInput> = {},
): HostHookObservationInput {
  return {
    hostId: "claude-code",
    event: "stop",
    sessionId: SESSION,
    cwd: `${workspace}/product`,
    recordedAt,
    ...patch,
  };
}

function recordName(receipt: Awaited<ReturnType<typeof writeHostHookObservation>>): string {
  return `${compact(receipt.record.recordedAt).slice(0, 8)}/${receipt.record.recordId.slice(0, 2)}/${compact(receipt.record.recordedAt)}-${receipt.record.event}-${receipt.record.recordId}.json`;
}

test("hook 观察记录要求 recordedAt 恰好 3 位小数秒：其他精度写得进去却永远读不出（D7a）", async (t) => {
  const { root, path: workspace } = await fixture(t);
  for (const recordedAt of [
    "2026-09-18T12:00:00Z",
    "2026-09-18T12:00:00.1Z",
    "2026-09-18T12:00:00.12Z",
    "2026-09-18T12:00:00.000000Z",
    "2026-09-18T12:00:00.123456789Z",
  ] as UtcInstant[]) {
    throws(
      () => createHostHookObservation(observation(workspace, recordedAt)),
      (error: unknown) =>
        isWakeflowError(error) &&
        error.code === "invalid-request" &&
        error.reason === "hook-instant-precision",
    );
  }
  equal(
    createHostHookObservation(observation(workspace, "2026-09-18T12:00:00.000Z" as UtcInstant))
      .recordedAt,
    "2026-09-18T12:00:00.000Z",
  );
  equal(HOST_HOOK_RETENTION_MILLISECONDS, 30 * DAY);
  // D7c：读取上限与目录列举上限是同一个内核常量，端点与观察域按它读取，不各自写字面量。
  equal(HOST_HOOK_RECORDS_MAXIMUM, 16384);
  await rejects(
    readHostHookObservations(root, "claude-code", {
      limit: HOST_HOOK_RECORDS_MAXIMUM + 1,
    }),
    (error: unknown) => isWakeflowError(error) && error.reason === "hook-limit",
  );
  deepEqual(
    await readHostHookObservations(root, "claude-code", {
      limit: HOST_HOOK_RECORDS_MAXIMUM,
    }),
    { records: [], skipped: 0, unreadable: 0, complete: true },
  );
  // 中止不被当作"读不出"吞掉。
  await rejects(
    readHostHookObservations(root, "claude-code", {}, { signal: AbortSignal.abort() }),
    (error: unknown) =>
      isWakeflowError(error) && error.code === "io-failure" && error.reason.endsWith("aborted"),
  );
});

test("新记录落地后只按龄修剪同一宿主目录：早于 30 天的记录文件被 unlink，边界与更新的保留，无法识别的条目与其他宿主不动（D7b）", async (t) => {
  const { root, path: workspace } = await fixture(t);
  const directory = hooksDirectory(workspace, "claude-code");
  // 按时间倒序写三条：每条落地时目录里最新的"另一条记录"都比它自己更旧，截止基准因此比它更早，
  // 三次写入一条都修剪不掉。第一条落地时目录里没有别的记录命名条目，直接不修剪。
  const stale = await writeHostHookObservation(root, observation(workspace, ago(31 * DAY)));
  const boundary = await writeHostHookObservation(
    root,
    observation(workspace, ago(HOST_HOOK_RETENTION_MILLISECONDS)),
  );
  const young = await writeHostHookObservation(root, observation(workspace, ago(29 * DAY)));
  // 符合记录命名但内容不可用的旧文件：修剪只看名字，照样 unlink。
  const staleGarbage = `20200101T000000000Z-session-end-${OLD_UUID}.json`;
  writeFileSync(path.join(directory, staleGarbage), "garbage\n", { mode: 0o600 });
  // 无法识别的条目留给 verify 的门：非记录命名的文件、记录命名的目录。
  writeFileSync(path.join(directory, "stray.txt"), "x\n", { mode: 0o600 });
  const staleDirectory = `20200101T000000000Z-stop-${OLD_UUID}.json`;
  mkdirSync(path.join(directory, staleDirectory));
  // 另一宿主目录里的旧记录不在本次修剪范围内。
  const codexDirectory = hooksDirectory(workspace, "codex");
  mkdirSync(codexDirectory, { recursive: true, mode: 0o700 });
  writeFileSync(path.join(codexDirectory, staleGarbage), "garbage\n", { mode: 0o600 });
  deepEqual(
    hookEntries(directory).sort(),
    [
      staleGarbage,
      staleDirectory,
      recordName(stale),
      recordName(boundary),
      recordName(young),
      "stray.txt",
    ].sort(),
  );

  // 截止基准取"目录里除本条之外最新的记录"与本条 recordedAt 的较小者：此刻最新的另一条是
  // 29 天前的 young，所以基准是 29 天前而不是"现在"，31 天前的 stale 这一轮还留着。
  const settled = await writeHostHookObservation(root, observation(workspace, ago(1)));
  equal(settled.disposition, "created");
  equal(hookEntries(directory).includes(recordName(stale)), true);
  equal(hookEntries(directory).includes(staleGarbage), false);

  // 现在目录里最新的另一条是 1 毫秒前的 settled：基准回到"现在"，30 天以前的才被修剪。
  const latest = await writeHostHookObservation(root, observation(workspace, ago(0)));
  equal(latest.disposition, "created");
  deepEqual(
    hookEntries(directory).sort(),
    [
      staleDirectory,
      recordName(boundary),
      recordName(young),
      recordName(settled),
      recordName(latest),
      "stray.txt",
    ].sort(),
  );
  deepEqual(readdirSync(codexDirectory), [staleGarbage]);

  const inventory = await readHostHookObservations(root, "claude-code");
  deepEqual(
    inventory.records.map((record) => record.recordId),
    [
      boundary.record.recordId,
      young.record.recordId,
      settled.record.recordId,
      latest.record.recordId,
    ],
  );
  // stray.txt 与记录命名的目录读不出，仍计 skipped；被修剪的不计。
  equal(inventory.skipped, 2);
  // 幂等重写没有新证据落地：整条修剪路径跳过，必然过期的记录命名文件要等下一次 created 才消失。
  const expired = `20200101T000000000Z-session-end-${OLD_UUID_OTHER}.json`;
  writeFileSync(path.join(directory, expired), "garbage\n", { mode: 0o600 });
  const again = await writeHostHookObservation(root, observation(workspace, ago(0)));
  equal(again.disposition, "current");
  equal(hookEntries(directory).includes(expired), true);
  const next = await writeHostHookObservation(
    root,
    observation(workspace, ago(0), { event: "session-end" }),
  );
  equal(next.disposition, "created");
  equal(hookEntries(directory).includes(expired), false);
  equal(hookEntries(directory).length, 7);
});

test("宿主时钟跳到未来时一次写入删不掉别的证据：截止基准被目录里已有的记录钳住（D7b）", async (t) => {
  const { root, path: workspace } = await fixture(t);
  const directory = hooksDirectory(workspace, "claude-code");
  const first = await writeHostHookObservation(root, observation(workspace, ago(2 * DAY)));
  const second = await writeHostHookObservation(root, observation(workspace, ago(DAY)));
  // 时钟跳变的宿主交回一条一年后的记录：不钳住基准的话截止线会落到 335 天之后，两条近期记录
  // 会被一次写入连根删掉，远远越过 D7b 的 30 天损失边界。
  const skewed = await writeHostHookObservation(
    root,
    observation(workspace, new Date(NOW + 365 * DAY).toISOString() as UtcInstant, {
      event: "session-end",
    }),
  );
  equal(skewed.disposition, "created");
  deepEqual(
    hookEntries(directory).sort(),
    [recordName(first), recordName(second), recordName(skewed)].sort(),
  );
  const inventory = await readHostHookObservations(root, "claude-code");
  deepEqual(
    inventory.records.map((record) => record.recordId),
    [first.record.recordId, second.record.recordId, skewed.record.recordId],
  );
  equal(inventory.skipped, 0);
});

test("修剪与读取并发：列举后被修剪的记录当作消失、不计 skipped；列举后被顶替的仍计 skipped（D7c）", async (t) => {
  const { root, path: workspace } = await fixture(t);
  const directory = hooksDirectory(workspace, "claude-code");
  // 第二个句柄代表并发写入的 hook 进程；在测试体内确定性关闭，不交给 `t.after`——
  // fixture 的 after 先注册、先运行并删掉临时目录，之后再 close 会让清理挂住。
  const writer = await RootedDirectory.open(workspace);
  try {
    await concurrentPruneDuringRead(root, writer, workspace, directory);
  } finally {
    await writer.close();
  }
});

async function concurrentPruneDuringRead(
  root: RootedDirectory,
  writer: RootedDirectory,
  workspace: string,
  directory: string,
): Promise<void> {
  // 先写两条近期记录再写一条 90 天前的：写 stale 时基准取它自己（更小），所以它自己不被修剪；
  // 之后那条"现在"的写入把基准抬到 28 天前，截止线落在 58 天前，stale 才轮到被修剪。
  const kept = await writeHostHookObservation(writer, observation(workspace, ago(29 * DAY)));
  const replaced = await writeHostHookObservation(
    writer,
    observation(workspace, ago(28 * DAY), { sessionId: "other-session" }),
  );
  const stale = await writeHostHookObservation(writer, observation(workspace, ago(90 * DAY)));
  let interleaved = 0;
  const concurrent = await readHostHookObservationsInterleaved(
    root,
    "claude-code",
    {},
    async () => {
      interleaved += 1;
      // 读取方已列举到 stale、kept、replaced；此刻异步 hook 写入一条新记录并修剪掉 stale。
      await writeHostHookObservation(writer, observation(workspace, ago(0)));
      // 同一时刻另一条被顶替成不同内容：这不是消失，是读不出。
      unlinkSync(path.join(directory, recordName(replaced)));
      writeFileSync(path.join(directory, recordName(replaced)), "{}\n", { mode: 0o600 });
    },
  );
  equal(interleaved, 1);
  deepEqual(
    concurrent.records.map((record) => record.recordId),
    [kept.record.recordId],
  );
  equal(concurrent.skipped, 1);
  equal(hookEntries(directory).includes(recordName(stale)), false);

  const settled = await readHostHookObservations(root, "claude-code");
  equal(settled.records.length, 2);
  equal(settled.skipped, 1);
  unlinkSync(path.join(directory, recordName(replaced)));
  equal((await readHostHookObservations(root, "claude-code")).skipped, 0);
}

/**
 * 越界目录的合成条目：无法识别的名字最便宜，而且修剪按定义不碰它们（D7b），所以填多少个，
 * 修剪之后读取报的 `skipped` 就还是多少个。
 */
const OVERSIZED_UNRECOGNIZED = 16_300;
/** 过期记录数：足以把目录从读取上限之上带回上限之下，又不必 unlink 上万个文件。 */
const OVERSIZED_EXPIRED = 96;

function fillOversizedDirectory(directory: string): void {
  for (let index = 0; index < OVERSIZED_UNRECOGNIZED; index += 1) {
    writeFileSync(path.join(directory, `stray-${index.toString(16).padStart(6, "0")}.txt`), "x\n", {
      mode: 0o600,
    });
  }
  for (let index = 0; index < OVERSIZED_EXPIRED; index += 1) {
    const hex = index.toString(16).padStart(12, "0");
    writeFileSync(
      path.join(directory, `20200101T000000000Z-stop-00000000-0000-4000-8000-${hex}.json`),
      "garbage\n",
      { mode: 0o600 },
    );
  }
}

test("旧目录超过 16384 项仍可分页完整读取与按龄修剪，未知条目不被删除", {
  timeout: 120_000,
}, async (t) => {
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

test("制品 manifest 摘要是后加的可选键：旧记录没有它读成 null，新记录原样往返（§13.127）", async (t) => {
  const { root, path: workspace } = await fixture(t);
  const artifact = `sha256:${"c".repeat(64)}` as Sha256Digest;
  const written = await writeHostHookObservation(
    root,
    observation(workspace, "2026-09-18T12:00:00.000Z" as UtcInstant, {
      event: "session-start",
      artifactManifestDigest: artifact,
    }),
  );
  equal(written.record.artifactManifestDigest, artifact);
  // 旧记录：恰好十二个键，没有 artifactManifestDigest——把内核自己写出的规范文件去掉这个键再放回去。
  const legacy = await writeHostHookObservation(
    root,
    observation(workspace, "2026-09-18T11:00:00.000Z" as UtcInstant, { event: "session-start" }),
  );
  const legacyPath = path.join(
    hooksDirectory(workspace, "claude-code"),
    path.basename(legacy.resourceRef),
  );
  renameSync(path.join(workspace, legacy.resourceRef), legacyPath);
  const rendered = readFileSync(legacyPath, "utf8");
  const parsed = JSON.parse(rendered) as Record<string, unknown>;
  delete parsed.artifactManifestDigest;
  const sorted = Object.fromEntries(
    Object.entries(parsed).sort(([left], [right]) => (left < right ? -1 : 1)),
  );
  writeFileSync(
    legacyPath,
    rendered.startsWith("{\n")
      ? `${JSON.stringify(sorted, null, 2)}\n`
      : `${JSON.stringify(sorted)}\n`,
  );
  const legacyBytes = readFileSync(legacyPath);
  const retried = await writeHostHookObservation(root, legacy.record);
  equal(retried.disposition, "current");
  equal(path.join(workspace, retried.resourceRef), legacyPath);
  deepEqual(readFileSync(legacyPath), legacyBytes);
  const inventory = await readHostHookObservations(root, "claude-code");
  equal(inventory.skipped, 0);
  deepEqual(
    inventory.records.map((record) => [record.recordId, record.artifactManifestDigest]),
    [
      [legacy.record.recordId, null],
      [written.record.recordId, artifact],
    ],
  );
});

// ---- §13.134 B12：原子暂存残留 --------------------------------------------------------------

const MINUTE = 60 * 1000;
/** 远早于任何一次测试运行的 mtime：只用来造"被遗弃"的暂存文件，测试不读墙钟。 */
const ANCIENT = new Date(Date.UTC(2020, 0, 1));
/** 不可能存在的进程号：`kill(pid, 0)` 恒为 ESRCH，foundation 据此把所有者判定为 `inactive`。 */
const DEAD_PID = 99_999_999;

/**
 * 与 foundation 签发的暂存名同形（`.wakeflow-atomic-v1-<操作>-<目标摘要>-<输入摘要>-m<权限位>__
 * <pid>-<线程>-<尝试>.tmp`）；§13.133 现场留下的就是 `create`、`m600` 这一种，所有者是被杀掉的 hook。
 */
function stageName(
  attempt: number,
  options: {
    readonly operation?: "create" | "replace";
    readonly mode?: string;
    readonly pid?: number;
  } = {},
): string {
  const { operation = "create", mode = "600", pid = DEAD_PID } = options;
  const uuid = `00000000-0000-4000-8000-${attempt.toString(16).padStart(12, "0")}`;
  return `.wakeflow-atomic-v1-${operation}-${"a".repeat(64)}-${"b".repeat(64)}-m${mode}__${pid}-0-${uuid}.tmp`;
}

test("写入器自己的原子暂存文件既不是记录也不计 skipped；别的暂存形状与无法识别的名字照计（§13.134 B12）", async (t) => {
  const { root, path: workspace } = await fixture(t);
  const directory = hooksDirectory(workspace, "claude-code");
  // 测试造的名字必须是 foundation 认的暂存名，否则下面测到的只是"无法识别"那条路径。
  const address = parseDurableAtomicFileStageFileName(stageName(1));
  equal(address.operation, "create");
  equal(address.mode, 0o600);
  equal(address.pid, DEAD_PID);
  const start = await writeHostHookObservation(
    root,
    observation(workspace, ago(0), { event: "session-start" }),
  );
  // §13.133 现场：kill-window 在原子创建中途杀掉 session-end hook，暂存文件里是一条完整记录。
  // 仍在写的 hook 的暂存文件（所有者还活着）对并发读取同样可见，同样不计。
  const content = readFileSync(path.join(directory, recordName(start)));
  writeFileSync(path.join(directory, stageName(1)), content, { mode: 0o600 });
  writeFileSync(path.join(directory, stageName(2, { pid: process.pid })), "partial", {
    mode: 0o600,
  });
  const withStage = await readHostHookObservations(root, "claude-code");
  deepEqual(
    withStage.records.map((record) => record.recordId),
    [start.record.recordId],
  );
  equal(withStage.skipped, 0);
  // 本写入器留不下的暂存形状、前缀对但格式不对的名字、暂存命名的目录与符号链接、无法识别的名字：
  // 都不是本写入器的暂存文件，照样计入 skipped，留给 verify 的门。
  writeFileSync(path.join(directory, stageName(3, { operation: "replace" })), content, {
    mode: 0o600,
  });
  writeFileSync(path.join(directory, stageName(4, { mode: "644" })), content, { mode: 0o600 });
  writeFileSync(path.join(directory, ".wakeflow-atomic-v1-create-not-a-stage.tmp"), content, {
    mode: 0o600,
  });
  mkdirSync(path.join(directory, stageName(5)));
  symlinkSync(path.join(directory, recordName(start)), path.join(directory, stageName(6)));
  writeFileSync(path.join(directory, "stray.txt"), "x\n", { mode: 0o600 });
  // 名字是写入器形状、节点却不是：权限位不是 0600，或链接数超过 2（本写入器最多双链接）。
  // foundation 的写前暂存清点会因它拒绝整个目录的写入，所以必须计入 skipped 让 verify 看见。
  writeFileSync(path.join(directory, stageName(7)), content);
  chmodSync(path.join(directory, stageName(7)), 0o644);
  const spare = path.join(directory, "spare.bin");
  writeFileSync(spare, content, { mode: 0o600 });
  chmodSync(spare, 0o600);
  linkSync(spare, path.join(directory, stageName(8)));
  linkSync(spare, path.join(directory, stageName(9)));
  equal(statSync(spare).nlink, 3);
  const mixed = await readHostHookObservations(root, "claude-code");
  deepEqual(
    mixed.records.map((record) => record.recordId),
    [start.record.recordId],
  );
  equal(mixed.skipped, 10);
});

test("被遗弃的暂存文件在下一次新落地记录时退休：只动够旧、所有者已不在的写入器形状普通暂存文件（§13.134 B12）", async (t) => {
  const { root, path: workspace } = await fixture(t);
  const directory = hooksDirectory(workspace, "claude-code");
  equal(HOST_HOOK_ABANDONED_STAGE_MILLISECONDS, 10 * MINUTE);
  // 目录里只有一个被遗弃的暂存文件、没有别的记录：记录修剪因此不跑，暂存文件的退休照样跑。
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  writeFileSync(path.join(directory, stageName(1)), "partial", { mode: 0o600 });
  utimesSync(path.join(directory, stageName(1)), ANCIENT, ANCIENT);
  const first = await writeHostHookObservation(root, observation(workspace, ago(3)));
  equal(first.disposition, "created");
  deepEqual(hookEntries(directory), [recordName(first)]);

  // 先落地第二条记录（稍后给它挂一个双链接的暂存文件），再摆放暂存文件，让下一次写入独自退休它们。
  const linked = await writeHostHookObservation(
    root,
    observation(workspace, ago(2), { event: "session-end" }),
  );
  // 退休的基准是刚落地那条记录文件的 mtime，不是 recordedAt（这里的 recordedAt 都是合成时刻）。
  // 以 linked 的 mtime 为参照摆放暂存文件：下一条记录的 mtime 只会更晚，差不到一分钟。
  const reference = statSync(path.join(directory, recordName(linked))).mtimeMs;
  const place = (name: string, mtime: Date | null): void => {
    writeFileSync(path.join(directory, name), "partial", { mode: 0o600 });
    if (mtime !== null) utimesSync(path.join(directory, name), mtime, mtime);
  };
  place(stageName(2), new Date(reference - 11 * MINUTE));
  // 九分钟前的与刚创建的：可能属于仍在写的 hook，不动。
  place(stageName(3), new Date(reference - 9 * MINUTE));
  place(stageName(4), null);
  // 够旧但所有者进程还活着（例如机器休眠时挂在写入中途的 hook）：不动。
  place(stageName(5, { pid: process.ppid }), ANCIENT);
  // 本写入器留不下的暂存形状与无法识别的名字：再旧也不修剪。暂存命名的目录与符号链接这里摆不了：
  // foundation 的原子写入在写前清点同目录的全部暂存命名条目，见到非普通文件就拒绝写入。
  place(stageName(6, { operation: "replace" }), ANCIENT);
  place(stageName(7, { mode: "644" }), ANCIENT);
  place("stray.txt", ANCIENT);
  // 创建在两次同步之间被杀：暂存文件与已发布的记录双链接。退休它只让链接数减一，记录照读。
  linkSync(path.join(directory, recordName(linked)), path.join(directory, stageName(8)));
  utimesSync(path.join(directory, stageName(8)), ANCIENT, ANCIENT);
  equal(statSync(path.join(directory, recordName(linked))).nlink, 2);

  const next = await writeHostHookObservation(root, observation(workspace, ago(1)));
  equal(next.disposition, "created");
  deepEqual(
    hookEntries(directory).sort(),
    [
      recordName(first),
      recordName(linked),
      recordName(next),
      stageName(3),
      stageName(4),
      stageName(5, { pid: process.ppid }),
      stageName(6, { operation: "replace" }),
      stageName(7, { mode: "644" }),
      "stray.txt",
    ].sort(),
  );
  equal(statSync(path.join(directory, recordName(linked))).nlink, 1);
  const inventory = await readHostHookObservations(root, "claude-code");
  deepEqual(
    inventory.records.map((record) => record.recordId),
    [first.record.recordId, linked.record.recordId, next.record.recordId],
  );
  // 留下的三个写入器暂存文件不计；replace、m644、stray.txt 照计。
  equal(inventory.skipped, 3);

  // 幂等重写没有新证据落地，整条修剪路径跳过；下一次 created 才退休变旧的暂存文件。
  utimesSync(path.join(directory, stageName(3)), ANCIENT, ANCIENT);
  const again = await writeHostHookObservation(root, observation(workspace, ago(1)));
  equal(again.disposition, "current");
  equal(existsSync(path.join(directory, stageName(3))), true);
  const latest = await writeHostHookObservation(root, observation(workspace, ago(0)));
  equal(latest.disposition, "created");
  equal(existsSync(path.join(directory, stageName(3))), false);
  equal(existsSync(path.join(directory, stageName(4))), true);
  equal(existsSync(path.join(directory, stageName(5, { pid: process.ppid }))), true);
});

test("旧平铺目录的 16385 条近期有效记录可完整扫描，目标查询与逐条证据读取不截断", {
  timeout: 240_000,
}, async (t) => {
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

test("有限结果明确报告不完整；损坏旧目录不会阻断新分片，未知文件保留", async (t) => {
  const { root, path: workspace } = await fixture(t);
  const directory = hooksDirectory(workspace, "claude-code");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const unknown = path.join(directory, ".wakeflow-atomic-invalid");
  writeFileSync(unknown, "unowned", { mode: 0o600 });
  const first = await writeHostHookObservation(root, observation(workspace, AT(0)));
  const second = await writeHostHookObservation(root, observation(workspace, AT(1)));
  equal(first.disposition, "created");
  equal(second.disposition, "created");
  const limited = await readHostHookObservations(root, "claude-code", { limit: 1 });
  equal(limited.complete, false);
  equal(limited.skipped, 1);
  equal(limited.records[0]?.recordId, first.record.recordId);
  equal(readFileSync(unknown, "utf8"), "unowned");
  const exact = await readHostHookObservationRecord(root, "claude-code", second.record.recordId);
  equal(exact?.record.recordId, second.record.recordId);
  // A valid fact at the wrong partition must not be accepted as authority.
  const misplaced = path.join(directory, "20260904", "ff", path.basename(first.resourceRef));
  mkdirSync(path.dirname(misplaced), { recursive: true, mode: 0o700 });
  if (misplaced !== path.join(workspace, first.resourceRef)) {
    writeFileSync(misplaced, readFileSync(path.join(workspace, first.resourceRef)), {
      mode: 0o600,
    });
    equal((await readHostHookObservations(root, "claude-code")).skipped, 2);
  }
});

test("密集历史也按龄退役：基准取最新的另一条记录，只走截止日之前的日目录，清空的分片与日目录随手回收（§13.161 H2-01/H2-02）", {
  timeout: 120_000,
}, async (t) => {
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

test("外来点文件不计，外来文件名只计 skipped，记录命名却读不出或叶子位置上的目录才计 unreadable（§13.161 B5-1）", async (t) => {
  const { root, path: workspace } = await fixture(t);
  const directory = hooksDirectory(workspace, "claude-code");
  const kept = await writeHostHookObservation(root, observation(workspace, ago(DAY)));
  writeFileSync(path.join(directory, ".DS_Store"), "x", { mode: 0o600 });
  writeFileSync(path.join(directory, "notes.txt"), "x", { mode: 0o600 });
  writeFileSync(path.join(directory, `20260901T000000000Z-stop-${OLD_UUID}.json`), "garbage\n", {
    mode: 0o600,
  });
  mkdirSync(path.join(directory, "stray-directory"));
  const inventory = await readHostHookObservations(root, "claude-code");
  deepEqual(
    inventory.records.map((record) => record.recordId),
    [kept.record.recordId],
  );
  // notes.txt、读不出的记录、目录各计一次 skipped；只有后两者可能藏着记录，计入 unreadable。
  equal(inventory.skipped, 3);
  equal(inventory.unreadable, 2);
  equal(inventory.complete, true);
});
