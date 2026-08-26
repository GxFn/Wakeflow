import {
  deepEqual,
  equal,
  notEqual,
} from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
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
  inspectLoadedArtifactTree,
  LOADED_ARTIFACT_TREE_IDENTITY_LIMITS,
  LoadedArtifactTreeIdentityError,
  type LoadedArtifactTreeIdentityErrorReason,
  type LoadedArtifactTreeIdentityLimits,
  validateLoadedArtifactTreeManifest,
} from "../../../src/foundation/artifact/loaded-artifact-tree-identity.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";

const FIXTURE_FILES = Object.freeze([
  ["package.json", "{\"name\":\"fixture\",\"version\":\"1.0.0\"}\n"],
  ["scripts-old.mjs", "export const old = false;\n"],
  ["scripts/entry.mjs", "export const entry = true;\n"],
  ["scripts/lib/value.mjs", "export const value = 1;\n"],
] as const);

const GOLDEN_IDENTITY = Object.freeze({
  artifactDigest: "sha256:adff1759d518534ba7b3ecc0be4d39687be178151d640c7e53066150604edd81",
  manifest: {
    artifactKind: "wakeflow-loaded-artifact-tree",
    fileCount: 4,
    files: [
      {
        bytes: 37,
        digest: "sha256:8812280c0ddd054048a24ca505da8848a0c0dd053d4fd858a536a7917a648a36",
        executable: false,
        ref: "package.json",
      },
      {
        bytes: 26,
        digest: "sha256:3ceb63d7567f791435ba96aa3bdbf925aa48d4ff4e27d3b276b078182bc2c8a8",
        executable: false,
        ref: "scripts-old.mjs",
      },
      {
        bytes: 27,
        digest: "sha256:d64e3cecf6900641fdf1b31442ee3777f034161c2a30e32ffd79b358c848c5b7",
        executable: false,
        ref: "scripts/entry.mjs",
      },
      {
        bytes: 24,
        digest: "sha256:5d8f65d2774e206bc9f7a7a4ad39ca2dc563b5c31e46ab57ef4874961237ce29",
        executable: false,
        ref: "scripts/lib/value.mjs",
      },
    ],
    schemaVersion: 1,
    totalBytes: 114,
  },
});

function createFixture(prefix = "wakeflow-artifact-ts-"): string {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), prefix));
  for (const [ref, contents] of FIXTURE_FILES) {
    const physicalPath = path.join(rootPath, ref);
    mkdirSync(path.dirname(physicalPath), { recursive: true });
    writeFileSync(physicalPath, contents);
    chmodSync(physicalPath, 0o644);
  }
  return rootPath;
}

async function inspectFixture(
  rootPath: string,
  limits?: LoadedArtifactTreeIdentityLimits,
) {
  const root = await RootedDirectory.open(rootPath);
  try {
    return limits === undefined
      ? await inspectLoadedArtifactTree(root)
      : await inspectLoadedArtifactTree(root, { limits });
  } finally {
    await root.close();
  }
}

async function expectIdentityError(
  action: () => unknown | Promise<unknown>,
  reason: LoadedArtifactTreeIdentityErrorReason,
): Promise<LoadedArtifactTreeIdentityError> {
  let caught: unknown;
  try {
    await action();
  } catch (error: unknown) {
    caught = error;
  }
  if (!(caught instanceof LoadedArtifactTreeIdentityError)) {
    throw new Error("Expected LoadedArtifactTreeIdentityError.");
  }
  equal(caught.code, "wakeflow-loaded-artifact-tree-identity");
  equal(caught.reason, reason);
  return caught;
}

test("loaded artifact identity preserves the v1 golden and ignores location", async () => {
  const firstPath = createFixture();
  const secondPath = createFixture("wakeflow-artifact-relocated-ts-");
  try {
    const first = await inspectFixture(firstPath);
    const second = await inspectFixture(secondPath);

    deepEqual(first, GOLDEN_IDENTITY);
    deepEqual(second, first);
    equal(JSON.stringify(first).includes(firstPath), false);
    equal(Object.isFrozen(first), true);
    equal(Object.isFrozen(first.manifest), true);
    equal(Object.isFrozen(first.manifest.files), true);
    equal(first.manifest.files.every(Object.isFrozen), true);
    deepEqual(validateLoadedArtifactTreeManifest(first.manifest), first.manifest);
  } finally {
    rmSync(firstPath, { recursive: true, force: true });
    rmSync(secondPath, { recursive: true, force: true });
  }
});

test("file bytes and executable permission both participate in identity", async () => {
  const rootPath = createFixture();
  try {
    const before = await inspectFixture(rootPath);
    writeFileSync(
      path.join(rootPath, "scripts/lib/value.mjs"),
      "export const value = 2;\n",
    );
    const contentChanged = await inspectFixture(rootPath);
    notEqual(contentChanged.artifactDigest, before.artifactDigest);

    chmodSync(path.join(rootPath, "scripts/entry.mjs"), 0o755);
    const permissionChanged = await inspectFixture(rootPath);
    notEqual(permissionChanged.artifactDigest, contentChanged.artifactDigest);
    equal(
      permissionChanged.manifest.files.find(
        (file) => file.ref === "scripts/entry.mjs",
      )?.executable,
      true,
    );
  } finally {
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("symlinks and special nodes fail closed", {
  skip: process.platform === "win32",
}, async () => {
  const symlinkRoot = createFixture();
  const fifoRoot = createFixture();
  try {
    symlinkSync("package.json", path.join(symlinkRoot, "package-link"));
    await expectIdentityError(
      () => inspectFixture(symlinkRoot),
      "symlink",
    );

    const fifo = spawnSync("mkfifo", [path.join(fifoRoot, "transport.fifo")], {
      encoding: "utf8",
    });
    equal(fifo.status, 0, fifo.stderr);
    await expectIdentityError(
      () => inspectFixture(fifoRoot),
      "special-node",
    );
  } finally {
    rmSync(symlinkRoot, { recursive: true, force: true });
    rmSync(fifoRoot, { recursive: true, force: true });
  }
});

test("every physical and logical budget is enforced", async () => {
  const rootPath = createFixture();
  mkdirSync(path.join(rootPath, "empty-a"));
  mkdirSync(path.join(rootPath, "empty-b"));
  try {
    const cases = [
      ["maxEntries", 3, "entry-limit"],
      ["maxFiles", 2, "file-count"],
      ["maxFileBytes", 4, "file-bytes"],
      ["maxTotalBytes", 8, "total-bytes"],
      ["maxDepth", 1, "depth-limit"],
      ["maxRefBytes", 8, "ref-bytes"],
    ] as const;
    for (const [field, limit, reason] of cases) {
      await expectIdentityError(
        () => inspectFixture(rootPath, {
          ...LOADED_ARTIFACT_TREE_IDENTITY_LIMITS,
          [field]: limit,
        }),
        reason,
      );
    }
  } finally {
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("empty trees, aborted work, and decorated options are rejected", async () => {
  const emptyPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-empty-artifact-"));
  const fixturePath = createFixture();
  const root = await RootedDirectory.open(fixturePath);
  try {
    await expectIdentityError(() => inspectFixture(emptyPath), "empty-tree");

    const controller = new AbortController();
    controller.abort();
    await expectIdentityError(
      () => inspectLoadedArtifactTree(root, { signal: controller.signal }),
      "aborted",
    );
    await expectIdentityError(
      () => inspectLoadedArtifactTree(root, null as never),
      "input",
    );
    await expectIdentityError(
      () => inspectLoadedArtifactTree(root, { unknown: true } as never),
      "input",
    );
  } finally {
    await root.close();
    rmSync(emptyPath, { recursive: true, force: true });
    rmSync(fixturePath, { recursive: true, force: true });
  }
});

test("manifest validator rejects collisions, reordering, and inconsistent totals", async () => {
  const rootPath = createFixture();
  try {
    const { manifest } = await inspectFixture(rootPath);
    const [sample] = manifest.files;
    if (sample === undefined) throw new Error("Fixture manifest is empty.");

    const collisionFiles = [
      { ...sample, ref: "Owner.txt" },
      { ...sample, ref: "owner.txt" },
    ];
    await expectIdentityError(
      () => validateLoadedArtifactTreeManifest({
        ...manifest,
        fileCount: 2,
        files: collisionFiles,
        totalBytes: sample.bytes * 2,
      }),
      "ref-collision",
    );
    await expectIdentityError(
      () => validateLoadedArtifactTreeManifest({
        ...manifest,
        files: [...manifest.files].reverse(),
      }),
      "manifest-order",
    );
    await expectIdentityError(
      () => validateLoadedArtifactTreeManifest({
        ...manifest,
        totalBytes: manifest.totalBytes + 1,
      }),
      "manifest-totals",
    );
    await expectIdentityError(
      () => validateLoadedArtifactTreeManifest({ ...manifest, unknown: true }),
      "manifest-shape",
    );
  } finally {
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("manifest validation is passive and applies caller limits", async () => {
  const rootPath = createFixture();
  try {
    const { manifest } = await inspectFixture(rootPath);
    const files = [...manifest.files];
    Object.setPrototypeOf(files, null);
    await expectIdentityError(
      () => validateLoadedArtifactTreeManifest({ ...manifest, files }),
      "manifest-shape",
    );
    await expectIdentityError(
      () => validateLoadedArtifactTreeManifest(manifest, {
        limits: {
          ...LOADED_ARTIFACT_TREE_IDENTITY_LIMITS,
          maxFiles: 2,
        },
      }),
      "file-count",
    );
    await expectIdentityError(
      () => validateLoadedArtifactTreeManifest(manifest, null as never),
      "input",
    );
  } finally {
    rmSync(rootPath, { recursive: true, force: true });
  }
});
