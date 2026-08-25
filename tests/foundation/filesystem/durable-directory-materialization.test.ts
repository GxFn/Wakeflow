import { deepEqual, equal } from "node:assert/strict";
import {
  chmodSync,
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
  createDirectoryAtomically,
  DurableDirectoryMaterializationError,
  materializeDirectoryPath,
  type DurableDirectoryMaterializationErrorReason,
  type DurableDirectoryOptions,
} from "../../../src/foundation/filesystem/durable-directory-materialization.js";
import {
  parsePortableResourcePath,
  type PortableResourcePath,
} from "../../../src/foundation/filesystem/portable-resource-path.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";

async function expectDirectoryError(
  action: () => unknown | Promise<unknown>,
  reason: DurableDirectoryMaterializationErrorReason,
  expectedPath: string,
): Promise<DurableDirectoryMaterializationError> {
  let caught: unknown;
  try {
    await action();
  } catch (error: unknown) {
    caught = error;
  }
  if (!(caught instanceof DurableDirectoryMaterializationError)) {
    throw new Error("Expected DurableDirectoryMaterializationError.");
  }
  equal(caught.name, "DurableDirectoryMaterializationError");
  equal(caught.code, "wakeflow-durable-directory-materialization");
  equal(caught.reason, reason);
  equal(caught.path, expectedPath);
  return caught;
}

function asOptions(value: unknown): DurableDirectoryOptions {
  return value as DurableDirectoryOptions;
}

function asPortableResourcePath(value: unknown): PortableResourcePath {
  return value as PortableResourcePath;
}

test("atomic create publishes one exact durable child directory", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-dir-create-"));
  mkdirSync(path.join(rootPath, "parent"));
  const root = await RootedDirectory.open(rootPath);
  try {
    const resourcePath = parsePortableResourcePath("parent/child");
    const result = await createDirectoryAtomically(
      root,
      resourcePath,
      { mode: 0o750 },
    );
    equal(result.resourcePath, resourcePath);
    equal(result.disposition, "created");
    equal(result.node.kind, "directory");
    equal(result.node.permissionBits, 0o750);
    equal(statSync(path.join(rootPath, "parent", "child")).isDirectory(), true);
    equal(statSync(path.join(rootPath, "parent", "child")).mode & 0o777, 0o750);
    equal(Object.isFrozen(result), true);
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("a zero-permission directory is hardened through its open handle", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-dir-sealed-"));
  const root = await RootedDirectory.open(rootPath);
  try {
    const result = await createDirectoryAtomically(
      root,
      parsePortableResourcePath("sealed"),
      { mode: 0 },
    );
    equal(result.node.kind, "directory");
    equal(result.node.permissionBits, 0);
    equal(statSync(path.join(rootPath, "sealed")).mode & 0o777, 0);
  } finally {
    await root.close();
    chmodSync(path.join(rootPath, "sealed"), 0o700);
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("atomic create is absent-only and concurrent calls have one winner", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-dir-race-"));
  const root = await RootedDirectory.open(rootPath);
  try {
    const resourcePath = parsePortableResourcePath("directory");
    const attempts = await Promise.allSettled([
      createDirectoryAtomically(root, resourcePath, { mode: 0o700 }),
      createDirectoryAtomically(root, resourcePath, { mode: 0o700 }),
    ]);
    equal(attempts.filter((entry) => entry.status === "fulfilled").length, 1);
    const rejected = attempts.find((entry) => entry.status === "rejected");
    if (rejected?.status !== "rejected") throw new Error("Expected rejection.");
    if (!(rejected.reason instanceof DurableDirectoryMaterializationError)) {
      throw new Error("Expected DurableDirectoryMaterializationError.");
    }
    equal(rejected.reason.reason, "target-exists");
    equal(statSync(path.join(rootPath, "directory")).isDirectory(), true);

    await expectDirectoryError(
      () => createDirectoryAtomically(root, resourcePath, { mode: 0o700 }),
      "target-exists",
      "$resourcePath",
    );
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("multi-level materialization records created segments and is idempotent", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-dir-path-"));
  const root = await RootedDirectory.open(rootPath);
  try {
    const resourcePath = parsePortableResourcePath("a/b/c");
    const first = await materializeDirectoryPath(root, resourcePath, {
      mode: 0o700,
    });
    deepEqual(
      first.segments.map((entry) => [
        entry.resourcePath,
        entry.disposition,
        entry.node.permissionBits,
      ]),
      [
        ["a", "created", 0o700],
        ["a/b", "created", 0o700],
        ["a/b/c", "created", 0o700],
      ],
    );
    equal(first.resourcePath, resourcePath);
    equal(first.node.kind, "directory");
    equal(Object.isFrozen(first), true);
    equal(Object.isFrozen(first.segments), true);

    const second = await materializeDirectoryPath(root, resourcePath, {
      mode: 0o755,
    });
    deepEqual(
      second.segments.map((entry) => entry.disposition),
      ["existing", "existing", "existing"],
    );
    deepEqual(
      second.segments.map((entry) => entry.node.permissionBits),
      [0o700, 0o700, 0o700],
    );
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("existing directory modes are observed while only missing segments use mode", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-dir-mode-"));
  mkdirSync(path.join(rootPath, "existing"), { mode: 0o755 });
  chmodSync(path.join(rootPath, "existing"), 0o755);
  const root = await RootedDirectory.open(rootPath);
  try {
    const result = await materializeDirectoryPath(
      root,
      parsePortableResourcePath("existing/private/leaf"),
      { mode: 0o700 },
    );
    deepEqual(
      result.segments.map((entry) => [
        entry.disposition,
        entry.node.permissionBits,
      ]),
      [
        ["existing", 0o755],
        ["created", 0o700],
        ["created", 0o700],
      ],
    );
    equal(statSync(path.join(rootPath, "existing")).mode & 0o777, 0o755);
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("file and symlink collisions fail without modifying the conflicting node", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-dir-type-"));
  const outside = mkdtempSync(path.join(os.tmpdir(), "wakeflow-dir-outside-"));
  writeFileSync(path.join(rootPath, "file"), "value");
  symlinkSync(outside, path.join(rootPath, "link"));
  const root = await RootedDirectory.open(rootPath);
  try {
    const cases: readonly [string, DurableDirectoryMaterializationErrorReason][] = [
      ["file/child", "target-not-directory"],
      ["link/child", "target-symlink"],
    ];
    for (const [candidate, reason] of cases) {
      await expectDirectoryError(
        () => materializeDirectoryPath(
          root,
          parsePortableResourcePath(candidate),
          { mode: 0o700 },
        ),
        reason,
        "$resourcePath",
      );
    }
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("atomic create requires an existing real parent", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-dir-parent-"));
  const outside = mkdtempSync(path.join(os.tmpdir(), "wakeflow-dir-parent-out-"));
  writeFileSync(path.join(rootPath, "file-parent"), "value");
  symlinkSync(outside, path.join(rootPath, "link-parent"));
  const root = await RootedDirectory.open(rootPath);
  try {
    const cases: readonly [string, DurableDirectoryMaterializationErrorReason][] = [
      ["missing/child", "parent-not-found"],
      ["file-parent/child", "parent-not-directory"],
      ["link-parent/child", "parent-symlink"],
    ];
    for (const [candidate, reason] of cases) {
      await expectDirectoryError(
        () => createDirectoryAtomically(
          root,
          parsePortableResourcePath(candidate),
          { mode: 0o700 },
        ),
        reason,
        "$resourcePath",
      );
    }
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("options and AbortSignal are closed and passively admitted", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-dir-input-"));
  const root = await RootedDirectory.open(rootPath);
  try {
    const resourcePath = parsePortableResourcePath("directory");
    const invalid: readonly [unknown, string][] = [
      [{}, "$options"],
      [{ mode: 0o700, extra: true }, "$options"],
      [{ mode: -1 }, "$options.mode"],
      [{ mode: 0o1000 }, "$options.mode"],
      [{ mode: 0o700, signal: {} }, "$options.signal"],
    ];
    for (const [options, expectedPath] of invalid) {
      await expectDirectoryError(
        () => createDirectoryAtomically(
          root,
          resourcePath,
          asOptions(options),
        ),
        "input",
        expectedPath,
      );
    }

    let getterCalls = 0;
    const accessor: Record<string, unknown> = {};
    Object.defineProperty(accessor, "mode", {
      get: () => {
        getterCalls += 1;
        return 0o700;
      },
      enumerable: true,
    });
    await expectDirectoryError(
      () => createDirectoryAtomically(
        root,
        resourcePath,
        asOptions(accessor),
      ),
      "input",
      "$options",
    );
    equal(getterCalls, 0);

    await expectDirectoryError(
      () => createDirectoryAtomically(
        root,
        asPortableResourcePath("../escape"),
        { mode: 0o700 },
      ),
      "input",
      "$resourcePath",
    );

    const controller = new AbortController();
    controller.abort("private-directory-abort");
    const error = await expectDirectoryError(
      () => materializeDirectoryPath(root, resourcePath, {
        mode: 0o700,
        signal: controller.signal,
      }),
      "aborted",
      "$signal",
    );
    equal(error.message.includes("private-directory-abort"), false);
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("directory materialization uses explicit single-level mkdir only", () => {
  const source = requireSource();
  const imports = [...source.matchAll(/from\s+["']([^"']+)["']/gu)]
    .map((entry) => entry[1]);
  deepEqual(imports, [
    "node:fs",
    "node:fs/promises",
    "node:util",
    "../data/passive-own-data.js",
    "../node/node-system-error.js",
    "./file-node-snapshot.js",
    "./portable-resource-path.js",
    "./rooted-directory.js",
    "./rooted-resource-parent-handle.js",
  ]);
  equal(source.includes("recursive: false"), true);
  equal(source.includes("recursive: true"), false);
  equal(source.includes("await targetHandle.sync()"), true);
  equal(source.includes("await parent.sync()"), true);
  equal(source.includes("chmod(options.mode)"), true);
  equal(source.includes("RootedResourceParentHandle.open"), true);
  equal(source.includes("interface OpenedParent"), false);
  equal(source.includes("function parseTargetAddress"), false);
  equal(source.includes("function inspectInitialParent"), false);
  equal(source.includes("parent.handle"), false);
  equal(/\brmdir\s*\(/u.test(source), false);
  equal(/\brm\s*\(/u.test(source), false);
  equal(/\bunlink\s*\(/u.test(source), false);
  equal(/\bwriteFile\s*\(/u.test(source), false);
});

function requireSource(): string {
  return readFileSync(
    path.join(
      process.cwd(),
      "src/foundation/filesystem/durable-directory-materialization.ts",
    ),
    "utf8",
  );
}
