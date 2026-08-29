import {
  deepEqual,
  equal,
} from "node:assert/strict";
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  createDirectoryTreeCandidateDurably,
  inspectDirectoryTreeCandidate,
  inspectDirectoryTreeCandidateProgress,
  parseDirectoryTreeCandidatePlan,
  planDirectoryTreeCandidate,
  settleDirectoryTreeCandidateDurably,
  DurableDirectoryTreeCandidateError,
  type DurableDirectoryTreeCandidateErrorReason,
} from "../../../src/foundation/filesystem/durable-directory-tree-candidate.js";
import { createDirectoryAtomically } from "../../../src/foundation/filesystem/durable-directory-materialization.js";
import { createFileCandidateDurably } from "../../../src/foundation/filesystem/durable-file-candidate.js";
import { parsePortableResourcePath } from "../../../src/foundation/filesystem/portable-resource-path.js";
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

async function expectCandidateError(
  action: () => unknown | Promise<unknown>,
  reason: DurableDirectoryTreeCandidateErrorReason,
): Promise<void> {
  let caught: unknown;
  try {
    await action();
  } catch (error: unknown) {
    caught = error;
  }
  if (!(caught instanceof DurableDirectoryTreeCandidateError)) {
    throw new Error("Expected DurableDirectoryTreeCandidateError.");
  }
  equal(caught.reason, reason);
}

test("durable directory tree candidate closes exact bytes, modes, and inventory", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-directory-candidate-"));
  mkdirSync(path.join(rootPath, "transactions"), { mode: 0o700 });
  chmodSync(path.join(rootPath, "transactions"), 0o700);
  const root = await RootedDirectory.open(rootPath);
  try {
    const plan = planDirectoryTreeCandidate(FILES, OPTIONS);
    deepEqual(plan.directories, ["design"]);
    deepEqual(plan.files.map(({ path: filePath, mode }) => ({
      path: filePath,
      mode,
    })), [{
      path: "design/requirement.md",
      mode: 0o644,
    }, {
      path: "record.json",
      mode: 0o644,
    }]);
    equal(Object.isFrozen(plan), true);
    equal(Object.isFrozen(plan.directories), true);
    equal(Object.isFrozen(plan.files), true);

    const created = await createDirectoryTreeCandidateDurably(
      root,
      "transactions/.requirement.stage",
      FILES,
      OPTIONS,
    );
    equal(created.plan.treeDigest, plan.treeDigest);
    equal(created.rootNode.kind, "directory");
    equal(created.rootNode.permissionBits, 0o755);

    const candidatePath = path.join(
      rootPath,
      "transactions",
      ".requirement.stage",
    );
    equal(statSync(candidatePath).mode & 0o777, 0o755);
    equal(statSync(path.join(candidatePath, "design")).mode & 0o777, 0o755);
    equal(
      statSync(path.join(candidatePath, "design/requirement.md")).mode & 0o777,
      0o644,
    );
    equal(readFileSync(path.join(candidatePath, "record.json"), "utf8"), "{\"kind\":\"record\"}\n");

    const inspected = await inspectDirectoryTreeCandidate(
      root,
      "transactions/.requirement.stage",
      plan,
      { expectedRootNode: created.rootNode },
    );
    equal(inspected.plan.treeDigest, plan.treeDigest);
    equal(inspected.rootNode.permissionBits, 0o755);

    writeFileSync(path.join(candidatePath, "unexpected.txt"), "unexpected\n", {
      mode: 0o644,
    });
    await expectCandidateError(
      () => inspectDirectoryTreeCandidate(
        root,
        "transactions/.requirement.stage",
        plan,
      ),
      "tree-conflict",
    );
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("directory tree plan rejects non-canonical and over-budget input", async () => {
  await expectCandidateError(
    () => planDirectoryTreeCandidate([...FILES].reverse(), OPTIONS),
    "file-order",
  );
  await expectCandidateError(
    () => planDirectoryTreeCandidate(FILES, {
      ...OPTIONS,
      maximumTotalBytes: 1,
    }),
    "capacity",
  );

  await expectCandidateError(
    () => planDirectoryTreeCandidate([{
      path: "A/first.txt",
      bytes: encodeUtf8("first\n"),
      mode: 0o644,
    }, {
      path: "a/second.txt",
      bytes: encodeUtf8("second\n"),
      mode: 0o644,
    }], OPTIONS),
    "path-conflict",
  );

  await expectCandidateError(
    () => planDirectoryTreeCandidate([{
      path: `${"a".repeat(1024)}x`,
      bytes: new Uint8Array(),
      mode: 0o644,
    }], OPTIONS),
    "capacity",
  );

  await expectCandidateError(
    () => planDirectoryTreeCandidate([{
      path: "shared.bin",
      bytes: new Uint8Array(new SharedArrayBuffer(1)),
      mode: 0o644,
    }], OPTIONS),
    "input",
  );

  const controller = new AbortController();
  controller.abort();
  await expectCandidateError(
    () => planDirectoryTreeCandidate(FILES, {
      ...OPTIONS,
      signal: controller.signal,
    }),
    "aborted",
  );

  const plan = planDirectoryTreeCandidate(FILES, OPTIONS);
  await expectCandidateError(
    () => parseDirectoryTreeCandidatePlan(plan, {
      maximumDepth: OPTIONS.maximumDepth,
      maximumEntries: OPTIONS.maximumEntries,
      maximumFileBytes: OPTIONS.maximumFileBytes,
      maximumFiles: OPTIONS.maximumFiles,
      maximumTotalBytes: 1,
    }),
    "capacity",
  );

  await expectCandidateError(
    () => planDirectoryTreeCandidate(FILES, {
      ...OPTIONS,
      maximumDepth: 65,
    }),
    "input",
  );

  await expectCandidateError(
    () => planDirectoryTreeCandidate(FILES, {
      ...OPTIONS,
      directoryMode: 0o500,
    }),
    "input",
  );

  await expectCandidateError(
    () => planDirectoryTreeCandidate([{
      ...FILES[0],
      mode: 0o200,
    }], OPTIONS),
    "input",
  );
});

test("directory tree candidate retry fills only missing exact nodes", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-directory-resume-"));
  mkdirSync(path.join(rootPath, "transactions"), { mode: 0o700 });
  chmodSync(path.join(rootPath, "transactions"), 0o700);
  const root = await RootedDirectory.open(rootPath);
  try {
    const stageRef = "transactions/.resume.stage";
    await createDirectoryAtomically(
      root,
      parsePortableResourcePath(stageRef),
      { mode: 0o755 },
    );
    await createFileCandidateDurably(
      root,
      parsePortableResourcePath(`${stageRef}/record.json`),
      FILES[1].bytes,
      { mode: 0o644 },
    );

    const progress = await inspectDirectoryTreeCandidateProgress(
      root,
      stageRef,
      planDirectoryTreeCandidate(FILES, OPTIONS),
    );
    equal(progress.status, "incomplete");
    deepEqual(progress.missingFiles, ["design/requirement.md"]);

    const settled = await settleDirectoryTreeCandidateDurably(
      root,
      stageRef,
      FILES,
      OPTIONS,
    );
    equal(settled.plan.files.length, 2);
    equal(
      readFileSync(path.join(rootPath, ...stageRef.split("/"), "design/requirement.md"), "utf8"),
      "# Requirement\n",
    );

    const conflictRef = "transactions/.conflict.stage";
    await createDirectoryAtomically(
      root,
      parsePortableResourcePath(conflictRef),
      { mode: 0o755 },
    );
    await createFileCandidateDurably(
      root,
      parsePortableResourcePath(`${conflictRef}/record.json`),
      encodeUtf8("different\n"),
      { mode: 0o644 },
    );
    await expectCandidateError(
      () => settleDirectoryTreeCandidateDurably(
        root,
        conflictRef,
        FILES,
        OPTIONS,
      ),
      "tree-conflict",
    );
    equal(
      readFileSync(path.join(rootPath, ...conflictRef.split("/"), "record.json"), "utf8"),
      "different\n",
    );
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});
