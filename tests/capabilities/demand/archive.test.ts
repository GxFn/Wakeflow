import { deepEqual, equal, rejects } from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import {
  payloadTexts,
  restoreCandidateOwner,
  restoreDemandRoot,
  retireDemandRoot,
  retiredDemandRootOwner,
} from "../../../src/capabilities/demand/archive.js";
import { payloadPrivacyBlockers } from "../../../src/capabilities/demand/decide.js";
import { computeSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import { parsePortableResourcePath } from "../../../src/foundation/filesystem/portable-resource-path.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { demandFinalRootRef } from "../../../src/kernel/layout.js";
import { WakeflowError } from "../../../src/kernel/error.js";
import { useDisposableDurability } from "../../support/disposable-durability.js";
import { disposableRoot } from "../../support/temp-root.js";

useDisposableDurability();

/**
 * 归档包与活动根的物理操作（能力卡 8）：负载文本的宽松解码（§13.161 B9-3）与活动根退役——负载摘要漂移
 * 拒绝删根，日志授权的残根清除跳过摘要比对但仍只接受普通文件与目录（open-items W19）；退役根的名字
 * 只认本 Demand 的，根已不在时清掉它们（1.4.1 段 1b）。级别 1（组件，一次性根目录）。
 */

function file(resourcePath: string, bytes: Uint8Array) {
  return {
    resourcePath: parsePortableResourcePath(resourcePath),
    bytes,
    digest: computeSha256Digest(bytes),
  };
}

test("归档负载里夹着二进制字节的文件仍按宽松解码做凭证扫描（§13.161 B9-3）", () => {
  const secret = "synthetic".repeat(3);
  const binary = Buffer.concat([
    Buffer.from([0xff, 0xfe, 0x00]),
    Buffer.from(`\nTOKEN=${secret}\n`),
  ]);
  const texts = payloadTexts([
    file("artifacts/a.bin", binary),
    file("artifacts/b.md", Buffer.from("plain\n")),
  ]);
  equal(texts.length, 2);
  equal(texts[0]?.text.includes(`TOKEN=${secret}`), true);
  deepEqual(payloadPrivacyBlockers(texts), [
    "payload-privacy:artifacts/a.bin:2:credential-assignment",
  ]);
});

const RESIDUAL_DEMAND_ID = "demand_22222222-2222-4222-8222-222222222222";

/** 一个删根中断留下的残根：身份记录已删，权威记录与一条提交还在。 */
function writeResidualRoot(demandRoot: string): void {
  mkdirSync(path.join(demandRoot, "event-sourcing", "commits"), { recursive: true, mode: 0o700 });
  writeFileSync(path.join(demandRoot, "authority.json"), "{}\n", { mode: 0o600 });
  writeFileSync(
    path.join(demandRoot, "event-sourcing", "commits", "0000000000000001.json"),
    "{}\n",
    {
      mode: 0o600,
    },
  );
}

test("活动根退役：负载摘要漂移拒绝删根；日志授权的残根清除跳过比对、删后根已消失；符号链接仍拒绝（W19）", async (t) => {
  const root = disposableRoot(t, "wakeflow-demand-retire-");
  const demandRoot = path.join(root, ...demandFinalRootRef(RESIDUAL_DEMAND_ID).split("/"));
  const archivedDigest = computeSha256Digest(Buffer.from("the sealed payload tree\n"));
  const workspaceRoot = await RootedDirectory.open(root);
  try {
    writeResidualRoot(demandRoot);
    await rejects(
      retireDemandRoot(workspaceRoot, RESIDUAL_DEMAND_ID, archivedDigest, undefined),
      (error: unknown) =>
        error instanceof WakeflowError &&
        error.code === "precondition-failed" &&
        error.reason === "demand-root-drift" &&
        error.retryable === true,
    );
    equal(existsSync(demandRoot), true, "a drifting root must survive");
    equal(
      await retireDemandRoot(workspaceRoot, RESIDUAL_DEMAND_ID, archivedDigest, undefined, {
        residual: true,
      }),
      "retired",
    );
    equal(existsSync(demandRoot), false, "the residual root survived");
    deepEqual(readdirSync(path.dirname(demandRoot)), [], "a retired root was left behind");
    equal(
      await retireDemandRoot(workspaceRoot, RESIDUAL_DEMAND_ID, archivedDigest, undefined, {
        residual: true,
      }),
      "absent",
    );
    writeResidualRoot(demandRoot);
    symlinkSync(path.join(demandRoot, "authority.json"), path.join(demandRoot, "link.json"));
    await rejects(
      retireDemandRoot(workspaceRoot, RESIDUAL_DEMAND_ID, archivedDigest, undefined, {
        residual: true,
      }),
      (error: unknown) =>
        error instanceof WakeflowError && error.reason === "demand-root-special-node",
    );
    equal(existsSync(demandRoot), true, "a root with a symbolic link must survive");
  } finally {
    await workspaceRoot.close();
  }
});

const OTHER_DEMAND_ID = "demand_33333333-3333-4333-8333-333333333333";
const RETIRE_UUID_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const RETIRE_UUID_B = "bbbbbbbb-bbbb-4bbb-9bbb-bbbbbbbbbbbb";
const RETIRE_UUID_C = "cccccccc-cccc-4ccc-accc-cccccccccccc";
const RETIRE_UUID_D = "dddddddd-dddd-4ddd-bddd-dddddddddddd";

test("退役根的名字：只认 .retire-<demandId>-<uuid>，返回它属于哪个 Demand", () => {
  equal(
    retiredDemandRootOwner(`.retire-${RESIDUAL_DEMAND_ID}-${RETIRE_UUID_A}`),
    RESIDUAL_DEMAND_ID,
  );
  equal(retiredDemandRootOwner(`.retire-${OTHER_DEMAND_ID}-${RETIRE_UUID_A}`), OTHER_DEMAND_ID);
  for (const name of [
    RESIDUAL_DEMAND_ID,
    `.restore-${RESIDUAL_DEMAND_ID}-${RETIRE_UUID_A}`,
    `.retire-${RESIDUAL_DEMAND_ID}`,
    `.retire-${RESIDUAL_DEMAND_ID}-${RETIRE_UUID_A.slice(0, -1)}`,
    `.retire-${RESIDUAL_DEMAND_ID}-${RETIRE_UUID_A}.tmp`,
    `x.retire-${RESIDUAL_DEMAND_ID}-${RETIRE_UUID_A}`,
    `.retire-${RESIDUAL_DEMAND_ID.toUpperCase()}-${RETIRE_UUID_A}`,
  ]) {
    equal(retiredDemandRootOwner(name), null, name);
  }
});

test("活动根退役：根已不在时清掉本 Demand 的退役根（整棵、没有顶层文件的、空的），别的名字原样留着", async (t) => {
  const root = disposableRoot(t, "wakeflow-demand-retired-roots-");
  const current = path.dirname(
    path.join(root, ...demandFinalRootRef(RESIDUAL_DEMAND_ID).split("/")),
  );
  const archivedDigest = computeSha256Digest(Buffer.from("the sealed payload tree\n"));
  const full = `.retire-${RESIDUAL_DEMAND_ID}-${RETIRE_UUID_A}`;
  const hollow = `.retire-${RESIDUAL_DEMAND_ID}-${RETIRE_UUID_B}`;
  const empty = `.retire-${RESIDUAL_DEMAND_ID}-${RETIRE_UUID_C}`;
  const regularFile = `.retire-${RESIDUAL_DEMAND_ID}-${RETIRE_UUID_D}`;
  const foreign = `.retire-${OTHER_DEMAND_ID}-${RETIRE_UUID_A}`;
  const restoring = `.restore-${RESIDUAL_DEMAND_ID}-${RETIRE_UUID_A}`;
  writeResidualRoot(path.join(current, full));
  mkdirSync(path.join(current, hollow, "event-sourcing", "index"), {
    recursive: true,
    mode: 0o700,
  });
  mkdirSync(path.join(current, empty), { mode: 0o700 });
  writeFileSync(path.join(current, regularFile), "not a retired root\n", { mode: 0o600 });
  writeResidualRoot(path.join(current, foreign));
  mkdirSync(path.join(current, restoring), { mode: 0o700 });
  const workspaceRoot = await RootedDirectory.open(root);
  try {
    equal(
      await retireDemandRoot(workspaceRoot, RESIDUAL_DEMAND_ID, archivedDigest, undefined),
      "absent",
    );
    deepEqual(readdirSync(current).sort(), [foreign, regularFile, restoring].sort());
    equal(existsSync(path.join(current, foreign, "authority.json")), true);
  } finally {
    await workspaceRoot.close();
  }
});

test("放回活动根：先清掉本 Demand 的退役根与上一次被杀的放回留下的候选树，别的 Demand 的原样留着", async (t) => {
  const root = disposableRoot(t, "wakeflow-demand-restore-residue-");
  const demandRoot = path.join(root, ...demandFinalRootRef(RESIDUAL_DEMAND_ID).split("/"));
  const current = path.dirname(demandRoot);
  const retired = `.retire-${RESIDUAL_DEMAND_ID}-${RETIRE_UUID_A}`;
  const orphan = `.restore-${RESIDUAL_DEMAND_ID}-${RETIRE_UUID_B}`;
  const foreignOrphan = `.restore-${OTHER_DEMAND_ID}-${RETIRE_UUID_B}`;
  equal(restoreCandidateOwner(orphan), RESIDUAL_DEMAND_ID);
  equal(restoreCandidateOwner(retired), null);
  equal(retiredDemandRootOwner(orphan), null);
  writeResidualRoot(path.join(current, retired));
  writeResidualRoot(path.join(current, orphan));
  writeResidualRoot(path.join(current, foreignOrphan));
  const workspaceRoot = await RootedDirectory.open(root);
  try {
    const restored = await restoreDemandRoot(
      workspaceRoot,
      RESIDUAL_DEMAND_ID,
      [file("identity.json", Buffer.from("{}\n"))],
      undefined,
    );
    equal(restored, "restored");
    deepEqual(readdirSync(current).sort(), [foreignOrphan, RESIDUAL_DEMAND_ID].sort());
    equal(existsSync(path.join(demandRoot, "identity.json")), true);
    // 根已经在时不再清：那是另一条路径（沿用已放回的根）。
    writeResidualRoot(path.join(current, orphan));
    equal(await restoreDemandRoot(workspaceRoot, RESIDUAL_DEMAND_ID, [], undefined), "current");
    equal(existsSync(path.join(current, orphan)), true);
  } finally {
    await workspaceRoot.close();
  }
});
