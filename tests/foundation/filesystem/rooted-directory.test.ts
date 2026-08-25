import { deepEqual, equal } from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  RootedDirectory,
  RootedDirectoryError,
  type RootedDirectoryErrorReason,
} from "../../../src/foundation/filesystem/rooted-directory.js";
import {
  parsePortableResourcePath,
  type PortableResourcePath,
} from "../../../src/foundation/filesystem/portable-resource-path.js";

async function expectRootedDirectoryError(
  action: () => unknown | Promise<unknown>,
  reason: RootedDirectoryErrorReason,
  expectedPath: string,
): Promise<RootedDirectoryError> {
  let caught: unknown;
  try {
    await action();
  } catch (error: unknown) {
    caught = error;
  }

  if (!(caught instanceof RootedDirectoryError)) {
    throw new Error("Expected RootedDirectoryError.");
  }
  equal(caught.name, "RootedDirectoryError");
  equal(caught.code, "wakeflow-rooted-directory");
  equal(caught.reason, reason);
  equal(caught.path, expectedPath);
  return caught;
}

function asPortableResourcePath(value: unknown): PortableResourcePath {
  return value as PortableResourcePath;
}

test("a canonical real directory opens as a handle-backed root", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-rooted-dir-"));
  const rooted = await RootedDirectory.open(rootPath);
  try {
    equal(rooted.absolutePath, realpathSync(rootPath));
    equal(rooted.initialSnapshot.kind, "directory");
    equal(rooted.isClosed, false);

    const current = await rooted.assertCurrent();
    equal(current.kind, "directory");
    equal(current.deviceId, rooted.initialSnapshot.deviceId);
    equal(current.inodeId, rooted.initialSnapshot.inodeId);
  } finally {
    await rooted.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("root input must be normalized, absolute, non-root, and present", async () => {
  for (const value of [
    "relative/root",
    "/",
    " /tmp",
    "/tmp/../tmp",
    "",
    null,
  ] as const) {
    await expectRootedDirectoryError(
      () => RootedDirectory.open(value, "$.root"),
      "root-input",
      "$.root",
    );
  }

  const missing = path.join(
    os.tmpdir(),
    `wakeflow-missing-root-${process.pid}-${Date.now()}`,
  );
  await expectRootedDirectoryError(
    () => RootedDirectory.open(missing, "$.root"),
    "root-not-found",
    "$.root",
  );
});

test("root symlinks and non-directory roots are rejected", async () => {
  const parent = mkdtempSync(path.join(os.tmpdir(), "wakeflow-root-types-"));
  const file = path.join(parent, "file");
  const link = path.join(parent, "link");
  try {
    writeFileSync(file, "x");
    symlinkSync(parent, link);

    await expectRootedDirectoryError(
      () => RootedDirectory.open(file, "$.root"),
      "root-type",
      "$.root",
    );
    await expectRootedDirectoryError(
      () => RootedDirectory.open(link, "$.root"),
      "root-symlink",
      "$.root",
    );
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("existing nested resources are inspected without reading contents", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-root-resource-"));
  const nested = path.join(rootPath, "目录", "records");
  const file = path.join(nested, "state.json");
  mkdirSync(nested, { recursive: true });
  writeFileSync(file, "private-content");

  const rooted = await RootedDirectory.open(rootPath);
  try {
    const resourcePath = parsePortableResourcePath(
      "目录/records/state.json",
    );
    const inspected = await rooted.inspectExistingResource(resourcePath);

    equal(inspected.resourcePath, resourcePath);
    equal(inspected.physicalPath, realpathSync(file));
    equal(inspected.node.kind, "file");
    equal(inspected.node.byteCount, Buffer.byteLength("private-content"));
    equal(Object.isFrozen(inspected), true);
  } finally {
    await rooted.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("intermediate symlinks and non-directory ancestors fail closed", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-root-ancestor-"));
  const outside = mkdtempSync(path.join(os.tmpdir(), "wakeflow-root-outside-"));
  writeFileSync(path.join(outside, "secret"), "secret");
  symlinkSync(outside, path.join(rootPath, "alias"));
  writeFileSync(path.join(rootPath, "not-directory"), "x");

  const rooted = await RootedDirectory.open(rootPath);
  try {
    await expectRootedDirectoryError(
      () => rooted.inspectExistingResource(
        parsePortableResourcePath("alias/secret"),
        "$.ref",
      ),
      "ancestor-symlink",
      "$.ref",
    );
    await expectRootedDirectoryError(
      () => rooted.inspectExistingResource(
        parsePortableResourcePath("not-directory/child"),
        "$.ref",
      ),
      "ancestor-type",
      "$.ref",
    );
  } finally {
    await rooted.close();
    rmSync(rootPath, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("a final symlink is observed as a symlink and never followed", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-root-final-link-"));
  const target = path.join(rootPath, "target");
  const link = path.join(rootPath, "link");
  writeFileSync(target, "target-bytes");
  symlinkSync("target", link);

  const rooted = await RootedDirectory.open(rootPath);
  try {
    const inspected = await rooted.inspectExistingResource(
      parsePortableResourcePath("link"),
    );
    equal(inspected.physicalPath, path.join(rooted.absolutePath, "link"));
    equal(inspected.node.kind, "symbolic-link");
    equal(inspected.node.byteCount > 0, true);
  } finally {
    await rooted.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("an opened root detects pathname replacement", async () => {
  const parent = mkdtempSync(path.join(os.tmpdir(), "wakeflow-root-replace-"));
  const rootPath = path.join(parent, "root");
  const original = path.join(parent, "original-root");
  mkdirSync(rootPath);
  const rooted = await RootedDirectory.open(rootPath);
  try {
    renameSync(rootPath, original);
    mkdirSync(rootPath);

    const error = await expectRootedDirectoryError(
      () => rooted.assertCurrent("$.root"),
      "root-changed",
      "$.root",
    );
    equal(error.message.includes(parent), false);
  } finally {
    await rooted.close();
    rmSync(parent, { recursive: true, force: true });
  }
});

test("resource paths are revalidated at the rooted boundary", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-root-ref-"));
  const rooted = await RootedDirectory.open(rootPath);
  try {
    await expectRootedDirectoryError(
      () => rooted.inspectExistingResource(
        asPortableResourcePath("../escape"),
        "$.ref",
      ),
      "resource-path",
      "$.ref",
    );
  } finally {
    await rooted.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("close is idempotent and all later I/O is rejected", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-root-close-"));
  const rooted = await RootedDirectory.open(rootPath);
  await rooted.close();
  await rooted.close();

  equal(rooted.isClosed, true);
  await expectRootedDirectoryError(
    () => rooted.assertCurrent(),
    "closed",
    "$root",
  );
  await expectRootedDirectoryError(
    () => rooted.inspectExistingResource(
      parsePortableResourcePath("missing"),
    ),
    "closed",
    "$resourcePath",
  );
  rmSync(rootPath, { recursive: true, force: true });
});

test("rooted-directory depends only on Node filesystem and prior facts", () => {
  const source = readFileSync(
    path.join(
      process.cwd(),
      "src/foundation/filesystem/rooted-directory.ts",
    ),
    "utf8",
  );
  const imports = [...source.matchAll(/from\s+["']([^"']+)["']/gu)]
    .map((entry) => entry[1]);

  deepEqual(imports, [
    "node:fs",
    "node:fs/promises",
    "node:path",
    "./file-node-snapshot.js",
    "./portable-resource-path.js",
    "../node/node-system-error.js",
  ]);
  equal(source.includes("readFile("), false);
  equal(source.includes("writeFile("), false);
  equal(source.includes("mkdir("), false);
  equal(source.includes("rename("), false);
  equal(source.includes("unlink("), false);
  equal(source.includes("O_NOFOLLOW"), true);
  equal(source.includes("O_DIRECTORY"), true);
});
