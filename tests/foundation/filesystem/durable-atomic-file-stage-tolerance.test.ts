import { equal, rejects } from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { type TestContext, test } from "node:test";

import {
  DurableAtomicFileStageRecoveryError,
  recoverDurableAtomicFileStagesForTargets,
  recoverDurableAtomicFileStagesInDirectory,
  recoverDurableAtomicFileStagesMatchingTargets,
} from "../../../src/foundation/filesystem/durable-atomic-file-stage-recovery.js";
import { createFileAtomically } from "../../../src/foundation/filesystem/durable-atomic-file-write.js";
import { parsePortableResourcePath } from "../../../src/foundation/filesystem/portable-resource-path.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { encodeUtf8 } from "../../../src/foundation/text/utf8.js";

async function fixture(t: TestContext): Promise<{ root: RootedDirectory; directory: string }> {
  const directory = realpathSync(mkdtempSync(path.join(os.tmpdir(), "wakeflow-stage-tolerance-")));
  mkdirSync(path.join(directory, "records"), { mode: 0o700 });
  // 两个形状不对的带前缀条目：一个目录、一个名字不合法的普通文件。
  mkdirSync(path.join(directory, "records", ".wakeflow-atomic-invalid-directory"), { mode: 0o700 });
  writeFileSync(path.join(directory, "records", ".wakeflow-atomic-stray.tmp"), "stray\n", { mode: 0o600 });
  const root = await RootedDirectory.open(directory, "$root", { durability: "none" });
  t.after(async () => {
    await root.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return { root, directory };
}

test("形状不对的暂存条目不再挡住同目录的写入：按目标匹配的恢复只计数，目录级与闭合集合的恢复仍拒绝（B13）", async (t) => {
  const { root, directory } = await fixture(t);
  const target = parsePortableResourcePath("records/record.json");
  const matching = await recoverDurableAtomicFileStagesMatchingTargets(root, [target]);
  equal(matching.unrecognizedEntryCount, 2);
  equal(matching.observedStageCount, 0);
  await createFileAtomically(root, target, encodeUtf8('{"ok":true}\n'), {
    mode: 0o600,
    durability: "none",
  });
  equal(readFileSync(path.join(directory, "records", "record.json"), "utf8"), '{"ok":true}\n');
  await rejects(
    recoverDurableAtomicFileStagesForTargets(root, [target]),
    (error: unknown) => error instanceof DurableAtomicFileStageRecoveryError && error.reason === "inventory",
  );
  await rejects(
    recoverDurableAtomicFileStagesInDirectory(root, parsePortableResourcePath("records")),
    (error: unknown) => error instanceof DurableAtomicFileStageRecoveryError && error.reason === "inventory",
  );
});
