import { deepEqual, equal } from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";

import {
  computeWakeflowConfigV3Digest,
  parseWakeflowConfigV3,
} from "../../../src/configuration/wakeflow-config-v3.js";
import {
  codexWorkspaceHostResourceProfile,
} from "../../../src/hosts/codex/wakeflow-workspace-host-resource-profile.js";
import {
  RootedDirectory,
} from "../../../src/foundation/filesystem/rooted-directory.js";
import { parseSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import { encodeUtf8 } from "../../../src/foundation/text/utf8.js";
import {
  recomposeWakeflowManagedTextEnvelope,
} from "../../../src/workspace/managed-integration/wakeflow-managed-text-envelope.js";
import {
  createWakeflowProgramInstructionBodyAuthority,
} from "../../../src/workspace/managed-integration/wakeflow-program-instruction-body-authority.js";
import {
  inspectWakeflowProgramInstruction,
  WakeflowProgramInstructionInspectionError,
  type WakeflowProgramInstructionInspectionErrorReason,
} from "../../../src/workspace/managed-integration/wakeflow-program-instruction-inspection.js";
import {
  createWakeflowWorkspaceStaticResourceMatrix,
} from "../../../src/workspace/wakeflow-workspace-static-resource-matrix.js";
import {
  createMinimalWakeflowConfigV3,
} from "../../configuration/wakeflow-config-v3.fixture.js";

async function fixture(
  t: TestContext,
  source?: string | Uint8Array,
): Promise<Readonly<{
  readonly absolutePath: string;
  readonly instructionPath: string;
  readonly root: RootedDirectory;
}>> {
  const absolutePath = mkdtempSync(path.join(
    os.tmpdir(),
    "wakeflow-program-instruction-inspection-",
  ));
  const instructionPath = path.join(absolutePath, "AGENTS.md");
  if (source !== undefined) {
    writeFileSync(instructionPath, source, { mode: 0o644 });
  }
  const root = await RootedDirectory.open(absolutePath);
  t.after(async () => {
    await root.close();
    rmSync(absolutePath, { recursive: true, force: true });
  });
  return Object.freeze({ absolutePath, instructionPath, root });
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

async function expectInspectionError(
  action: () => Promise<unknown>,
  reason: WakeflowProgramInstructionInspectionErrorReason,
  pathValue: string,
): Promise<void> {
  let caught: unknown;
  try {
    await action();
  } catch (error: unknown) {
    caught = error;
  }
  equal(caught instanceof WakeflowProgramInstructionInspectionError, true);
  if (caught instanceof WakeflowProgramInstructionInspectionError) {
    equal(caught.code, "wakeflow-program-instruction-inspection");
    equal(caught.reason, reason);
    equal(caught.path, pathValue);
  }
}

test("Program Instruction inspection is read-only for fresh and user-owned files", async (t) => {
  const desired = config("en");
  const absent = await fixture(t);
  const absentInspection = await inspectWakeflowProgramInstruction(
    absent.root,
    request(null, desired),
  );
  equal(absentInspection.status, "recompose-required");
  equal(absentInspection.source, null);
  equal(absentInspection.currentAuthority, null);
  equal(absentInspection.transition.sourceAuthority, "unmanaged");
  equal(absentInspection.transition.target?.disposition, "inserted");
  equal(existsSync(absent.instructionPath), false);

  const outside = "# User instructions\r\nKeep this text.\n";
  const userOwned = await fixture(t, outside);
  const before = readFileSync(userOwned.instructionPath);
  const userInspection = await inspectWakeflowProgramInstruction(
    userOwned.root,
    request(null, desired),
  );
  equal(userInspection.status, "recompose-required");
  equal(userInspection.transition.target?.disposition, "inserted");
  const targetBytes = userInspection.transition.target?.bytes;
  if (targetBytes === undefined) throw new Error("Expected target bytes.");
  deepEqual(targetBytes.subarray(0, before.byteLength), before);
  deepEqual(readFileSync(userOwned.instructionPath), before);
});

test("Program Instruction inspection admits an exact language transition and retry", async (t) => {
  const current = config("en");
  const desired = config("zh-Hans");
  const currentAuthority = createWakeflowProgramInstructionBodyAuthority(
    current,
    codexWorkspaceHostResourceProfile,
  );
  const source = recomposeWakeflowManagedTextEnvelope(
    encodeUtf8("# User section\n"),
    currentAuthority.envelopeTarget,
  ).bytes;
  const workspace = await fixture(t, source);
  const transitionRequest = request(current, desired);

  const inspected = await inspectWakeflowProgramInstruction(
    workspace.root,
    transitionRequest,
  );
  equal(inspected.status, "recompose-required");
  equal(inspected.transition.sourceAuthority, "admitted-current");
  equal(inspected.transition.target?.disposition, "updated");
  equal(inspected.desiredAuthority.language, "zh-Hans");
  const desiredBytes = inspected.transition.target?.bytes;
  if (desiredBytes === undefined) throw new Error("Expected desired bytes.");
  equal(Buffer.from(desiredBytes).includes(Buffer.from("Wakeflow 程序指令")), true);

  writeFileSync(workspace.instructionPath, desiredBytes, { mode: 0o644 });
  const retried = await inspectWakeflowProgramInstruction(
    workspace.root,
    transitionRequest,
  );
  equal(retried.status, "managed-current");
  equal(retried.transition.sourceAuthority, "desired");
  equal(retried.transition.target, null);
});

test("Program Instruction inspection rejects unknown managed text and source-policy drift", async (t) => {
  const desired = config("en");
  const authority = createWakeflowProgramInstructionBodyAuthority(
    desired,
    codexWorkspaceHostResourceProfile,
  );
  const unknown = recomposeWakeflowManagedTextEnvelope(
    new Uint8Array(),
    {
      ...authority.envelopeTarget,
      body: "## Unknown but marker-consistent body\n",
    },
  ).bytes;
  const workspace = await fixture(t, unknown);
  await expectInspectionError(
    () => inspectWakeflowProgramInstruction(
      workspace.root,
      request(desired, desired),
    ),
    "unknown-managed-body",
    "$source",
  );

  writeFileSync(workspace.instructionPath, authority.body, { mode: 0o644 });
  chmodSync(workspace.instructionPath, 0o600);
  await expectInspectionError(
    () => inspectWakeflowProgramInstruction(
      workspace.root,
      request(null, desired),
    ),
    "source-policy",
    "$source",
  );

  const invalidDigestRequest = {
    ...request(null, desired),
    expectedDesiredConfigDigest: parseSha256Digest(
      "sha256:0000000000000000000000000000000000000000000000000000000000000000",
    ),
  };
  await expectInspectionError(
    () => inspectWakeflowProgramInstruction(
      workspace.root,
      invalidDigestRequest,
    ),
    "input",
    "$request.expectedDesiredConfigDigest",
  );
});
