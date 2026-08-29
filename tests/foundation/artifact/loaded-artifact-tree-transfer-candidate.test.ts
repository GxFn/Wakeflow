import { deepEqual, equal } from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import { setImmediate as yieldEventLoop } from "node:timers/promises";

import {
  inspectLoadedArtifactTree,
} from "../../../src/foundation/artifact/loaded-artifact-tree-identity.js";
import {
  materializeLoadedArtifactTreeTransferCandidate,
  LoadedArtifactTreeTransferCandidateError,
  type LoadedArtifactTreeTransferCandidateErrorReason,
} from "../../../src/foundation/artifact/loaded-artifact-tree-transfer-candidate.js";
import {
  planLoadedArtifactTreeTransfer,
  type LoadedArtifactTreeTransferPlan,
} from "../../../src/foundation/artifact/loaded-artifact-tree-transfer-plan.js";
import {
  createDirectoryAtomically,
} from "../../../src/foundation/filesystem/durable-directory-materialization.js";
import {
  createFileCandidateDurably,
} from "../../../src/foundation/filesystem/durable-file-candidate.js";
import {
  joinDirectoryTreeCandidatePath,
} from "../../../src/foundation/filesystem/directory-tree-candidate-plan.js";
import { parsePortableResourcePath } from "../../../src/foundation/filesystem/portable-resource-path.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";

interface TransferFixture {
  readonly sourcePath: string;
  readonly destinationPath: string;
  readonly sourceRoot: RootedDirectory;
  readonly destinationRoot: RootedDirectory;
}

async function fixture(t: TestContext): Promise<Readonly<TransferFixture>> {
  const sourcePath = mkdtempSync(path.join(
    os.tmpdir(),
    "wakeflow-artifact-source-",
  ));
  const destinationPath = mkdtempSync(path.join(
    os.tmpdir(),
    "wakeflow-artifact-destination-",
  ));
  mkdirSync(path.join(destinationPath, "stages"), { mode: 0o700 });
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

function writeSourceTree(root: string, large = false): void {
  mkdirSync(path.join(root, "bin"), { mode: 0o755 });
  mkdirSync(path.join(root, "nested"), { mode: 0o755 });
  writeFileSync(path.join(root, "README.md"), "# Artifact\n", {
    mode: 0o644,
  });
  writeFileSync(
    path.join(root, "bin", "run.mjs"),
    large ? Buffer.alloc(4 * 1024 * 1024, 0x61) : "export {};\n",
    { mode: 0o755 },
  );
  chmodSync(path.join(root, "bin", "run.mjs"), 0o755);
  writeFileSync(path.join(root, "nested", "data.json"), "{}\n", {
    mode: 0o644,
  });
}

async function transferPlan(
  current: Readonly<TransferFixture>,
): Promise<Readonly<LoadedArtifactTreeTransferPlan>> {
  const identity = await inspectLoadedArtifactTree(current.sourceRoot);
  return planLoadedArtifactTreeTransfer(
    identity.manifest,
    parsePortableResourcePath("stages/.bundle.stage"),
    {
      directoryMode: 0o755,
      executableFileMode: 0o755,
      regularFileMode: 0o644,
    },
  );
}

async function expectCandidateError(
  action: () => Promise<unknown>,
  reason: LoadedArtifactTreeTransferCandidateErrorReason,
  pathValue: string,
): Promise<void> {
  let caught: unknown;
  try {
    await action();
  } catch (error: unknown) {
    caught = error;
  }
  equal(caught instanceof LoadedArtifactTreeTransferCandidateError, true);
  if (caught instanceof LoadedArtifactTreeTransferCandidateError) {
    equal(caught.code, "wakeflow-loaded-artifact-tree-transfer-candidate");
    equal(caught.reason, reason);
    equal(caught.path, pathValue);
  }
}

test("loaded artifact transfer materializes and closes a complete candidate", async (t) => {
  const current = await fixture(t);
  writeSourceTree(current.sourcePath);
  const plan = await transferPlan(current);

  const result = await materializeLoadedArtifactTreeTransferCandidate(
    current.sourceRoot,
    current.destinationRoot,
    plan,
  );
  equal(result.kind, "LoadedArtifactTreeTransferCandidate");
  equal(result.sourceIdentity.artifactDigest, plan.artifactDigest);
  equal(result.candidate.plan.treeDigest, plan.directoryPlan.treeDigest);
  deepEqual(result.copiedFiles, [
    "README.md",
    "bin/run.mjs",
    "nested/data.json",
  ]);
  const candidateRoot = path.join(
    current.destinationPath,
    plan.candidateRootPath,
  );
  equal(statSync(candidateRoot).mode & 0o777, 0o755);
  equal(statSync(path.join(candidateRoot, "bin/run.mjs")).mode & 0o777, 0o755);
  equal(statSync(path.join(candidateRoot, "README.md")).mode & 0o777, 0o644);
  equal(readFileSync(path.join(candidateRoot, "README.md"), "utf8"), "# Artifact\n");
  equal(Object.isFrozen(result), true);
  equal(Object.isFrozen(result.copiedFiles), true);
});

test("loaded artifact transfer resumes only missing exact files", async (t) => {
  const current = await fixture(t);
  writeSourceTree(current.sourcePath);
  const plan = await transferPlan(current);
  await createDirectoryAtomically(
    current.destinationRoot,
    plan.candidateRootPath,
    { mode: plan.directoryPlan.directoryMode },
  );
  const readme = plan.directoryPlan.files[0];
  if (readme === undefined) throw new Error("Expected README descriptor.");
  await createFileCandidateDurably(
    current.destinationRoot,
    joinDirectoryTreeCandidatePath(plan.candidateRootPath, readme.path),
    readFileSync(path.join(current.sourcePath, readme.path)),
    { mode: readme.mode },
  );
  const existingPath = path.join(
    current.destinationPath,
    plan.candidateRootPath,
    readme.path,
  );
  const existingInode = statSync(existingPath, { bigint: true }).ino;

  const resumed = await materializeLoadedArtifactTreeTransferCandidate(
    current.sourceRoot,
    current.destinationRoot,
    plan,
  );
  deepEqual(resumed.copiedFiles, ["bin/run.mjs", "nested/data.json"]);
  equal(statSync(existingPath, { bigint: true }).ino, existingInode);

  const retried = await materializeLoadedArtifactTreeTransferCandidate(
    current.sourceRoot,
    current.destinationRoot,
    plan,
  );
  deepEqual(retried.copiedFiles, []);
  equal(statSync(existingPath, { bigint: true }).ino, existingInode);
});

test("loaded artifact transfer refuses conflicting partial candidates", async (t) => {
  const current = await fixture(t);
  writeSourceTree(current.sourcePath);
  const plan = await transferPlan(current);
  await createDirectoryAtomically(
    current.destinationRoot,
    plan.candidateRootPath,
    { mode: plan.directoryPlan.directoryMode },
  );
  const conflictingPath = path.join(
    current.destinationPath,
    plan.candidateRootPath,
    "README.md",
  );
  writeFileSync(conflictingPath, "different\n", { mode: 0o644 });

  await expectCandidateError(
    () => materializeLoadedArtifactTreeTransferCandidate(
      current.sourceRoot,
      current.destinationRoot,
      plan,
    ),
    "candidate-conflict",
    "$candidate",
  );
  equal(readFileSync(conflictingPath, "utf8"), "different\n");
});

test("loaded artifact transfer rejects a source changed before materialization", async (t) => {
  const current = await fixture(t);
  writeSourceTree(current.sourcePath);
  const plan = await transferPlan(current);
  writeFileSync(path.join(current.sourcePath, "unexpected.txt"), "unexpected\n");

  await expectCandidateError(
    () => materializeLoadedArtifactTreeTransferCandidate(
      current.sourceRoot,
      current.destinationRoot,
      plan,
    ),
    "source-changed",
    "$source",
  );
  equal(
    existsSync(path.join(current.destinationPath, plan.candidateRootPath)),
    false,
  );
});

test("loaded artifact transfer detects source drift during tree copy", {
  concurrency: false,
}, async (t) => {
  const current = await fixture(t);
  writeSourceTree(current.sourcePath, true);
  const plan = await transferPlan(current);
  const candidateRoot = path.join(
    current.destinationPath,
    plan.candidateRootPath,
  );
  const pending = materializeLoadedArtifactTreeTransferCandidate(
    current.sourceRoot,
    current.destinationRoot,
    plan,
  );
  const mutateAfterCandidate = async (): Promise<boolean> => {
    for (let attempt = 0; attempt < 2_000; attempt += 1) {
      if (existsSync(candidateRoot)) {
        writeFileSync(
          path.join(current.sourcePath, "unexpected.txt"),
          "unexpected\n",
        );
        return true;
      }
      await yieldEventLoop();
    }
    return false;
  };
  const mutation = mutateAfterCandidate();
  await expectCandidateError(() => pending, "source-changed", "$source");
  equal(await mutation, true);
  equal(existsSync(candidateRoot), true);
});

test("loaded artifact transfer rejects cancellation and a tampered plan", async (t) => {
  const current = await fixture(t);
  writeSourceTree(current.sourcePath);
  const plan = await transferPlan(current);
  const controller = new AbortController();
  controller.abort();
  await expectCandidateError(
    () => materializeLoadedArtifactTreeTransferCandidate(
      current.sourceRoot,
      current.destinationRoot,
      plan,
      { signal: controller.signal },
    ),
    "aborted",
    "$signal",
  );

  const tampered = {
    ...plan,
    copies: plan.copies.map((copy, index) => index === 0
      ? { ...copy, candidateResourcePath: "stages/.bundle.stage/other" }
      : copy),
  } as unknown as LoadedArtifactTreeTransferPlan;
  await expectCandidateError(
    () => materializeLoadedArtifactTreeTransferCandidate(
      current.sourceRoot,
      current.destinationRoot,
      tampered,
    ),
    "input",
    "$plan",
  );
});
