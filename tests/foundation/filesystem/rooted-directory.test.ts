import { equal } from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
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

    const current = await rooted.assertCurrent();
    equal(current.kind, "directory");
  } finally {
    await rooted.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("持久化级别是打开时固定的根属性，缺省与显式 fsync 等价", async (t) => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-rooted-dir-durability-"));
  t.after(() => rmSync(rootPath, { recursive: true, force: true }));

  const inherited = await RootedDirectory.open(rootPath);
  const explicitDurable = await RootedDirectory.open(rootPath, "$root", {
    durability: "fsync",
  });
  const disposable = await RootedDirectory.open(rootPath, "$root", {
    durability: "none",
  });
  try {
    equal(inherited.durability, "fsync");
    equal(explicitDurable.durability, "fsync");
    equal(disposable.durability, "none");
    // 缺省与空选项都必须落在 fsync，绝不能因为传了一个空对象就悄悄降档。
    const emptyOptions = await RootedDirectory.open(rootPath, "$root", {});
    try {
      equal(emptyOptions.durability, "fsync");
    } finally {
      await emptyOptions.close();
    }
  } finally {
    await inherited.close();
    await explicitDurable.close();
    await disposable.close();
  }
});

test("非法的持久化级别与未知选项键按 root-input 拒绝", async (t) => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-rooted-dir-durability-input-"));
  t.after(() => rmSync(rootPath, { recursive: true, force: true }));

  for (const options of [
    { durability: "fsync-ish" },
    { durability: null },
    { durability: "fsync", unknown: true },
    { unknown: true },
    "fsync",
    42,
    // 数组也是 object：选项形状必须按普通记录判定，不能只看 typeof。
    [],
    ["fsync"],
    Object.assign([], { durability: "none" }),
  ] as const) {
    await expectRootedDirectoryError(
      () => RootedDirectory.open(rootPath, "$.root", options as never),
      "root-input",
      "$.root",
    );
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

test("directory identity survives sibling entry mutations", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-root-directory-identity-"));
  const nested = path.join(rootPath, "records");
  mkdirSync(nested);
  const rooted = await RootedDirectory.open(rootPath);
  try {
    const resourcePath = parsePortableResourcePath("records");
    const before = await rooted.inspectExistingResource(resourcePath);
    writeFileSync(path.join(nested, "new-record"), "value");
    const after = await rooted.inspectExistingResource(resourcePath);

    equal(after.node.kind, "directory");
    equal(after.node.deviceId, before.node.deviceId);
    equal(after.node.inodeId, before.node.inodeId);
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
    const missingError = await expectRootedDirectoryError(
      () => rooted.assertCurrent("$.root"),
      "root-changed",
      "$.root",
    );
    equal(missingError.message.includes(parent), false);

    mkdirSync(rootPath);
    await expectRootedDirectoryError(
      () => rooted.assertCurrent("$.root"),
      "root-changed",
      "$.root",
    );
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
