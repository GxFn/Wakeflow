import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { canonicalJsonDigest } from "../core/scripts/lib/wakeflow-canonical-json.mjs";
import {
  createWakeflowConfigV3OwnerMutationParticipant,
  planWakeflowConfigV3FreshOwner,
} from "../core/scripts/lib/wakeflow-config-v3-owner.mjs";
import {
  assertWakeflowConfigV3TransitionAuthority,
  createWakeflowMigrationConfigTransitionScope,
  withWakeflowMigrationConfigTransitionScope,
} from "../core/scripts/lib/wakeflow-config-v3-transition-authority.mjs";
import {
  parseWakeflowConfigV3,
  serializeWakeflowConfigV3,
  wakeflowConfigV3Digest,
} from "../core/scripts/lib/wakeflow-config-v3.mjs";
import { runWakeflowMaintenanceMutation } from "../core/scripts/lib/wakeflow-workspace-mutation.mjs";

const REPOSITORY_ROOT = path.resolve(import.meta.dirname, "..");
const CONFIG_FIXTURE = path.join(
  REPOSITORY_ROOT,
  "test/fixtures/wakeflow-config-v3/valid-minimal.json",
);
const LEGACY_CONFIG_FIXTURE = path.join(
  REPOSITORY_ROOT,
  "test/fixtures/legacy-origins/codex-0.9.6-70d79d72/static/shared-setup/WakeflowFixture/wakeflow.config.json",
);
const CONFIG_REF = "wakeflow.config.json";
const V3_CONFIG_LIMIT = 1024 * 1024;
const LEGACY_CLASSIFIER_LIMIT = 8 * 1024 * 1024;

function desiredModel() {
  return parseWakeflowConfigV3(JSON.parse(readFileSync(CONFIG_FIXTURE, "utf8")));
}

function workspace(t, prefix = "wakeflow-config-transition-") {
  const base = realpathSync(mkdtempSync(path.join(os.tmpdir(), prefix)));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const workspaceRoot = path.join(base, "WakeflowProgram");
  mkdirSync(workspaceRoot, { mode: 0o755 });
  return workspaceRoot;
}

function writeExactFile(file, bytes) {
  writeFileSync(file, bytes, { mode: 0o644 });
  chmodSync(file, 0o644);
}

function writeModel(workspaceRoot, model) {
  writeExactFile(
    path.join(workspaceRoot, CONFIG_REF),
    Buffer.from(serializeWakeflowConfigV3(model), "utf8"),
  );
}

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function paddedLegacyConfig(byteLength) {
  const source = readFileSync(LEGACY_CONFIG_FIXTURE);
  assert.ok(source.length <= byteLength);
  return Buffer.concat([source, Buffer.alloc(byteLength - source.length, 0x20)]);
}

function assertTransitionFailure(operation, expectedCode) {
  assert.throws(operation, (error) => (
    error?.name === "WakeflowConfigV3TransitionAuthorityError"
    && error.code === expectedCode
  ));
}

test("transition authority distinguishes strict source/desired endpoints from fresh absence", (t) => {
  const workspaceRoot = workspace(t);
  const desired = desiredModel();
  const sourceCandidate = structuredClone(desired);
  sourceCandidate.program.description = `${sourceCandidate.program.description} source`;
  const source = parseWakeflowConfigV3(sourceCandidate);

  writeModel(workspaceRoot, source);
  const fromSource = assertWakeflowConfigV3TransitionAuthority({
    workspaceRoot,
    action: "reconfigure",
    sourceModel: source,
    desiredModel: desired,
    context: null,
  });
  assert.deepEqual(fromSource, {
    status: "strict",
    configDigest: wakeflowConfigV3Digest(source),
  });

  writeModel(workspaceRoot, desired);
  const atDesired = assertWakeflowConfigV3TransitionAuthority({
    workspaceRoot,
    action: "reconfigure",
    sourceModel: source,
    desiredModel: desired,
    context: null,
  });
  assert.deepEqual(atDesired, {
    status: "strict",
    configDigest: wakeflowConfigV3Digest(desired),
  });

  const emptyRoot = workspace(t, "wakeflow-config-transition-absent-");
  assert.deepEqual(assertWakeflowConfigV3TransitionAuthority({
    workspaceRoot: emptyRoot,
    action: "fresh-initialize",
    sourceModel: null,
    desiredModel: desired,
    context: null,
  }), { status: "absent", configDigest: null });
  assertTransitionFailure(
    () => assertWakeflowConfigV3TransitionAuthority({
      workspaceRoot: emptyRoot,
      action: "reconcile",
      sourceModel: desired,
      desiredModel: desired,
      context: null,
    }),
    "wakeflow-config-v3-transition-source",
  );
});

test("issued migration scope admits the classifier-sized legacy source only while dynamically active", (t) => {
  const workspaceRoot = workspace(t, "wakeflow-config-transition-migration-");
  const desired = desiredModel();
  const sourceBytes = paddedLegacyConfig(V3_CONFIG_LIMIT + 1);
  writeExactFile(path.join(workspaceRoot, CONFIG_REF), sourceBytes);
  const scope = createWakeflowMigrationConfigTransitionScope({
    workspaceRoot,
    sourceDigest: sha256(sourceBytes),
    desiredModel: desired,
  });
  const input = {
    workspaceRoot,
    action: "fresh-initialize",
    sourceModel: null,
    desiredModel: desired,
    context: null,
  };

  assert.equal(Object.isFrozen(scope), true);
  assertTransitionFailure(
    () => assertWakeflowConfigV3TransitionAuthority(input),
    "wakeflow-config-v3-transition-source",
  );
  assert.deepEqual(
    withWakeflowMigrationConfigTransitionScope(
      scope,
      () => assertWakeflowConfigV3TransitionAuthority(input),
    ),
    {
      status: "migration-config-source",
      configDigest: wakeflowConfigV3Digest(desired),
    },
  );
  assertTransitionFailure(
    () => assertWakeflowConfigV3TransitionAuthority(input),
    "wakeflow-config-v3-transition-source",
  );
  assertTransitionFailure(
    () => withWakeflowMigrationConfigTransitionScope(structuredClone(scope), () => {}),
    "wakeflow-config-v3-transition-context",
  );

  const otherRoot = workspace(t, "wakeflow-config-transition-other-scope-");
  const otherBytes = paddedLegacyConfig(V3_CONFIG_LIMIT + 2);
  writeExactFile(path.join(otherRoot, CONFIG_REF), otherBytes);
  const otherScope = createWakeflowMigrationConfigTransitionScope({
    workspaceRoot: otherRoot,
    sourceDigest: sha256(otherBytes),
    desiredModel: desired,
  });
  withWakeflowMigrationConfigTransitionScope(scope, () => {
    assertTransitionFailure(
      () => withWakeflowMigrationConfigTransitionScope(otherScope, () => {}),
      "wakeflow-config-v3-transition-context",
    );
  });
});

test("migration transition source remains bounded by the legacy classifier limit", (t) => {
  const workspaceRoot = workspace(t, "wakeflow-config-transition-limit-");
  const desired = desiredModel();
  const sourceBytes = paddedLegacyConfig(LEGACY_CLASSIFIER_LIMIT + 1);
  writeExactFile(path.join(workspaceRoot, CONFIG_REF), sourceBytes);
  const scope = createWakeflowMigrationConfigTransitionScope({
    workspaceRoot,
    sourceDigest: sha256(sourceBytes),
    desiredModel: desired,
  });

  assertTransitionFailure(
    () => withWakeflowMigrationConfigTransitionScope(
      scope,
      () => assertWakeflowConfigV3TransitionAuthority({
        workspaceRoot,
        action: "fresh-initialize",
        sourceModel: null,
        desiredModel: desired,
        context: null,
      }),
    ),
    "wakeflow-config-v3-transition-source",
  );
});

test("fresh committed pair is admitted only inside the exact M3 terminal boundary", async (t) => {
  const workspaceRoot = workspace(t, "wakeflow-config-transition-pair-");
  const desired = desiredModel();
  const confirmedPlan = planWakeflowConfigV3FreshOwner({ workspaceRoot, model: desired });
  const owner = createWakeflowConfigV3OwnerMutationParticipant({
    workspaceRoot,
    model: desired,
    confirmedPlan,
  });
  let transition = null;
  const participant = Object.freeze({
    validatePlan: owner.validatePlan,
    deriveCurrentPlan: owner.deriveCurrentPlan,
    stepHandlers: owner.stepHandlers,
    deriveTerminalClosure(value) {
      const current = assertWakeflowConfigV3TransitionAuthority({
        workspaceRoot,
        action: "fresh-initialize",
        sourceModel: null,
        desiredModel: desired,
        context: value.context,
      });
      // M3 会在cleanup前后各重验一次terminal closure：前一次必须识别
      // committed pair，后一次已经回到普通single-link strict状态。
      if (current.status === "fresh-committed-pair") {
        assertTransitionFailure(
          () => assertWakeflowConfigV3TransitionAuthority({
            workspaceRoot,
            action: "fresh-initialize",
            sourceModel: null,
            desiredModel: desired,
            context: null,
          }),
          "wakeflow-config-v3-transition-source",
        );
        transition = current;
      }
      return owner.deriveTerminalClosure(value);
    },
  });

  const result = await runWakeflowMaintenanceMutation({
    workspaceRoot,
    action: "fresh-initialize",
    operationKind: "config-transition-authority-test",
    domainOwner: "config-transition-authority-test",
    confirmedPlan,
    planDigest: canonicalJsonDigest(confirmedPlan),
    validatePlan: participant.validatePlan,
    deriveCurrentPlan: participant.deriveCurrentPlan,
    deriveTerminalClosure: participant.deriveTerminalClosure,
    stepHandlers: participant.stepHandlers,
  });
  assert.equal(result.status, "completed");
  assert.deepEqual(transition, {
    status: "fresh-committed-pair",
    configDigest: wakeflowConfigV3Digest(desired),
  });
  assert.equal(lstatSync(path.join(workspaceRoot, CONFIG_REF)).nlink, 1);
  assert.equal(existsSync(path.join(workspaceRoot, confirmedPlan.payload.stageRef)), false);
});
