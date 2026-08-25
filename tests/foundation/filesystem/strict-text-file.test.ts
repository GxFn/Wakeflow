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
import { parseByteCount } from "../../../src/foundation/numeric/byte-count.js";
import { parsePortableResourcePath } from "../../../src/foundation/filesystem/portable-resource-path.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import {
  readStrictTextFile,
  StrictTextFileError,
  type StrictTextFileErrorReason,
  type StrictTextFileOptions,
} from "../../../src/foundation/filesystem/strict-text-file.js";

async function expectStrictTextFileError(
  action: () => unknown | Promise<unknown>,
  reason: StrictTextFileErrorReason,
  expectedPath: string,
): Promise<StrictTextFileError> {
  let caught: unknown;
  try {
    await action();
  } catch (error: unknown) {
    caught = error;
  }

  if (!(caught instanceof StrictTextFileError)) {
    throw new Error("Expected StrictTextFileError.");
  }
  equal(caught.name, "StrictTextFileError");
  equal(caught.code, "wakeflow-strict-text-file");
  equal(caught.reason, reason);
  equal(caught.path, expectedPath);
  return caught;
}

function strictOptions(
  overrides: Partial<StrictTextFileOptions> = {},
): StrictTextFileOptions {
  return {
    maximumBytes: parseByteCount(1024),
    bom: "reject",
    lineEndings: "lf",
    finalNewline: "required",
    empty: "forbid",
    ...overrides,
  };
}

function asOptions(value: unknown): StrictTextFileOptions {
  return value as StrictTextFileOptions;
}

test("explicit LF profile returns exact text and stable source facts", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-strict-text-"));
  const bytes = Buffer.from("第一行\nsecond line\n", "utf8");
  writeFileSync(path.join(rootPath, "document.txt"), bytes);
  const root = await RootedDirectory.open(rootPath);
  try {
    const result = await readStrictTextFile(
      root,
      parsePortableResourcePath("document.txt"),
      strictOptions(),
    );

    equal(result.text, bytes.toString("utf8"));
    equal(result.byteCount, bytes.byteLength);
    equal(result.digest, computeSha256Digest(bytes));
    equal(result.bom, "absent");
    equal(result.lineEndings, "lf");
    equal(result.hasFinalNewline, true);
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
      () => readStrictTextFile(
        root,
        parsePortableResourcePath("invalid"),
        strictOptions({
          lineEndings: "preserve",
          finalNewline: "optional",
        }),
      ),
      "utf8",
      "$text",
    );
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("BOM policy rejects, preserves, or strips exactly one initial BOM", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-strict-bom-"));
  const bytes = Buffer.from("\ufeffvalue\n", "utf8");
  writeFileSync(path.join(rootPath, "bom.txt"), bytes);
  const root = await RootedDirectory.open(rootPath);
  try {
    const resourcePath = parsePortableResourcePath("bom.txt");
    await expectStrictTextFileError(
      () => readStrictTextFile(root, resourcePath, strictOptions()),
      "bom",
      "$text",
    );

    const preserved = await readStrictTextFile(
      root,
      resourcePath,
      strictOptions({ bom: "preserve" }),
    );
    const stripped = await readStrictTextFile(
      root,
      resourcePath,
      strictOptions({ bom: "strip" }),
    );
    equal(preserved.text, "\ufeffvalue\n");
    equal(stripped.text, "value\n");
    equal(preserved.bom, "present");
    equal(stripped.bom, "present");
    equal(preserved.digest, stripped.digest);
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("line-ending policies distinguish LF, CRLF, mixed, and no newline", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-strict-lines-"));
  const files = {
    lf: "a\nb\n",
    crlf: "a\r\nb\r\n",
    mixed: "a\r\nb\nc\r",
    none: "abc",
  } as const;
  for (const [name, text] of Object.entries(files)) {
    writeFileSync(path.join(rootPath, name), text);
  }
  const root = await RootedDirectory.open(rootPath);
  try {
    const preserved = await Promise.all(
      Object.keys(files).map(async (name) => readStrictTextFile(
        root,
        parsePortableResourcePath(name),
        strictOptions({
          lineEndings: "preserve",
          finalNewline: "optional",
        }),
      )),
    );
    deepEqual(
      preserved.map((result) => result.lineEndings),
      ["lf", "crlf", "mixed", "none"],
    );

    await expectStrictTextFileError(
      () => readStrictTextFile(
        root,
        parsePortableResourcePath("crlf"),
        strictOptions({ lineEndings: "lf" }),
      ),
      "line-endings",
      "$text",
    );
    await expectStrictTextFileError(
      () => readStrictTextFile(
        root,
        parsePortableResourcePath("lf"),
        strictOptions({ lineEndings: "crlf" }),
      ),
      "line-endings",
      "$text",
    );
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("final-newline policy is independent from line-ending style", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-strict-final-"));
  writeFileSync(path.join(rootPath, "with"), "value\n");
  writeFileSync(path.join(rootPath, "without"), "value");
  const root = await RootedDirectory.open(rootPath);
  try {
    await expectStrictTextFileError(
      () => readStrictTextFile(
        root,
        parsePortableResourcePath("without"),
        strictOptions({ finalNewline: "required" }),
      ),
      "final-newline",
      "$text",
    );
    await expectStrictTextFileError(
      () => readStrictTextFile(
        root,
        parsePortableResourcePath("with"),
        strictOptions({ finalNewline: "forbidden" }),
      ),
      "final-newline",
      "$text",
    );
    const optional = await readStrictTextFile(
      root,
      parsePortableResourcePath("without"),
      strictOptions({ finalNewline: "optional" }),
    );
    equal(optional.hasFinalNewline, false);
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("empty policy treats a BOM-only file as logically empty", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-strict-empty-"));
  writeFileSync(path.join(rootPath, "empty"), Buffer.alloc(0));
  writeFileSync(path.join(rootPath, "bom-only"), Buffer.from("\ufeff", "utf8"));
  const root = await RootedDirectory.open(rootPath);
  try {
    for (const name of ["empty", "bom-only"] as const) {
      await expectStrictTextFileError(
        () => readStrictTextFile(
          root,
          parsePortableResourcePath(name),
          strictOptions({
            bom: "strip",
            lineEndings: "preserve",
            finalNewline: "optional",
            empty: "forbid",
          }),
        ),
        "empty",
        "$text",
      );
    }

    const allowed = await readStrictTextFile(
      root,
      parsePortableResourcePath("empty"),
      strictOptions({
        lineEndings: "preserve",
        finalNewline: "optional",
        empty: "allow",
      }),
    );
    equal(allowed.text, "");
    equal(allowed.lineEndings, "none");
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("all profile fields are explicit and passively admitted", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-strict-options-"));
  writeFileSync(path.join(rootPath, "file"), "value\n");
  const root = await RootedDirectory.open(rootPath);
  try {
    const invalid: readonly [unknown, string][] = [
      [{}, "$options"],
      [{ ...strictOptions(), extra: true }, "$options"],
      [{ ...strictOptions(), bom: "auto" }, "$options.bom"],
      [{ ...strictOptions(), lineEndings: "auto" }, "$options.lineEndings"],
      [{ ...strictOptions(), finalNewline: "auto" }, "$options.finalNewline"],
      [{ ...strictOptions(), empty: "auto" }, "$options.empty"],
      [{ ...strictOptions(), maximumBytes: -1 }, "$options.maximumBytes"],
      [{ ...strictOptions(), signal: {} }, "$options.signal"],
    ];
    for (const [options, expectedPath] of invalid) {
      await expectStrictTextFileError(
        () => readStrictTextFile(
          root,
          parsePortableResourcePath("file"),
          asOptions(options),
        ),
        "input",
        expectedPath,
      );
    }

    let getterCalls = 0;
    const accessor = strictOptions() as unknown as Record<string, unknown>;
    Object.defineProperty(accessor, "bom", {
      get: () => {
        getterCalls += 1;
        return "reject";
      },
      enumerable: true,
    });
    await expectStrictTextFileError(
      () => readStrictTextFile(
        root,
        parsePortableResourcePath("file"),
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

test("strict-text-file composes existing byte and UTF-8 foundations only", () => {
  const source = readFileSync(
    path.join(
      process.cwd(),
      "src/foundation/filesystem/strict-text-file.ts",
    ),
    "utf8",
  );
  const imports = [...source.matchAll(/from\s+["']([^"']+)["']/gu)]
    .map((entry) => entry[1]);

  deepEqual(imports, [
    "node:util",
    "../data/passive-own-data.js",
    "../numeric/byte-count.js",
    "../text/utf8.js",
    "../crypto/sha256.js",
    "./file-node-snapshot.js",
    "./portable-resource-path.js",
    "./rooted-directory.js",
    "./stable-file-read.js",
  ]);
  equal(source.includes("node:fs"), false);
  equal(source.includes("TextDecoder"), false);
  equal(source.includes("JSON.parse"), false);
  equal(source.includes("replace(/\\r"), false);
  equal(source.includes("decodeUtf8"), true);
  equal(source.includes("readStableFile"), true);
});
