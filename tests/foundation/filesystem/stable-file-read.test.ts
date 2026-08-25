import { deepEqual, equal } from "node:assert/strict";
import {
  linkSync,
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
  parseByteCount,
} from "../../../src/foundation/numeric/byte-count.js";
import {
  parsePortableResourcePath,
  type PortableResourcePath,
} from "../../../src/foundation/filesystem/portable-resource-path.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import {
  readStableFile,
  STABLE_FILE_READ_CHUNK_BYTES,
  StableFileReadError,
  type StableFileReadErrorReason,
  type StableFileReadOptions,
} from "../../../src/foundation/filesystem/stable-file-read.js";

async function expectStableFileReadError(
  action: () => unknown | Promise<unknown>,
  reason: StableFileReadErrorReason,
  expectedPath: string,
): Promise<StableFileReadError> {
  let caught: unknown;
  try {
    await action();
  } catch (error: unknown) {
    caught = error;
  }

  if (!(caught instanceof StableFileReadError)) {
    throw new Error("Expected StableFileReadError.");
  }
  equal(caught.name, "StableFileReadError");
  equal(caught.code, "wakeflow-stable-file-read");
  equal(caught.reason, reason);
  equal(caught.path, expectedPath);
  return caught;
}

function asOptions(value: unknown): StableFileReadOptions {
  return value as StableFileReadOptions;
}

function asPortableResourcePath(value: unknown): PortableResourcePath {
  return value as PortableResourcePath;
}

test("bounded byte capture returns exact bytes, digest, and final node facts", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-stable-read-"));
  const file = path.join(rootPath, "records", "state.json");
  mkdirSync(path.dirname(file));
  const expected = Buffer.from("{\"state\":\"ready\"}\n", "utf8");
  writeFileSync(file, expected, { mode: 0o600 });

  const root = await RootedDirectory.open(rootPath);
  try {
    const resourcePath = parsePortableResourcePath("records/state.json");
    const result = await readStableFile(root, resourcePath, {
      maximumBytes: parseByteCount(1024),
      capture: "bytes",
    });

    equal(result.capture, "bytes");
    deepEqual(result.bytes, expected);
    equal(result.byteCount, expected.byteLength);
    equal(result.digest, computeSha256Digest(expected));
    equal(result.node.kind, "file");
    equal(result.node.permissionBits, 0o600);
    equal(Object.isFrozen(result), true);
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("digest-only mode streams multiple chunks without returning file bytes", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-stable-hash-"));
  const file = path.join(rootPath, "large.bin");
  const expected = Buffer.alloc(STABLE_FILE_READ_CHUNK_BYTES * 3 + 17);
  for (let index = 0; index < expected.length; index += 1) {
    expected[index] = index % 251;
  }
  writeFileSync(file, expected);

  const root = await RootedDirectory.open(rootPath);
  try {
    const result = await readStableFile(
      root,
      parsePortableResourcePath("large.bin"),
      {
        maximumBytes: parseByteCount(expected.byteLength),
        capture: "digest-only",
      },
    );

    equal(result.capture, "digest-only");
    equal(result.bytes, null);
    equal(result.byteCount, expected.byteLength);
    equal(result.digest, computeSha256Digest(expected));
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("empty files are valid in both capture modes", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-stable-empty-"));
  writeFileSync(path.join(rootPath, "empty"), Buffer.alloc(0));
  const root = await RootedDirectory.open(rootPath);
  try {
    const resourcePath = parsePortableResourcePath("empty");
    const bytes = await readStableFile(root, resourcePath, {
      maximumBytes: parseByteCount(0),
    });
    const digest = await readStableFile(root, resourcePath, {
      maximumBytes: parseByteCount(0),
      capture: "digest-only",
    });

    equal(bytes.capture, "bytes");
    equal(bytes.bytes.byteLength, 0);
    equal(digest.bytes, null);
    equal(bytes.digest, digest.digest);
    equal(bytes.byteCount, 0);
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("caller maximum is enforced before content allocation or hashing", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-stable-limit-"));
  writeFileSync(path.join(rootPath, "bounded"), "1234");
  const root = await RootedDirectory.open(rootPath);
  try {
    await expectStableFileReadError(
      () => readStableFile(root, parsePortableResourcePath("bounded"), {
        maximumBytes: parseByteCount(3),
      }),
      "too-large",
      "$resourcePath",
    );
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("directories and symlinks are classified without reading their targets", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-stable-types-"));
  mkdirSync(path.join(rootPath, "directory"));
  writeFileSync(path.join(rootPath, "target"), "secret-target");
  symlinkSync("target", path.join(rootPath, "link"));
  const root = await RootedDirectory.open(rootPath);
  try {
    await expectStableFileReadError(
      () => readStableFile(root, parsePortableResourcePath("directory"), {
        maximumBytes: parseByteCount(1024),
      }),
      "not-file",
      "$resourcePath",
    );
    await expectStableFileReadError(
      () => readStableFile(root, parsePortableResourcePath("link"), {
        maximumBytes: parseByteCount(1024),
      }),
      "symlink",
      "$resourcePath",
    );
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("missing and forged resource paths map to stable read errors", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-stable-path-"));
  const root = await RootedDirectory.open(rootPath);
  try {
    await expectStableFileReadError(
      () => readStableFile(root, parsePortableResourcePath("missing"), {
        maximumBytes: parseByteCount(1024),
      }),
      "not-found",
      "$resourcePath",
    );
    await expectStableFileReadError(
      () => readStableFile(root, asPortableResourcePath("../escape"), {
        maximumBytes: parseByteCount(1024),
      }),
      "input",
      "$resourcePath",
    );
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("hard links remain observable facts rather than a foundation rejection", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-stable-link-"));
  const source = path.join(rootPath, "source");
  writeFileSync(source, "shared");
  linkSync(source, path.join(rootPath, "alias"));
  const root = await RootedDirectory.open(rootPath);
  try {
    const result = await readStableFile(
      root,
      parsePortableResourcePath("source"),
      { maximumBytes: parseByteCount(1024) },
    );
    if (result.capture !== "bytes") {
      throw new Error("Expected captured stable file bytes.");
    }
    equal(result.node.linkCount, 2n);
    equal(Buffer.from(result.bytes).toString("utf8"), "shared");
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("an already-aborted signal stops before reading", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-stable-abort-"));
  writeFileSync(path.join(rootPath, "file"), "content");
  const root = await RootedDirectory.open(rootPath);
  const controller = new AbortController();
  controller.abort(new Error("private abort reason"));
  try {
    const error = await expectStableFileReadError(
      () => readStableFile(root, parsePortableResourcePath("file"), {
        maximumBytes: parseByteCount(1024),
        signal: controller.signal,
      }),
      "aborted",
      "$signal",
    );
    equal(error.message.includes("private abort reason"), false);
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("closed options reject accessors, unknown fields, and forged values", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-stable-options-"));
  writeFileSync(path.join(rootPath, "file"), "content");
  const root = await RootedDirectory.open(rootPath);
  try {
    let getterCalls = 0;
    const accessor = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(accessor, "maximumBytes", {
      get: () => {
        getterCalls += 1;
        return 1024;
      },
      enumerable: true,
    });
    await expectStableFileReadError(
      () => readStableFile(
        root,
        parsePortableResourcePath("file"),
        asOptions(accessor),
      ),
      "input",
      "$options",
    );
    equal(getterCalls, 0);

    for (const options of [
      { maximumBytes: 1024, extra: true },
      { maximumBytes: -1 },
      { maximumBytes: 1024, capture: "partial" },
      { maximumBytes: 1024, signal: {} },
    ] as const) {
      await expectStableFileReadError(
        () => readStableFile(
          root,
          parsePortableResourcePath("file"),
          asOptions(options),
        ),
        "input",
        options.maximumBytes === -1
          ? "$options.maximumBytes"
          : "capture" in options
            ? "$options.capture"
            : "signal" in options
              ? "$options.signal"
              : "$options",
      );
    }
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("stable-file-read does not use convenience whole-file APIs", () => {
  const source = readFileSync(
    path.join(
      process.cwd(),
      "src/foundation/filesystem/stable-file-read.ts",
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
    "../crypto/sha256-hasher.js",
    "../crypto/sha256.js",
    "../data/passive-own-data.js",
    "../numeric/byte-count.js",
    "../node/node-system-error.js",
    "./file-node-snapshot.js",
    "./portable-resource-path.js",
    "./rooted-directory.js",
  ]);
  equal(source.includes("readFile("), false);
  equal(source.includes("readFileSync("), false);
  equal(source.includes("createReadStream("), false);
  equal(source.includes("O_NOFOLLOW"), true);
  equal(source.includes("O_NONBLOCK"), true);
  equal(source.includes("Sha256Hasher"), true);
});
