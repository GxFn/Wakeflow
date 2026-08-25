import { deepEqual, equal } from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { computeSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import {
  createFileByteRange,
  parseFileByteOffset,
  parseFileByteRange,
  type FileByteRange,
} from "../../../src/foundation/filesystem/file-byte-range.js";
import { parsePortableResourcePath } from "../../../src/foundation/filesystem/portable-resource-path.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import {
  readStableFileRange,
  STABLE_FILE_RANGE_READ_CHUNK_BYTES,
  StableFileRangeReadError,
  type StableFileRangeReadErrorReason,
  type StableFileRangeReadOptions,
} from "../../../src/foundation/filesystem/stable-file-range-read.js";
import { readStableFile } from "../../../src/foundation/filesystem/stable-file-read.js";
import { parseByteCount } from "../../../src/foundation/numeric/byte-count.js";

async function expectRangeReadError(
  action: () => unknown | Promise<unknown>,
  reason: StableFileRangeReadErrorReason,
  expectedPath: string,
): Promise<StableFileRangeReadError> {
  let caught: unknown;
  try {
    await action();
  } catch (error: unknown) {
    caught = error;
  }
  if (!(caught instanceof StableFileRangeReadError)) {
    throw new Error("Expected StableFileRangeReadError.");
  }
  equal(caught.name, "StableFileRangeReadError");
  equal(caught.code, "wakeflow-stable-file-range-read");
  equal(caught.reason, reason);
  equal(caught.path, expectedPath);
  return caught;
}

function asRange(value: unknown): FileByteRange {
  return value as FileByteRange;
}

function asOptions(value: unknown): StableFileRangeReadOptions {
  return value as StableFileRangeReadOptions;
}

test("interior positioned read returns exact bytes and range-only digest", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-range-read-"));
  const content = Buffer.from("prefix-目标区域-suffix", "utf8");
  writeFileSync(path.join(rootPath, "record"), content);
  const root = await RootedDirectory.open(rootPath);
  try {
    const offset = Buffer.byteLength("prefix-", "utf8");
    const length = Buffer.byteLength("目标区域", "utf8");
    const range = createFileByteRange(
      parseFileByteOffset(offset),
      parseByteCount(length),
    );
    const result = await readStableFileRange(
      root,
      parsePortableResourcePath("record"),
      range,
      {},
    );

    deepEqual(result.bytes, Buffer.from("目标区域", "utf8"));
    equal(result.rangeDigest, computeSha256Digest(result.bytes));
    equal(result.rangeDigest === computeSha256Digest(content), false);
    equal(result.fileByteCount, content.byteLength);
    equal(result.fileNode.kind, "file");
    deepEqual(result.range, range);
    equal(Object.isFrozen(result), true);
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("ranges spanning multiple positioned-read chunks remain exact", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-range-chunks-"));
  const content = Buffer.alloc(STABLE_FILE_RANGE_READ_CHUNK_BYTES * 3 + 41);
  for (let index = 0; index < content.length; index += 1) {
    content[index] = index % 251;
  }
  writeFileSync(path.join(rootPath, "large"), content);
  const root = await RootedDirectory.open(rootPath);
  try {
    const offset = 13;
    const length = STABLE_FILE_RANGE_READ_CHUNK_BYTES * 2 + 17;
    const result = await readStableFileRange(
      root,
      parsePortableResourcePath("large"),
      parseFileByteRange({ offset, length }),
      {},
    );
    deepEqual(result.bytes, content.subarray(offset, offset + length));
    equal(result.rangeDigest, computeSha256Digest(result.bytes));
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("zero-length ranges are valid at the beginning and exact EOF", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-range-empty-"));
  writeFileSync(path.join(rootPath, "file"), "12345");
  const root = await RootedDirectory.open(rootPath);
  try {
    for (const offset of [0, 5] as const) {
      const result = await readStableFileRange(
        root,
        parsePortableResourcePath("file"),
        parseFileByteRange({ offset, length: 0 }),
        {},
      );
      equal(result.bytes.byteLength, 0);
      equal(result.rangeDigest, computeSha256Digest(new Uint8Array(0)));
    }
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("range bounds are checked against the opened file version", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-range-bounds-"));
  writeFileSync(path.join(rootPath, "file"), "12345");
  const root = await RootedDirectory.open(rootPath);
  try {
    for (const range of [
      parseFileByteRange({ offset: 6, length: 0 }),
      parseFileByteRange({ offset: 4, length: 2 }),
    ]) {
      await expectRangeReadError(
        () => readStableFileRange(
          root,
          parsePortableResourcePath("file"),
          range,
          {},
        ),
        "range-out-of-bounds",
        "$range",
      );
    }
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("expectedNode binds an indexed range to one exact file version", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-range-version-"));
  const target = path.join(rootPath, "file");
  writeFileSync(target, "version-one");
  const root = await RootedDirectory.open(rootPath);
  try {
    const resourcePath = parsePortableResourcePath("file");
    const version = await readStableFile(root, resourcePath, {
      maximumBytes: parseByteCount(1024),
      capture: "digest-only",
    });
    const range = parseFileByteRange({ offset: 0, length: 7 });
    const current = await readStableFileRange(root, resourcePath, range, {
      expectedNode: version.node,
    });
    deepEqual(current.bytes, Buffer.from("version"));

    writeFileSync(target, "version-two");
    await expectRangeReadError(
      () => readStableFileRange(root, resourcePath, range, {
        expectedNode: version.node,
      }),
      "expectation-changed",
      "$resourcePath",
    );
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("missing, directory, and symlink targets are rejected without following", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-range-types-"));
  mkdirSync(path.join(rootPath, "directory"));
  writeFileSync(path.join(rootPath, "target"), "secret");
  symlinkSync("target", path.join(rootPath, "link"));
  const root = await RootedDirectory.open(rootPath);
  try {
    const cases: readonly [string, StableFileRangeReadErrorReason][] = [
      ["missing", "not-found"],
      ["directory", "not-file"],
      ["link", "symlink"],
    ];
    for (const [name, reason] of cases) {
      await expectRangeReadError(
        () => readStableFileRange(
          root,
          parsePortableResourcePath(name),
          parseFileByteRange({ offset: 0, length: 0 }),
          {},
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

test("range and options inputs are closed, passive, and revalidated", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-range-input-"));
  writeFileSync(path.join(rootPath, "file"), "value");
  const root = await RootedDirectory.open(rootPath);
  try {
    await expectRangeReadError(
      () => readStableFileRange(
        root,
        parsePortableResourcePath("file"),
        asRange({ offset: 0, length: 1, endExclusive: 9 }),
        {},
      ),
      "input",
      "$range",
    );
    for (const options of [
      { extra: true },
      { signal: {} },
      { expectedNode: {} },
    ]) {
      await expectRangeReadError(
        () => readStableFileRange(
          root,
          parsePortableResourcePath("file"),
          parseFileByteRange({ offset: 0, length: 1 }),
          asOptions(options),
        ),
        "input",
        options.signal === undefined && options.expectedNode === undefined
          ? "$options"
          : options.signal !== undefined
            ? "$options.signal"
            : "$options.expectedNode",
      );
    }

    let getterCalls = 0;
    const accessor: Record<string, unknown> = {};
    Object.defineProperty(accessor, "signal", {
      get: () => {
        getterCalls += 1;
        return undefined;
      },
      enumerable: true,
    });
    await expectRangeReadError(
      () => readStableFileRange(
        root,
        parsePortableResourcePath("file"),
        parseFileByteRange({ offset: 0, length: 1 }),
        asOptions(accessor),
      ),
      "input",
      "$options",
    );
    equal(getterCalls, 0);

    const controller = new AbortController();
    controller.abort("private-range-reason");
    const error = await expectRangeReadError(
      () => readStableFileRange(
        root,
        parsePortableResourcePath("file"),
        parseFileByteRange({ offset: 0, length: 1 }),
        { signal: controller.signal },
      ),
      "aborted",
      "$signal",
    );
    equal(error.message.includes("private-range-reason"), false);
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("returned range byte arrays are independent caller-owned copies", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-range-copy-"));
  writeFileSync(path.join(rootPath, "file"), "abcdef");
  const root = await RootedDirectory.open(rootPath);
  try {
    const resourcePath = parsePortableResourcePath("file");
    const range = parseFileByteRange({ offset: 1, length: 3 });
    const first = await readStableFileRange(root, resourcePath, range, {});
    const second = await readStableFileRange(root, resourcePath, range, {});
    first.bytes[0] = 0;
    deepEqual(second.bytes, Buffer.from("bcd"));
    equal(readFileSync(path.join(rootPath, "file"), "utf8"), "abcdef");
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("stable-file-range-read uses positioned I/O and no text or marker logic", () => {
  const source = readFileSync(
    path.join(
      process.cwd(),
      "src/foundation/filesystem/stable-file-range-read.ts",
    ),
    "utf8",
  );
  const imports = [...source.matchAll(/from\s+["']([^"']+)["']/gu)]
    .map((entry) => entry[1]);
  deepEqual(imports, [
    "node:buffer",
    "node:fs",
    "node:fs/promises",
    "node:util",
    "../crypto/sha256.js",
    "../data/passive-own-data.js",
    "../numeric/byte-count.js",
    "../node/node-system-error.js",
    "./file-node-snapshot.js",
    "./file-byte-range.js",
    "./portable-resource-path.js",
    "./rooted-directory.js",
  ]);
  equal(source.includes("range.offset + captured"), true);
  equal(source.includes("readFile("), false);
  equal(source.includes("TextDecoder"), false);
  equal(source.includes("marker"), true);
  equal(source.includes("write("), false);
  equal(source.includes("rangeDigest"), true);
});
