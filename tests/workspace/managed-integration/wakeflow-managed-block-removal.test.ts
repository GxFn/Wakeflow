import { deepEqual, equal, rejects } from "node:assert/strict";
import { chmodSync, existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { type TestContext, test } from "node:test";

import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import {
  inspectWakeflowManagedBlockRemoval,
  removeWakeflowManagedBlockFile,
  WakeflowManagedBlockFileError,
} from "../../../src/workspace/managed-integration/wakeflow-managed-block-file.js";
import { recomposeWakeflowManagedTextEnvelope } from "../../../src/workspace/managed-integration/wakeflow-managed-text-envelope.js";
import { useDisposableDurability } from "../../support/disposable-durability.js";
import { disposableRoot } from "../../support/temp-root.js";

useDisposableDurability();

/**
 * 1 级（组件）：托管块的精确删除（ADR-0024 的 `remove-managed-block`）。只有正文等于某个已知渲染
 * （当前渲染或已登记的历史渲染）才删；块删掉后文件为空（只剩空白）则删文件，否则保留其余内容并
 * 保留权限位；没有块的文件与不在的文件都是 absent / current；正文未知即 `unknown-managed-body`，
 * 另一个 component/owner 的块是 `envelope`。
 */

const IDENTITY = Object.freeze({
  component: "repository-instruction",
  owner: "host-instruction-integration",
});
const CURRENT = Object.freeze({ ...IDENTITY, body: "Current render.\n" });
const HISTORICAL = Object.freeze({ ...IDENTITY, body: "Older render.\n" });
const FOREIGN = Object.freeze({ ...IDENTITY, body: "Another workspace's render.\n" });

async function fixture(t: TestContext) {
  const absolutePath = disposableRoot(t, "wakeflow-managed-block-removal-");
  const root = await RootedDirectory.open(absolutePath);
  t.after(() => root.close());
  return Object.freeze({ absolutePath, root });
}

function block(target: Readonly<{ component: string; owner: string; body: string }>, outside = "") {
  return Buffer.from(
    recomposeWakeflowManagedTextEnvelope(Buffer.from(outside, "utf8"), target).bytes,
  );
}

/** 写夹具文件并显式设权限位（`writeFileSync` 的 mode 会被 umask 削掉 group-write）。 */
function write(absolutePath: string, name: string, bytes: Uint8Array, mode = 0o644): string {
  const file = path.join(absolutePath, name);
  writeFileSync(file, bytes, { mode });
  chmodSync(file, mode);
  return file;
}

test("block that is the whole file is removed and the empty file is deleted", async (t) => {
  const { absolutePath, root } = await fixture(t);
  const file = write(absolutePath, "AGENTS.md", block(CURRENT));
  const inspected = await inspectWakeflowManagedBlockRemoval(root, {
    resourcePath: "AGENTS.md",
    admittedTargets: [CURRENT],
  });
  equal(inspected.status, "removal-required");
  equal(inspected.target?.deletesFile, true);
  equal(existsSync(file), true, "inspection must not write");

  const removed = await removeWakeflowManagedBlockFile(root, {
    resourcePath: "AGENTS.md",
    admittedTargets: [CURRENT],
  });
  equal(removed.disposition, "deleted");
  equal(existsSync(file), false);

  const again = await removeWakeflowManagedBlockFile(root, {
    resourcePath: "AGENTS.md",
    admittedTargets: [CURRENT],
  });
  equal(again.disposition, "current");
  equal(again.inspection.status, "absent");
});

test("block inside user content is removed byte for byte and the owner mode is kept", async (t) => {
  const { absolutePath, root } = await fixture(t);
  const outside = "# Product A\n\nUser text stays.\n";
  const file = write(absolutePath, "AGENTS.md", block(CURRENT, outside), 0o664);
  const removed = await removeWakeflowManagedBlockFile(root, {
    resourcePath: "AGENTS.md",
    admittedTargets: [CURRENT],
  });
  equal(removed.disposition, "replaced");
  equal(readFileSync(file, "utf8"), outside);
  equal(statSync(file).mode & 0o777, 0o664);
  equal(removed.inspection.status, "absent");
  equal(removed.inspection.source?.byteCount, Buffer.byteLength(outside, "utf8"));
});

test("historical render is admitted when registered, unknown body and foreign owner are refused", async (t) => {
  const { absolutePath, root } = await fixture(t);
  write(absolutePath, "AGENTS.md", block(HISTORICAL));
  await rejects(
    inspectWakeflowManagedBlockRemoval(root, {
      resourcePath: "AGENTS.md",
      admittedTargets: [CURRENT],
    }),
    (error: unknown) =>
      error instanceof WakeflowManagedBlockFileError && error.reason === "unknown-managed-body",
  );
  const admitted = await removeWakeflowManagedBlockFile(root, {
    resourcePath: "AGENTS.md",
    admittedTargets: [CURRENT, HISTORICAL],
  });
  equal(admitted.disposition, "deleted");

  write(absolutePath, "FOREIGN.md", block(FOREIGN));
  await rejects(
    removeWakeflowManagedBlockFile(root, {
      resourcePath: "FOREIGN.md",
      admittedTargets: [CURRENT, HISTORICAL],
    }),
    (error: unknown) =>
      error instanceof WakeflowManagedBlockFileError && error.reason === "unknown-managed-body",
  );
  equal(
    existsSync(path.join(absolutePath, "FOREIGN.md")),
    true,
    "unknown bodies are never touched",
  );

  write(
    absolutePath,
    "OTHER.md",
    block({ component: "support-instruction", owner: IDENTITY.owner, body: "x\n" }),
  );
  await rejects(
    inspectWakeflowManagedBlockRemoval(root, {
      resourcePath: "OTHER.md",
      admittedTargets: [CURRENT],
    }),
    (error: unknown) =>
      error instanceof WakeflowManagedBlockFileError && error.reason === "envelope",
  );
});

test("files without a block and admitted-target shape are closed at the boundary", async (t) => {
  const { absolutePath, root } = await fixture(t);
  write(absolutePath, "PLAIN.md", Buffer.from("no block here\n", "utf8"));
  const plain = await inspectWakeflowManagedBlockRemoval(root, {
    resourcePath: "PLAIN.md",
    admittedTargets: [CURRENT],
  });
  equal(plain.status, "absent");
  equal(plain.source !== null, true);
  equal(plain.target, null);
  deepEqual({ ...plain.identity }, { ...IDENTITY });

  for (const admittedTargets of [[], [CURRENT, CURRENT], [CURRENT, { ...CURRENT, owner: "x" }]]) {
    await rejects(
      inspectWakeflowManagedBlockRemoval(root, { resourcePath: "PLAIN.md", admittedTargets }),
      (error: unknown) =>
        error instanceof WakeflowManagedBlockFileError && error.reason === "input",
    );
  }
});
