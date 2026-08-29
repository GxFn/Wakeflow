import { deepEqual, equal } from "node:assert/strict";
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

import {
  parsePortableResourcePath,
  type PortableResourcePath,
} from "../../../src/foundation/filesystem/portable-resource-path.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import {
  readStableResourceDirectory,
  readStableRootDirectory,
  StableDirectoryReadError,
  type StableDirectoryReadErrorReason,
  type StableDirectoryReadOptions,
} from "../../../src/foundation/filesystem/stable-directory-read.js";

async function expectStableDirectoryReadError(
  action: () => unknown | Promise<unknown>,
  reason: StableDirectoryReadErrorReason,
  expectedPath: string,
): Promise<StableDirectoryReadError> {
  let caught: unknown;
  try {
    await action();
  } catch (error: unknown) {
    caught = error;
  }

  if (!(caught instanceof StableDirectoryReadError)) {
    throw new Error("Expected StableDirectoryReadError.");
  }
  equal(caught.name, "StableDirectoryReadError");
  equal(caught.code, "wakeflow-stable-directory-read");
  equal(caught.reason, reason);
  equal(caught.path, expectedPath);
  return caught;
}

function asOptions(value: unknown): StableDirectoryReadOptions {
  return value as StableDirectoryReadOptions;
}

function asPortableResourcePath(value: unknown): PortableResourcePath {
  return value as PortableResourcePath;
}

test("root directory entries are code-unit sorted immutable physical facts", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-stable-dir-"));
  const outside = mkdtempSync(path.join(os.tmpdir(), "wakeflow-stable-outside-"));
  writeFileSync(path.join(outside, "secret"), "must-not-be-read");
  writeFileSync(path.join(rootPath, "zeta"), "z");
  mkdirSync(path.join(rootPath, "nested"));
  writeFileSync(path.join(rootPath, "Alpha"), "a", { mode: 0o600 });
  symlinkSync(outside, path.join(rootPath, "outside-link"));

  const root = await RootedDirectory.open(rootPath);
  try {
    const result = await readStableRootDirectory(root, {
      maximumEntries: 4,
    });

    equal(result.directoryResourcePath, null);
    equal(result.directoryNode.kind, "directory");
    deepEqual(
      result.entries.map((entry) => entry.name),
      ["Alpha", "nested", "outside-link", "zeta"],
    );
    deepEqual(
      result.entries.map((entry) => entry.resourcePath),
      ["Alpha", "nested", "outside-link", "zeta"],
    );
    deepEqual(
      result.entries.map((entry) => entry.node.kind),
      ["file", "directory", "symbolic-link", "file"],
    );
    equal(result.entries[0]?.node.permissionBits, 0o600);
    equal(Object.isFrozen(result), true);
    equal(Object.isFrozen(result.entries), true);
    equal(result.entries.every((entry) => Object.isFrozen(entry)), true);
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("resource directory read is one level only and keeps full portable paths", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-stable-nested-"));
  mkdirSync(path.join(rootPath, "records", "deeper"), { recursive: true });
  writeFileSync(path.join(rootPath, "records", "current.json"), "{}");
  writeFileSync(path.join(rootPath, "records", "deeper", "hidden.json"), "{}");

  const root = await RootedDirectory.open(rootPath);
  try {
    const directoryPath = parsePortableResourcePath("records");
    const result = await readStableResourceDirectory(
      root,
      directoryPath,
      { maximumEntries: 2 },
    );

    equal(result.directoryResourcePath, directoryPath);
    deepEqual(
      result.entries.map((entry) => [
        entry.name,
        entry.resourcePath,
        entry.node.kind,
      ]),
      [
        ["current.json", "records/current.json", "file"],
        ["deeper", "records/deeper", "directory"],
      ],
    );
    equal(
      result.entries.some((entry) => entry.resourcePath.endsWith("hidden.json")),
      false,
    );
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("maximumEntries is exact and zero admits only an empty directory", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-stable-bound-"));
  mkdirSync(path.join(rootPath, "empty"));
  mkdirSync(path.join(rootPath, "two"));
  writeFileSync(path.join(rootPath, "two", "a"), "a");
  writeFileSync(path.join(rootPath, "two", "b"), "b");
  const root = await RootedDirectory.open(rootPath);
  try {
    const empty = await readStableResourceDirectory(
      root,
      parsePortableResourcePath("empty"),
      { maximumEntries: 0 },
    );
    equal(empty.entries.length, 0);

    const exact = await readStableResourceDirectory(
      root,
      parsePortableResourcePath("two"),
      { maximumEntries: 2 },
    );
    equal(exact.entries.length, 2);

    await expectStableDirectoryReadError(
      () => readStableResourceDirectory(
        root,
        parsePortableResourcePath("two"),
        { maximumEntries: 1 },
      ),
      "too-many-entries",
      "$entries",
    );
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("expectedNode binds a directory read to one exact observed version", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-stable-dir-expected-"));
  const directoryPath = path.join(rootPath, "records");
  mkdirSync(directoryPath);
  writeFileSync(path.join(directoryPath, "before"), "before");
  const root = await RootedDirectory.open(rootPath);
  try {
    const resourcePath = parsePortableResourcePath("records");
    const observed = await readStableResourceDirectory(root, resourcePath, {
      maximumEntries: 1,
    });
    writeFileSync(path.join(directoryPath, "after"), "after");

    await expectStableDirectoryReadError(
      () => readStableResourceDirectory(root, resourcePath, {
        maximumEntries: 2,
        expectedNode: observed.directoryNode,
      }),
      "expectation-changed",
      "$options.expectedNode",
    );
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("many-entry inspection preserves deterministic order", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-stable-dir-many-"));
  const names = Array.from({ length: 64 }, (_, index) => (
    `entry-${String(63 - index).padStart(2, "0")}`
  ));
  for (const name of names) writeFileSync(path.join(rootPath, name), name);
  const root = await RootedDirectory.open(rootPath);
  try {
    const result = await readStableRootDirectory(root, { maximumEntries: 64 });
    deepEqual(
      result.entries.map((entry) => entry.name),
      [...names].sort(),
    );
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("missing, file, symlink, and forged directory targets fail distinctly", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-stable-target-"));
  mkdirSync(path.join(rootPath, "target"));
  writeFileSync(path.join(rootPath, "file"), "value");
  symlinkSync("target", path.join(rootPath, "link"));
  const root = await RootedDirectory.open(rootPath);
  try {
    const cases: readonly [PortableResourcePath, StableDirectoryReadErrorReason][] = [
      [parsePortableResourcePath("missing"), "not-found"],
      [parsePortableResourcePath("file"), "not-directory"],
      [parsePortableResourcePath("link"), "symlink"],
      [asPortableResourcePath("../escape"), "input"],
    ];
    for (const [resourcePath, reason] of cases) {
      await expectStableDirectoryReadError(
        () => readStableResourceDirectory(
          root,
          resourcePath,
          { maximumEntries: 10 },
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

test("hard links remain observable node facts rather than a scanner policy", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-stable-hardlink-"));
  const source = path.join(rootPath, "source");
  writeFileSync(source, "shared");
  linkSync(source, path.join(rootPath, "alias"));
  const root = await RootedDirectory.open(rootPath);
  try {
    const result = await readStableRootDirectory(root, {
      maximumEntries: 2,
    });
    equal(result.entries.length, 2);
    equal(result.entries[0]?.node.kind, "file");
    equal(result.entries[1]?.node.kind, "file");
    equal(result.entries[0]?.node.deviceId, result.entries[1]?.node.deviceId);
    equal(result.entries[0]?.node.inodeId, result.entries[1]?.node.inodeId);
    equal(result.entries[0]?.node.linkCount, 2n);
    equal(result.entries[1]?.node.linkCount, 2n);
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("non-portable physical entry names fail instead of being normalized", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-stable-name-"));
  const decomposed = "e\u0301";
  writeFileSync(path.join(rootPath, decomposed), "value");
  const root = await RootedDirectory.open(rootPath);
  try {
    await expectStableDirectoryReadError(
      () => readStableRootDirectory(root, { maximumEntries: 1 }),
      "entry-path",
      "$entries/0",
    );
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("options are closed, passive, and support pre-aborted reads", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-stable-options-"));
  const root = await RootedDirectory.open(rootPath);
  try {
    const invalid: readonly [unknown, string][] = [
      [{}, "$options"],
      [{ maximumEntries: 1, extra: true }, "$options"],
      [{ maximumEntries: -1 }, "$options.maximumEntries"],
      [{ maximumEntries: 1.5 }, "$options.maximumEntries"],
      [{ maximumEntries: Number.MAX_SAFE_INTEGER + 1 }, "$options.maximumEntries"],
      [{ maximumEntries: 1, signal: {} }, "$options.signal"],
      [{ maximumEntries: 1, expectedNode: {} }, "$options.expectedNode"],
    ];
    for (const [options, expectedPath] of invalid) {
      await expectStableDirectoryReadError(
        () => readStableRootDirectory(root, asOptions(options)),
        "input",
        expectedPath,
      );
    }

    let getterCalls = 0;
    const accessor: Record<string, unknown> = {};
    Object.defineProperty(accessor, "maximumEntries", {
      get: () => {
        getterCalls += 1;
        return 1;
      },
      enumerable: true,
    });
    await expectStableDirectoryReadError(
      () => readStableRootDirectory(root, asOptions(accessor)),
      "input",
      "$options",
    );
    equal(getterCalls, 0);

    const controller = new AbortController();
    controller.abort("private-abort-reason");
    const aborted = await expectStableDirectoryReadError(
      () => readStableRootDirectory(root, {
        maximumEntries: 0,
        signal: controller.signal,
      }),
      "aborted",
      "$signal",
    );
    equal(aborted.message.includes("private-abort-reason"), false);
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});
