import { equal, rejects } from "node:assert/strict";
import {
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  DurableRegularFileLinkError,
  type DurableRegularFileLinkErrorReason,
  linkRegularFileWithoutReplacement,
} from "../../../src/foundation/filesystem/durable-regular-file-link.js";
import {
  type PortableResourcePath,
  parsePortableResourcePath,
} from "../../../src/foundation/filesystem/portable-resource-path.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { OperationAbortedError } from "../../../src/foundation/node/abort-signal.js";
import { countFsyncs } from "./fsync-count-probe.js";

async function expectLinkError(
  action: () => unknown | Promise<unknown>,
  reason: DurableRegularFileLinkErrorReason,
  expectedPath: string,
): Promise<DurableRegularFileLinkError> {
  let caught: unknown;
  try {
    await action();
  } catch (error: unknown) {
    caught = error;
  }
  if (!(caught instanceof DurableRegularFileLinkError)) {
    throw new Error("Expected DurableRegularFileLinkError.");
  }
  equal(caught.name, "DurableRegularFileLinkError");
  equal(caught.code, "wakeflow-durable-regular-file-link");
  equal(caught.reason, reason);
  equal(caught.path, expectedPath);
  return caught;
}

function asPortableResourcePath(value: unknown): PortableResourcePath {
  return value as PortableResourcePath;
}

test("same-parent link publishes one exact no-replace linked pair", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-link-file-"));
  writeFileSync(path.join(rootPath, "source"), "payload", { mode: 0o640 });
  const root = await RootedDirectory.open(rootPath);
  try {
    const source = parsePortableResourcePath("source");
    const destination = parsePortableResourcePath("destination");
    const expected = await root.inspectExistingResource(source);
    const result = await linkRegularFileWithoutReplacement(root, source, destination, {
      expectedSourceNode: expected.node,
    });

    equal(result.sourceNode.inodeId, result.destinationNode.inodeId);
    equal(result.sourceNode.deviceId, result.destinationNode.deviceId);
    equal(result.sourceNode.linkCount, 2n);
    equal(result.destinationNode.linkCount, 2n);
    equal(readFileSync(path.join(rootPath, "source"), "utf8"), "payload");
    equal(readFileSync(path.join(rootPath, "destination"), "utf8"), "payload");
    equal(Object.isFrozen(result), true);
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("fsync root: a link syncs only the destination parent, never the source inode again", {
  concurrency: false,
}, async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-link-count-"));
  mkdirSync(path.join(rootPath, "from"));
  mkdirSync(path.join(rootPath, "to"));
  writeFileSync(path.join(rootPath, "from", "source"), "payload");
  const root = await RootedDirectory.open(rootPath, "$root", { durability: "fsync" });
  try {
    const source = parsePortableResourcePath("from/source");
    const expected = await root.inspectExistingResource(source);
    const counted = await countFsyncs(() =>
      linkRegularFileWithoutReplacement(root, source, parsePortableResourcePath("to/destination"), {
        expectedSourceNode: expected.node,
      }),
    );
    // 源内容由调用方在链接前同步；本原语只让新目录项持久：一次，落在目标父目录上。
    equal(counted.syncCount, 1);
    equal(counted.directorySyncCount, 1);
    equal(counted.result.destinationNode.linkCount, 2n);
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("cross-parent link preserves a pre-existing hard-link count", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-link-cross-"));
  mkdirSync(path.join(rootPath, "from"));
  mkdirSync(path.join(rootPath, "to"));
  const sourcePath = path.join(rootPath, "from", "source");
  writeFileSync(sourcePath, "shared");
  linkSync(sourcePath, path.join(rootPath, "from", "existing-alias"));
  const root = await RootedDirectory.open(rootPath);
  try {
    const source = parsePortableResourcePath("from/source");
    const destination = parsePortableResourcePath("to/destination");
    const expected = await root.inspectExistingResource(source);
    await linkRegularFileWithoutReplacement(root, source, destination, {
      expectedSourceNode: expected.node,
    });

    equal(statSync(sourcePath).nlink, 3);
    equal(statSync(path.join(rootPath, "to", "destination")).nlink, 3);
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("concurrent links to one destination have exactly one winner", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-link-race-"));
  writeFileSync(path.join(rootPath, "source"), "value");
  const root = await RootedDirectory.open(rootPath);
  try {
    const source = parsePortableResourcePath("source");
    const destination = parsePortableResourcePath("destination");
    const expected = await root.inspectExistingResource(source);
    const attempts = await Promise.allSettled([
      linkRegularFileWithoutReplacement(root, source, destination, {
        expectedSourceNode: expected.node,
      }),
      linkRegularFileWithoutReplacement(root, source, destination, {
        expectedSourceNode: expected.node,
      }),
    ]);
    equal(attempts.filter((entry) => entry.status === "fulfilled").length, 1);
    const rejected = attempts.find((entry) => entry.status === "rejected");
    if (rejected?.status !== "rejected") throw new Error("Expected rejection.");
    if (!(rejected.reason instanceof DurableRegularFileLinkError)) {
      throw new Error("Expected DurableRegularFileLinkError.");
    }
    equal(["destination-exists", "source-changed"].includes(rejected.reason.reason), true);
    equal(statSync(path.join(rootPath, "source")).nlink, 2);
    equal(statSync(path.join(rootPath, "destination")).nlink, 2);
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("existing destination is never overwritten", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-link-exists-"));
  writeFileSync(path.join(rootPath, "source"), "source");
  writeFileSync(path.join(rootPath, "destination"), "destination");
  const root = await RootedDirectory.open(rootPath);
  try {
    const source = parsePortableResourcePath("source");
    const expected = await root.inspectExistingResource(source);
    await expectLinkError(
      () =>
        linkRegularFileWithoutReplacement(root, source, parsePortableResourcePath("destination"), {
          expectedSourceNode: expected.node,
        }),
      "destination-exists",
      "$destinationResourcePath",
    );
    equal(readFileSync(path.join(rootPath, "source"), "utf8"), "source");
    equal(readFileSync(path.join(rootPath, "destination"), "utf8"), "destination");
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("stale source expectation prevents publication", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-link-stale-"));
  const sourcePath = path.join(rootPath, "source");
  writeFileSync(sourcePath, "before");
  const root = await RootedDirectory.open(rootPath);
  try {
    const source = parsePortableResourcePath("source");
    const expected = await root.inspectExistingResource(source);
    writeFileSync(sourcePath, "after-change");
    await expectLinkError(
      () =>
        linkRegularFileWithoutReplacement(root, source, parsePortableResourcePath("destination"), {
          expectedSourceNode: expected.node,
        }),
      "source-changed",
      "$sourceResourcePath",
    );
    equal(statSync(path.join(rootPath, "destination"), { throwIfNoEntry: false }), undefined);
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("missing, directory, and symlink sources fail without following", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-link-types-"));
  mkdirSync(path.join(rootPath, "directory"));
  writeFileSync(path.join(rootPath, "target"), "value");
  symlinkSync("target", path.join(rootPath, "link"));
  const root = await RootedDirectory.open(rootPath);
  try {
    const fileNode = (await root.inspectExistingResource(parsePortableResourcePath("target"))).node;
    await expectLinkError(
      () =>
        linkRegularFileWithoutReplacement(
          root,
          parsePortableResourcePath("missing"),
          parsePortableResourcePath("destination"),
          { expectedSourceNode: fileNode },
        ),
      "source-not-found",
      "$sourceResourcePath",
    );

    for (const [name, reason] of [
      ["directory", "source-not-file"],
      ["link", "source-symlink"],
    ] as const) {
      const inspected = await root.inspectExistingResource(parsePortableResourcePath(name));
      await expectLinkError(
        () =>
          linkRegularFileWithoutReplacement(
            root,
            parsePortableResourcePath(name),
            parsePortableResourcePath("destination"),
            { expectedSourceNode: inspected.node },
          ),
        reason,
        "$sourceResourcePath",
      );
    }
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("destination requires an existing real parent", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-link-parent-"));
  const outside = mkdtempSync(path.join(os.tmpdir(), "wakeflow-link-parent-out-"));
  writeFileSync(path.join(rootPath, "source"), "value");
  writeFileSync(path.join(rootPath, "file-parent"), "value");
  symlinkSync(outside, path.join(rootPath, "link-parent"));
  const root = await RootedDirectory.open(rootPath);
  try {
    const source = parsePortableResourcePath("source");
    const expected = await root.inspectExistingResource(source);
    const cases: readonly [string, DurableRegularFileLinkErrorReason][] = [
      ["missing/destination", "parent-not-found"],
      ["file-parent/destination", "parent-not-directory"],
      ["link-parent/destination", "parent-symlink"],
    ];
    for (const [candidate, reason] of cases) {
      await expectLinkError(
        () =>
          linkRegularFileWithoutReplacement(root, source, parsePortableResourcePath(candidate), {
            expectedSourceNode: expected.node,
          }),
        reason,
        "$destinationResourcePath",
      );
    }
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("paths and AbortSignal are checked before any link", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-link-input-"));
  writeFileSync(path.join(rootPath, "source"), "value");
  const root = await RootedDirectory.open(rootPath);
  try {
    const source = parsePortableResourcePath("source");
    const expected = await root.inspectExistingResource(source);
    await expectLinkError(
      () =>
        linkRegularFileWithoutReplacement(
          root,
          asPortableResourcePath("../escape"),
          parsePortableResourcePath("destination"),
          { expectedSourceNode: expected.node },
        ),
      "input",
      "$sourceResourcePath",
    );
    await expectLinkError(
      () =>
        linkRegularFileWithoutReplacement(root, source, asPortableResourcePath(null), {
          expectedSourceNode: expected.node,
        }),
      "input",
      "$destinationResourcePath",
    );

    const controller = new AbortController();
    controller.abort("private-link-reason");
    await rejects(
      () =>
        linkRegularFileWithoutReplacement(root, source, parsePortableResourcePath("destination"), {
          expectedSourceNode: expected.node,
          signal: controller.signal,
        }),
      (error: unknown) =>
        error instanceof OperationAbortedError && !error.message.includes("private-link-reason"),
    );
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});
