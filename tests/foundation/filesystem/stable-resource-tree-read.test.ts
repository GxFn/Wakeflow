import { deepEqual, equal } from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  linkSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { parseByteCount } from "../../../src/foundation/numeric/byte-count.js";
import {
  parsePortableResourcePath,
  type PortableResourcePath,
} from "../../../src/foundation/filesystem/portable-resource-path.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import {
  readStableResourceTree,
  readStableRootResourceTree,
  StableResourceTreeReadError,
  type StableResourceTreeReadErrorReason,
  type StableResourceTreeReadOptions,
} from "../../../src/foundation/filesystem/stable-resource-tree-read.js";

async function expectStableResourceTreeReadError(
  action: () => unknown | Promise<unknown>,
  reason: StableResourceTreeReadErrorReason,
  expectedPath: string,
): Promise<StableResourceTreeReadError> {
  let caught: unknown;
  try {
    await action();
  } catch (error: unknown) {
    caught = error;
  }
  if (!(caught instanceof StableResourceTreeReadError)) {
    throw new Error("Expected StableResourceTreeReadError.");
  }
  equal(caught.name, "StableResourceTreeReadError");
  equal(caught.code, "wakeflow-stable-resource-tree-read");
  equal(caught.reason, reason);
  equal(caught.path, expectedPath);
  return caught;
}

function treeOptions(
  overrides: Partial<StableResourceTreeReadOptions> = {},
): StableResourceTreeReadOptions {
  return {
    maximumEntries: 100,
    maximumDepth: 10,
    maximumFiles: 100,
    maximumFileBytes: parseByteCount(1_024),
    maximumTotalBytes: parseByteCount(10_240),
    ...overrides,
  };
}

function asOptions(value: unknown): StableResourceTreeReadOptions {
  return value as StableResourceTreeReadOptions;
}

function asPortableResourcePath(value: unknown): PortableResourcePath {
  return value as PortableResourcePath;
}

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

test("root resource tree binds deterministic structure to stable file digests", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-stable-tree-"));
  const outsidePath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-stable-tree-outside-"));
  mkdirSync(path.join(rootPath, "alpha", "empty"), { recursive: true });
  writeFileSync(path.join(rootPath, "z.txt"), "zeta");
  writeFileSync(path.join(rootPath, "alpha", "a.txt"), "alpha");
  writeFileSync(path.join(outsidePath, "secret"), "outside");
  symlinkSync(outsidePath, path.join(rootPath, "outside-link"));
  const root = await RootedDirectory.open(rootPath);
  try {
    const result = await readStableRootResourceTree(root, treeOptions());

    equal(result.treeRootResourcePath, null);
    deepEqual(
      result.entries.map((entry) => entry.resourcePath),
      ["alpha", "alpha/a.txt", "alpha/empty", "outside-link", "z.txt"],
    );
    deepEqual(
      result.files.map((file) => [
        file.resourcePath,
        file.parentResourcePath,
        file.depth,
        file.byteCount,
        file.digest,
      ]),
      [
        ["alpha/a.txt", "alpha", 2, 5, sha256("alpha")],
        ["z.txt", null, 1, 4, sha256("zeta")],
      ],
    );
    equal(result.totalFileBytes, 9);
    equal(
      result.entries.find((entry) => entry.resourcePath === "outside-link")
        ?.node.kind,
      "symbolic-link",
    );
    equal(
      result.entries.some((entry) => entry.resourcePath.includes("secret")),
      false,
    );
    equal(Object.isFrozen(result), true);
    equal(Object.isFrozen(result.entries), true);
    equal(Object.isFrozen(result.files), true);
    equal(result.files.every((file) => Object.isFrozen(file)), true);
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
    rmSync(outsidePath, { recursive: true, force: true });
  }
});

test("resource tree stays below its start and honors the starting expectation", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-stable-subtree-"));
  const recordsPath = path.join(rootPath, "records");
  mkdirSync(path.join(recordsPath, "history"), { recursive: true });
  writeFileSync(path.join(rootPath, "outside.json"), "outside");
  writeFileSync(path.join(recordsPath, "current.json"), "current");
  writeFileSync(path.join(recordsPath, "history", "001.json"), "history");
  const root = await RootedDirectory.open(rootPath);
  try {
    const resourcePath = parsePortableResourcePath("records");
    const observed = await readStableResourceTree(
      root,
      resourcePath,
      treeOptions(),
    );
    deepEqual(
      observed.files.map((file) => file.resourcePath),
      ["records/current.json", "records/history/001.json"],
    );
    writeFileSync(path.join(recordsPath, "new.json"), "new");

    await expectStableResourceTreeReadError(
      () => readStableResourceTree(root, resourcePath, treeOptions({
        expectedNode: observed.treeRootNode,
      })),
      "source-changed",
      "$tree",
    );
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("entry, depth, file-count, file-byte, and total-byte budgets fail closed", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-stable-tree-budget-"));
  mkdirSync(path.join(rootPath, "nested"));
  writeFileSync(path.join(rootPath, "first"), "1234");
  writeFileSync(path.join(rootPath, "nested", "second"), "56789");
  const root = await RootedDirectory.open(rootPath);
  try {
    const cases: readonly [
      Partial<StableResourceTreeReadOptions>,
      StableResourceTreeReadErrorReason,
      string,
    ][] = [
      [{ maximumEntries: 2 }, "entry-limit", "$tree.entries"],
      [{ maximumDepth: 1 }, "depth-limit", "$tree.depth"],
      [{ maximumFiles: 1 }, "file-count", "$tree.files"],
      [{ maximumFileBytes: parseByteCount(4) }, "file-bytes", "$tree.files"],
      [{ maximumTotalBytes: parseByteCount(8) }, "total-bytes", "$tree.totalFileBytes"],
    ];
    for (const [overrides, reason, expectedPath] of cases) {
      await expectStableResourceTreeReadError(
        () => readStableRootResourceTree(root, treeOptions(overrides)),
        reason,
        expectedPath,
      );
    }
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("hard links remain two path facts and do not become a Foundation policy", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-stable-tree-link-"));
  const sourcePath = path.join(rootPath, "source");
  writeFileSync(sourcePath, "shared");
  linkSync(sourcePath, path.join(rootPath, "alias"));
  const root = await RootedDirectory.open(rootPath);
  try {
    const result = await readStableRootResourceTree(root, treeOptions({
      maximumEntries: 2,
      maximumDepth: 1,
      maximumFiles: 2,
    }));
    equal(result.files.length, 2);
    equal(result.files[0]?.node.inodeId, result.files[1]?.node.inodeId);
    equal(result.files[0]?.digest, result.files[1]?.digest);
    equal(result.totalFileBytes, 12);
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("missing, file, symlink, and forged starting targets fail distinctly", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-stable-tree-target-"));
  mkdirSync(path.join(rootPath, "directory"));
  writeFileSync(path.join(rootPath, "file"), "value");
  symlinkSync("directory", path.join(rootPath, "link"));
  const root = await RootedDirectory.open(rootPath);
  try {
    const cases: readonly [PortableResourcePath, StableResourceTreeReadErrorReason][] = [
      [parsePortableResourcePath("missing"), "not-found"],
      [parsePortableResourcePath("file"), "not-directory"],
      [parsePortableResourcePath("link"), "symlink"],
      [asPortableResourcePath("../escape"), "input"],
    ];
    for (const [resourcePath, reason] of cases) {
      await expectStableResourceTreeReadError(
        () => readStableResourceTree(root, resourcePath, treeOptions()),
        reason,
        reason === "input" ? "$resourcePath" : "$tree",
      );
    }
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("options are closed and passive, and AbortSignal remains cooperative", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-stable-tree-options-"));
  const root = await RootedDirectory.open(rootPath);
  try {
    const complete = treeOptions();
    const invalid: readonly [unknown, string][] = [
      [{}, "$options"],
      [{ ...complete, maximumFiles: -1 }, "$options.maximumFiles"],
      [{ ...complete, maximumFileBytes: 1.5 }, "$options.maximumFileBytes"],
      [{ ...complete, maximumTotalBytes: -1 }, "$options.maximumTotalBytes"],
      [{ ...complete, expectedNode: null }, "$options.expectedNode"],
      [{ ...complete, expectedNode: {} }, "$options.expectedNode"],
      [{ ...complete, signal: {} }, "$options.signal"],
      [{ ...complete, extra: true }, "$options"],
    ];
    for (const [options, expectedPath] of invalid) {
      await expectStableResourceTreeReadError(
        () => readStableRootResourceTree(root, asOptions(options)),
        "input",
        expectedPath,
      );
    }

    let getterCalls = 0;
    const accessor = { ...complete } as Record<string, unknown>;
    Object.defineProperty(accessor, "maximumFiles", {
      get: () => {
        getterCalls += 1;
        return 1;
      },
      enumerable: true,
    });
    await expectStableResourceTreeReadError(
      () => readStableRootResourceTree(root, asOptions(accessor)),
      "input",
      "$options",
    );
    equal(getterCalls, 0);

    const controller = new AbortController();
    controller.abort("private-tree-abort");
    const aborted = await expectStableResourceTreeReadError(
      () => readStableRootResourceTree(root, treeOptions({
        signal: controller.signal,
      })),
      "aborted",
      "$signal",
    );
    equal(aborted.message.includes("private-tree-abort"), false);
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});
