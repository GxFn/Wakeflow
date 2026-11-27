import { equal, rejects } from "node:assert/strict";
import { linkSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  DurableRegularFileSettlementError,
  type DurableRegularFileSettlementErrorReason,
  settleRegularFileDurability,
} from "../../../src/foundation/filesystem/durable-regular-file-settlement.js";
import { sameFileNodeSnapshot } from "../../../src/foundation/filesystem/file-node-snapshot.js";
import {
  type PortableResourcePath,
  parsePortableResourcePath,
} from "../../../src/foundation/filesystem/portable-resource-path.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { OperationAbortedError } from "../../../src/foundation/node/abort-signal.js";
import { countFsyncs } from "./fsync-count-probe.js";

async function expectSettlementError(
  action: () => unknown | Promise<unknown>,
  reason: DurableRegularFileSettlementErrorReason,
  expectedPath: string,
): Promise<void> {
  let caught: unknown;
  try {
    await action();
  } catch (error: unknown) {
    caught = error;
  }
  if (!(caught instanceof DurableRegularFileSettlementError)) {
    throw new Error("Expected DurableRegularFileSettlementError.");
  }
  equal(caught.code, "wakeflow-durable-regular-file-settlement");
  equal(caught.reason, reason);
  equal(caught.path, expectedPath);
}

function asPortableResourcePath(value: unknown): PortableResourcePath {
  return value as PortableResourcePath;
}

test("exact linked target settlement 同步 file 与 destination parent", {
  concurrency: false,
}, async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-file-settlement-"));
  mkdirSync(path.join(rootPath, "candidates"), { mode: 0o700 });
  mkdirSync(path.join(rootPath, "commits"), { mode: 0o700 });
  const candidatePath = path.join(rootPath, "candidates", "candidate.json");
  writeFileSync(candidatePath, "payload", { mode: 0o600 });
  linkSync(candidatePath, path.join(rootPath, "commits", "commit.json"));
  const root = await RootedDirectory.open(rootPath, "$root", {
    durability: "fsync",
  });
  try {
    const ref = parsePortableResourcePath("commits/commit.json");
    const expected = await root.inspectExistingResource(ref);
    const linked = await countFsyncs(() =>
      settleRegularFileDurability(root, ref, {
        expectedNode: expected.node,
      }),
    );
    equal(linked.syncCount, 2);

    const settled = await root.inspectExistingResource(ref);
    equal(settled.node.linkCount, 2n);
    equal(sameFileNodeSnapshot(settled.node, expected.node), true);

    rmSync(candidatePath);
    const singleLink = await root.inspectExistingResource(ref);
    const single = await countFsyncs(() =>
      settleRegularFileDurability(root, ref, {
        expectedNode: singleLink.node,
      }),
    );
    equal(single.syncCount, 2);
    const settledSingleLink = await root.inspectExistingResource(ref);
    equal(settledSingleLink.node.linkCount, 1n);
    equal(sameFileNodeSnapshot(settledSingleLink.node, singleLink.node), true);
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("settlement 拒绝 stale、missing、directory 与 symlink target", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-file-settlement-policy-"));
  writeFileSync(path.join(rootPath, "file"), "before");
  mkdirSync(path.join(rootPath, "directory"));
  symlinkSync("file", path.join(rootPath, "link"));
  const root = await RootedDirectory.open(rootPath);
  try {
    const fileRef = parsePortableResourcePath("file");
    const file = await root.inspectExistingResource(fileRef);
    writeFileSync(path.join(rootPath, "file"), "after-change");
    await expectSettlementError(
      () =>
        settleRegularFileDurability(root, fileRef, {
          expectedNode: file.node,
        }),
      "resource-changed",
      "$resourcePath",
    );
    await expectSettlementError(
      () =>
        settleRegularFileDurability(root, parsePortableResourcePath("missing"), {
          expectedNode: file.node,
        }),
      "resource-not-found",
      "$resourcePath",
    );

    for (const [name, reason] of [
      ["directory", "resource-not-file"],
      ["link", "resource-symlink"],
    ] as const) {
      const ref = parsePortableResourcePath(name);
      const resource = await root.inspectExistingResource(ref);
      await expectSettlementError(
        () =>
          settleRegularFileDurability(root, ref, {
            expectedNode: resource.node,
          }),
        reason,
        "$resourcePath",
      );
    }
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("settlement 在任何同步之前拒绝越界 path 与已取消的 AbortSignal", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-file-settlement-input-"));
  writeFileSync(path.join(rootPath, "file"), "value");
  const root = await RootedDirectory.open(rootPath);
  try {
    const ref = parsePortableResourcePath("file");
    const expected = await root.inspectExistingResource(ref);
    await expectSettlementError(
      () =>
        settleRegularFileDurability(root, asPortableResourcePath("../escape"), {
          expectedNode: expected.node,
        }),
      "input",
      "$resourcePath",
    );

    const controller = new AbortController();
    controller.abort();
    await rejects(
      () =>
        settleRegularFileDurability(root, ref, {
          expectedNode: expected.node,
          signal: controller.signal,
        }),
      OperationAbortedError,
    );
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});
