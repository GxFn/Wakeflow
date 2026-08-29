import {
  equal,
  rejects,
} from "node:assert/strict";
import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { computeSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import {
  createFileCandidateDurably,
} from "../../../src/foundation/filesystem/durable-file-candidate.js";
import {
  durableAtomicFileStageRef,
  issueDurableAtomicFileStageAddress,
  releaseDurableAtomicFileStageAddress,
} from "../../../src/foundation/filesystem/durable-atomic-file-stage-address.js";
import {
  recoverDurableAtomicFileStagesForTargets,
  recoverDurableAtomicFileStagesInTargetParent,
  recoverDurableAtomicFileStagesMatchingTargets,
  DurableAtomicFileStageRecoveryError,
} from "../../../src/foundation/filesystem/durable-atomic-file-stage-recovery.js";
import {
  parsePortableResourcePath,
} from "../../../src/foundation/filesystem/portable-resource-path.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { encodeUtf8 } from "../../../src/foundation/text/utf8.js";

test("atomic stage recovery 回滚 inactive single-link partial stage", async () => {
  const rootPath = mkdtempSync(path.join(
    os.tmpdir(),
    "wakeflow-atomic-stage-rollback-",
  ));
  mkdirSync(path.join(rootPath, "records"), { mode: 0o700 });
  const root = await RootedDirectory.open(rootPath);
  const targetRef = parsePortableResourcePath("records/record.json");
  const intendedBytes = encodeUtf8("complete-payload");
  const address = issueDurableAtomicFileStageAddress(
    "create",
    targetRef,
    computeSha256Digest(intendedBytes),
    0o600,
  );
  const stageRef = durableAtomicFileStageRef(targetRef, address);
  let released = false;
  try {
    await createFileCandidateDurably(root, stageRef, encodeUtf8("partial"), {
      mode: 0o600,
    });
    releaseDurableAtomicFileStageAddress(address);
    released = true;

    const receipt = await recoverDurableAtomicFileStagesInTargetParent(
      root,
      targetRef,
    );
    equal(receipt.retiredStageCount, 1);
    equal(receipt.settledTargetCount, 0);
    equal(receipt.activeStageCount, 0);
    equal(receipt.unknownStageCount, 0);
    equal(existsSync(path.join(rootPath, ...stageRef.split("/"))), false);
    equal(existsSync(path.join(rootPath, ...targetRef.split("/"))), false);
  } finally {
    if (!released) {
      releaseDurableAtomicFileStageAddress(address);
    }
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("atomic stage recovery 前向结算 exact two-link create publication", async () => {
  const rootPath = mkdtempSync(path.join(
    os.tmpdir(),
    "wakeflow-atomic-stage-forward-",
  ));
  mkdirSync(path.join(rootPath, "records"), { mode: 0o700 });
  const root = await RootedDirectory.open(rootPath);
  const targetRef = parsePortableResourcePath("records/record.json");
  const bytes = encodeUtf8("complete-payload");
  const address = issueDurableAtomicFileStageAddress(
    "create",
    targetRef,
    computeSha256Digest(bytes),
    0o600,
  );
  const stageRef = durableAtomicFileStageRef(targetRef, address);
  let released = false;
  try {
    await createFileCandidateDurably(root, stageRef, bytes, { mode: 0o600 });
    linkSync(
      path.join(rootPath, ...stageRef.split("/")),
      path.join(rootPath, ...targetRef.split("/")),
    );
    releaseDurableAtomicFileStageAddress(address);
    released = true;

    const receipt = await recoverDurableAtomicFileStagesInTargetParent(
      root,
      targetRef,
    );
    equal(receipt.retiredStageCount, 1);
    equal(receipt.settledTargetCount, 1);
    equal(existsSync(path.join(rootPath, ...stageRef.split("/"))), false);
    equal(statSync(path.join(rootPath, ...targetRef.split("/"))).nlink, 1);
  } finally {
    if (!released) releaseDurableAtomicFileStageAddress(address);
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("atomic stage recovery 保留 active stage 并拒绝 malformed reserved name", async () => {
  const rootPath = mkdtempSync(path.join(
    os.tmpdir(),
    "wakeflow-atomic-stage-active-",
  ));
  mkdirSync(path.join(rootPath, "records"), { mode: 0o700 });
  const root = await RootedDirectory.open(rootPath);
  const targetRef = parsePortableResourcePath("records/record.json");
  const bytes = encodeUtf8("payload");
  const address = issueDurableAtomicFileStageAddress(
    "create",
    targetRef,
    computeSha256Digest(bytes),
    0o600,
  );
  const stageRef = durableAtomicFileStageRef(targetRef, address);
  let released = false;
  try {
    await createFileCandidateDurably(root, stageRef, bytes, { mode: 0o600 });
    const active = await recoverDurableAtomicFileStagesInTargetParent(
      root,
      targetRef,
    );
    equal(active.activeStageCount, 1);
    equal(active.retiredStageCount, 0);
    equal(existsSync(path.join(rootPath, ...stageRef.split("/"))), true);

    releaseDurableAtomicFileStageAddress(address);
    released = true;
    const retired = await recoverDurableAtomicFileStagesInTargetParent(
      root,
      targetRef,
    );
    equal(retired.retiredStageCount, 1);

    writeFileSync(
      path.join(rootPath, "records", ".wakeflow-atomic-malformed.tmp"),
      "unknown",
      { mode: 0o600 },
    );
    await rejects(
      recoverDurableAtomicFileStagesInTargetParent(root, targetRef),
      (error: unknown) => (
        error instanceof DurableAtomicFileStageRecoveryError
        && error.reason === "inventory"
      ),
    );
  } finally {
    if (!released) releaseDurableAtomicFileStageAddress(address);
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("target-scoped atomic stage recovery rejects foreign stages before mutation", async () => {
  const rootPath = mkdtempSync(path.join(
    os.tmpdir(),
    "wakeflow-atomic-stage-target-scope-",
  ));
  mkdirSync(path.join(rootPath, "records"), { mode: 0o700 });
  const root = await RootedDirectory.open(rootPath);
  const firstTarget = parsePortableResourcePath("records/first.json");
  const secondTarget = parsePortableResourcePath("records/second.json");
  const bytes = encodeUtf8("candidate");
  const addresses = [firstTarget, secondTarget].map((target) => (
    issueDurableAtomicFileStageAddress(
      "replace",
      target,
      computeSha256Digest(bytes),
      0o600,
    )
  ));
  const stages = addresses.map((address, index) => durableAtomicFileStageRef(
    index === 0 ? firstTarget : secondTarget,
    address,
  ));
  let released = false;
  try {
    for (const stage of stages) {
      await createFileCandidateDurably(root, stage, bytes, { mode: 0o600 });
    }
    for (const address of addresses) {
      releaseDurableAtomicFileStageAddress(address);
    }
    released = true;

    await rejects(
      recoverDurableAtomicFileStagesForTargets(root, [firstTarget]),
      (error: unknown) => (
        error instanceof DurableAtomicFileStageRecoveryError
        && error.reason === "target-scope"
      ),
    );
    equal(
      stages.every((stage) => existsSync(
        path.join(rootPath, ...stage.split("/")),
      )),
      true,
    );

    const firstReceipt = await recoverDurableAtomicFileStagesMatchingTargets(
      root,
      [firstTarget],
    );
    equal(firstReceipt.retiredStageCount, 1);
    equal(existsSync(path.join(rootPath, ...stages[0]!.split("/"))), false);
    equal(existsSync(path.join(rootPath, ...stages[1]!.split("/"))), true);

    const receipt = await recoverDurableAtomicFileStagesForTargets(
      root,
      [secondTarget],
    );
    equal(receipt.retiredStageCount, 1);
    equal(
      stages.some((stage) => existsSync(
        path.join(rootPath, ...stage.split("/")),
      )),
      false,
    );
  } finally {
    if (!released) {
      for (const address of addresses) {
        releaseDurableAtomicFileStageAddress(address);
      }
    }
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});
