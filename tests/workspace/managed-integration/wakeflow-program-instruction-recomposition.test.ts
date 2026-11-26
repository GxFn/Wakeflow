import { deepEqual, equal } from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { type TestContext, test } from "node:test";

import {
  computeWakeflowConfigDigest,
  parseWakeflowConfig,
} from "../../../src/configuration/wakeflow-config.js";
import { computeSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import {
  issueDurableAtomicFileStageAddress,
  releaseDurableAtomicFileStageAddress,
} from "../../../src/foundation/filesystem/durable-atomic-file-stage-address.js";
import { acquireKernelFileLock } from "../../../src/foundation/filesystem/kernel-file-lock.js";
import { parsePortableResourcePath } from "../../../src/foundation/filesystem/portable-resource-path.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { codexWorkspaceHostResourceProfile } from "../../../src/hosts/codex/wakeflow-workspace-host-resource-profile.js";
import {
  materializeWorkspaceLocksRoot,
  workspaceLockRef,
} from "../../../src/kernel/workspace-locks.js";
import { recomposeWakeflowManagedTextEnvelope } from "../../../src/workspace/managed-integration/wakeflow-managed-text-envelope.js";
import { createWakeflowProgramInstructionBodyAuthority } from "../../../src/workspace/managed-integration/wakeflow-program-instruction-body-authority.js";
import {
  recomposeWakeflowProgramInstruction,
  WakeflowProgramInstructionRecompositionError,
  type WakeflowProgramInstructionRecompositionErrorReason,
} from "../../../src/workspace/managed-integration/wakeflow-program-instruction-recomposition.js";
import { createWakeflowWorkspaceStaticResourceMatrix } from "../../../src/workspace/wakeflow-workspace-static-resource-matrix.js";
import { createMinimalWakeflowConfig } from "../../configuration/wakeflow-config.fixture.js";
import { useDisposableDurability } from "../../support/disposable-durability.js";

useDisposableDurability();

interface Fixture {
  readonly absolutePath: string;
  readonly instructionPath: string;
  readonly root: RootedDirectory;
}

async function fixture(t: TestContext, source?: string | Uint8Array): Promise<Readonly<Fixture>> {
  const absolutePath = mkdtempSync(
    path.join(os.tmpdir(), "wakeflow-program-instruction-recomposition-"),
  );
  mkdirSync(path.join(absolutePath, ".wakeflow-local"), { mode: 0o700 });
  const instructionPath = path.join(absolutePath, "AGENTS.md");
  if (source !== undefined) {
    writeFileSync(instructionPath, source, { mode: 0o644 });
  }
  const root = await RootedDirectory.open(absolutePath);
  t.after(async () => {
    await root.close();
    rmSync(absolutePath, { recursive: true, force: true });
  });
  return Object.freeze({
    absolutePath,
    instructionPath,
    root,
  });
}

function config(language: "en" | "zh-Hans") {
  const value = createMinimalWakeflowConfig();
  (value.presentation as Record<string, unknown>).language = language;
  return parseWakeflowConfig(value);
}

function request(
  currentConfig: ReturnType<typeof config> | null,
  desiredConfig: ReturnType<typeof config>,
) {
  const matrix = createWakeflowWorkspaceStaticResourceMatrix(codexWorkspaceHostResourceProfile);
  return Object.freeze({
    matrix,
    expectedMatrixDigest: matrix.matrixDigest,
    profile: codexWorkspaceHostResourceProfile,
    currentConfig,
    expectedCurrentConfigDigest:
      currentConfig === null ? null : computeWakeflowConfigDigest(currentConfig),
    desiredConfig,
    expectedDesiredConfigDigest: computeWakeflowConfigDigest(desiredConfig),
  });
}

async function expectRecompositionError(
  action: () => Promise<unknown>,
  reason: WakeflowProgramInstructionRecompositionErrorReason,
  pathValue: string,
): Promise<void> {
  let caught: unknown;
  try {
    await action();
  } catch (error: unknown) {
    caught = error;
  }
  equal(caught instanceof WakeflowProgramInstructionRecompositionError, true);
  if (caught instanceof WakeflowProgramInstructionRecompositionError) {
    equal(caught.code, "wakeflow-program-instruction-recomposition");
    equal(caught.reason, reason);
    equal(caught.path, pathValue);
  }
}

test("Program Instruction recomposition atomically creates once and stays current", async (t) => {
  const workspace = await fixture(t);
  const desired = config("en");
  const operation = request(null, desired);
  const created = await recomposeWakeflowProgramInstruction(workspace.root, operation);

  equal(created.disposition, "created");
  equal(created.effect?.publication, "created");
  equal(created.inspection.status, "managed-current");
  equal(created.inspection.transition.target, null);
  equal(statSync(workspace.instructionPath).mode & 0o777, 0o644);
  const bytes = readFileSync(workspace.instructionPath);
  const node = statSync(workspace.instructionPath, { bigint: true });

  const current = await recomposeWakeflowProgramInstruction(workspace.root, operation);
  equal(current.disposition, "current");
  equal(current.effect, null);
  deepEqual(readFileSync(workspace.instructionPath), bytes);
  equal(statSync(workspace.instructionPath, { bigint: true }).ino, node.ino);
  // 锁在私有的锁目录里（ADR-0033）：工作区根上没有锁文件。
  deepEqual(
    readdirSync(workspace.absolutePath).filter((name) => name.endsWith(".lock")),
    [],
  );
});

test("Program Instruction recomposition settles a dead writer's stage and then replaces (ADR-0033)", async (t) => {
  const workspace = await fixture(t, "# User section\n");
  // 上一个重组的进程死在写到一半：内核已经收走它的锁，它替换用的暂存还留着。
  const bytes = Buffer.from("stale\n");
  const stage = issueDurableAtomicFileStageAddress(
    "replace",
    parsePortableResourcePath("AGENTS.md"),
    computeSha256Digest(bytes),
    0o644,
  );
  releaseDurableAtomicFileStageAddress(stage);
  const stagePath = path.join(workspace.absolutePath, stage.fileName);
  writeFileSync(stagePath, bytes, { mode: 0o644 });

  const replaced = await recomposeWakeflowProgramInstruction(
    workspace.root,
    request(null, config("en")),
  );
  equal(replaced.disposition, "replaced");
  equal(existsSync(stagePath), false);
});

test("Program Instruction recomposition replaces an admitted language render and preserves outside", async (t) => {
  const current = config("en");
  const desired = config("zh-Hans");
  const currentAuthority = createWakeflowProgramInstructionBodyAuthority(
    current,
    codexWorkspaceHostResourceProfile,
  );
  const outside = Buffer.from("# User section\r\nKeep exactly.\n");
  const source = recomposeWakeflowManagedTextEnvelope(
    outside,
    currentAuthority.envelopeTarget,
  ).bytes;
  const workspace = await fixture(t, source);
  const sourceDigest = computeSha256Digest(source);

  const replaced = await recomposeWakeflowProgramInstruction(
    workspace.root,
    request(current, desired),
  );
  equal(replaced.disposition, "replaced");
  equal(replaced.effect?.publication, "replaced");
  if (replaced.effect?.publication === "replaced") {
    equal(replaced.effect.previous.digest, sourceDigest);
  }
  equal(replaced.inspection.status, "managed-current");
  const finalBytes = readFileSync(workspace.instructionPath);
  deepEqual(finalBytes.subarray(0, outside.byteLength), outside);
  equal(finalBytes.includes(Buffer.from("Wakeflow 程序指令")), true);
});

test("Program Instruction recomposition rejects unsafe source and bounded lock contention", async (t) => {
  const desired = config("en");
  const unsafe = await fixture(t, "# User section\n");
  chmodSync(unsafe.instructionPath, 0o600);
  await expectRecompositionError(
    () => recomposeWakeflowProgramInstruction(unsafe.root, request(null, desired)),
    "source-invalid",
    "$source",
  );

  const contended = await fixture(t);
  await materializeWorkspaceLocksRoot(contended.root);
  const lease = await acquireKernelFileLock(
    contended.root,
    workspaceLockRef("program-instruction"),
    "exclusive",
  );
  try {
    await expectRecompositionError(
      () =>
        recomposeWakeflowProgramInstruction(contended.root, request(null, desired), {
          acquireTimeoutMilliseconds: 30,
          retryDelayMilliseconds: 5,
        }),
      "lock-timeout",
      "$lock",
    );
  } finally {
    await lease.release();
  }
});
