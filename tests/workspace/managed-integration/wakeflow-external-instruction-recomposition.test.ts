import { deepEqual, equal } from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";

import {
  computeWakeflowConfigDigest,
  parseWakeflowConfig,
} from "../../../src/configuration/wakeflow-config.js";
import { computeSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { codexWorkspaceHostResourceProfile } from "../../../src/hosts/codex/wakeflow-workspace-host-resource-profile.js";
import { createWakeflowExternalInstructionBodyAuthority } from "../../../src/workspace/managed-integration/wakeflow-external-instruction-body-authority.js";
import {
  inspectWakeflowExternalInstruction,
  WakeflowExternalInstructionInspectionError,
  type WakeflowExternalInstructionInspectionErrorReason,
} from "../../../src/workspace/managed-integration/wakeflow-external-instruction-inspection.js";
import {
  recomposeWakeflowExternalInstruction,
  WakeflowExternalInstructionRecompositionError,
  type WakeflowExternalInstructionRecompositionErrorReason,
} from "../../../src/workspace/managed-integration/wakeflow-external-instruction-recomposition.js";
import { recomposeWakeflowManagedTextEnvelope } from "../../../src/workspace/managed-integration/wakeflow-managed-text-envelope.js";
import { createMinimalWakeflowConfig } from "../../configuration/wakeflow-config.fixture.js";
import {
  createManagedBlockWakeflowConfig,
  EXTERNAL_DESIGN_SURFACE_TARGET,
  MANAGED_BLOCK_REPOSITORY_TARGET,
} from "./wakeflow-external-instruction.fixture.js";

/**
 * 外部根托管块的检查与 CAS 重组：不存在则以 0644 新建、存在则追加并保留所有者权限位、
 * 相同即 current、准入的前序渲染可替换、受管区域内的用户改动与不安全源一律拒绝。
 */

interface Fixture {
  readonly absolutePath: string;
  readonly instructionPath: string;
  readonly root: RootedDirectory;
}

async function fixture(
  t: TestContext,
  source?: string | Uint8Array,
  mode = 0o644,
): Promise<Readonly<Fixture>> {
  const absolutePath = realpathSync(mkdtempSync(path.join(
    os.tmpdir(),
    "wakeflow-external-instruction-",
  )));
  const instructionPath = path.join(absolutePath, "AGENTS.md");
  if (source !== undefined) {
    writeFileSync(instructionPath, source, { mode });
    chmodSync(instructionPath, mode);
  }
  const root = await RootedDirectory.open(absolutePath);
  t.after(async () => {
    await root.close();
    rmSync(absolutePath, { recursive: true, force: true });
  });
  return Object.freeze({ absolutePath, instructionPath, root });
}

function config(language: "en" | "zh-Hans") {
  return parseWakeflowConfig(createManagedBlockWakeflowConfig(language));
}

function request(
  currentConfig: ReturnType<typeof config> | null,
  desiredConfig: ReturnType<typeof config>,
  target: unknown = MANAGED_BLOCK_REPOSITORY_TARGET,
) {
  return Object.freeze({
    profile: codexWorkspaceHostResourceProfile,
    target,
    currentConfig,
    expectedCurrentConfigDigest: currentConfig === null
      ? null
      : computeWakeflowConfigDigest(currentConfig),
    desiredConfig,
    expectedDesiredConfigDigest: computeWakeflowConfigDigest(desiredConfig),
  });
}

async function expectRecompositionError(
  action: () => Promise<unknown>,
  reason: WakeflowExternalInstructionRecompositionErrorReason,
  pathValue: string,
): Promise<void> {
  let caught: unknown;
  try {
    await action();
  } catch (error: unknown) {
    caught = error;
  }
  equal(caught instanceof WakeflowExternalInstructionRecompositionError, true);
  if (caught instanceof WakeflowExternalInstructionRecompositionError) {
    equal(caught.code, "wakeflow-external-instruction-recomposition");
    equal(caught.reason, reason);
    equal(caught.path, pathValue);
  }
}

async function expectInspectionError(
  action: () => Promise<unknown>,
  reason: WakeflowExternalInstructionInspectionErrorReason,
  pathValue: string,
): Promise<void> {
  let caught: unknown;
  try {
    await action();
  } catch (error: unknown) {
    caught = error;
  }
  equal(caught instanceof WakeflowExternalInstructionInspectionError, true);
  if (caught instanceof WakeflowExternalInstructionInspectionError) {
    equal(caught.code, "wakeflow-external-instruction-inspection");
    equal(caught.reason, reason);
    equal(caught.path, pathValue);
  }
}

test("external instruction recomposition creates the managed block once and stays current", async (t) => {
  const workspace = await fixture(t);
  const desired = config("en");
  const operation = request(null, desired);
  const before = await inspectWakeflowExternalInstruction(workspace.root, operation);
  equal(before.status, "recompose-required");
  equal(before.source, null);
  equal(before.currentAuthority, null);
  equal(existsSync(workspace.instructionPath), false, "inspection must not write");

  const created = await recomposeWakeflowExternalInstruction(workspace.root, operation);
  equal(created.disposition, "created");
  equal(created.effect?.publication, "created");
  equal(created.inspection.status, "managed-current");
  equal(created.inspection.transition.target, null);
  equal(statSync(workspace.instructionPath).mode & 0o777, 0o644);
  const authority = createWakeflowExternalInstructionBodyAuthority(
    desired,
    codexWorkspaceHostResourceProfile,
    MANAGED_BLOCK_REPOSITORY_TARGET,
  );
  deepEqual(
    readFileSync(workspace.instructionPath),
    Buffer.from(recomposeWakeflowManagedTextEnvelope(
      new Uint8Array(),
      authority.envelopeTarget,
    ).bytes),
  );
  const node = statSync(workspace.instructionPath, { bigint: true });

  const current = await recomposeWakeflowExternalInstruction(workspace.root, operation);
  equal(current.disposition, "current");
  equal(current.effect, null);
  equal(statSync(workspace.instructionPath, { bigint: true }).ino, node.ino);
  equal(
    (await inspectWakeflowExternalInstruction(workspace.root, operation)).status,
    "managed-current",
  );
});

test("external instruction recomposition appends to owner text and preserves the owner's mode", async (t) => {
  const outside = "# Product A\n\nLocal engineering rules stay exactly as written.\n";
  const workspace = await fixture(t, outside, 0o664);
  const sourceDigest = computeSha256Digest(Buffer.from(outside));
  const desired = config("en");

  const replaced = await recomposeWakeflowExternalInstruction(
    workspace.root,
    request(null, desired),
  );
  equal(replaced.disposition, "replaced");
  equal(replaced.effect?.publication, "replaced");
  if (replaced.effect?.publication === "replaced") {
    equal(replaced.effect.previous.digest, sourceDigest);
  }
  equal(replaced.inspection.status, "managed-current");
  equal(statSync(workspace.instructionPath).mode & 0o777, 0o664);
  const finalText = readFileSync(workspace.instructionPath, "utf8");
  equal(finalText.startsWith(outside), true);
  equal(finalText.includes("## Wakeflow Repository Instructions"), true);
  equal(
    finalText.includes(
      "<!-- wakeflow:managed-content:v1:begin component=repository-instruction owner=host-instruction-integration",
    ),
    true,
  );
  equal(
    (await recomposeWakeflowExternalInstruction(workspace.root, request(null, desired)))
      .disposition,
    "current",
  );
});

test("external instruction recomposition replaces only an admitted render and never a user-edited block", async (t) => {
  const current = config("en");
  const desired = config("zh-Hans");
  const currentAuthority = createWakeflowExternalInstructionBodyAuthority(
    current,
    codexWorkspaceHostResourceProfile,
    MANAGED_BLOCK_REPOSITORY_TARGET,
  );
  const outside = Buffer.from("# User section\r\nKeep exactly.\n");
  const source = recomposeWakeflowManagedTextEnvelope(
    outside,
    currentAuthority.envelopeTarget,
  ).bytes;
  const workspace = await fixture(t, source);

  // 没有可准入的前序渲染时，现有托管正文是未知正文。
  await expectRecompositionError(
    () => recomposeWakeflowExternalInstruction(workspace.root, request(null, desired)),
    "source-invalid",
    "$source",
  );
  await expectInspectionError(
    () => inspectWakeflowExternalInstruction(workspace.root, request(null, desired)),
    "unknown-managed-body",
    "$source",
  );
  deepEqual(readFileSync(workspace.instructionPath), Buffer.from(source));

  // owner-managed 的前序 Config 同样没有前序渲染。
  const ownerManaged = parseWakeflowConfig(createMinimalWakeflowConfig());
  await expectRecompositionError(
    () => recomposeWakeflowExternalInstruction(
      workspace.root,
      request(ownerManaged, desired),
    ),
    "source-invalid",
    "$source",
  );

  const replaced = await recomposeWakeflowExternalInstruction(
    workspace.root,
    request(current, desired),
  );
  equal(replaced.disposition, "replaced");
  equal(replaced.inspection.currentAuthority?.language, "en");
  const finalBytes = readFileSync(workspace.instructionPath);
  deepEqual(finalBytes.subarray(0, outside.byteLength), outside);
  equal(finalBytes.includes(Buffer.from("Wakeflow 仓库指令")), true);

  // 受管区域内的原地改动破坏 envelope 摘要：按 envelope 拒绝，绝不覆盖。
  const tampered = finalBytes
    .toString("utf8")
    .replace("### 安全边界", "### 安全边界（用户改动）");
  writeFileSync(workspace.instructionPath, tampered);
  await expectRecompositionError(
    () => recomposeWakeflowExternalInstruction(
      workspace.root,
      request(desired, desired),
    ),
    "source-invalid",
    "$source",
  );
  await expectInspectionError(
    () => inspectWakeflowExternalInstruction(
      workspace.root,
      request(desired, desired),
    ),
    "envelope",
    "$source",
  );
  equal(readFileSync(workspace.instructionPath, "utf8"), tampered);

  // 自洽但不是任何已准入渲染的托管正文：按未知正文拒绝。
  const foreignConfig = createManagedBlockWakeflowConfig("zh-Hans");
  (foreignConfig.program as Record<string, unknown>).displayName = "Another";
  const foreignAuthority = createWakeflowExternalInstructionBodyAuthority(
    foreignConfig,
    codexWorkspaceHostResourceProfile,
    MANAGED_BLOCK_REPOSITORY_TARGET,
  );
  writeFileSync(
    workspace.instructionPath,
    recomposeWakeflowManagedTextEnvelope(outside, foreignAuthority.envelopeTarget).bytes,
  );
  await expectInspectionError(
    () => inspectWakeflowExternalInstruction(
      workspace.root,
      request(desired, desired),
    ),
    "unknown-managed-body",
    "$source",
  );
  await expectRecompositionError(
    () => recomposeWakeflowExternalInstruction(
      workspace.root,
      request(desired, desired),
    ),
    "source-invalid",
    "$source",
  );
});

test("external instruction recomposition rejects unsafe sources, foreign targets and cancellation", async (t) => {
  const desired = config("en");
  const linked = await fixture(t);
  writeFileSync(path.join(linked.absolutePath, "real.md"), "# Elsewhere\n");
  symlinkSync("real.md", linked.instructionPath);
  await expectRecompositionError(
    () => recomposeWakeflowExternalInstruction(linked.root, request(null, desired)),
    "source-invalid",
    "$source",
  );
  await expectInspectionError(
    () => inspectWakeflowExternalInstruction(linked.root, request(null, desired)),
    "source-policy",
    "$source",
  );

  const directory = await fixture(t);
  mkdirSync(directory.instructionPath);
  await expectRecompositionError(
    () => recomposeWakeflowExternalInstruction(directory.root, request(null, desired)),
    "source-invalid",
    "$source",
  );

  const plain = await fixture(t);
  await expectRecompositionError(
    () => recomposeWakeflowExternalInstruction(
      plain.root,
      request(null, parseWakeflowConfig(createMinimalWakeflowConfig())),
    ),
    "input",
    "$request.target",
  );
  const controller = new AbortController();
  controller.abort();
  await expectRecompositionError(
    () => recomposeWakeflowExternalInstruction(
      plain.root,
      request(null, desired),
      { signal: controller.signal },
    ),
    "aborted",
    "$signal",
  );
  equal(existsSync(plain.instructionPath), false);

  const surface = await recomposeWakeflowExternalInstruction(
    plain.root,
    request(null, desired, EXTERNAL_DESIGN_SURFACE_TARGET),
  );
  equal(surface.disposition, "created");
  equal(
    readFileSync(plain.instructionPath, "utf8").includes(
      "## Wakeflow Design Support Instructions",
    ),
    true,
  );
});
