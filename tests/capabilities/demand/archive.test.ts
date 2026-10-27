import { deepEqual, equal, rejects } from "node:assert/strict";
import { existsSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { payloadTexts, retireDemandRoot } from "../../../src/capabilities/demand/archive.js";
import { payloadPrivacyBlockers } from "../../../src/capabilities/demand/decide.js";
import { computeSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import { parsePortableResourcePath } from "../../../src/foundation/filesystem/portable-resource-path.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { demandFinalRootRef } from "../../../src/governance/demand/publication/demand-publication-paths.js";
import { WakeflowError } from "../../../src/kernel/error.js";
import { useDisposableDurability } from "../../support/disposable-durability.js";
import { disposableRoot } from "../../support/temp-root.js";

useDisposableDurability();

/**
 * 归档包与活动根的物理操作（能力卡 8）：负载文本的宽松解码（§13.161 B9-3）与活动根退役——负载摘要漂移
 * 拒绝删根，日志授权的残根清除跳过摘要比对但仍只接受普通文件与目录（open-items W19）。级别 1（组件，
 * 一次性根目录）。
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
