import { deepEqual, equal } from "node:assert/strict";
import {
  existsSync,
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
import { test, type TestContext } from "node:test";
import { setImmediate as yieldEventLoop } from "node:timers/promises";

import { computeSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import {
  copyFileToCandidateDurably,
  DurableFileCopyCandidateError,
  type DurableFileCopyCandidateErrorReason,
} from "../../../src/foundation/filesystem/durable-file-copy-candidate.js";
import {
  parsePortableResourcePath,
} from "../../../src/foundation/filesystem/portable-resource-path.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { readStableFileDigest } from "../../../src/foundation/filesystem/stable-file-read.js";
import { parseByteCount } from "../../../src/foundation/numeric/byte-count.js";

interface CopyFixture {
  readonly sourcePath: string;
  readonly destinationPath: string;
  readonly sourceRoot: RootedDirectory;
  readonly destinationRoot: RootedDirectory;
}

async function fixture(t: TestContext): Promise<Readonly<CopyFixture>> {
  const sourcePath = mkdtempSync(path.join(
    os.tmpdir(),
    "wakeflow-copy-source-",
  ));
  const destinationPath = mkdtempSync(path.join(
    os.tmpdir(),
    "wakeflow-copy-destination-",
  ));
  mkdirSync(path.join(destinationPath, "candidate"), { mode: 0o700 });
  const sourceRoot = await RootedDirectory.open(sourcePath);
  const destinationRoot = await RootedDirectory.open(destinationPath);
  t.after(async () => {
    await sourceRoot.close();
    await destinationRoot.close();
    rmSync(sourcePath, { recursive: true, force: true });
    rmSync(destinationPath, { recursive: true, force: true });
  });
  return Object.freeze({
    sourcePath,
    destinationPath,
    sourceRoot,
    destinationRoot,
  });
}

async function expectCopyError(
  action: () => Promise<unknown>,
  reason: DurableFileCopyCandidateErrorReason,
  pathValue: string,
): Promise<void> {
  let caught: unknown;
  try {
    await action();
  } catch (error: unknown) {
    caught = error;
  }
  equal(caught instanceof DurableFileCopyCandidateError, true);
  if (caught instanceof DurableFileCopyCandidateError) {
    equal(caught.code, "wakeflow-durable-file-copy-candidate");
    equal(caught.reason, reason);
    equal(caught.path, pathValue);
  }
}

test("durable file copy streams exact bytes across rooted directories", async (t) => {
  const current = await fixture(t);
  const bytes = Buffer.alloc((1024 * 1024) + 17);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = index % 251;
  }
  const sourceRef = parsePortableResourcePath("artifact.bin");
  const candidateRef = parsePortableResourcePath("candidate/artifact.bin");
  writeFileSync(path.join(current.sourcePath, sourceRef), bytes, {
    mode: 0o755,
  });

  const result = await copyFileToCandidateDurably(
    current.sourceRoot,
    current.destinationRoot,
    sourceRef,
    candidateRef,
    {
      byteCount: parseByteCount(bytes.byteLength),
      digest: computeSha256Digest(bytes),
    },
    {
      maximumBytes: parseByteCount(bytes.byteLength),
      mode: 0o755,
    },
  );

  equal(result.source.resourcePath, sourceRef);
  equal(result.candidate.resourcePath, candidateRef);
  equal(result.source.digest, result.candidate.digest);
  equal(result.candidate.byteCount, bytes.byteLength);
  equal(result.candidate.node.permissionBits, 0o755);
  equal(result.candidate.node.linkCount, 1n);
  equal(
    result.source.node.inodeId === result.candidate.node.inodeId
      && result.source.node.deviceId === result.candidate.node.deviceId,
    false,
  );
  deepEqual(
    readFileSync(path.join(current.destinationPath, candidateRef)),
    bytes,
  );
  equal(Object.hasOwn(result, "bytes"), false);
  equal(Object.isFrozen(result), true);
});

test("durable file copy accepts an empty source without allocating full content", async (t) => {
  const current = await fixture(t);
  const sourceRef = parsePortableResourcePath("empty");
  const candidateRef = parsePortableResourcePath("candidate/empty");
  const bytes = Buffer.alloc(0);
  writeFileSync(path.join(current.sourcePath, sourceRef), bytes);

  const result = await copyFileToCandidateDurably(
    current.sourceRoot,
    current.destinationRoot,
    sourceRef,
    candidateRef,
    { byteCount: parseByteCount(0), digest: computeSha256Digest(bytes) },
    { maximumBytes: parseByteCount(0), mode: 0o600 },
  );
  equal(result.candidate.byteCount, 0);
  equal(statSync(path.join(current.destinationPath, candidateRef)).size, 0);
});

test("durable file copy binds an optional exact source node", async (t) => {
  const current = await fixture(t);
  const sourceRef = parsePortableResourcePath("source.txt");
  const candidateRef = parsePortableResourcePath("candidate/source.txt");
  const sourcePath = path.join(current.sourcePath, sourceRef);
  writeFileSync(sourcePath, "first");
  const observed = await readStableFileDigest(
    current.sourceRoot,
    sourceRef,
    { maximumBytes: parseByteCount(1024) },
  );
  writeFileSync(sourcePath, "other");

  await expectCopyError(
    () => copyFileToCandidateDurably(
      current.sourceRoot,
      current.destinationRoot,
      sourceRef,
      candidateRef,
      {
        byteCount: observed.byteCount,
        digest: observed.digest,
        expectedNode: observed.node,
      },
      { maximumBytes: parseByteCount(1024), mode: 0o600 },
    ),
    "source-changed",
    "$source",
  );
  equal(existsSync(path.join(current.destinationPath, candidateRef)), false);
});

test("durable file copy rejects mismatched content and preserves an existing target", async (t) => {
  const current = await fixture(t);
  const sourceRef = parsePortableResourcePath("source.txt");
  const mismatchRef = parsePortableResourcePath("candidate/mismatch.txt");
  const existingRef = parsePortableResourcePath("candidate/existing.txt");
  const bytes = Buffer.from("source bytes");
  writeFileSync(path.join(current.sourcePath, sourceRef), bytes);
  writeFileSync(path.join(current.destinationPath, existingRef), "existing");

  await expectCopyError(
    () => copyFileToCandidateDurably(
      current.sourceRoot,
      current.destinationRoot,
      sourceRef,
      mismatchRef,
      {
        byteCount: parseByteCount(bytes.byteLength),
        digest: computeSha256Digest(Buffer.from("different")),
      },
      { maximumBytes: parseByteCount(1024), mode: 0o600 },
    ),
    "source-mismatch",
    "$source",
  );
  equal(existsSync(path.join(current.destinationPath, mismatchRef)), false);

  await expectCopyError(
    () => copyFileToCandidateDurably(
      current.sourceRoot,
      current.destinationRoot,
      sourceRef,
      existingRef,
      {
        byteCount: parseByteCount(bytes.byteLength),
        digest: computeSha256Digest(bytes),
      },
      { maximumBytes: parseByteCount(1024), mode: 0o600 },
    ),
    "target-exists",
    "$candidateResourcePath",
  );
  equal(
    readFileSync(path.join(current.destinationPath, existingRef), "utf8"),
    "existing",
  );
});

test("durable file copy detects source mutation after candidate creation", {
  concurrency: false,
}, async (t) => {
  const current = await fixture(t);
  const sourceRef = parsePortableResourcePath("large.bin");
  const candidateRef = parsePortableResourcePath("candidate/large.bin");
  const sourcePath = path.join(current.sourcePath, sourceRef);
  const candidatePath = path.join(current.destinationPath, candidateRef);
  const bytes = Buffer.alloc(4 * 1024 * 1024, 0x61);
  writeFileSync(sourcePath, bytes);

  const pending = copyFileToCandidateDurably(
    current.sourceRoot,
    current.destinationRoot,
    sourceRef,
    candidateRef,
    {
      byteCount: parseByteCount(bytes.byteLength),
      digest: computeSha256Digest(bytes),
    },
    { maximumBytes: parseByteCount(bytes.byteLength), mode: 0o600 },
  );
  const mutateAfterCreation = async (): Promise<boolean> => {
    for (let attempt = 0; attempt < 2_000; attempt += 1) {
      if (existsSync(candidatePath)) {
        writeFileSync(sourcePath, Buffer.alloc(bytes.byteLength, 0x62));
        return true;
      }
      await yieldEventLoop();
    }
    return false;
  };
  const mutation = mutateAfterCreation();
  await expectCopyError(() => pending, "source-changed", "$source");
  equal(await mutation, true);
  equal(existsSync(candidatePath), false);
});

test("durable file copy removes its candidate when cancelled mid-copy", {
  concurrency: false,
}, async (t) => {
  const current = await fixture(t);
  const sourceRef = parsePortableResourcePath("large.bin");
  const candidateRef = parsePortableResourcePath("candidate/large.bin");
  const candidatePath = path.join(current.destinationPath, candidateRef);
  const bytes = Buffer.alloc(8 * 1024 * 1024, 0x61);
  writeFileSync(path.join(current.sourcePath, sourceRef), bytes);
  const controller = new AbortController();

  const pending = copyFileToCandidateDurably(
    current.sourceRoot,
    current.destinationRoot,
    sourceRef,
    candidateRef,
    {
      byteCount: parseByteCount(bytes.byteLength),
      digest: computeSha256Digest(bytes),
    },
    {
      maximumBytes: parseByteCount(bytes.byteLength),
      mode: 0o600,
      signal: controller.signal,
    },
  );
  const abortAfterCreation = async (): Promise<boolean> => {
    for (let attempt = 0; attempt < 2_000; attempt += 1) {
      if (existsSync(candidatePath)) {
        controller.abort();
        return true;
      }
      await yieldEventLoop();
    }
    return false;
  };
  const aborting = abortAfterCreation();
  await expectCopyError(() => pending, "aborted", "$signal");
  equal(await aborting, true);
  equal(existsSync(candidatePath), false);
});

test("durable file copy rejects unsafe sources, capacity, and cancellation", async (t) => {
  await t.test("symlink source", async (subtest) => {
    const current = await fixture(subtest);
    writeFileSync(path.join(current.sourcePath, "target"), "content");
    symlinkSync("target", path.join(current.sourcePath, "link"));
    await expectCopyError(
      () => copyFileToCandidateDurably(
        current.sourceRoot,
        current.destinationRoot,
        parsePortableResourcePath("link"),
        parsePortableResourcePath("candidate/link"),
        {
          byteCount: parseByteCount(7),
          digest: computeSha256Digest(Buffer.from("content")),
        },
        { maximumBytes: parseByteCount(7), mode: 0o600 },
      ),
      "source-symlink",
      "$source",
    );
  });

  await t.test("capacity", async (subtest) => {
    const current = await fixture(subtest);
    const bytes = Buffer.from("1234");
    writeFileSync(path.join(current.sourcePath, "source"), bytes);
    await expectCopyError(
      () => copyFileToCandidateDurably(
        current.sourceRoot,
        current.destinationRoot,
        parsePortableResourcePath("source"),
        parsePortableResourcePath("candidate/source"),
        {
          byteCount: parseByteCount(bytes.byteLength),
          digest: computeSha256Digest(bytes),
        },
        { maximumBytes: parseByteCount(3), mode: 0o600 },
      ),
      "capacity",
      "$source",
    );
  });

  await t.test("pre-aborted", async (subtest) => {
    const current = await fixture(subtest);
    const bytes = Buffer.from("content");
    writeFileSync(path.join(current.sourcePath, "source"), bytes);
    const controller = new AbortController();
    controller.abort();
    await expectCopyError(
      () => copyFileToCandidateDurably(
        current.sourceRoot,
        current.destinationRoot,
        parsePortableResourcePath("source"),
        parsePortableResourcePath("candidate/source"),
        {
          byteCount: parseByteCount(bytes.byteLength),
          digest: computeSha256Digest(bytes),
        },
        {
          maximumBytes: parseByteCount(bytes.byteLength),
          mode: 0o600,
          signal: controller.signal,
        },
      ),
      "aborted",
      "$signal",
    );
  });
});

test("durable file copy rejects behavioral expectation input without executing it", async (t) => {
  const current = await fixture(t);
  writeFileSync(path.join(current.sourcePath, "source"), "content");
  let trapCalls = 0;
  const expectation = new Proxy({
    byteCount: parseByteCount(7),
    digest: computeSha256Digest(Buffer.from("content")),
  }, {
    getPrototypeOf: () => {
      trapCalls += 1;
      return Object.prototype;
    },
  });
  await expectCopyError(
    () => copyFileToCandidateDurably(
      current.sourceRoot,
      current.destinationRoot,
      parsePortableResourcePath("source"),
      parsePortableResourcePath("candidate/source"),
      expectation,
      { maximumBytes: parseByteCount(7), mode: 0o600 },
    ),
    "input",
    "$expectation",
  );
  equal(trapCalls, 0);
});
