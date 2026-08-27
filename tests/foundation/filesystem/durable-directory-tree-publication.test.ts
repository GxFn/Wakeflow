import { equal } from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  createDirectoryTreeCandidateDurably,
} from "../../../src/foundation/filesystem/durable-directory-tree-candidate.js";
import {
  publishDirectoryTreeCandidateDurably,
  DurableDirectoryTreePublicationError,
  type DurableDirectoryTreePublicationErrorReason,
} from "../../../src/foundation/filesystem/durable-directory-tree-publication.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { encodeUtf8 } from "../../../src/foundation/text/utf8.js";

const OPTIONS = {
  directoryMode: 0o755,
  maximumDepth: 8,
  maximumEntries: 16,
  maximumFileBytes: 1024,
  maximumFiles: 4,
  maximumTotalBytes: 4096,
} as const;

const FILES = [{
  path: "design/requirement.md",
  bytes: encodeUtf8("# Requirement\n"),
  mode: 0o644,
}, {
  path: "record.json",
  bytes: encodeUtf8("{\"kind\":\"record\"}\n"),
  mode: 0o644,
}] as const;

async function fixture() {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-directory-publication-"));
  mkdirSync(path.join(rootPath, "transactions"), { mode: 0o700 });
  mkdirSync(path.join(rootPath, "requirements"), { mode: 0o755 });
  chmodSync(path.join(rootPath, "transactions"), 0o700);
  chmodSync(path.join(rootPath, "requirements"), 0o755);
  const root = await RootedDirectory.open(rootPath);
  return { rootPath, root };
}

async function expectPublicationError(
  action: () => unknown | Promise<unknown>,
  reason: DurableDirectoryTreePublicationErrorReason,
): Promise<void> {
  let caught: unknown;
  try {
    await action();
  } catch (error: unknown) {
    caught = error;
  }
  if (!(caught instanceof DurableDirectoryTreePublicationError)) {
    throw new Error("Expected DurableDirectoryTreePublicationError.");
  }
  equal(caught.reason, reason);
}

test("closed directory tree candidate publishes through one durable rename", async () => {
  const { rootPath, root } = await fixture();
  try {
    const sourceRef = "transactions/.requirement.stage";
    const finalRef = "requirements/requirement_11111111-1111-4111-8111-111111111111";
    const candidate = await createDirectoryTreeCandidateDurably(
      root,
      sourceRef,
      FILES,
      OPTIONS,
    );
    const published = await publishDirectoryTreeCandidateDurably(
      root,
      candidate,
      finalRef,
    );

    equal(published.sourceResourcePath, sourceRef);
    equal(published.destinationResourcePath, finalRef);
    equal(published.plan.treeDigest, candidate.plan.treeDigest);
    equal(published.rootNode.deviceId, candidate.rootNode.deviceId);
    equal(published.rootNode.inodeId, candidate.rootNode.inodeId);
    equal(existsSync(path.join(rootPath, ...sourceRef.split("/"))), false);
    equal(existsSync(path.join(rootPath, ...finalRef.split("/"))), true);
    equal(
      readFileSync(path.join(rootPath, ...finalRef.split("/"), "design/requirement.md"), "utf8"),
      "# Requirement\n",
    );
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("publication preserves a candidate when final exists or source drifted", async () => {
  const { rootPath, root } = await fixture();
  try {
    const existingSource = "transactions/.existing.stage";
    const existingFinal = "requirements/requirement_22222222-2222-4222-8222-222222222222";
    const existingCandidate = await createDirectoryTreeCandidateDurably(
      root,
      existingSource,
      FILES,
      OPTIONS,
    );
    mkdirSync(path.join(rootPath, ...existingFinal.split("/")), { mode: 0o755 });
    await expectPublicationError(
      () => publishDirectoryTreeCandidateDurably(
        root,
        existingCandidate,
        existingFinal,
      ),
      "destination-exists",
    );
    equal(existsSync(path.join(rootPath, ...existingSource.split("/"))), true);

    const changedSource = "transactions/.changed.stage";
    const changedFinal = "requirements/requirement_33333333-3333-4333-8333-333333333333";
    const changedCandidate = await createDirectoryTreeCandidateDurably(
      root,
      changedSource,
      FILES,
      OPTIONS,
    );
    writeFileSync(
      path.join(rootPath, ...changedSource.split("/"), "unexpected.txt"),
      "changed\n",
      { mode: 0o644 },
    );
    await expectPublicationError(
      () => publishDirectoryTreeCandidateDurably(
        root,
        changedCandidate,
        changedFinal,
      ),
      "source-changed",
    );
    equal(existsSync(path.join(rootPath, ...changedSource.split("/"))), true);
    equal(existsSync(path.join(rootPath, ...changedFinal.split("/"))), false);
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});
