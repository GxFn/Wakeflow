import { equal } from "node:assert/strict";
import {
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

import { inspectLoadedArtifactTree } from "../../../src/foundation/artifact/loaded-artifact-tree-identity.js";
import {
  materializeLoadedArtifactTreeTransferCandidate,
} from "../../../src/foundation/artifact/loaded-artifact-tree-transfer-candidate.js";
import {
  planLoadedArtifactTreeTransfer,
  type LoadedArtifactTreeTransferPlan,
} from "../../../src/foundation/artifact/loaded-artifact-tree-transfer-plan.js";
import {
  publishLoadedArtifactTreeTransferCandidate,
  LoadedArtifactTreeTransferPublicationError,
  type LoadedArtifactTreeTransferPublicationErrorReason,
} from "../../../src/foundation/artifact/loaded-artifact-tree-transfer-publication.js";
import { createDirectoryAtomically } from "../../../src/foundation/filesystem/durable-directory-materialization.js";
import { parsePortableResourcePath } from "../../../src/foundation/filesystem/portable-resource-path.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";

interface PublicationFixture {
  readonly sourcePath: string;
  readonly destinationPath: string;
  readonly sourceRoot: RootedDirectory;
  readonly destinationRoot: RootedDirectory;
}

async function fixture(
  t: TestContext,
): Promise<Readonly<PublicationFixture>> {
  const sourcePath = mkdtempSync(path.join(
    os.tmpdir(),
    "wakeflow-artifact-publish-source-",
  ));
  const destinationPath = mkdtempSync(path.join(
    os.tmpdir(),
    "wakeflow-artifact-publish-destination-",
  ));
  mkdirSync(path.join(sourcePath, "bin"), { mode: 0o755 });
  writeFileSync(path.join(sourcePath, "README.md"), "# Artifact\n", {
    mode: 0o644,
  });
  writeFileSync(path.join(sourcePath, "bin/run.mjs"), "export {};\n", {
    mode: 0o755,
  });
  mkdirSync(path.join(destinationPath, "stages"), { mode: 0o700 });
  mkdirSync(path.join(destinationPath, "assets"), { mode: 0o700 });
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

async function plan(
  current: Readonly<PublicationFixture>,
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

async function materialize(
  current: Readonly<PublicationFixture>,
  transferPlan: Readonly<LoadedArtifactTreeTransferPlan>,
): Promise<void> {
  await materializeLoadedArtifactTreeTransferCandidate(
    current.sourceRoot,
    current.destinationRoot,
    transferPlan,
  );
}

async function expectPublicationError(
  action: () => Promise<unknown>,
  reason: LoadedArtifactTreeTransferPublicationErrorReason,
  pathValue: string,
): Promise<void> {
  let caught: unknown;
  try {
    await action();
  } catch (error: unknown) {
    caught = error;
  }
  equal(caught instanceof LoadedArtifactTreeTransferPublicationError, true);
  if (caught instanceof LoadedArtifactTreeTransferPublicationError) {
    equal(caught.code, "wakeflow-loaded-artifact-tree-transfer-publication");
    equal(caught.reason, reason);
    equal(caught.path, pathValue);
  }
}

test("loaded artifact publication durably renames and reads back final identity", async (t) => {
  const current = await fixture(t);
  const transferPlan = await plan(current);
  await materialize(current, transferPlan);
  const finalRef = parsePortableResourcePath("assets/bundle");

  const published = await publishLoadedArtifactTreeTransferCandidate(
    current.destinationRoot,
    transferPlan,
    finalRef,
  );
  equal(published.disposition, "published");
  equal(published.publication?.sourceResourcePath, transferPlan.candidateRootPath);
  equal(published.publication?.destinationResourcePath, finalRef);
  equal(published.finalTree.candidateRootPath, finalRef);
  equal(published.artifactIdentity.artifactDigest, transferPlan.artifactDigest);
  equal(
    existsSync(path.join(current.destinationPath, transferPlan.candidateRootPath)),
    false,
  );
  const finalPath = path.join(current.destinationPath, finalRef);
  equal(existsSync(finalPath), true);
  equal(readFileSync(path.join(finalPath, "README.md"), "utf8"), "# Artifact\n");
  equal(statSync(path.join(finalPath, "bin/run.mjs")).mode & 0o777, 0o755);
  equal(existsSync(path.join(current.sourcePath, "README.md")), true);

  const currentResult = await publishLoadedArtifactTreeTransferCandidate(
    current.destinationRoot,
    transferPlan,
    finalRef,
  );
  equal(currentResult.disposition, "current");
  equal(currentResult.publication, null);
  equal(currentResult.artifactIdentity.artifactDigest, transferPlan.artifactDigest);
});

test("loaded artifact publication rejects a conflicting final tree", async (t) => {
  const current = await fixture(t);
  const transferPlan = await plan(current);
  const finalRef = parsePortableResourcePath("assets/bundle");
  const finalPath = path.join(current.destinationPath, finalRef);
  mkdirSync(finalPath, { mode: 0o755 });
  writeFileSync(path.join(finalPath, "unexpected.txt"), "unexpected\n", {
    mode: 0o644,
  });

  await expectPublicationError(
    () => publishLoadedArtifactTreeTransferCandidate(
      current.destinationRoot,
      transferPlan,
      finalRef,
    ),
    "destination-conflict",
    "$destinationResourcePath",
  );
  equal(readFileSync(path.join(finalPath, "unexpected.txt"), "utf8"), "unexpected\n");
});

test("loaded artifact publication keeps current target and candidate residue for recovery", async (t) => {
  const current = await fixture(t);
  const transferPlan = await plan(current);
  const finalRef = parsePortableResourcePath("assets/bundle");
  await materialize(current, transferPlan);
  await publishLoadedArtifactTreeTransferCandidate(
    current.destinationRoot,
    transferPlan,
    finalRef,
  );
  await materialize(current, transferPlan);

  await expectPublicationError(
    () => publishLoadedArtifactTreeTransferCandidate(
      current.destinationRoot,
      transferPlan,
      finalRef,
    ),
    "candidate-residue",
    "$candidate",
  );
  equal(existsSync(path.join(current.destinationPath, finalRef)), true);
  equal(
    existsSync(path.join(current.destinationPath, transferPlan.candidateRootPath)),
    true,
  );
});

test("loaded artifact publication rejects incomplete candidate and cancellation", async (t) => {
  const current = await fixture(t);
  const transferPlan = await plan(current);
  const finalRef = parsePortableResourcePath("assets/bundle");
  await createDirectoryAtomically(
    current.destinationRoot,
    transferPlan.candidateRootPath,
    { mode: transferPlan.directoryPlan.directoryMode },
  );
  await expectPublicationError(
    () => publishLoadedArtifactTreeTransferCandidate(
      current.destinationRoot,
      transferPlan,
      finalRef,
    ),
    "candidate-conflict",
    "$candidate",
  );

  rmSync(
    path.join(current.destinationPath, transferPlan.candidateRootPath),
    { recursive: true, force: true },
  );
  await materialize(current, transferPlan);
  const controller = new AbortController();
  controller.abort();
  await expectPublicationError(
    () => publishLoadedArtifactTreeTransferCandidate(
      current.destinationRoot,
      transferPlan,
      finalRef,
      { signal: controller.signal },
    ),
    "aborted",
    "$signal",
  );
  equal(existsSync(path.join(current.destinationPath, finalRef)), false);
  equal(
    existsSync(path.join(current.destinationPath, transferPlan.candidateRootPath)),
    true,
  );
});
