import { deepEqual, equal } from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  sameFileNodeIdentity,
  type FileNodeSnapshot,
} from "../../../src/foundation/filesystem/file-node-snapshot.js";
import {
  parsePortableResourcePath,
  type PortableResourcePath,
} from "../../../src/foundation/filesystem/portable-resource-path.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import {
  RootedExactResourceHandle,
  RootedExactResourceHandleError,
  type RootedExactResourceHandleErrorReason,
} from "../../../src/foundation/filesystem/rooted-exact-resource-handle.js";

async function expectExactHandleError(
  action: () => unknown | Promise<unknown>,
  reason: RootedExactResourceHandleErrorReason,
  expectedPath: string,
): Promise<RootedExactResourceHandleError> {
  let caught: unknown;
  try {
    await action();
  } catch (error: unknown) {
    caught = error;
  }
  if (!(caught instanceof RootedExactResourceHandleError)) {
    throw new Error("Expected RootedExactResourceHandleError.");
  }
  equal(caught.name, "RootedExactResourceHandleError");
  equal(caught.code, "wakeflow-rooted-exact-resource-handle");
  equal(caught.reason, reason);
  equal(caught.path, expectedPath);
  return caught;
}

function asPortableResourcePath(value: unknown): PortableResourcePath {
  return value as PortableResourcePath;
}

function asExpectedNode(value: unknown): Readonly<FileNodeSnapshot> {
  return value as Readonly<FileNodeSnapshot>;
}

test("regular-file factory admits one exact pathname and opened inode", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-exact-file-"));
  const physicalPath = path.join(rootPath, "source");
  writeFileSync(physicalPath, "payload", { mode: 0o640 });
  const root = await RootedDirectory.open(rootPath);
  const resourcePath = parsePortableResourcePath("source");
  const expected = await root.inspectExistingResource(resourcePath);
  const handle = await RootedExactResourceHandle.openRegularFile(
    root,
    resourcePath,
    expected.node,
  );
  try {
    equal(
      handle.resourceAbsolutePath,
      path.join(root.absolutePath, "source"),
    );
    equal(handle.kind, "file");
    deepEqual(handle.initialNodeSnapshot, expected.node);
    deepEqual(await handle.inspectOpenedNode(), expected.node);
    deepEqual(await handle.assertPathCurrent(), expected.node);
    deepEqual(await handle.syncOpenedNode(), expected.node);
    equal(Object.isFrozen(handle.initialNodeSnapshot), true);
  } finally {
    await handle.close();
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("file-or-directory factory admits directories while both factories reject symlinks", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-exact-kind-"));
  mkdirSync(path.join(rootPath, "directory"));
  writeFileSync(path.join(rootPath, "target"), "value");
  symlinkSync("target", path.join(rootPath, "link"));
  const root = await RootedDirectory.open(rootPath);
  const directoryPath = parsePortableResourcePath("directory");
  const directory = await root.inspectExistingResource(directoryPath);
  const handle = await RootedExactResourceHandle.openFileOrDirectory(
    root,
    directoryPath,
    directory.node,
    "$.source",
  );
  try {
    equal(handle.kind, "directory");
    equal((await handle.assertPathCurrent()).kind, "directory");

    await expectExactHandleError(
      () => RootedExactResourceHandle.openRegularFile(
        root,
        directoryPath,
        directory.node,
        "$.source",
      ),
      "resource-kind",
      "$.source",
    );

    const linkPath = parsePortableResourcePath("link");
    const link = await root.inspectExistingResource(linkPath);
    for (const open of [
      () => RootedExactResourceHandle.openRegularFile(
        root,
        linkPath,
        link.node,
        "$.source",
      ),
      () => RootedExactResourceHandle.openFileOrDirectory(
        root,
        linkPath,
        link.node,
        "$.source",
      ),
    ]) {
      await expectExactHandleError(open, "resource-symlink", "$.source");
    }
  } finally {
    await handle.close();
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("missing resources and stale expectations fail before a handle is issued", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-exact-stale-"));
  const physicalPath = path.join(rootPath, "source");
  writeFileSync(physicalPath, "before");
  const root = await RootedDirectory.open(rootPath);
  try {
    const resourcePath = parsePortableResourcePath("source");
    const expected = await root.inspectExistingResource(resourcePath);
    await expectExactHandleError(
      () => RootedExactResourceHandle.openRegularFile(
        root,
        parsePortableResourcePath("missing"),
        expected.node,
        "$.source",
      ),
      "resource-not-found",
      "$.source",
    );

    writeFileSync(physicalPath, "changed-and-longer");
    await expectExactHandleError(
      () => RootedExactResourceHandle.openRegularFile(
        root,
        resourcePath,
        expected.node,
        "$.source",
      ),
      "resource-changed",
      "$.source",
    );
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("inputs are revalidated without executing root or expectation proxies", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-exact-input-"));
  writeFileSync(path.join(rootPath, "source"), "value");
  const root = await RootedDirectory.open(rootPath);
  const resourcePath = parsePortableResourcePath("source");
  const expected = await root.inspectExistingResource(resourcePath);
  try {
    await expectExactHandleError(
      () => RootedExactResourceHandle.openRegularFile(
        root,
        asPortableResourcePath("../escape"),
        expected.node,
        "$.source",
      ),
      "input",
      "$.source",
    );
    await expectExactHandleError(
      () => RootedExactResourceHandle.openRegularFile(
        root,
        resourcePath,
        asExpectedNode({ ...expected.node }),
      ),
      "input",
      "$expectedNode",
    );

    let rootTrapCalls = 0;
    const rootProxy = new Proxy(root, {
      get: () => {
        rootTrapCalls += 1;
        return undefined;
      },
      getPrototypeOf: () => {
        rootTrapCalls += 1;
        return RootedDirectory.prototype;
      },
    });
    await expectExactHandleError(
      () => RootedExactResourceHandle.openRegularFile(
        rootProxy,
        resourcePath,
        expected.node,
      ),
      "input",
      "$root",
    );
    equal(rootTrapCalls, 0);

    let expectedTrapCalls = 0;
    const expectedProxy = new Proxy(expected.node, {
      get: () => {
        expectedTrapCalls += 1;
        return undefined;
      },
      ownKeys: () => {
        expectedTrapCalls += 1;
        return [];
      },
    });
    await expectExactHandleError(
      () => RootedExactResourceHandle.openRegularFile(
        root,
        resourcePath,
        expectedProxy,
      ),
      "input",
      "$expectedNode",
    );
    equal(expectedTrapCalls, 0);
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("path metadata changes invalidate exact currentness but retain opened identity", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-exact-change-"));
  const physicalPath = path.join(rootPath, "source");
  writeFileSync(physicalPath, "before");
  const root = await RootedDirectory.open(rootPath);
  const resourcePath = parsePortableResourcePath("source");
  const expected = await root.inspectExistingResource(resourcePath);
  const handle = await RootedExactResourceHandle.openRegularFile(
    root,
    resourcePath,
    expected.node,
    "$.source",
  );
  try {
    writeFileSync(physicalPath, "after-and-longer");
    await expectExactHandleError(
      () => handle.assertPathCurrent(),
      "resource-changed",
      "$.source",
    );
    const opened = await handle.inspectOpenedNode();
    equal(sameFileNodeIdentity(handle.initialNodeSnapshot, opened), true);
    equal(opened.byteCount, Buffer.byteLength("after-and-longer"));
  } finally {
    await handle.close();
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("opened inode remains observable and synchronizable after rename and unlink", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-exact-move-"));
  const sourcePath = path.join(rootPath, "source");
  const movedPath = path.join(rootPath, "moved");
  writeFileSync(sourcePath, "payload");
  const root = await RootedDirectory.open(rootPath);
  const resourcePath = parsePortableResourcePath("source");
  const expected = await root.inspectExistingResource(resourcePath);
  const handle = await RootedExactResourceHandle.openRegularFile(
    root,
    resourcePath,
    expected.node,
    "$.source",
  );
  try {
    renameSync(sourcePath, movedPath);
    await expectExactHandleError(
      () => handle.assertPathCurrent(),
      "resource-changed",
      "$.source",
    );
    const moved = await handle.inspectOpenedNode();
    equal(sameFileNodeIdentity(expected.node, moved), true);

    unlinkSync(movedPath);
    const unlinked = await handle.inspectOpenedNode();
    equal(sameFileNodeIdentity(expected.node, unlinked), true);
    equal(unlinked.linkCount, 0n);
    const synchronized = await handle.syncOpenedNode();
    equal(sameFileNodeIdentity(unlinked, synchronized), true);
    equal(synchronized.linkCount, 0n);
  } finally {
    await handle.close();
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("close is idempotent and all later I/O methods reject", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-exact-close-"));
  writeFileSync(path.join(rootPath, "source"), "value");
  const root = await RootedDirectory.open(rootPath);
  const resourcePath = parsePortableResourcePath("source");
  const expected = await root.inspectExistingResource(resourcePath);
  const handle = await RootedExactResourceHandle.openRegularFile(
    root,
    resourcePath,
    expected.node,
    "$.source",
  );
  await handle.close();
  await handle.close();
  for (const operation of [
    () => handle.assertPathCurrent(),
    () => handle.inspectOpenedNode(),
    () => handle.syncOpenedNode(),
  ]) {
    await expectExactHandleError(operation, "closed", "$.source");
  }
  await root.close();
  rmSync(rootPath, { recursive: true, force: true });
});
