import { equal } from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  parsePortableResourcePath,
  type PortableResourcePath,
} from "../../../src/foundation/filesystem/portable-resource-path.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import {
  RootedResourceParentHandle,
  RootedResourceParentHandleError,
  type RootedResourceParentHandleErrorReason,
} from "../../../src/foundation/filesystem/rooted-resource-parent-handle.js";

async function expectParentHandleError(
  action: () => unknown | Promise<unknown>,
  reason: RootedResourceParentHandleErrorReason,
  expectedPath: string,
): Promise<RootedResourceParentHandleError> {
  let caught: unknown;
  try {
    await action();
  } catch (error: unknown) {
    caught = error;
  }
  if (!(caught instanceof RootedResourceParentHandleError)) {
    throw new Error("Expected RootedResourceParentHandleError.");
  }
  equal(caught.name, "RootedResourceParentHandleError");
  equal(caught.code, "wakeflow-rooted-resource-parent-handle");
  equal(caught.reason, reason);
  equal(caught.path, expectedPath);
  return caught;
}

function asPortableResourcePath(value: unknown): PortableResourcePath {
  return value as PortableResourcePath;
}

test("root-level target uses the opened RootedDirectory as parent", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-parent-root-"));
  const root = await RootedDirectory.open(rootPath);
  const resourcePath = parsePortableResourcePath("target");
  const parent = await RootedResourceParentHandle.open(root, resourcePath);
  try {
    equal(parent.parentResourcePath, null);
    equal(parent.parentAbsolutePath, root.absolutePath);
    equal(parent.resourceAbsolutePath, path.join(root.absolutePath, "target"));
    equal(parent.parentDeviceId, (await parent.assertCurrent()).deviceId);
    equal(await parent.inspectTarget(), null);

    writeFileSync(path.join(rootPath, "target"), "value");
    const target = await parent.inspectTarget();
    equal(target?.kind, "file");
    equal(target?.byteCount, Buffer.byteLength("value"));
    equal((await parent.sync()).kind, "directory");
  } finally {
    await parent.close();
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("nested target exposes one stable real parent and observes symlink itself", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-parent-nested-"));
  mkdirSync(path.join(rootPath, "records", "nested"), { recursive: true });
  writeFileSync(path.join(rootPath, "records", "nested", "target"), "value");
  symlinkSync("target", path.join(rootPath, "records", "nested", "link"));
  const root = await RootedDirectory.open(rootPath);
  const targetPath = parsePortableResourcePath("records/nested/target");
  const target = await RootedResourceParentHandle.open(root, targetPath);
  const link = await RootedResourceParentHandle.open(
    root,
    parsePortableResourcePath("records/nested/link"),
  );
  try {
    equal(target.parentResourcePath, "records/nested");
    equal((await target.inspectTarget())?.kind, "file");
    equal((await link.inspectTarget())?.kind, "symbolic-link");
  } finally {
    await link.close();
    await target.close();
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("missing, symlink, and non-directory parents fail distinctly", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-parent-types-"));
  const outside = mkdtempSync(path.join(os.tmpdir(), "wakeflow-parent-outside-"));
  writeFileSync(path.join(rootPath, "file-parent"), "value");
  symlinkSync(outside, path.join(rootPath, "link-parent"));
  const root = await RootedDirectory.open(rootPath);
  try {
    const cases: readonly [string, RootedResourceParentHandleErrorReason][] = [
      ["missing/target", "parent-not-found"],
      ["file-parent/target", "parent-not-directory"],
      ["link-parent/target", "parent-symlink"],
    ];
    for (const [candidate, reason] of cases) {
      await expectParentHandleError(
        () => RootedResourceParentHandle.open(
          root,
          parsePortableResourcePath(candidate),
          "$.target",
        ),
        reason,
        "$.target",
      );
    }
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("resource and root inputs are revalidated without executing proxies", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-parent-input-"));
  const root = await RootedDirectory.open(rootPath);
  try {
    await expectParentHandleError(
      () => RootedResourceParentHandle.open(
        root,
        asPortableResourcePath("../escape"),
        "$.target",
      ),
      "input",
      "$.target",
    );

    let trapCalls = 0;
    const proxy = new Proxy(root, {
      get: () => {
        trapCalls += 1;
        return undefined;
      },
      getPrototypeOf: () => {
        trapCalls += 1;
        return RootedDirectory.prototype;
      },
    });
    await expectParentHandleError(
      () => RootedResourceParentHandle.open(
        proxy,
        parsePortableResourcePath("target"),
      ),
      "input",
      "$root",
    );
    equal(trapCalls, 0);
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("parent identity survives sibling mutations but detects pathname replacement", async () => {
  const outer = mkdtempSync(path.join(os.tmpdir(), "wakeflow-parent-replace-"));
  const rootPath = path.join(outer, "root");
  mkdirSync(path.join(rootPath, "parent"), { recursive: true });
  const root = await RootedDirectory.open(rootPath);
  const handle = await RootedResourceParentHandle.open(
    root,
    parsePortableResourcePath("parent/target"),
  );
  try {
    writeFileSync(path.join(rootPath, "parent", "sibling"), "value");
    equal((await handle.assertCurrent()).kind, "directory");
    await handle.sync();

    renameSync(
      path.join(rootPath, "parent"),
      path.join(rootPath, "original-parent"),
    );
    await expectParentHandleError(
      () => handle.assertCurrent(),
      "parent-changed",
      "$resourcePath",
    );

    mkdirSync(path.join(rootPath, "parent"));
    await expectParentHandleError(
      () => handle.assertCurrent(),
      "parent-changed",
      "$resourcePath",
    );
  } finally {
    await handle.close();
    await root.close();
    rmSync(outer, { recursive: true, force: true });
  }
});

test("close is idempotent and all later I/O methods reject", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-parent-close-"));
  const root = await RootedDirectory.open(rootPath);
  const handle = await RootedResourceParentHandle.open(
    root,
    parsePortableResourcePath("target"),
    "$.target",
  );
  await handle.close();
  await handle.close();
  for (const operation of [
    () => handle.assertCurrent(),
    () => handle.inspectTarget(),
    () => handle.sync(),
  ]) {
    await expectParentHandleError(operation, "closed", "$.target");
  }
  await root.close();
  rmSync(rootPath, { recursive: true, force: true });
});
