import { deepEqual, equal, notEqual } from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { computeCanonicalJsonSha256Digest } from "../../../src/foundation/crypto/canonical-json-sha256.js";
import { computeSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import { DeterministicJsonDocumentError } from "../../../src/foundation/data/deterministic-json-document.js";
import {
  parseJsonValue,
  type JsonObject,
} from "../../../src/foundation/data/json-value.js";
import {
  readDeterministicJsonFile,
  type DeterministicJsonFileOptions,
} from "../../../src/foundation/filesystem/deterministic-json-file.js";
import { parsePortableResourcePath } from "../../../src/foundation/filesystem/portable-resource-path.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { StableFileReadError } from "../../../src/foundation/filesystem/stable-file-read.js";
import { StrictTextFileError } from "../../../src/foundation/filesystem/strict-text-file.js";
import { parseByteCount } from "../../../src/foundation/numeric/byte-count.js";

const OPTIONS = Object.freeze({ maximumBytes: parseByteCount(4096) });

function asOptions(value: unknown): DeterministicJsonFileOptions {
  return value as DeterministicJsonFileOptions;
}

test("pretty JSON returns frozen value plus distinct source and semantic digests", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-deterministic-file-"));
  const text = [
    "{",
    '  "artifactKind": "wakeflow-example",',
    '  "nested": {',
    '    "second": 2,',
    '    "first": 1',
    "  }",
    "}",
    "",
  ].join("\n");
  writeFileSync(path.join(rootPath, "record.json"), text);
  const root = await RootedDirectory.open(rootPath);
  try {
    const result = await readDeterministicJsonFile(
      root,
      parsePortableResourcePath("record.json"),
      OPTIONS,
    );
    equal(result.text, text);
    equal(result.digest, computeSha256Digest(Buffer.from(text)));
    equal(result.semanticDigest, computeCanonicalJsonSha256Digest(result.value));
    equal(Object.isFrozen(result), true);
    equal(Object.isFrozen(result.value), true);
    const record = result.value as JsonObject;
    equal(Object.getPrototypeOf(record), null);
    equal(Object.isFrozen(record.nested), true);
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("all JSON top-level kinds share the same file profile", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-deterministic-kinds-"));
  const documents = {
    null: "null\n",
    boolean: "true\n",
    number: "42\n",
    string: "\"文本\"\n",
    array: "[\n  null,\n  false,\n  2\n]\n",
    object: "{}\n",
  } as const;
  for (const [name, text] of Object.entries(documents)) {
    writeFileSync(path.join(rootPath, name), text);
  }
  const root = await RootedDirectory.open(rootPath);
  try {
    const values = await Promise.all(Object.keys(documents).map(async (name) => (
      await readDeterministicJsonFile(root, parsePortableResourcePath(name), OPTIONS)
    ).value));
    deepEqual(values, [
      null,
      true,
      42,
      "文本",
      [null, false, 2],
      parseJsonValue({}),
    ]);
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("JSON representation drift is rejected without repair", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-deterministic-drift-"));
  const documents = [
    "{\"a\":1}\n",
    "{\n    \"a\": 1\n}\n",
    "{\n  \"a\": 1,\n  \"a\": 2\n}\n",
    "1.0\n",
    "1e+01\n",
  ] as const;
  for (const [index, text] of documents.entries()) {
    writeFileSync(path.join(rootPath, String(index)), text);
  }
  const root = await RootedDirectory.open(rootPath);
  try {
    for (const index of documents.keys()) {
      let caught: unknown;
      try {
        await readDeterministicJsonFile(
          root,
          parsePortableResourcePath(String(index)),
          OPTIONS,
        );
      } catch (error: unknown) {
        caught = error;
      }
      if (!(caught instanceof DeterministicJsonDocumentError)) {
        throw new Error("Expected DeterministicJsonDocumentError.");
      }
      equal(caught.reason, "non-deterministic");
    }
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("key order changes source identity but not canonical semantic identity", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-deterministic-order-"));
  writeFileSync(path.join(rootPath, "left"), "{\n  \"a\": 1,\n  \"b\": 2\n}\n");
  writeFileSync(path.join(rootPath, "right"), "{\n  \"b\": 2,\n  \"a\": 1\n}\n");
  const root = await RootedDirectory.open(rootPath);
  try {
    const left = await readDeterministicJsonFile(
      root,
      parsePortableResourcePath("left"),
      OPTIONS,
    );
    const right = await readDeterministicJsonFile(
      root,
      parsePortableResourcePath("right"),
      OPTIONS,
    );
    notEqual(left.digest, right.digest);
    equal(left.semanticDigest, right.semanticDigest);
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("syntax, JSON value, and strict text failures retain their owning layers", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-deterministic-errors-"));
  writeFileSync(path.join(rootPath, "syntax"), "{broken}\n");
  writeFileSync(path.join(rootPath, "surrogate"), "\"\\ud800\"\n");
  writeFileSync(path.join(rootPath, "crlf"), "null\r\n");
  const root = await RootedDirectory.open(rootPath);
  try {
    const cases = [
      ["syntax", DeterministicJsonDocumentError, "json-syntax"],
      ["surrogate", DeterministicJsonDocumentError, "lone-surrogate"],
      ["crlf", StrictTextFileError, "line-endings"],
    ] as const;
    for (const [name, ErrorType, reason] of cases) {
      let caught: unknown;
      try {
        await readDeterministicJsonFile(root, parsePortableResourcePath(name), OPTIONS);
      } catch (error: unknown) {
        caught = error;
      }
      if (!(caught instanceof ErrorType)) throw new Error("Unexpected error owner.");
      equal((caught as { reason: string }).reason, reason);
    }
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("expectedNode and options remain lower-layer file contracts", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-deterministic-options-"));
  const physicalPath = path.join(rootPath, "record.json");
  writeFileSync(physicalPath, "null\n");
  const root = await RootedDirectory.open(rootPath);
  try {
    const resourcePath = parsePortableResourcePath("record.json");
    const observed = await readDeterministicJsonFile(root, resourcePath, OPTIONS);
    writeFileSync(physicalPath, "true\n");

    for (const [options, reason, expectedPath] of [
      [{ ...OPTIONS, expectedNode: observed.node }, "expectation-changed", "$options.expectedNode"],
      [{ maximumBytes: -1 }, "input", "$options.maximumBytes"],
    ] as const) {
      let caught: unknown;
      try {
        await readDeterministicJsonFile(root, resourcePath, asOptions(options));
      } catch (error: unknown) {
        caught = error;
      }
      if (!(caught instanceof StableFileReadError)) {
        throw new Error("Expected StableFileReadError.");
      }
      equal(caught.reason, reason);
      equal(caught.path, expectedPath);
    }

    let caught: unknown;
    try {
      await readDeterministicJsonFile(
        root,
        resourcePath,
        asOptions({ ...OPTIONS, extra: true }),
      );
    } catch (error: unknown) {
      caught = error;
    }
    if (!(caught instanceof StrictTextFileError)) {
      throw new Error("Expected StrictTextFileError.");
    }
    equal(caught.reason, "input");
    equal(caught.path, "$options");
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});
