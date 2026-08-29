import { equal } from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { computeSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import { parsePortableResourcePath } from "../../../src/foundation/filesystem/portable-resource-path.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import {
  StableFileReadError,
  type StableFileReadErrorReason,
  type StableFileReadOptions,
} from "../../../src/foundation/filesystem/stable-file-read.js";
import {
  readStrictTextFile,
  StrictTextFileError,
  type StrictTextFileErrorReason,
} from "../../../src/foundation/filesystem/strict-text-file.js";
import { parseByteCount } from "../../../src/foundation/numeric/byte-count.js";

const DEFAULT_OPTIONS = Object.freeze({
  maximumBytes: parseByteCount(1024),
});

async function expectStrictTextFileError(
  action: () => unknown | Promise<unknown>,
  reason: StrictTextFileErrorReason,
  expectedPath = "$text",
): Promise<void> {
  let caught: unknown;
  try {
    await action();
  } catch (error: unknown) {
    caught = error;
  }
  if (!(caught instanceof StrictTextFileError)) {
    throw new Error("Expected StrictTextFileError.");
  }
  equal(caught.code, "wakeflow-strict-text-file");
  equal(caught.reason, reason);
  equal(caught.path, expectedPath);
}

async function expectStableFileReadError(
  action: () => unknown | Promise<unknown>,
  reason: StableFileReadErrorReason,
  expectedPath: string,
): Promise<void> {
  let caught: unknown;
  try {
    await action();
  } catch (error: unknown) {
    caught = error;
  }
  if (!(caught instanceof StableFileReadError)) {
    throw new Error("Expected StableFileReadError.");
  }
  equal(caught.reason, reason);
  equal(caught.path, expectedPath);
}

function asOptions(value: unknown): StableFileReadOptions {
  return value as StableFileReadOptions;
}

test("strict UTF-8 text returns exact NFC/LF bytes and stable source facts", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-strict-text-"));
  const bytes = Buffer.from("第一行\nsecond line\n", "utf8");
  writeFileSync(path.join(rootPath, "document.txt"), bytes);
  const root = await RootedDirectory.open(rootPath);
  try {
    const result = await readStrictTextFile(
      root,
      parsePortableResourcePath("document.txt"),
      DEFAULT_OPTIONS,
    );
    equal(result.text, bytes.toString("utf8"));
    equal(result.byteCount, bytes.byteLength);
    equal(result.digest, computeSha256Digest(bytes));
    equal(result.node.kind, "file");
    equal(Object.keys(result).sort().join(","), "byteCount,digest,node,resourcePath,text");
    equal(Object.isFrozen(result), true);
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("invalid UTF-8 is rejected without replacement text", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-strict-utf8-"));
  writeFileSync(path.join(rootPath, "invalid"), Buffer.from([0x61, 0xc3, 0x28]));
  const root = await RootedDirectory.open(rootPath);
  try {
    await expectStrictTextFileError(
      () => readStrictTextFile(root, parsePortableResourcePath("invalid"), DEFAULT_OPTIONS),
      "utf8",
    );
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("an initial UTF-8 BOM is always rejected", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-strict-bom-"));
  writeFileSync(path.join(rootPath, "bom.txt"), Buffer.from("\ufeffvalue\n", "utf8"));
  const root = await RootedDirectory.open(rootPath);
  try {
    await expectStrictTextFileError(
      () => readStrictTextFile(root, parsePortableResourcePath("bom.txt"), DEFAULT_OPTIONS),
      "bom",
    );
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("CRLF, mixed endings, and lone CR are rejected", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-strict-lines-"));
  const cases = {
    crlf: "a\r\nb\r\n",
    mixed: "a\nb\r\n",
    lone: "a\rb\n",
  } as const;
  for (const [name, text] of Object.entries(cases)) {
    writeFileSync(path.join(rootPath, name), text);
  }
  const root = await RootedDirectory.open(rootPath);
  try {
    for (const name of Object.keys(cases)) {
      await expectStrictTextFileError(
        () => readStrictTextFile(root, parsePortableResourcePath(name), DEFAULT_OPTIONS),
        "line-endings",
      );
    }
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("text must end with exactly one LF", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-strict-final-"));
  writeFileSync(path.join(rootPath, "missing"), "value");
  writeFileSync(path.join(rootPath, "extra"), "value\n\n");
  const root = await RootedDirectory.open(rootPath);
  try {
    for (const name of ["missing", "extra"] as const) {
      await expectStrictTextFileError(
        () => readStrictTextFile(root, parsePortableResourcePath(name), DEFAULT_OPTIONS),
        "final-newline",
      );
    }
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("zero bytes and a lone final LF are logically empty", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-strict-empty-"));
  writeFileSync(path.join(rootPath, "zero"), Buffer.alloc(0));
  writeFileSync(path.join(rootPath, "newline"), "\n");
  const root = await RootedDirectory.open(rootPath);
  try {
    for (const name of ["zero", "newline"] as const) {
      await expectStrictTextFileError(
        () => readStrictTextFile(root, parsePortableResourcePath(name), DEFAULT_OPTIONS),
        "empty",
      );
    }
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("decoded source text must already use Unicode NFC", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-strict-nfc-"));
  writeFileSync(path.join(rootPath, "nfd"), "Cafe\u0301\n");
  const root = await RootedDirectory.open(rootPath);
  try {
    await expectStrictTextFileError(
      () => readStrictTextFile(root, parsePortableResourcePath("nfd"), DEFAULT_OPTIONS),
      "unicode-normalization",
    );
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("expectedNode is delegated to the stable file version boundary", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-strict-expected-"));
  const physicalPath = path.join(rootPath, "record.txt");
  writeFileSync(physicalPath, "before\n");
  const root = await RootedDirectory.open(rootPath);
  try {
    const resourcePath = parsePortableResourcePath("record.txt");
    const observed = await readStrictTextFile(root, resourcePath, DEFAULT_OPTIONS);
    const repeated = await readStrictTextFile(root, resourcePath, {
      ...DEFAULT_OPTIONS,
      expectedNode: observed.node,
    });
    equal(repeated.digest, observed.digest);

    writeFileSync(physicalPath, "after-version\n");
    await expectStableFileReadError(
      () => readStrictTextFile(root, resourcePath, {
        ...DEFAULT_OPTIONS,
        expectedNode: observed.node,
      }),
      "expectation-changed",
      "$options.expectedNode",
    );
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("stable file read remains the sole owner of read options", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-strict-options-"));
  writeFileSync(path.join(rootPath, "file"), "value\n");
  const root = await RootedDirectory.open(rootPath);
  try {
    await expectStableFileReadError(
      () => readStrictTextFile(
        root,
        parsePortableResourcePath("file"),
        asOptions({ maximumBytes: parseByteCount(1024), extra: true }),
      ),
      "input",
      "$options",
    );

    let getterCalls = 0;
    const accessor = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(accessor, "maximumBytes", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return 1024;
      },
    });
    await expectStableFileReadError(
      () => readStrictTextFile(
        root,
        parsePortableResourcePath("file"),
        asOptions(accessor),
      ),
      "input",
      "$options",
    );
    equal(getterCalls, 0);

    await expectStableFileReadError(
      () => readStrictTextFile(
        root,
        parsePortableResourcePath("file"),
        asOptions({ maximumBytes: -1 }),
      ),
      "input",
      "$options.maximumBytes",
    );
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});
