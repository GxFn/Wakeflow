import { deepEqual, equal } from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  BoundedDirectoryTreeScanError,
  scanBoundedResourceDirectoryTree,
  scanBoundedRootDirectoryTree,
  type BoundedDirectoryTreeScanErrorReason,
  type BoundedDirectoryTreeScanOptions,
} from "../../../src/foundation/filesystem/bounded-directory-tree-scan.js";
import {
  parsePortableResourcePath,
  type PortableResourcePath,
} from "../../../src/foundation/filesystem/portable-resource-path.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";

async function expectTreeScanError(
  action: () => unknown | Promise<unknown>,
  reason: BoundedDirectoryTreeScanErrorReason,
  expectedPath: string,
): Promise<BoundedDirectoryTreeScanError> {
  let caught: unknown;
  try {
    await action();
  } catch (error: unknown) {
    caught = error;
  }

  if (!(caught instanceof BoundedDirectoryTreeScanError)) {
    throw new Error("Expected BoundedDirectoryTreeScanError.");
  }
  equal(caught.name, "BoundedDirectoryTreeScanError");
  equal(caught.code, "wakeflow-bounded-directory-tree-scan");
  equal(caught.reason, reason);
  equal(caught.path, expectedPath);
  return caught;
}

function treeOptions(
  overrides: Partial<BoundedDirectoryTreeScanOptions> = {},
): BoundedDirectoryTreeScanOptions {
  return {
    maximumEntries: 100,
    maximumDepth: 10,
    ...overrides,
  };
}

function asOptions(value: unknown): BoundedDirectoryTreeScanOptions {
  return value as BoundedDirectoryTreeScanOptions;
}

function asPortableResourcePath(value: unknown): PortableResourcePath {
  return value as PortableResourcePath;
}

test("root tree scan returns every descendant in global portable-path order", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-tree-root-"));
  const outside = mkdtempSync(path.join(os.tmpdir(), "wakeflow-tree-outside-"));
  writeFileSync(path.join(outside, "secret"), "not-part-of-tree");
  mkdirSync(path.join(rootPath, "alpha", "deep"), { recursive: true });
  mkdirSync(path.join(rootPath, "z-empty"));
  writeFileSync(path.join(rootPath, ".hidden"), "hidden");
  writeFileSync(path.join(rootPath, "a.txt"), "a");
  writeFileSync(path.join(rootPath, "alpha", "z.json"), "{}");
  writeFileSync(path.join(rootPath, "alpha", "deep", "x.json"), "{}");
  symlinkSync(outside, path.join(rootPath, "outside-link"));

  const root = await RootedDirectory.open(rootPath);
  try {
    const result = await scanBoundedRootDirectoryTree(
      root,
      treeOptions(),
    );

    equal(result.treeRootResourcePath, null);
    equal(result.treeRootNode.kind, "directory");
    deepEqual(
      result.entries.map((entry) => entry.resourcePath),
      [
        ".hidden",
        "a.txt",
        "alpha",
        "alpha/deep",
        "alpha/deep/x.json",
        "alpha/z.json",
        "outside-link",
        "z-empty",
      ],
    );
    deepEqual(
      result.entries.map((entry) => entry.depth),
      [1, 1, 1, 2, 3, 2, 1, 1],
    );
    deepEqual(
      result.entries.map((entry) => entry.parentResourcePath),
      [null, null, null, "alpha", "alpha/deep", "alpha", null, null],
    );
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
    equal(result.entries.every((entry) => Object.isFrozen(entry)), true);
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("resource tree scan stays below its explicit starting directory", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-tree-resource-"));
  mkdirSync(path.join(rootPath, "records", "history"), { recursive: true });
  writeFileSync(path.join(rootPath, "outside.json"), "{}");
  writeFileSync(path.join(rootPath, "records", "current.json"), "{}");
  writeFileSync(path.join(rootPath, "records", "history", "001.json"), "{}");

  const root = await RootedDirectory.open(rootPath);
  try {
    const resourcePath = parsePortableResourcePath("records");
    const result = await scanBoundedResourceDirectoryTree(
      root,
      resourcePath,
      treeOptions(),
    );

    equal(result.treeRootResourcePath, resourcePath);
    deepEqual(
      result.entries.map((entry) => [
        entry.resourcePath,
        entry.parentResourcePath,
        entry.depth,
      ]),
      [
        ["records/current.json", "records", 1],
        ["records/history", "records", 1],
        ["records/history/001.json", "records/history", 2],
      ],
    );
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("starting-directory expectation classifies target replacement as source change", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-tree-expected-"));
  const recordsPath = path.join(rootPath, "records");
  mkdirSync(recordsPath);
  writeFileSync(path.join(recordsPath, "before"), "before");
  const root = await RootedDirectory.open(rootPath);
  try {
    const resourcePath = parsePortableResourcePath("records");
    const observed = await scanBoundedResourceDirectoryTree(
      root,
      resourcePath,
      treeOptions({ maximumEntries: 1 }),
    );
    rmSync(recordsPath, { recursive: true, force: true });
    symlinkSync(".", recordsPath);

    await expectTreeScanError(
      () => scanBoundedResourceDirectoryTree(
        root,
        resourcePath,
        treeOptions({
          expectedNode: observed.treeRootNode,
          maximumEntries: 1,
        }),
      ),
      "source-changed",
      "$options.expectedNode",
    );
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("maximumEntries is a total descendant bound and never returns a prefix", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-tree-entries-"));
  mkdirSync(path.join(rootPath, "directory"));
  writeFileSync(path.join(rootPath, "top"), "top");
  writeFileSync(path.join(rootPath, "directory", "child"), "child");
  const root = await RootedDirectory.open(rootPath);
  try {
    const exact = await scanBoundedRootDirectoryTree(
      root,
      treeOptions({ maximumEntries: 3 }),
    );
    equal(exact.entries.length, 3);

    await expectTreeScanError(
      () => scanBoundedRootDirectoryTree(
        root,
        treeOptions({ maximumEntries: 2 }),
      ),
      "entry-limit",
      "$tree.entries",
    );
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("maximumDepth proves the tree has no hidden descendants beyond the bound", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-tree-depth-"));
  mkdirSync(path.join(rootPath, "one"));
  writeFileSync(path.join(rootPath, "one", "two"), "value");
  const root = await RootedDirectory.open(rootPath);
  try {
    const exact = await scanBoundedRootDirectoryTree(
      root,
      treeOptions({ maximumDepth: 2 }),
    );
    equal(exact.entries.length, 2);

    for (const maximumDepth of [0, 1] as const) {
      await expectTreeScanError(
        () => scanBoundedRootDirectoryTree(
          root,
          treeOptions({ maximumDepth }),
        ),
        "depth-limit",
        "$tree.depth",
      );
    }
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("starting target errors are mapped into the tree-scan error family", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-tree-target-"));
  mkdirSync(path.join(rootPath, "directory"));
  writeFileSync(path.join(rootPath, "file"), "value");
  symlinkSync("directory", path.join(rootPath, "link"));
  const root = await RootedDirectory.open(rootPath);
  try {
    const cases: readonly [PortableResourcePath, BoundedDirectoryTreeScanErrorReason][] = [
      [parsePortableResourcePath("missing"), "not-found"],
      [parsePortableResourcePath("file"), "not-directory"],
      [parsePortableResourcePath("link"), "symlink"],
      [asPortableResourcePath("../escape"), "input"],
    ];
    for (const [resourcePath, reason] of cases) {
      await expectTreeScanError(
        () => scanBoundedResourceDirectoryTree(
          root,
          resourcePath,
          treeOptions(),
        ),
        reason,
        "$resourcePath",
      );
    }
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("options are explicit, passive, and AbortSignal remains cooperative", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-tree-options-"));
  const root = await RootedDirectory.open(rootPath);
  try {
    const invalid: readonly [unknown, string][] = [
      [{}, "$options"],
      [{ maximumEntries: 1 }, "$options"],
      [{ maximumDepth: 1 }, "$options"],
      [{ maximumEntries: 1, maximumDepth: 1, extra: true }, "$options"],
      [{ maximumEntries: -1, maximumDepth: 1 }, "$options.maximumEntries"],
      [{ maximumEntries: 1, maximumDepth: 1.5 }, "$options.maximumDepth"],
      [{ maximumEntries: 1, maximumDepth: 1, signal: {} }, "$options.signal"],
      [{ maximumEntries: 1, maximumDepth: 1, expectedNode: null }, "$options.expectedNode"],
      [{ maximumEntries: 1, maximumDepth: 1, expectedNode: {} }, "$options.expectedNode"],
    ];
    for (const [options, expectedPath] of invalid) {
      await expectTreeScanError(
        () => scanBoundedRootDirectoryTree(root, asOptions(options)),
        "input",
        expectedPath,
      );
    }

    let getterCalls = 0;
    const accessor = { maximumDepth: 1 } as Record<string, unknown>;
    Object.defineProperty(accessor, "maximumEntries", {
      get: () => {
        getterCalls += 1;
        return 1;
      },
      enumerable: true,
    });
    await expectTreeScanError(
      () => scanBoundedRootDirectoryTree(root, asOptions(accessor)),
      "input",
      "$options",
    );
    equal(getterCalls, 0);

    const controller = new AbortController();
    controller.abort("private-tree-reason");
    const error = await expectTreeScanError(
      () => scanBoundedRootDirectoryTree(
        root,
        treeOptions({ signal: controller.signal }),
      ),
      "aborted",
      "$signal",
    );
    equal(error.message.includes("private-tree-reason"), false);
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});
