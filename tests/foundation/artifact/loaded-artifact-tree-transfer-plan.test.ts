import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";

import { computeCanonicalJsonSha256Digest } from "../../../src/foundation/crypto/canonical-json-sha256.js";
import { computeSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import {
  validateLoadedArtifactTreeManifest,
  type LoadedArtifactTreeManifest,
} from "../../../src/foundation/artifact/loaded-artifact-tree-identity.js";
import {
  planLoadedArtifactTreeTransfer,
  LoadedArtifactTreeTransferPlanError,
  type LoadedArtifactTreeTransferPlanErrorReason,
} from "../../../src/foundation/artifact/loaded-artifact-tree-transfer-plan.js";
import { parsePortableResourcePath } from "../../../src/foundation/filesystem/portable-resource-path.js";

function manifest(): LoadedArtifactTreeManifest {
  const files = [{
    ref: "README.md",
    content: Buffer.from("# Artifact\n"),
    executable: false,
  }, {
    ref: "bin/run.mjs",
    content: Buffer.from("export {};\n"),
    executable: true,
  }, {
    ref: "nested/deep/data.json",
    content: Buffer.from("{}\n"),
    executable: false,
  }];
  return validateLoadedArtifactTreeManifest({
    artifactKind: "wakeflow-loaded-artifact-tree",
    fileCount: files.length,
    files: files.map((file) => ({
      bytes: file.content.byteLength,
      digest: computeSha256Digest(file.content),
      executable: file.executable,
      ref: file.ref,
    })),
    schemaVersion: 1,
    totalBytes: files.reduce((total, file) => (
      total + file.content.byteLength
    ), 0),
  });
}

function expectPlanError(
  action: () => unknown,
  reason: LoadedArtifactTreeTransferPlanErrorReason,
  path: string,
): void {
  let caught: unknown;
  try {
    action();
  } catch (error: unknown) {
    caught = error;
  }
  equal(caught instanceof LoadedArtifactTreeTransferPlanError, true);
  if (caught instanceof LoadedArtifactTreeTransferPlanError) {
    equal(caught.code, "wakeflow-loaded-artifact-tree-transfer-plan");
    equal(caught.reason, reason);
    equal(caught.path, path);
  }
}

function assertDeepFrozen(value: unknown): void {
  if (typeof value !== "object" || value === null) return;
  equal(Object.isFrozen(value), true);
  for (const child of Object.values(value)) assertDeepFrozen(child);
}

test("loaded artifact transfer plan reuses one closed directory plan", () => {
  const source = manifest();
  const candidateRootPath = parsePortableResourcePath(
    ".wakeflow-local/runtime/assets/.bundle.stage",
  );
  const plan = planLoadedArtifactTreeTransfer(
    source,
    candidateRootPath,
    {
      directoryMode: 0o755,
      executableFileMode: 0o755,
      regularFileMode: 0o644,
    },
  );

  equal(plan.artifactKind, "wakeflow-loaded-artifact-tree-transfer-plan");
  equal(plan.schemaVersion, 1);
  equal(plan.artifactDigest, computeCanonicalJsonSha256Digest(source));
  equal(plan.candidateRootPath, candidateRootPath);
  deepEqual(plan.directoryPlan.directories, [
    "bin",
    "nested",
    "nested/deep",
  ]);
  deepEqual(plan.directoryPlan.files.map((file) => ({
    path: file.path,
    mode: file.mode,
  })), [{
    path: "README.md",
    mode: 0o644,
  }, {
    path: "bin/run.mjs",
    mode: 0o755,
  }, {
    path: "nested/deep/data.json",
    mode: 0o644,
  }]);
  deepEqual(plan.copies, [{
    sourceResourcePath: "README.md",
    candidateResourcePath:
      ".wakeflow-local/runtime/assets/.bundle.stage/README.md",
  }, {
    sourceResourcePath: "bin/run.mjs",
    candidateResourcePath:
      ".wakeflow-local/runtime/assets/.bundle.stage/bin/run.mjs",
  }, {
    sourceResourcePath: "nested/deep/data.json",
    candidateResourcePath:
      ".wakeflow-local/runtime/assets/.bundle.stage/nested/deep/data.json",
  }]);
  const basis = {
    artifactKind: plan.artifactKind,
    schemaVersion: plan.schemaVersion,
    artifactDigest: plan.artifactDigest,
    candidateRootPath: plan.candidateRootPath,
    directoryPlan: plan.directoryPlan,
    copies: plan.copies,
  };
  equal(plan.planDigest, computeCanonicalJsonSha256Digest(basis));
  equal(plan.directoryPlan.totalBytes, source.totalBytes);
  assertDeepFrozen(plan);
});

test("loaded artifact transfer plan is deterministic across manifest snapshots", () => {
  const source = manifest();
  const candidateRootPath = parsePortableResourcePath("stages/bundle");
  const options = {
    directoryMode: 0o700,
    executableFileMode: 0o700,
    regularFileMode: 0o600,
  } as const;
  const first = planLoadedArtifactTreeTransfer(
    source,
    candidateRootPath,
    options,
  );
  const second = planLoadedArtifactTreeTransfer(
    structuredClone(source),
    candidateRootPath,
    options,
  );
  deepEqual(second, first);
  equal(second.manifest === first.manifest, false);
});

test("loaded artifact transfer plan rejects modes that erase executable semantics", () => {
  const source = manifest();
  const candidateRootPath = parsePortableResourcePath("stages/bundle");
  for (const options of [{
    directoryMode: 0o755,
    executableFileMode: 0o644,
    regularFileMode: 0o644,
  }, {
    directoryMode: 0o755,
    executableFileMode: 0o755,
    regularFileMode: 0o744,
  }]) {
    expectPlanError(
      () => planLoadedArtifactTreeTransfer(
        source,
        candidateRootPath,
        options,
      ),
      "mode",
      "$options",
    );
  }
});

test("loaded artifact transfer plan maps manifest and capacity failures", () => {
  const source = manifest();
  const options = {
    directoryMode: 0o755,
    executableFileMode: 0o755,
    regularFileMode: 0o644,
  } as const;
  const candidateRootPath = parsePortableResourcePath("stages/bundle");
  const reversed = {
    ...source,
    files: [...source.files].reverse(),
  } as unknown as LoadedArtifactTreeManifest;
  expectPlanError(
    () => planLoadedArtifactTreeTransfer(
      reversed,
      candidateRootPath,
      options,
    ),
    "manifest",
    "$manifest",
  );

  const oversized = {
    ...source,
    fileCount: 1,
    files: [{
      ...source.files[0],
      bytes: (32 * 1024 * 1024) + 1,
    }],
    totalBytes: (32 * 1024 * 1024) + 1,
  } as unknown as LoadedArtifactTreeManifest;
  expectPlanError(
    () => planLoadedArtifactTreeTransfer(
      oversized,
      candidateRootPath,
      options,
    ),
    "capacity",
    "$manifest",
  );
});

test("loaded artifact transfer plan rejects behavioral options without traps", () => {
  const source = manifest();
  let trapCalls = 0;
  const options = new Proxy({
    directoryMode: 0o755,
    executableFileMode: 0o755,
    regularFileMode: 0o644,
  }, {
    getPrototypeOf: () => {
      trapCalls += 1;
      return Object.prototype;
    },
  });
  expectPlanError(
    () => planLoadedArtifactTreeTransfer(
      source,
      parsePortableResourcePath("stages/bundle"),
      options,
    ),
    "input",
    "$options",
  );
  equal(trapCalls, 0);
});
