import { deepEqual, equal } from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { computeSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import type { JsonObject } from "../../../src/foundation/data/json-value.js";
import { parseByteCount } from "../../../src/foundation/numeric/byte-count.js";
import {
  CanonicalJsonFileError,
  readCanonicalJsonFile,
  type CanonicalJsonFileErrorReason,
  type CanonicalJsonFileOptions,
} from "../../../src/foundation/filesystem/canonical-json-file.js";
import { parsePortableResourcePath } from "../../../src/foundation/filesystem/portable-resource-path.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { StrictTextFileError } from "../../../src/foundation/filesystem/strict-text-file.js";

function canonicalOptions(
  overrides: Partial<CanonicalJsonFileOptions> = {},
): CanonicalJsonFileOptions {
  return {
    maximumBytes: parseByteCount(4096),
    ...overrides,
  };
}

function asOptions(value: unknown): CanonicalJsonFileOptions {
  return value as CanonicalJsonFileOptions;
}

async function expectCanonicalJsonFileError(
  action: () => unknown | Promise<unknown>,
  reason: CanonicalJsonFileErrorReason,
  expectedPath: string,
): Promise<CanonicalJsonFileError> {
  let caught: unknown;
  try {
    await action();
  } catch (error: unknown) {
    caught = error;
  }

  if (!(caught instanceof CanonicalJsonFileError)) {
    throw new Error("Expected CanonicalJsonFileError.");
  }
  equal(caught.name, "CanonicalJsonFileError");
  equal(caught.code, "wakeflow-canonical-json-file");
  equal(caught.reason, reason);
  equal(caught.path, expectedPath);
  return caught;
}

test("canonical JSON file returns immutable value and exact file facts", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-canonical-file-"));
  const bytes = Buffer.from(
    "{\"list\":[{\"x\":null,\"y\":true},\"尾\"],\"nested\":{\"a\":1,\"b\":2}}\n",
    "utf8",
  );
  writeFileSync(path.join(rootPath, "record.json"), bytes);
  const root = await RootedDirectory.open(rootPath);
  try {
    const result = await readCanonicalJsonFile(
      root,
      parsePortableResourcePath("record.json"),
      canonicalOptions(),
    );

    equal(result.resourcePath, "record.json");
    equal(result.byteCount, bytes.byteLength);
    equal(result.digest, computeSha256Digest(bytes));
    deepEqual(Object.keys(result).sort(), [
      "byteCount",
      "digest",
      "node",
      "resourcePath",
      "value",
    ]);
    equal(Object.isFrozen(result), true);
    equal(Object.isFrozen(result.value), true);
    if (
      result.value === null
      || typeof result.value !== "object"
      || Array.isArray(result.value)
    ) {
      throw new Error("Expected a JSON object result.");
    }
    const record = result.value as JsonObject;
    equal(Object.getPrototypeOf(record), null);
    equal(Object.isFrozen(record.nested), true);
    deepEqual({ ...record.nested as object }, { a: 1, b: 2 });
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("all RFC 8785 top-level JSON value kinds can be canonical files", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-canonical-kinds-"));
  const documents = {
    null: "null\n",
    boolean: "true\n",
    number: "1e+30\n",
    string: "\"文本\"\n",
    array: "[null,false,2]\n",
  } as const;
  for (const [name, text] of Object.entries(documents)) {
    writeFileSync(path.join(rootPath, name), text);
  }
  const root = await RootedDirectory.open(rootPath);
  try {
    const values = await Promise.all(
      Object.keys(documents).map(async (name) => (
        await readCanonicalJsonFile(
          root,
          parsePortableResourcePath(name),
          canonicalOptions(),
        )
      ).value),
    );
    deepEqual(values, [null, true, 1e30, "文本", [null, false, 2]]);
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("parseable representation drift is rejected instead of normalized", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-canonical-drift-"));
  const documents = [
    "{ \"a\":1}\n",
    "{\"b\":1,\"a\":2}\n",
    "{\n\"a\":1\n}\n",
    "{\"a\":1}\n\n",
    "{\"a\":1} \n",
    "{\"a\":1,\"a\":1}\n",
    "1.0\n",
    "1e+01\n",
    "\"\\/\"\n",
  ] as const;
  for (const [index, text] of documents.entries()) {
    writeFileSync(path.join(rootPath, String(index)), text);
  }
  const root = await RootedDirectory.open(rootPath);
  try {
    for (const index of documents.keys()) {
      await expectCanonicalJsonFileError(
        () => readCanonicalJsonFile(
          root,
          parsePortableResourcePath(String(index)),
          canonicalOptions(),
        ),
        "non-canonical",
        "$document",
      );
    }
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("malformed JSON is sanitized into the document syntax error", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-canonical-syntax-"));
  writeFileSync(path.join(rootPath, "broken.json"), "{\"private\":}\n");
  const root = await RootedDirectory.open(rootPath);
  try {
    const error = await expectCanonicalJsonFileError(
      () => readCanonicalJsonFile(
        root,
        parsePortableResourcePath("broken.json"),
        canonicalOptions(),
      ),
      "json-syntax",
      "$document",
    );
    equal(error.message.includes("private"), false);
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("decoded values still pass through Wakeflow JSON value admission", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-canonical-value-"));
  writeFileSync(path.join(rootPath, "negative-zero"), "-0\n");
  writeFileSync(path.join(rootPath, "surrogate"), "\"\\ud800\"\n");
  const root = await RootedDirectory.open(rootPath);
  try {
    await expectCanonicalJsonFileError(
      () => readCanonicalJsonFile(
        root,
        parsePortableResourcePath("negative-zero"),
        canonicalOptions(),
      ),
      "negative-zero",
      "$document",
    );
    await expectCanonicalJsonFileError(
      () => readCanonicalJsonFile(
        root,
        parsePortableResourcePath("surrogate"),
        canonicalOptions(),
      ),
      "lone-surrogate",
      "$document",
    );
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("BOM, CRLF, and a missing final LF remain strict-text failures", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-canonical-text-"));
  writeFileSync(path.join(rootPath, "bom"), Buffer.from("\ufeffnull\n", "utf8"));
  writeFileSync(path.join(rootPath, "crlf"), "null\r\n");
  writeFileSync(path.join(rootPath, "no-final-lf"), "null");
  const root = await RootedDirectory.open(rootPath);
  try {
    const cases = [
      ["bom", "bom"],
      ["crlf", "line-endings"],
      ["no-final-lf", "final-newline"],
    ] as const;
    for (const [name, reason] of cases) {
      let caught: unknown;
      try {
        await readCanonicalJsonFile(
          root,
          parsePortableResourcePath(name),
          canonicalOptions(),
        );
      } catch (error: unknown) {
        caught = error;
      }
      if (!(caught instanceof StrictTextFileError)) {
        throw new Error("Expected StrictTextFileError.");
      }
      equal(caught.reason, reason);
    }
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("file options are closed and passively admitted", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-canonical-options-"));
  writeFileSync(path.join(rootPath, "record.json"), "null\n");
  const root = await RootedDirectory.open(rootPath);
  try {
    const invalid: readonly [unknown, string][] = [
      [{}, "$options"],
      [{ maximumBytes: 10, extra: true }, "$options"],
      [{ maximumBytes: -1 }, "$options.maximumBytes"],
      [{ maximumBytes: 10, signal: {} }, "$options.signal"],
    ];
    for (const [options, expectedPath] of invalid) {
      await expectCanonicalJsonFileError(
        () => readCanonicalJsonFile(
          root,
          parsePortableResourcePath("record.json"),
          asOptions(options),
        ),
        "input",
        expectedPath,
      );
    }

    let getterCalls = 0;
    const accessor: Record<string, unknown> = {};
    Object.defineProperty(accessor, "maximumBytes", {
      get: () => {
        getterCalls += 1;
        return 10;
      },
      enumerable: true,
    });
    await expectCanonicalJsonFileError(
      () => readCanonicalJsonFile(
        root,
        parsePortableResourcePath("record.json"),
        asOptions(accessor),
      ),
      "input",
      "$options",
    );
    equal(getterCalls, 0);
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("canonical-json-file only composes existing foundations", () => {
  const source = readFileSync(
    path.join(
      process.cwd(),
      "src/foundation/filesystem/canonical-json-file.ts",
    ),
    "utf8",
  );
  const imports = [...source.matchAll(/from\s+["']([^"']+)["']/gu)]
    .map((entry) => entry[1]);

  deepEqual(imports, [
    "node:util",
    "../data/canonical-json.js",
    "../data/json-value.js",
    "../data/passive-own-data.js",
    "../crypto/sha256.js",
    "../numeric/byte-count.js",
    "./file-node-snapshot.js",
    "./portable-resource-path.js",
    "./rooted-directory.js",
    "./strict-text-file.js",
  ]);
  equal(source.includes("node:fs"), false);
  equal(source.includes("TextDecoder"), false);
  equal(source.includes("JSON.stringify"), false);
  equal(source.includes("readStableFile"), false);
  equal(source.includes("readStrictTextFile"), true);
  equal(source.includes("canonicalizeJson"), true);
  equal(source.includes("JSON.parse"), true);
});
