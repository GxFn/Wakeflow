import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { canonicalJsonDigest } from "../core/scripts/lib/wakeflow-canonical-json.mjs";
import {
  executeClaudePodMaterialization,
  normalizeClaudePodCreationObservation,
  planClaudePodMaterializationOperation,
} from "../plugins/claude-code-wakeflow/scripts/lib/wakeflow-claude-pod-host.mjs";

function candidatePlan({ mode = "host-create", role = "product", root }) {
  const canonicalRoot = realpathSync.native(root);
  const launchOperationId = "pod-launch_77000000-0000-4000-8000-000000000001";
  const unsigned = {
    kind: "WakeflowPodWindowMaterializationPlan",
    schemaVersion: 1,
    mode,
    programId: "program_11111111-1111-4111-8111-111111111111",
    demandId: "demand_22000000-0000-4000-8000-000000000001",
    hostId: "claude-code",
    podId: "pod_33000000-0000-4000-8000-000000000001",
    windowId: "window_55000000-0000-4000-8000-000000000001",
    bindingId: "binding_66000000-0000-4000-8000-000000000001",
    configDigest: `sha256:${"1".repeat(64)}`,
    state: { revision: 2, digest: `sha256:${"2".repeat(64)}` },
    launchIntent: {
      ref: `.wakeflow-local/runtime/hosts/claude-code/evidence/pods/`
        + `pod_33000000-0000-4000-8000-000000000001/launch-intents/${launchOperationId}.json`,
      digest: `sha256:${"3".repeat(64)}`,
    },
    materialization: { status: mode === "host-recovery" ? "pending" : "creating" },
    operation: {
      role,
      environmentIntent: role === "product" ? "host-worktree" : "host-local",
      launchOperationId,
      correlationId: launchOperationId,
      stateRootRef: ".wakeflow-active/current/demand_22000000-0000-4000-8000-000000000001",
      ...(role === "product"
        ? {
            repositoryId: "repository_22222222-2222-4222-8222-222222222222",
            repositoryRoot: canonicalRoot,
            repositorySourceDigest: `sha256:${"4".repeat(64)}`,
            expectedBaseHead: "0123456789abcdef0123456789abcdef01234567",
            hostResourceKey: "wakeflow-pod-product-a",
          }
        : { controlRoot: canonicalRoot }),
    },
    requiresHostOperationFence: true,
    hostCreateAllowed: mode === "host-create",
    recoveryOnly: mode !== "host-create",
  };
  return { ...unsigned, planDigest: canonicalJsonDigest(unsigned) };
}

test("Claude candidate operation consumes an exact v3 plan without writing host or local state", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "wakeflow-claude-pod-candidate-"));
  const repository = path.join(root, "RepoA");
  mkdirSync(repository);
  const before = readdirSync(root).sort();
  const plan = candidatePlan({ root: repository });
  const operation = planClaudePodMaterializationOperation(plan);
  assert.equal(operation.mode, "host-create");
  assert.equal(operation.search.beforeCreate, true);
  assert.deepEqual(operation.create.environment, {
    type: "host-worktree",
    repositoryRoot: plan.operation.repositoryRoot,
    expectedBaseHead: plan.operation.expectedBaseHead,
    hostResourceKey: "wakeflow-pod-product-a",
  });
  assert.match(operation.create.prompt, new RegExp(plan.operation.correlationId));
  assert.equal(Object.isFrozen(operation.create.environment), true);
  assert.deepEqual(readdirSync(root).sort(), before);

  const controlPlan = candidatePlan({ role: "controller", root });
  assert.deepEqual(planClaudePodMaterializationOperation(controlPlan).create.environment, {
    type: "host-local",
    cwd: controlPlan.operation.controlRoot,
  });
  assert.throws(
    () => planClaudePodMaterializationOperation({ ...plan, bindingId: "tampered" }),
    (error) => error?.code === "invalid-materialization-plan",
  );

  const { planDigest: _planDigest, ...missingHeadUnsigned } = plan;
  missingHeadUnsigned.operation = { ...missingHeadUnsigned.operation };
  delete missingHeadUnsigned.operation.expectedBaseHead;
  const missingHead = {
    ...missingHeadUnsigned,
    planDigest: canonicalJsonDigest(missingHeadUnsigned),
  };
  assert.throws(
    () => planClaudePodMaterializationOperation(missingHead),
    (error) => error?.code === "invalid-materialization-plan",
  );
});

test("Claude candidate executor searches first, then performs one synchronous create", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "wakeflow-claude-pod-create-"));
  const plan = candidatePlan({ root });
  const calls = [];
  const result = executeClaudePodMaterialization(plan, {
    inspectExisting(search) {
      calls.push(["inspect", search.correlationId]);
      return { sessions: [] };
    },
    create(request) {
      calls.push(["create", request.environment.type]);
      return {
        sessionId: "11111111-1111-4111-8111-111111111111",
        actualCwd: root,
        correlationId: plan.operation.correlationId,
        hostCreatedAt: "2026-08-09T03:10:00.000Z",
      };
    },
  });
  assert.deepEqual(calls, [
    ["inspect", plan.operation.correlationId],
    ["create", "host-worktree"],
  ]);
  assert.deepEqual(result, {
    status: "finalized",
    handle: {
      kind: "claude-session",
      value: "11111111-1111-4111-8111-111111111111",
    },
    observation: {
      actualCwd: realpathSync.native(root),
      hostCreatedAt: "2026-08-09T03:10:00.000Z",
    },
    recovered: false,
  });
});

test("Claude candidate recovery reuses one exact session and never invokes create", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "wakeflow-claude-pod-recovery-"));
  const plan = candidatePlan({ mode: "host-recovery", root });
  let createCalls = 0;
  const result = executeClaudePodMaterialization(plan, {
    inspectExisting() {
      return {
        sessions: [
          {
            sessionId: "22222222-2222-4222-8222-222222222222",
            actualCwd: root,
            correlationId: "unrelated",
          },
          {
            sessionId: "33333333-3333-4333-8333-333333333333",
            actualCwd: root,
            correlationId: plan.operation.correlationId,
          },
        ],
      };
    },
    create() {
      createCalls += 1;
    },
  });
  assert.equal(result.recovered, true);
  assert.equal(result.handle.value, "33333333-3333-4333-8333-333333333333");
  assert.equal(createCalls, 0);

  assert.throws(
    () => executeClaudePodMaterialization(plan, {
      inspectExisting: () => ({ sessions: [] }),
      create: () => { createCalls += 1; },
    }),
    (error) => error?.code === "recovery-not-found",
  );
  assert.equal(createCalls, 0);
});

test("Claude candidate executor rejects duplicate recovery and asynchronous physical adapters", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "wakeflow-claude-pod-adapter-"));
  const plan = candidatePlan({ root });
  const session = {
    sessionId: "44444444-4444-4444-8444-444444444444",
    actualCwd: root,
    correlationId: plan.operation.correlationId,
  };
  assert.throws(
    () => executeClaudePodMaterialization(plan, {
      inspectExisting: () => ({ sessions: [session, { ...session, sessionId: "55555555-5555-4555-8555-555555555555" }] }),
      create: () => session,
    }),
    (error) => error?.code === "recovery-not-unique",
  );
  assert.throws(
    () => executeClaudePodMaterialization(plan, {
      inspectExisting: async () => ({ sessions: [] }),
      create: () => session,
    }),
    (error) => error?.code === "async-host-adapter-forbidden",
  );
  assert.throws(
    () => normalizeClaudePodCreationObservation(plan, {
      ...session,
      correlationId: "wrong-correlation",
    }),
    (error) => error?.code === "invalid-host-observation",
  );
});

test("Claude Pod host rejects behavioral plans, adapter slots, and observations without execution", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "wakeflow-claude-pod-passive-"));
  const plan = candidatePlan({ root });
  let planKindReads = 0;
  const behavioralPlan = { ...plan };
  Object.defineProperty(behavioralPlan, "kind", {
    enumerable: true,
    configurable: true,
    get() {
      planKindReads += 1;
      return plan.kind;
    },
  });
  assert.throws(
    () => planClaudePodMaterializationOperation(behavioralPlan),
    (error) => error?.code === "invalid-materialization-plan",
  );
  assert.equal(planKindReads, 0);

  let adapterReads = 0;
  const adapters = {
    create() {
      throw new Error("create must not run");
    },
  };
  Object.defineProperty(adapters, "inspectExisting", {
    enumerable: true,
    configurable: true,
    get() {
      adapterReads += 1;
      return () => ({ sessions: [] });
    },
  });
  assert.throws(
    () => executeClaudePodMaterialization(plan, adapters),
    (error) => error?.code === "invalid-host-adapter",
  );
  assert.equal(adapterReads, 0);

  let sessionIdReads = 0;
  const session = {
    actualCwd: root,
    correlationId: plan.operation.correlationId,
  };
  Object.defineProperty(session, "sessionId", {
    enumerable: true,
    configurable: true,
    get() {
      sessionIdReads += 1;
      return "11111111-1111-4111-8111-111111111111";
    },
  });
  assert.throws(
    () => executeClaudePodMaterialization(plan, {
      inspectExisting: () => ({ sessions: [session] }),
      create: () => session,
    }),
    (error) => error?.code === "invalid-host-observation",
  );
  assert.equal(sessionIdReads, 0);
});
