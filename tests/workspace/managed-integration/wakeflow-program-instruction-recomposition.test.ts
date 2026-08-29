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

import {
  computeWakeflowConfigV3Digest,
  parseWakeflowConfigV3,
} from "../../../src/configuration/wakeflow-config-v3.js";
import { computeSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import {
  withRootedExclusiveFileLock,
} from "../../../src/foundation/filesystem/rooted-exclusive-file-lock.js";
import {
  codexWorkspaceHostResourceProfile,
} from "../../../src/hosts/codex/wakeflow-workspace-host-resource-profile.js";
import {
  recomposeWakeflowManagedTextEnvelope,
} from "../../../src/workspace/managed-integration/wakeflow-managed-text-envelope.js";
import {
  createWakeflowProgramInstructionBodyAuthority,
} from "../../../src/workspace/managed-integration/wakeflow-program-instruction-body-authority.js";
import {
  recoverWakeflowProgramInstructionRecomposition,
} from "../../../src/workspace/managed-integration/wakeflow-program-instruction-recomposition-recovery.js";
import {
  recomposeWakeflowProgramInstruction,
  WakeflowProgramInstructionRecompositionError,
  type WakeflowProgramInstructionRecompositionErrorReason,
} from "../../../src/workspace/managed-integration/wakeflow-program-instruction-recomposition.js";
import {
  createWakeflowWorkspaceStaticResourceMatrix,
} from "../../../src/workspace/wakeflow-workspace-static-resource-matrix.js";
import {
  wakeflowProgramInstructionRecompositionLockRef,
} from "../../../src/workspace/workspace-host-resource-catalog.js";
import {
  createMinimalWakeflowConfigV3,
} from "../../configuration/wakeflow-config-v3.fixture.js";

interface Fixture {
  readonly absolutePath: string;
  readonly instructionPath: string;
  readonly lockPath: string;
  readonly root: RootedDirectory;
}

async function fixture(
  t: TestContext,
  source?: string | Uint8Array,
): Promise<Readonly<Fixture>> {
  const absolutePath = mkdtempSync(path.join(
    os.tmpdir(),
    "wakeflow-program-instruction-recomposition-",
  ));
  mkdirSync(path.join(absolutePath, ".wakeflow-local"), { mode: 0o700 });
  const instructionPath = path.join(absolutePath, "AGENTS.md");
  if (source !== undefined) {
    writeFileSync(instructionPath, source, { mode: 0o644 });
  }
  const lockRef = wakeflowProgramInstructionRecompositionLockRef(
    codexWorkspaceHostResourceProfile,
  );
  const root = await RootedDirectory.open(absolutePath);
  t.after(async () => {
    await root.close();
    rmSync(absolutePath, { recursive: true, force: true });
  });
  return Object.freeze({
    absolutePath,
    instructionPath,
    lockPath: path.join(absolutePath, lockRef),
    root,
  });
}

function config(language: "en" | "zh-Hans") {
  const value = createMinimalWakeflowConfigV3();
  (value.presentation as Record<string, unknown>).language = language;
  return parseWakeflowConfigV3(value);
}

function request(
  currentConfig: ReturnType<typeof config> | null,
  desiredConfig: ReturnType<typeof config>,
) {
  const matrix = createWakeflowWorkspaceStaticResourceMatrix(
    codexWorkspaceHostResourceProfile,
  );
  return Object.freeze({
    matrix,
    expectedMatrixDigest: matrix.matrixDigest,
    profile: codexWorkspaceHostResourceProfile,
    currentConfig,
    expectedCurrentConfigDigest: currentConfig === null
      ? null
      : computeWakeflowConfigV3Digest(currentConfig),
    desiredConfig,
    expectedDesiredConfigDigest: computeWakeflowConfigV3Digest(desiredConfig),
  });
}

function writeInactiveLock(lockPath: string): void {
  writeFileSync(lockPath, `${JSON.stringify({
    createdAt: "2026-08-27T10:00:00.000Z",
    kind: "WakeflowExclusiveFileLock",
    pid: 2_147_483_647,
    threadId: 0,
    token: "2147483647-0-11111111-1111-4111-8111-111111111111",
    version: 1,
  }, null, 2)}\n`, { mode: 0o600 });
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
  const created = await recomposeWakeflowProgramInstruction(
    workspace.root,
    operation,
  );

  equal(created.disposition, "created");
  equal(created.effect?.publication, "created");
  equal(created.inspection.status, "managed-current");
  equal(created.inspection.transition.target, null);
  equal(statSync(workspace.instructionPath).mode & 0o777, 0o644);
  equal(existsSync(workspace.lockPath), false);
  const bytes = readFileSync(workspace.instructionPath);
  const node = statSync(workspace.instructionPath, { bigint: true });

  const current = await recomposeWakeflowProgramInstruction(
    workspace.root,
    operation,
  );
  equal(current.disposition, "current");
  equal(current.effect, null);
  deepEqual(readFileSync(workspace.instructionPath), bytes);
  equal(statSync(workspace.instructionPath, { bigint: true }).ino, node.ino);
  equal(existsSync(workspace.lockPath), false);
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
  equal(existsSync(workspace.lockPath), false);
});

test("Program Instruction recomposition rejects unsafe source and bounded lock contention", async (t) => {
  const desired = config("en");
  const unsafe = await fixture(t, "# User section\n");
  chmodSync(unsafe.instructionPath, 0o600);
  await expectRecompositionError(
    () => recomposeWakeflowProgramInstruction(
      unsafe.root,
      request(null, desired),
    ),
    "source-invalid",
    "$source",
  );
  equal(existsSync(unsafe.lockPath), false);

  const contended = await fixture(t);
  let enter: (() => void) | undefined;
  let release: (() => void) | undefined;
  const entered = new Promise<void>((resolve) => { enter = resolve; });
  const released = new Promise<void>((resolve) => { release = resolve; });
  const holder = withRootedExclusiveFileLock(
    contended.root,
    wakeflowProgramInstructionRecompositionLockRef(
      codexWorkspaceHostResourceProfile,
    ),
    async () => {
      enter?.();
      await released;
    },
  );
  await entered;
  try {
    await expectRecompositionError(
      () => recomposeWakeflowProgramInstruction(
        contended.root,
        request(null, desired),
        {
          acquireTimeoutMilliseconds: 30,
          retryDelayMilliseconds: 5,
        },
      ),
      "lock-timeout",
      "$lock",
    );
  } finally {
    release?.();
    await holder;
  }
  equal(existsSync(contended.lockPath), false);
});

test("Program Instruction recovery retires only an inactive safe lock", async (t) => {
  const desired = config("en");
  const operation = request(null, desired);
  const workspace = await fixture(t);
  writeInactiveLock(workspace.lockPath);

  const recovered = await recoverWakeflowProgramInstructionRecomposition(
    workspace.root,
    operation,
  );
  equal(recovered.disposition, "recovered");
  equal(/^sha256:[0-9a-f]{64}$/u.test(recovered.retiredLockDigest), true);
  equal(recovered.stageRecovery.observedStageCount, 0);
  equal(recovered.recomposition.disposition, "created");
  equal(recovered.recomposition.inspection.status, "managed-current");
  equal(existsSync(workspace.lockPath), false);

  const absent = await fixture(t);
  await expectRecompositionError(
    () => recoverWakeflowProgramInstructionRecomposition(
      absent.root,
      operation,
    ),
    "recovery-not-required",
    "$lock",
  );
});

test("Program Instruction recovery preserves unknown managed content", async (t) => {
  const desired = config("en");
  const authority = createWakeflowProgramInstructionBodyAuthority(
    desired,
    codexWorkspaceHostResourceProfile,
  );
  const unknown = recomposeWakeflowManagedTextEnvelope(
    new Uint8Array(),
    {
      ...authority.envelopeTarget,
      body: "## Unknown marker-consistent content\n",
    },
  ).bytes;
  const workspace = await fixture(t, unknown);
  writeInactiveLock(workspace.lockPath);

  await expectRecompositionError(
    () => recoverWakeflowProgramInstructionRecomposition(
      workspace.root,
      request(desired, desired),
    ),
    "recovery-required",
    "$source",
  );
  equal(existsSync(workspace.lockPath), true);
  deepEqual(readFileSync(workspace.instructionPath), unknown);
});
