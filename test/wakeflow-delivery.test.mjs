#!/usr/bin/env node

import assert from "node:assert/strict";
import { runSync } from "../plugins/codex-wakeflow/lib/wakeflow-process.mjs";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildControllerCallbackPlan,
  controllerReturnDuplicateScopeText,
  controllerReturnDuplicateSelector,
  controllerReturnReadinessIssue,
  returnPolicyReviewScope,
} from "../plugins/codex-wakeflow/scripts/lib/wakeflow-return-policy.mjs";
import {
  buildControllerReturnEnvelope,
  formatControllerReturnPrompt,
} from "../plugins/codex-wakeflow/scripts/lib/wakeflow-controller-return.mjs";
import {
  buildRuntimeResumePlan,
  deriveRuntimeGroupStatus,
  summarizeRuntimeNextAction,
} from "../plugins/codex-wakeflow/scripts/lib/wakeflow-runtime-summary.mjs";
import { buildControllerReviewPack } from "../plugins/codex-wakeflow/scripts/lib/wakeflow-review-pack.mjs";
import {
  buildWindowDispatchConfig,
  createThreadRegistration,
  normalizeThreadRegistrationRecord,
} from "../plugins/codex-wakeflow/scripts/lib/wakeflow-thread-registry.mjs";

const workspaceRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../plugins/codex-wakeflow");
const script = path.join(workspaceRoot, "scripts/wakeflow-delivery.mjs");
const stateScript = path.join(workspaceRoot, "scripts/wakeflow-state.mjs");

function writeText(file, content) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${content.trimEnd()}\n`);
}

function writeJson(file, value) {
  writeText(file, JSON.stringify(value, null, 2));
}

function makeFixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "codex-loop-state-only-"));
  writeJson(path.join(root, "workspace.config.json"), {
    workspaceName: "Wakeflow",
    controllerWindow: "AlembicWorkspace",
    repositories: [
      { windowName: "AlembicWorkspace", path: ".", role: "controller" },
      { windowName: "AlembicPlugin", path: "../AlembicPlugin", role: "plugin" },
    ],
    dispatchWindows: ["AlembicWorkspace", "AlembicPlugin"],
  });
  const stateRoot = path.join(root, ".wakeflow-active/current/CSMR-FIXTURE");
  mkdirSync(path.join(stateRoot, "task-packages"), { recursive: true });
  mkdirSync(path.join(stateRoot, "target-results"), { recursive: true });
  writeJson(path.join(stateRoot, "wakeflow-state.json"), {
    schemaVersion: 1,
    demandKey: "CSMR-FIXTURE",
    title: "Controller State Fixture",
    state: "planned",
    stateReason: "test",
    revision: 3,
    activeStageId: null,
    updatedAt: "2026-06-05T00:00:00.000Z",
    allowedActions: [],
    blockers: [],
    decisionsRequired: [],
    stages: [],
    taskPackages: [{
      taskPackageId: "CSMR-PKG-1",
      summary: "Fixture package",
      status: "pending",
      createdAt: "2026-06-05T00:00:00.000Z",
    }],
    targetTasks: [{
      targetTaskId: "CSMR-TASK-1",
      taskPackageId: "CSMR-PKG-1",
      targetWindow: "AlembicPlugin",
      summary: "Run fixture target task",
      status: "pending",
      createdAt: "2026-06-05T00:00:00.000Z",
    }],
    windows: [{
      windowName: "AlembicPlugin",
      windowState: "pending",
      taskPackageIds: ["CSMR-PKG-1"],
      targetTaskIds: ["CSMR-TASK-1"],
    }],
    review: {
      status: "none",
      readyResultIds: [],
      blockedResultIds: [],
      missingResultIds: [],
    },
    automation: {
      enabled: false,
      activeRunIds: [],
      lastReviewPack: null,
    },
    projection: {
      status: "synced",
      lastRenderedAt: "2026-06-05T00:00:00.000Z",
      progressDoc: "developer-progress.md",
    },
  });
  writeJson(path.join(stateRoot, "task-packages/CSMR-PKG-1.json"), {
    schemaVersion: 1,
    taskPackageId: "CSMR-PKG-1",
    demandKey: "CSMR-FIXTURE",
    summary: "Fixture package",
    status: "pending",
    targetTasks: [{
      targetTaskId: "CSMR-TASK-1",
      taskPackageId: "CSMR-PKG-1",
      targetWindow: "AlembicPlugin",
      summary: "Run fixture target task",
      status: "pending",
    }],
    createdAt: "2026-06-05T00:00:00.000Z",
  });
  writeText(path.join(stateRoot, "developer-progress.md"), "# Controller State Fixture");
  return {
    root,
    stateRootRef: ".wakeflow-active/current/CSMR-FIXTURE",
    stateRoot,
  };
}

function run(root, args) {
  return runSync(process.execPath, [script, ...args, "--root", root, "--json"], {
    cwd: root,
    encoding: "utf8",
  });
}

function runState(root, args) {
  return runSync(process.execPath, [stateScript, ...args, "--root", root, "--json"], {
    cwd: root,
    encoding: "utf8",
  });
}

function parseOk(result) {
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

test("legacy .workspace-local delivery state-dir redirects to .wakeflow-local", () => {
  const { root } = makeFixture();
  try {
    const legacyStateDir = path.join(root, ".workspace-local/wakeflow-delivery");
    const result = run(root, [
      "keep-live-state",
      "--automation-run-id",
      "legacy-alias",
      "--status",
      "stopped",
      "--state-dir",
      legacyStateDir,
      "--write",
    ]);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const payload = JSON.parse(result.stdout);
    assert.equal(
      payload.stateFile,
      ".wakeflow-local/wakeflow-delivery/hosts/codex/keep-live/state.json",
    );
    assert.match(result.stderr, /redirected legacy state dir/);
    assert.equal(
      existsSync(path.join(root, ".wakeflow-local/wakeflow-delivery/hosts/codex/keep-live/state.json")),
      true,
    );
    assert.equal(existsSync(path.join(root, ".workspace-local")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function registerThread(root, windowName) {
  return parseOk(run(root, [
    "register-thread",
    "--window",
    windowName,
    "--thread-id",
    `0192fac-${windowName}`,
    "--write",
  ]));
}

function prepareDispatch(root, stateRootRef, options = {}) {
  const config = Array.isArray(options) ? { extra: options } : options;
  const group = config.group || "GROUP-STATE";
  const targetTaskId = config.targetTaskId || "CSMR-TASK-1";
  const extra = config.extra || [];
  return parseOk(run(root, [
    "prepare-dispatch-from-state",
    "--state-root",
    stateRootRef,
    "--target-task-id",
    targetTaskId,
    "--group",
    group,
    "--controller-window",
    "AlembicWorkspace",
    "--human-context-ref",
    `${stateRootRef}/developer-progress.md`,
    "--require-thread",
    "--write",
    ...extra,
  ]));
}

test("return policy helpers preserve group-ready and per-target callback semantics", () => {
  const review = {
    group: "group-fixture",
    returnPolicy: { mode: "group-ready" },
    results: [
      {
        packet: { packetId: "packet-a", targetWindow: "WindowA", taskId: "task-a" },
        result: { status: "completed" },
      },
      {
        packet: { packetId: "packet-b", targetWindow: "WindowB", taskId: "task-b" },
        result: null,
      },
    ],
    groupSnapshot: {
      allSentResultsPresent: false,
      ready: [{ packetId: "packet-a", targetWindow: "WindowA", taskId: "task-a" }],
      blocked: [],
      missing: [{ packetId: "packet-b", targetWindow: "WindowB", taskId: "task-b" }],
    },
  };

  assert.equal(returnPolicyReviewScope(review.returnPolicy), "group");
  assert.deepEqual(controllerReturnDuplicateSelector({
    returnPolicy: review.returnPolicy,
    triggerTarget: "WindowA",
    triggerTaskId: "task-a",
  }), {});
  assert.equal(controllerReturnDuplicateScopeText({
    returnPolicy: review.returnPolicy,
    triggerTarget: "WindowA",
    triggerTaskId: "task-a",
  }), "");
  assert.equal(
    controllerReturnReadinessIssue({
      review,
      triggerTarget: "WindowA",
      triggerTaskId: "task-a",
    }).code,
    "group-ready-missing-sent-results",
  );
  const groupPlan = buildControllerCallbackPlan({
    dispatchGroup: "group-fixture",
    returnPolicy: review.returnPolicy,
    groupSnapshot: review.groupSnapshot,
  });
  assert.equal(groupPlan.status, "waiting");
  assert.equal(groupPlan.counts.waitingForSentResultsCount, 1);

  const perTargetReview = {
    ...review,
    returnPolicy: { mode: "per-target" },
  };
  assert.equal(returnPolicyReviewScope(perTargetReview.returnPolicy), "single-target");
  assert.deepEqual(controllerReturnDuplicateSelector({
    returnPolicy: perTargetReview.returnPolicy,
    triggerTarget: "WindowA",
    triggerTaskId: "task-a",
  }), { triggerTarget: "WindowA", triggerTaskId: "task-a" });
  assert.equal(controllerReturnDuplicateScopeText({
    returnPolicy: perTargetReview.returnPolicy,
    triggerTarget: "WindowA",
    triggerTaskId: "task-a",
  }), " for WindowA / task-a");
  assert.equal(controllerReturnReadinessIssue({
    review: perTargetReview,
    triggerTarget: "WindowA",
    triggerTaskId: "task-a",
  }), null);
  const perTargetPlan = buildControllerCallbackPlan({
    dispatchGroup: "group-fixture",
    returnPolicy: perTargetReview.returnPolicy,
    groupSnapshot: perTargetReview.groupSnapshot,
  });
  assert.equal(perTargetPlan.status, "ready-to-build");
  assert.equal(perTargetPlan.counts.readyToBuildCount, 1);
  assert.deepEqual(perTargetPlan.units.map((unit) => unit.triggerTarget), ["WindowA"]);
  assert.equal(
    controllerReturnReadinessIssue({
      review: perTargetReview,
      triggerTarget: "WindowB",
      triggerTaskId: "task-b",
    }).code,
    "trigger-result-missing",
  );
});

test("controller-return builder preserves callback prompt scope and transport guards", () => {
  const stateRef = {
    stateRoot: ".wakeflow-active/current/CSMR-FIXTURE",
  };
  const groupSnapshot = {
    readyTargets: ["WindowA", "WindowB"],
    blockedTargets: ["WindowC"],
    missingTargets: ["WindowD"],
    pendingDispatchTargets: ["WindowE"],
  };

  assert.match(formatControllerReturnPrompt({
    dispatchGroup: "group-fixture",
    triggerTarget: "WindowA",
    triggerTaskId: "task-a",
    stateRef,
    reviewScope: "group",
    groupSnapshot,
  }), /Continue controller review: WindowA, WindowB, WindowC backfill\./);
  assert.match(formatControllerReturnPrompt({
    dispatchGroup: "group-fixture",
    triggerTarget: "WindowA",
    triggerTaskId: "task-a",
    stateRef,
    reviewScope: "single-target",
    groupSnapshot,
  }), /Continue controller review: WindowA backfill\./);

  const envelope = buildControllerReturnEnvelope({
    version: 2,
    deliveryId: "controller-return-group-fixture__windowa__task-a",
    dispatchGroup: "group-fixture",
    controllerWindow: "Controller",
    triggerTarget: "WindowA",
    triggerTaskId: "task-a",
    returnPolicy: { mode: "per-target" },
    groupSnapshot,
    reviewScope: "single-target",
    humanContextRef: "developer-progress.md",
    stateRef,
    registration: {
      windowName: "Controller",
      threadId: "0192fac-controller",
      threadRegistryFile: "thread-registry/Controller.json",
    },
    transportThreadRegistryFile: "thread-registry/Controller.json",
    automationEnabled: true,
    keepLiveStateFile: "keep-live/state.json",
    returnReason: "result-ready",
    reviewDecision: "review",
    groupStatus: "partially-ready",
    windowConfig: { kind: "CodexSubwindowDispatchConfig" },
    wakeflowTrace: { dispatchGroup: "group-fixture" },
    createdAt: "2026-06-10T00:00:00.000Z",
  });
  assert.equal(envelope.kind, "ControllerReturnEnvelope");
  assert.equal(envelope.oneShot, true);
  assert.equal(envelope.targetThread.threadIdRedacted, true);
  assert.equal(Object.hasOwn(envelope.targetThread, "threadId"), false);
  assert.equal(envelope.transport.readbackRequired, true);
  assert.equal(envelope.deliveryCompletion.pendingUntil, "host-send-readback-recorded");
  assert.equal(envelope.loopGuard.controllerReviewRequired, true);
  assert.equal(envelope.automation.keepLiveStateFile, "keep-live/state.json");
});

test("runtime summary helpers separate host-send, review, wait, and dispatch resume plans", () => {
  assert.equal(deriveRuntimeGroupStatus({ "pending-host-send": 1 }), "pending-host-send");
  assert.equal(deriveRuntimeGroupStatus({ completed: 1, missing: 1 }), "partially-ready");
  assert.equal(deriveRuntimeGroupStatus({ missing: 1 }), "waiting");
  assert.equal(deriveRuntimeGroupStatus({ "pending-dispatch": 1 }), "pending-dispatch");

  const diagnostics = { errors: [] };
  assert.equal(summarizeRuntimeNextAction({
    diagnostics,
    deliveryStatuses: [{ kind: "ControllerReturnEnvelope", status: "pending-host-send" }],
    groupSummaries: [],
  }), "send-controller-return");
  assert.equal(summarizeRuntimeNextAction({
    diagnostics,
    deliveryStatuses: [],
    groupSummaries: [{
      groupStatus: "partially-ready",
      callbackPlan: { counts: { readyToBuildCount: 1 } },
    }],
  }), "build-controller-return");
  assert.equal(summarizeRuntimeNextAction({
    diagnostics,
    deliveryStatuses: [{ kind: "DeliveryEnvelope", status: "failed" }],
    groupSummaries: [{ groupStatus: "ready" }],
  }), "inspect-delivery-failures");
  assert.equal(summarizeRuntimeNextAction({
    diagnostics,
    deliveryStatuses: [],
    groupSummaries: [{ groupStatus: "partially-ready" }],
  }), "review-target-results");
  assert.equal(summarizeRuntimeNextAction({
    diagnostics,
    deliveryStatuses: [],
    groupSummaries: [{ groupStatus: "waiting" }],
  }), "wait-for-target-result");
  assert.equal(summarizeRuntimeNextAction({
    diagnostics,
    deliveryStatuses: [],
    groupSummaries: [{ groupStatus: "pending-dispatch" }],
  }), "dispatch-pending-target");

  const hostSendPlan = buildRuntimeResumePlan({
    nextAction: "send-controller-return",
    diagnostics,
    deliveryStatuses: [{
      kind: "ControllerReturnEnvelope",
      status: "pending-host-send",
      file: ".wakeflow-local/wakeflow-delivery/delivery-envelopes/controller-return.json",
      deliveryId: "controller-return-1",
      targetWindow: "Controller",
      taskId: "task-a",
      dispatchGroup: "group-fixture",
      wakeflowTrace: { dispatchGroup: "group-fixture" },
    }],
    groupSummaries: [],
  });
  assert.equal(hostSendPlan.status, "ready");
  assert.equal(hostSendPlan.hostSendRequired, true);
  assert.equal(hostSendPlan.steps[0].kind, "host-send");
  assert.equal(hostSendPlan.steps[0].adapter.kind, "WakeflowHostSendAdapter");
  assert.equal(hostSendPlan.steps[0].adapter.adapterId, "codex-app-thread");
  assert.equal(hostSendPlan.steps[0].adapter.storesThreadIds, false);
  assert.equal(hostSendPlan.steps[1].kind, "record-delivery-run");

  const callbackPlan = buildRuntimeResumePlan({
    nextAction: "build-controller-return",
    diagnostics,
    deliveryStatuses: [],
    groupSummaries: [{
      groupId: "group-fixture",
      groupStatus: "partially-ready",
      stateRoot: ".wakeflow-active/current/CSMR-FIXTURE",
      returnPolicy: { mode: "per-target" },
      callbackPlan: {
        counts: { readyToBuildCount: 1 },
        units: [{
          scope: "target",
          triggerTarget: "WindowA",
          triggerTaskId: "task-a",
          buildAllowed: true,
        }],
      },
    }],
  });
  assert.equal(callbackPlan.status, "ready");
  assert.equal(callbackPlan.steps[0].kind, "prepare-controller-return");
  assert.deepEqual(callbackPlan.steps[0].arguments, {
    direction: "controller-return",
    dispatchGroup: "group-fixture",
    triggerTarget: "WindowA",
    triggerTaskId: "task-a",
  });

  const waitPlan = buildRuntimeResumePlan({
    nextAction: "wait-for-target-result",
    diagnostics,
    deliveryStatuses: [],
    groupSummaries: [{
      groupId: "group-fixture",
      groupStatus: "waiting",
      targets: [{
        status: "missing",
        targetWindow: "WindowA",
        taskId: "task-a",
        deliveryStatus: "sent",
      }],
    }],
  });
  assert.equal(waitPlan.status, "waiting");
  assert.equal(waitPlan.stopRequired, true);
  assert.equal(waitPlan.steps[0].kind, "stop-and-wait");
});

test("thread registry helpers build dispatch config without leaking thread ids", () => {
  const registeredAt = "2026-06-10T00:00:00.000Z";
  const rawRegistration = createThreadRegistration({
    windowName: "WindowA",
    threadId: "0192fac-window-a",
    registeredAt,
  });
  assert.equal(rawRegistration.lastVerifiedAt, registeredAt);

  const registration = normalizeThreadRegistrationRecord({
    windowName: "WindowA",
    registration: rawRegistration,
    threadRegistryFile: "thread-registry/WindowA.json",
  });
  assert.equal(registration.threadId, "0192fac-window-a");
  assert.equal(registration.threadRegistryFile, "thread-registry/WindowA.json");
  assert.throws(() => normalizeThreadRegistrationRecord({
    windowName: "WindowB",
    registration: { kind: "CodexWindowThreadRegistration" },
    threadRegistryFile: "thread-registry/WindowB.json",
  }), /missing threadId/);

  const config = buildWindowDispatchConfig({
    windowName: "WindowA",
    config: {
      controllerWindow: "Controller",
      dispatchWindows: ["WindowA"],
    },
    repository: { path: "../WindowA", role: "plugin" },
    deliveryRole: "target",
    cwd: "../WindowA",
    responsibilityRoot: "../WindowA",
    registration,
    threadRegistryFile: "thread-registry/WindowA.json",
    generatedAt: registeredAt,
  });
  assert.equal(config.dispatchable, true);
  assert.equal(config.threadRegistered, true);
  assert.equal(config.threadRegistryFile, "thread-registry/WindowA.json");
  assert.equal(config.delivery.missingThread, "fail-closed");
  assert.equal(config.result.returnRoute, "controller");
  assert.equal(Object.hasOwn(config, "threadId"), false);

  const unlisted = buildWindowDispatchConfig({
    windowName: "WindowB",
    config: {
      controllerWindow: "Controller",
      dispatchWindows: ["WindowA"],
    },
    repository: { path: "../WindowB", role: "plugin" },
    deliveryRole: "target",
    cwd: "../WindowB",
    responsibilityRoot: "../WindowB",
    registration: null,
    threadRegistryFile: "thread-registry/WindowB.json",
    generatedAt: registeredAt,
  });
  assert.equal(unlisted.dispatchable, false);
});

test("review pack helper preserves evidence repair and pending-dispatch gates", () => {
  const review = {
    group: "group-fixture",
    taskId: "",
    decision: "review",
    returnPolicy: { mode: "group-ready" },
    groupStatus: "partially-ready",
    groupSnapshot: {
      missing: [],
      pendingDispatch: [{ packetId: "packet-b" }],
    },
    blocked: [],
  };
  const pack = buildControllerReviewPack({
    review,
    controllerReturnDelivery: { status: "none" },
    targetResults: [{
      targetWindow: "WindowA",
      taskId: "task-a",
      resultStatus: "completed",
      commits: [],
      evidenceRefs: ["missing-evidence.md"],
      verificationSummary: ["unit passed"],
      hasControllerReviewEvidence: true,
      missingEvidenceRefs: ["missing-evidence.md"],
    }],
    generatedAt: "2026-06-10T00:00:00.000Z",
    wakeflowTrace: { dispatchGroup: "group-fixture" },
  });

  assert.equal(pack.kind, "ControllerReviewPack");
  assert.equal(pack.gates.controllerReviewReady, false);
  assert.equal(pack.gates.evidenceRepairRequired, true);
  assert.equal(pack.gates.pendingDispatchTargetsPresent, true);
  assert.equal(pack.nextAction, "fix-missing-evidence-refs-before-controller-verdict");
  assert.deepEqual(pack.rawEvidenceRequired[0].verificationSummary, ["unit passed"]);
  assert.deepEqual(pack.missingEvidenceRefs, [{
    targetWindow: "WindowA",
    taskId: "task-a",
    ref: "missing-evidence.md",
  }]);
});

// Decoupling: a recorded result must wake the controller even when evidence refs don't resolve.
// controllerReturnNextStep (transport) is independent of evidence; the Iron Law (controller may
// not ACCEPT without resolvable evidence) still holds via gates.controllerReviewReady / nextAction.
test("controller-return transport is decoupled from evidence quality (no break on missing evidence)", () => {
  const review = {
    decision: "ready",
    group: "group-fixture",
    returnPolicy: { mode: "group-ready" },
    groupStatus: "ready",
    groupSnapshot: { missing: [], pendingDispatch: [], ready: [{ packetId: "packet-a" }], blocked: [] },
    blocked: [],
  };
  const pack = buildControllerReviewPack({
    review,
    controllerReturnDelivery: { status: "none" },
    callbackPlan: { status: "ready-to-build", counts: { readyToBuildCount: 1, pendingHostSendCount: 0, sentCount: 0 } },
    targetResults: [{
      targetWindow: "WindowA", taskId: "task-a", resultStatus: "completed", commits: [],
      evidenceRefs: ["only-in-target-repo.json"], verificationSummary: ["unit passed"],
      hasControllerReviewEvidence: true,
      missingEvidenceRefs: ["only-in-target-repo.json"],
    }],
    generatedAt: "2026-06-24T00:00:00.000Z",
    wakeflowTrace: { dispatchGroup: "group-fixture" },
  });
  // Transport: the wake-up fires regardless of the unresolved evidence ref.
  assert.equal(pack.controllerReturnNextStep, "send-controller-return");
  assert.equal(pack.gates.controllerReturnReady, true);
  // Verdict (Iron Law intact): the controller still may not accept without resolvable evidence.
  assert.equal(pack.gates.controllerReviewReady, false);
  assert.equal(pack.nextAction, "fix-missing-evidence-refs-before-controller-verdict");
});

// Regression: a target reports evidence relative to ITS OWN repo (where the work + commit
// happened). Resolving evidence refs only against the workspace root false-flagged that
// evidence as "missing", flipping nextAction to fix-missing-evidence-refs and stalling the
// controller return / verdict — a real closed-loop break observed in live MCP use.
test("evidence ref relative to a target window's repo resolves, not false-missing (closed-loop break fix)", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "wakeflow-evidence-repo-"));
  writeJson(path.join(root, "workspace.config.json"), {
    workspaceName: "Wakeflow",
    controllerWindow: "AlembicWorkspace",
    repositories: [
      { windowName: "AlembicWorkspace", path: ".", role: "controller" },
      { windowName: "PluginWin", path: "PluginRepo", role: "plugin" },
    ],
    dispatchWindows: ["AlembicWorkspace", "PluginWin"],
  });
  // Evidence exists ONLY under the producing window's repo, NOT at the workspace root.
  writeText(path.join(root, "PluginRepo/test/cold-start/evidence.json"), "{}");
  const stateRoot = path.join(root, ".wakeflow-active/current/EV-FIXTURE");
  mkdirSync(path.join(stateRoot, "target-results"), { recursive: true });
  writeJson(path.join(stateRoot, "wakeflow-state.json"), {
    schemaVersion: 1, demandKey: "EV-FIXTURE", title: "Evidence Fixture",
    state: "dispatched", stateReason: "test", revision: 4, activeStageId: null,
    updatedAt: "2026-06-24T00:00:00.000Z", allowedActions: [], blockers: [],
    decisionsRequired: [], stages: [],
    taskPackages: [{ taskPackageId: "EV-PKG-1", summary: "pkg", status: "sent", createdAt: "2026-06-24T00:00:00.000Z" }],
    targetTasks: [{
      targetTaskId: "EV-T1", taskPackageId: "EV-PKG-1", targetWindow: "PluginWin",
      summary: "task", status: "sent", createdAt: "2026-06-24T00:00:00.000Z",
      delivery: { deliveryId: "d-ev", dispatchGroup: "EV-PKG-1" },
    }],
    windows: [{ windowName: "PluginWin", windowState: "active", taskPackageIds: ["EV-PKG-1"], targetTaskIds: ["EV-T1"] }],
    review: { status: "none", readyResultIds: [], blockedResultIds: [], missingResultIds: [] },
    automation: { enabled: false, activeRunIds: [], lastReviewPack: null },
    projection: { status: "synced", lastRenderedAt: "2026-06-24T00:00:00.000Z", progressDoc: "developer-progress.md" },
  });
  writeJson(path.join(stateRoot, "target-results/tr-EV-T1.json"), {
    schemaVersion: 1, resultId: "tr-EV-T1", demandKey: "EV-FIXTURE", taskPackageId: "EV-PKG-1",
    dispatchGroup: "EV-PKG-1", stateRoot: ".wakeflow-active/current/EV-FIXTURE",
    targetWindow: "PluginWin", targetTaskId: "EV-T1", status: "completed", summary: "done",
    evidenceRefs: ["test/cold-start/evidence.json", "test/cold-start/missing.json"],
    createdAt: "2026-06-24T00:10:00.000Z",
  });
  writeText(path.join(stateRoot, "developer-progress.md"), "# Evidence Fixture");
  const parsed = parseOk(run(root, ["review-pack", "--state-root", ".wakeflow-active/current/EV-FIXTURE"]));
  const pack = parsed.reviewPack || parsed;
  const missing = (pack.missingEvidenceRefs || []).map((m) => m.ref ?? m);
  assert.ok(!missing.includes("test/cold-start/evidence.json"),
    "evidence relative to the target window's repo must resolve, not be flagged missing");
  assert.ok(missing.includes("test/cold-start/missing.json"),
    "a genuinely-absent evidence ref must still be flagged missing");
});

test("help exposes state-root commands and rejects old dispatch routes", () => {
  const { root } = makeFixture();
  const help = runSync(process.execPath, [script, "--help", "--root", root], { cwd: root, encoding: "utf8" });
  assert.equal(help.status, 0, help.stderr || help.stdout);
  assert.match(help.stdout, /prepare-dispatch-from-state/);
  assert.match(help.stdout, /trace-spine/);
  assert.doesNotMatch(help.stdout, /create-dispatch/);
  assert.doesNotMatch(help.stdout, /prepare-dispatch --target-window/);
  assert.doesNotMatch(help.stdout, /--control-plan/);

  for (const command of ["create-dispatch", "prepare-dispatch"]) {
    const result = run(root, [command, "--write"]);
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /Unknown command/);
  }
});

test("registers threads locally and redacts thread ids", () => {
  const { root } = makeFixture();
  const payload = registerThread(root, "AlembicPlugin");
  assert.equal(payload.ok, true);
  assert.equal(payload.windowName, "AlembicPlugin");
  assert.equal(payload.threadIdRedacted, true);
  assert.equal(Object.hasOwn(payload, "deliveryRole"), false);
  assert.doesNotMatch(JSON.stringify(payload), /0192fac-AlembicPlugin/);
  const registry = JSON.parse(readFileSync(path.join(root, ".wakeflow-local/wakeflow-delivery/hosts/codex/thread-registry/AlembicPlugin.json"), "utf8"));
  assert.equal(registry.threadId, "0192fac-AlembicPlugin");
  assert.equal(Object.hasOwn(registry, "deliveryRole"), false);
  assert.equal(Object.hasOwn(registry, "cwd"), false);
  assert.equal(Object.hasOwn(registry, "responsibilityRoot"), false);
  assert.equal(Object.hasOwn(registry, "displayTitle"), false);

  const config = parseOk(run(root, ["build-window-config", "--window", "AlembicPlugin", "--require-thread", "--write"]));
  assert.equal(config.config.threadRegistered, true);
  assert.equal(config.config.dispatchable, true);
  assert.equal(config.config.deliveryRole, "target");
  assert.equal(config.config.cwd, "../AlembicPlugin");
  assert.equal(config.config.responsibilityRoot, "../AlembicPlugin");
  assert.equal(config.config.delivery.transport, "direct-thread");
});

test("reads legacy pre-dual-host thread registrations through the fallback path", () => {
  const { root } = makeFixture();
  writeJson(path.join(root, ".wakeflow-local/wakeflow-delivery/thread-registry/AlembicPlugin.json"), {
    kind: "CodexWindowThreadRegistration",
    version: 2,
    windowName: "AlembicPlugin",
    threadId: "0192fac-AlembicPlugin",
    registeredAt: "2026-01-01T00:00:00.000Z",
    lastVerifiedAt: "2026-01-01T00:00:00.000Z",
  });

  const config = parseOk(run(root, ["build-window-config", "--window", "AlembicPlugin", "--require-thread", "--write"]));
  assert.equal(config.config.threadRegistered, true);
  assert.match(config.config.threadRegistryFile, /^thread-registry\//);
});

test("rejects obsolete thread registry kinds instead of using fallback metadata", () => {
  const { root } = makeFixture();
  writeJson(path.join(root, ".wakeflow-local/wakeflow-delivery/hosts/codex/thread-registry/AlembicPlugin.json"), {
    kind: "CodexAutomationThreadRegistration",
    version: 1,
    windowName: "AlembicPlugin",
    threadId: "0192fac-AlembicPlugin",
  });

  const result = run(root, ["build-window-config", "--window", "AlembicPlugin", "--require-thread"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr || result.stdout, /Invalid thread registration/);
});

test("prepare-dispatch-from-state writes packet, group, and delivery without legacy controlPlan authority", () => {
  const { root, stateRootRef } = makeFixture();
  registerThread(root, "AlembicPlugin");
  const payload = prepareDispatch(root, stateRootRef);

  assert.equal(payload.ok, true);
  assert.equal(payload.command, "prepare-dispatch-from-state");
  assert.equal(payload.packet.controlPlan, undefined);
  assert.equal(payload.dispatchGroup.controlPlan, undefined);
  assert.equal(payload.envelope.controlPlan, undefined);
  assert.equal(payload.packet.stateRef.stateRoot, stateRootRef);
  assert.equal(payload.packet.stateRef.taskPackageId, "CSMR-PKG-1");
  assert.equal(payload.packet.stateRef.stateRevision, 3);
  assert.equal(payload.dispatchGroup.stateRef.stateRoot, stateRootRef);
  assert.equal(payload.envelope.stateRef.targetTaskId, "CSMR-TASK-1");
  assert.equal(payload.packet.wakeflowTrace.artifactKind, "dispatch-packet");
  assert.equal(payload.packet.wakeflowTrace.stateRoot, stateRootRef);
  assert.equal(payload.packet.wakeflowTrace.taskPackageId, "CSMR-PKG-1");
  assert.equal(payload.packet.wakeflowTrace.targetTaskId, "CSMR-TASK-1");
  assert.equal(payload.dispatchGroup.wakeflowTrace.artifactKind, "dispatch-group");
  assert.equal(payload.envelope.wakeflowTrace.artifactKind, "delivery-envelope");
  assert.equal(payload.envelope.wakeflowTrace.deliveryId, payload.envelope.deliveryId);
  const status = parseOk(run(root, ["status"]));
  assert.equal(status.runtimeSummary.kind, "WakeflowClosedLoopRuntimeSummary");
  assert.equal(status.runtimeSummary.nextAction, "send-target-delivery");
  assert.equal(status.runtimeSummary.health.kind, "WakeflowRuntimeHealth");
  assert.equal(status.runtimeSummary.health.status, "attention");
  assert.equal(status.runtimeSummary.health.checks.hostSend.pendingCount, 1);
  assert.equal(status.runtimeSummary.health.checks.projection.stateRootCount, 1);
  assert.equal(status.runtimeSummary.health.checks.projection.staleCount, 0);
  assert.equal(status.runtimeSummary.deliveries.counts["pending-host-send"], 1);
  assert.equal(status.runtimeSummary.groups.items[0].groupStatus, "pending-host-send");
  assert.equal(status.runtimeSummary.resumePlan.kind, "WakeflowRuntimeResumePlan");
  assert.equal(status.runtimeSummary.resumePlan.hostSendRequired, true);
  assert.equal(status.runtimeSummary.resumePlan.steps[0].kind, "host-send");
  assert.equal(status.runtimeSummary.resumePlan.steps[0].adapter.adapterId, "codex-app-thread");
  assert.equal(status.runtimeSummary.resumePlan.steps[0].adapter.inputAuthority, "delivery-envelope");
  assert.equal(status.runtimeSummary.resumePlan.steps[0].deliveryFile, payload.deliveryFile);
  assert.equal(status.runtimeSummary.resumePlan.steps[1].tool, "wakeflow_record_delivery");
  assert.match(payload.packet.prompt, /- stateRoot: \.wakeflow-active\/current\/CSMR-FIXTURE/);
  assert.match(payload.packet.prompt, /- dispatchGroup: GROUP-STATE/);
  assert.doesNotMatch(payload.packet.prompt, /humanContextRef:/);
  assert.doesNotMatch(payload.packet.prompt, /stateRevision:/);
  assert.doesNotMatch(payload.packet.prompt, /taskPackageId:/);
  assert.doesNotMatch(payload.packet.prompt, /demandKey:/);
  assert.doesNotMatch(payload.packet.prompt, /controllerWindow:/);
  assert.doesNotMatch(payload.packet.prompt, /rules:/);
  assert.doesNotMatch(payload.packet.prompt, /controlPlan:/);
  assert.doesNotMatch(payload.packet.prompt, /<codex_delegation>|<input>|source_thread_id/);
  assert.equal(payload.envelope.prompt, payload.packet.prompt);
  assert.doesNotMatch(readFileSync(path.join(root, payload.packetFile), "utf8"), /controlPlan/);
  assert.doesNotMatch(readFileSync(path.join(root, payload.deliveryFile), "utf8"), /controlPlan/);
  assert.doesNotMatch(readFileSync(path.join(root, payload.deliveryFile), "utf8"), /0192fac-AlembicPlugin/);
  assert.equal(
    payload.packet.idempotency.key,
    "dispatch-packet:.wakeflow-active/current/CSMR-FIXTURE:CSMR-PKG-1:CSMR-TASK-1:3:GROUP-STATE:AlembicPlugin",
  );

  const replayed = prepareDispatch(root, stateRootRef);
  assert.equal(replayed.duplicate, true);
  assert.equal(replayed.idempotentReplay, true);
  assert.equal(replayed.wrote, false);
  assert.equal(replayed.packet.createdAt, payload.packet.createdAt);
  assert.equal(replayed.envelope.createdAt, payload.envelope.createdAt);

  rmSync(path.join(root, payload.dispatchGroupFile));
  const repaired = prepareDispatch(root, stateRootRef);
  assert.equal(repaired.duplicate, true);
  assert.equal(repaired.idempotentReplay, true);
  assert.equal(repaired.wrote, true);
  assert.deepEqual(repaired.repairedArtifacts, ["dispatch-group"]);
  assert.equal(existsSync(path.join(root, payload.dispatchGroupFile)), true);

  const stateFile = path.join(root, stateRootRef, "wakeflow-state.json");
  const staleState = JSON.parse(readFileSync(stateFile, "utf8"));
  staleState.revision = 4;
  writeJson(stateFile, staleState);
  const staleReplay = run(root, [
    "prepare-dispatch-from-state",
    "--state-root",
    stateRootRef,
    "--target-task-id",
    "CSMR-TASK-1",
    "--group",
    "GROUP-STATE",
    "--controller-window",
    "AlembicWorkspace",
    "--human-context-ref",
    `${stateRootRef}/developer-progress.md`,
    "--require-thread",
    "--write",
  ]);
  assert.notEqual(staleReplay.status, 0);
  assert.match(staleReplay.stdout, /prepared from state revision 3; current revision is 4/);
});

test("prepare-dispatch-from-state rejects completed and accepted state-root tasks", () => {
  const { root, stateRootRef, stateRoot } = makeFixture();
  const stateFile = path.join(stateRoot, "wakeflow-state.json");
  const state = JSON.parse(readFileSync(stateFile, "utf8"));
  state.state = "completed";
  state.review.status = "demand-completed";
  state.taskPackages[0].status = "accepted";
  state.targetTasks[0].status = "accepted";
  writeJson(stateFile, state);

  const completed = run(root, [
    "prepare-dispatch-from-state",
    "--state-root",
    stateRootRef,
    "--target-task-id",
    "CSMR-TASK-1",
    "--group",
    "GROUP-STATE",
    "--controller-window",
    "AlembicWorkspace",
    "--write",
  ]);
  assert.notEqual(completed.status, 0);
  assert.match(completed.stdout, /cannot prepare dispatch while controller state is completed/);

  state.state = "planned";
  writeJson(stateFile, state);
  const accepted = run(root, [
    "prepare-dispatch-from-state",
    "--state-root",
    stateRootRef,
    "--target-task-id",
    "CSMR-TASK-1",
    "--group",
    "GROUP-STATE",
    "--controller-window",
    "AlembicWorkspace",
    "--write",
  ]);
  assert.notEqual(accepted.status, 0);
  assert.match(accepted.stdout, /target task CSMR-TASK-1 is accepted/);

  state.targetTasks[0].status = "sent";
  writeJson(stateFile, state);
  const sent = run(root, [
    "prepare-dispatch-from-state",
    "--state-root",
    stateRootRef,
    "--target-task-id",
    "CSMR-TASK-1",
    "--group",
    "GROUP-STATE",
    "--controller-window",
    "AlembicWorkspace",
    "--write",
  ]);
  assert.notEqual(sent.status, 0);
  assert.match(sent.stdout, /target task CSMR-TASK-1 is sent/);

  state.state = "blocked";
  state.taskPackages[0].status = "pending";
  state.targetTasks[0].status = "pending";
  writeJson(stateFile, state);
  const blocked = run(root, [
    "prepare-dispatch-from-state",
    "--state-root",
    stateRootRef,
    "--target-task-id",
    "CSMR-TASK-1",
    "--group",
    "GROUP-STATE",
    "--controller-window",
    "AlembicWorkspace",
    "--write",
  ]);
  assert.notEqual(blocked.status, 0);
  assert.match(blocked.stdout, /cannot prepare dispatch while controller state is blocked/);
});

test("build-delivery rejects legacy packets without stateRef", () => {
  const { root } = makeFixture();
  const packetFile = path.join(root, "legacy-packet.json");
  writeJson(packetFile, {
    kind: "ControllerDispatchPacket",
    version: 1,
    id: "legacy-packet",
    targetWindow: "AlembicPlugin",
    taskId: "TASK-LEGACY",
    prompt: "Continue current window task: AlembicPlugin / TASK-LEGACY.",
  });
  const result = run(root, ["build-delivery", "--packet-file", "legacy-packet.json", "--write"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /missing stateRef/);
});

test("review-results and controller return require state-root group evidence", () => {
  const { root, stateRootRef } = makeFixture();
  registerThread(root, "AlembicPlugin");
  registerThread(root, "AlembicWorkspace", "controller");
  const prepared = prepareDispatch(root, stateRootRef);
  parseOk(run(root, [
    "record-delivery-run",
    "--delivery-file",
    prepared.deliveryFile,
    "--status",
    "sent",
    "--readback-ok",
    "true",
    "--evidence",
    "host thread accepted prompt",
    "--write",
  ]));

  const waiting = parseOk(run(root, ["review-results", "--group", "GROUP-STATE"]));
  assert.equal(waiting.decision, "wait");
  assert.equal(waiting.groupSnapshot.missingTargets[0], "AlembicPlugin");
  assert.equal(waiting.groupSnapshot.pendingDispatch.length, 0);

  const completed = parseOk(run(root, [
    "record-target-result",
    "--target-window",
    "AlembicPlugin",
    "--task-id",
    "CSMR-TASK-1",
    "--group",
    "GROUP-STATE",
    "--status",
    "completed",
    "--evidence-ref",
    "reports/result.json",
    "--verification",
    "focused smoke passed",
    "--write",
  ]));
  assert.equal(completed.result.status, "completed");

  const ready = parseOk(run(root, ["review-results", "--group", "GROUP-STATE"]));
  assert.equal(ready.decision, "needs-controller-review");
  assert.equal(ready.groupSnapshot.readyTargets[0], "AlembicPlugin");

  const returned = parseOk(run(root, [
    "build-controller-return",
    "--group",
    "GROUP-STATE",
    "--trigger-target",
    "AlembicPlugin",
    "--trigger-task-id",
    "CSMR-TASK-1",
    "--require-thread",
    "--write",
  ]));
  assert.equal(returned.envelope.controlPlan, undefined);
  assert.equal(returned.envelope.stateRef.stateRoot, stateRootRef);
  assert.equal(returned.envelope.humanContextRef, `${stateRootRef}/developer-progress.md`);
  assert.match(returned.envelope.prompt, /- stateRoot: \.wakeflow-active\/current\/CSMR-FIXTURE/);
  assert.match(returned.envelope.prompt, /- trigger: AlembicPlugin \/ CSMR-TASK-1/);
  assert.doesNotMatch(returned.envelope.prompt, /controllerWindow:/);
  assert.doesNotMatch(returned.envelope.prompt, /returnPolicy:/);
  assert.doesNotMatch(returned.envelope.prompt, /reviewScope:/);
  assert.doesNotMatch(returned.envelope.prompt, /groupStatus:/);
  assert.doesNotMatch(returned.envelope.prompt, /humanContextRef:/);
  assert.doesNotMatch(returned.envelope.prompt, /stateRevision:/);
  assert.doesNotMatch(returned.envelope.prompt, /taskPackageId:/);
  assert.doesNotMatch(returned.envelope.prompt, /demandKey:/);
  assert.doesNotMatch(returned.envelope.prompt, /rules:/);
  assert.doesNotMatch(returned.envelope.prompt, /controlPlan:/);
  assert.doesNotMatch(returned.envelope.prompt, /<codex_delegation>|<input>|source_thread_id/);
  assert.doesNotMatch(readFileSync(path.join(root, returned.returnFile), "utf8"), /controlPlan/);
  assert.equal(returned.envelope.dispatchGroup, prepared.packet.dispatchGroup);

  const duplicateReturn = run(root, [
    "build-controller-return",
    "--group",
    "GROUP-STATE",
    "--trigger-target",
    "AlembicPlugin",
    "--trigger-task-id",
    "CSMR-TASK-1",
    "--require-thread",
    "--write",
  ]);
  assert.notEqual(duplicateReturn.status, 0);
  assert.match(duplicateReturn.stdout, /already has controller-return delivery status pending-host-send/);
});

test("group-ready controller return ignores targets prepared but not sent", () => {
  const { root, stateRootRef, stateRoot } = makeFixture();
  registerThread(root, "AlembicPlugin");
  registerThread(root, "AlembicWorkspace", "controller");

  const stateFile = path.join(stateRoot, "wakeflow-state.json");
  const state = JSON.parse(readFileSync(stateFile, "utf8"));
  state.taskPackages.push({
    taskPackageId: "CSMR-PKG-2",
    summary: "Second fixture package",
    status: "pending",
    createdAt: "2026-06-05T00:00:00.000Z",
  });
  state.targetTasks.push({
    targetTaskId: "CSMR-TASK-2",
    taskPackageId: "CSMR-PKG-2",
    targetWindow: "AlembicPlugin",
    summary: "Run second fixture target task",
    status: "pending",
    createdAt: "2026-06-05T00:00:00.000Z",
  });
  state.windows[0].taskPackageIds.push("CSMR-PKG-2");
  state.windows[0].targetTaskIds.push("CSMR-TASK-2");
  writeJson(stateFile, state);
  writeJson(path.join(stateRoot, "task-packages/CSMR-PKG-2.json"), {
    schemaVersion: 1,
    taskPackageId: "CSMR-PKG-2",
    demandKey: "CSMR-FIXTURE",
    summary: "Second fixture package",
    status: "pending",
    targetTasks: [{
      targetTaskId: "CSMR-TASK-2",
      taskPackageId: "CSMR-PKG-2",
      targetWindow: "AlembicPlugin",
      summary: "Run second fixture target task",
      status: "pending",
    }],
    createdAt: "2026-06-05T00:00:00.000Z",
  });

  const first = prepareDispatch(root, stateRootRef);
  parseOk(run(root, [
    "prepare-dispatch-from-state",
    "--state-root",
    stateRootRef,
    "--target-task-id",
    "CSMR-TASK-2",
    "--group",
    "GROUP-STATE",
    "--controller-window",
    "AlembicWorkspace",
    "--human-context-ref",
    `${stateRootRef}/developer-progress.md`,
    "--require-thread",
    "--write",
  ]));
  parseOk(run(root, [
    "record-delivery-run",
    "--delivery-file",
    first.deliveryFile,
    "--status",
    "sent",
    "--readback-ok",
    "true",
    "--evidence",
    "first target thread accepted prompt",
    "--write",
  ]));
  parseOk(run(root, [
    "record-target-result",
    "--target-window",
    "AlembicPlugin",
    "--task-id",
    "CSMR-TASK-1",
    "--group",
    "GROUP-STATE",
    "--status",
    "completed",
    "--evidence-ref",
    "reports/result-1.json",
    "--verification",
    "focused smoke passed",
    "--write",
  ]));

  const review = parseOk(run(root, ["review-results", "--group", "GROUP-STATE"]));
  assert.equal(review.decision, "needs-controller-review");
  assert.equal(review.groupStatus, "partially-ready");
  assert.deepEqual(review.groupSnapshot.missing, []);
  assert.equal(review.groupSnapshot.pendingDispatch[0].taskId, "CSMR-TASK-2");
  assert.equal(review.groupSnapshot.pendingDispatch[0].status, "pending-dispatch");
  assert.equal(review.groupSnapshot.allSentResultsPresent, true);
  assert.equal(review.groupSnapshot.allResultsPresent, false);

  const returned = parseOk(run(root, [
    "build-controller-return",
    "--group",
    "GROUP-STATE",
    "--trigger-target",
    "AlembicPlugin",
    "--trigger-task-id",
    "CSMR-TASK-1",
    "--require-thread",
    "--write",
  ]));
  assert.equal(returned.ok, true);
  assert.equal(returned.envelope.wakeflowTrace.artifactKind, "controller-return-envelope");
  assert.equal(returned.envelope.wakeflowTrace.deliveryId, returned.envelope.deliveryId);
  assert.equal(returned.envelope.wakeflowTrace.dispatchGroup, "GROUP-STATE");
  assert.equal(returned.envelope.wakeflowTrace.stateRoot, stateRootRef);
  const status = parseOk(run(root, ["status"]));
  assert.equal(status.runtimeSummary.nextAction, "send-controller-return");
  assert.equal(status.runtimeSummary.resumePlan.steps[0].deliveryKind, "ControllerReturnEnvelope");
  assert.equal(status.runtimeSummary.resumePlan.steps[0].deliveryId, returned.envelope.deliveryId);
  assert.equal(returned.envelope.groupSnapshot.pendingDispatch[0].taskId, "CSMR-TASK-2");
  assert.match(returned.envelope.prompt, /pendingDispatchTargets: AlembicPlugin/);
});

test("per-target controller return allows independent callbacks per target", () => {
  const { root, stateRootRef, stateRoot } = makeFixture();
  const configFile = path.join(root, "workspace.config.json");
  const config = JSON.parse(readFileSync(configFile, "utf8"));
  config.repositories.push({ windowName: "AlembicCore", path: "../AlembicCore", role: "core" });
  config.dispatchWindows.push("AlembicCore");
  writeJson(configFile, config);

  const stateFile = path.join(stateRoot, "wakeflow-state.json");
  const state = JSON.parse(readFileSync(stateFile, "utf8"));
  state.taskPackages.push({
    taskPackageId: "CSMR-PKG-2",
    summary: "Second fixture package",
    status: "pending",
    createdAt: "2026-06-05T00:00:00.000Z",
  });
  state.targetTasks.push({
    targetTaskId: "CSMR-TASK-2",
    taskPackageId: "CSMR-PKG-2",
    targetWindow: "AlembicCore",
    summary: "Run second fixture target task",
    status: "pending",
    createdAt: "2026-06-05T00:00:00.000Z",
  });
  state.windows.push({
    windowName: "AlembicCore",
    windowState: "pending",
    taskPackageIds: ["CSMR-PKG-2"],
    targetTaskIds: ["CSMR-TASK-2"],
  });
  writeJson(stateFile, state);
  writeJson(path.join(stateRoot, "task-packages/CSMR-PKG-2.json"), {
    schemaVersion: 1,
    taskPackageId: "CSMR-PKG-2",
    demandKey: "CSMR-FIXTURE",
    summary: "Second fixture package",
    status: "pending",
    targetTasks: [{
      targetTaskId: "CSMR-TASK-2",
      taskPackageId: "CSMR-PKG-2",
      targetWindow: "AlembicCore",
      summary: "Run second fixture target task",
      status: "pending",
    }],
    createdAt: "2026-06-05T00:00:00.000Z",
  });

  registerThread(root, "AlembicPlugin");
  registerThread(root, "AlembicCore");
  registerThread(root, "AlembicWorkspace");

  prepareDispatch(root, stateRootRef, { extra: ["--return-policy", "per-target"] });
  prepareDispatch(root, stateRootRef, { targetTaskId: "CSMR-TASK-2" });

  parseOk(run(root, [
    "record-target-result",
    "--target-window",
    "AlembicPlugin",
    "--task-id",
    "CSMR-TASK-1",
    "--group",
    "GROUP-STATE",
    "--status",
    "completed",
    "--evidence-ref",
    "reports/plugin-result.json",
    "--verification",
    "plugin smoke passed",
    "--write",
  ]));
  const firstReturn = parseOk(run(root, [
    "build-controller-return",
    "--group",
    "GROUP-STATE",
    "--trigger-target",
    "AlembicPlugin",
    "--trigger-task-id",
    "CSMR-TASK-1",
    "--require-thread",
    "--write",
  ]));
  assert.equal(firstReturn.envelope.returnPolicy.mode, "per-target");
  assert.equal(firstReturn.envelope.reviewScope, "single-target");
  assert.equal(firstReturn.envelope.triggerTarget, "AlembicPlugin");

  parseOk(run(root, [
    "record-target-result",
    "--target-window",
    "AlembicCore",
    "--task-id",
    "CSMR-TASK-2",
    "--group",
    "GROUP-STATE",
    "--status",
    "completed",
    "--evidence-ref",
    "reports/core-result.json",
    "--verification",
    "core smoke passed",
    "--write",
  ]));
  const secondReturn = parseOk(run(root, [
    "build-controller-return",
    "--group",
    "GROUP-STATE",
    "--trigger-target",
    "AlembicCore",
    "--trigger-task-id",
    "CSMR-TASK-2",
    "--require-thread",
    "--write",
  ]));
  assert.equal(secondReturn.envelope.returnPolicy.mode, "per-target");
  assert.equal(secondReturn.envelope.reviewScope, "single-target");
  assert.equal(secondReturn.envelope.triggerTarget, "AlembicCore");
  assert.notEqual(firstReturn.envelope.deliveryId, secondReturn.envelope.deliveryId);

  const duplicateFirstReturn = run(root, [
    "build-controller-return",
    "--group",
    "GROUP-STATE",
    "--trigger-target",
    "AlembicPlugin",
    "--trigger-task-id",
    "CSMR-TASK-1",
    "--require-thread",
    "--write",
  ]);
  assert.notEqual(duplicateFirstReturn.status, 0);
  assert.match(duplicateFirstReturn.stdout, /GROUP-STATE for AlembicPlugin \/ CSMR-TASK-1 already has controller-return delivery status pending-host-send/);

  const review = parseOk(run(root, ["review-results", "--group", "GROUP-STATE"]));
  assert.equal(review.controllerReturnDelivery.envelopeCount, 2);
  assert.equal(review.controllerReturnDelivery.pendingCount, 2);
});

test("target results are scoped by dispatch group to avoid parallel run collisions", () => {
  const { root, stateRootRef } = makeFixture();
  registerThread(root, "AlembicPlugin");
  prepareDispatch(root, stateRootRef, { group: "GROUP-A" });
  prepareDispatch(root, stateRootRef, { group: "GROUP-B" });

  const resultA = parseOk(run(root, [
    "record-target-result",
    "--target-window",
    "AlembicPlugin",
    "--task-id",
    "CSMR-TASK-1",
    "--group",
    "GROUP-A",
    "--status",
    "completed",
    "--evidence-ref",
    "reports/group-a.json",
    "--write",
  ]));
  const resultB = parseOk(run(root, [
    "record-target-result",
    "--target-window",
    "AlembicPlugin",
    "--task-id",
    "CSMR-TASK-1",
    "--group",
    "GROUP-B",
    "--status",
    "blocked",
    "--evidence-ref",
    "reports/group-b.json",
    "--risk",
    "group B is intentionally blocked",
    "--write",
  ]));

  assert.match(resultA.resultFile, /GROUP-A__AlembicPlugin__CSMR-TASK-1\.json$/);
  assert.match(resultB.resultFile, /GROUP-B__AlembicPlugin__CSMR-TASK-1\.json$/);
  assert.notEqual(resultA.resultFile, resultB.resultFile);

  const reviewA = parseOk(run(root, ["review-results", "--group", "GROUP-A"]));
  assert.equal(reviewA.decision, "needs-controller-review");
  assert.equal(reviewA.groupSnapshot.ready[0].status, "completed");

  const reviewB = parseOk(run(root, ["review-results", "--group", "GROUP-B"]));
  assert.equal(reviewB.decision, "blocked");
  assert.equal(reviewB.groupSnapshot.blocked[0].status, "blocked");
});

test("review-pack gates missing path evidence refs before controller verdict", () => {
  const { root, stateRootRef } = makeFixture();
  registerThread(root, "AlembicPlugin");
  prepareDispatch(root, stateRootRef);

  parseOk(run(root, [
    "record-target-result",
    "--target-window",
    "AlembicPlugin",
    "--task-id",
    "CSMR-TASK-1",
    "--group",
    "GROUP-STATE",
    "--status",
    "completed",
    "--evidence-ref",
    "reports/missing-result.json",
    "--verification",
    "focused smoke passed",
    "--write",
  ]));

  const missing = parseOk(run(root, ["review-pack", "--group", "GROUP-STATE"]));
  assert.equal(missing.reviewPack.decision, "needs-controller-review");
  assert.equal(missing.reviewPack.wakeflowTrace.artifactKind, "review-pack");
  assert.equal(missing.reviewPack.wakeflowTrace.dispatchGroup, "GROUP-STATE");
  assert.equal(missing.reviewPack.wakeflowTrace.stateRoot, stateRootRef);
  assert.equal(missing.reviewPack.gates.controllerReviewReady, false);
  assert.equal(missing.reviewPack.gates.missingEvidenceRefsPresent, true);
  assert.equal(missing.reviewPack.gates.evidenceRepairRequired, true);
  assert.equal(missing.reviewPack.gates.totalControlVerdictRequired, false);
  assert.deepEqual(missing.reviewPack.missingEvidenceRefs, [{
    targetWindow: "AlembicPlugin",
    taskId: "CSMR-TASK-1",
    ref: "reports/missing-result.json",
  }]);
  assert.match(missing.reviewPack.nextAction, /fix-missing-evidence-refs/);

  writeText(path.join(root, "reports/missing-result.json"), "{\"ok\": true}");
  const repaired = parseOk(run(root, ["review-pack", "--group", "GROUP-STATE"]));
  assert.equal(repaired.reviewPack.gates.controllerReviewReady, true);
  assert.equal(repaired.reviewPack.gates.missingEvidenceRefsPresent, false);
  assert.deepEqual(repaired.reviewPack.missingEvidenceRefs, []);
});

test("controller-return blocked delivery records controller window evidence", () => {
  const { root, stateRootRef } = makeFixture();
  registerThread(root, "AlembicPlugin");
  prepareDispatch(root, stateRootRef);
  parseOk(run(root, [
    "record-target-result",
    "--target-window",
    "AlembicPlugin",
    "--task-id",
    "CSMR-TASK-1",
    "--group",
    "GROUP-STATE",
    "--status",
    "completed",
    "--evidence-ref",
    "reports/result.json",
    "--verification",
    "focused smoke passed",
    "--write",
  ]));

  const returned = parseOk(run(root, [
    "build-controller-return",
    "--group",
    "GROUP-STATE",
    "--trigger-target",
    "AlembicPlugin",
    "--trigger-task-id",
    "CSMR-TASK-1",
    "--write",
  ]));
  assert.equal(returned.threadReady, false);

  const recorded = parseOk(run(root, [
    "record-delivery-run",
    "--delivery-file",
    returned.returnFile,
    "--status",
    "blocked",
    "--error",
    "controller thread missing",
    "--write",
  ]));
  assert.equal(recorded.run.targetWindow, "AlembicWorkspace");
  assert.equal(recorded.run.thread.windowName, "AlembicWorkspace");
  assert.equal(recorded.run.status, "blocked");
});

test("group review and controller return read state-root target results", () => {
  const { root, stateRootRef, stateRoot } = makeFixture();
  registerThread(root, "AlembicPlugin");
  prepareDispatch(root, stateRootRef);
  writeText(path.join(stateRoot, "reports/plugin-result.json"), "{\"ok\": true}");
  writeJson(path.join(stateRoot, "target-results/result-1.json"), {
    schemaVersion: 1,
    resultId: "result-1",
    demandKey: "CSMR-FIXTURE",
    taskPackageId: "CSMR-PKG-1",
    targetTaskId: "CSMR-TASK-1",
    targetWindow: "AlembicPlugin",
    dispatchGroup: "GROUP-STATE",
    status: "completed",
    changedRepositories: [{
      repository: "AlembicPlugin",
      head: "abc123",
      changedFiles: [],
    }],
    evidenceRefs: ["reports/plugin-result.json"],
    verification: ["focused smoke passed"],
    risks: [],
    createdAt: "2026-06-05T00:01:00.000Z",
  });

  const review = parseOk(run(root, ["review-results", "--group", "GROUP-STATE"]));
  assert.equal(review.decision, "needs-controller-review");
  assert.equal(review.groupStatus, "ready");
  assert.equal(review.groupSnapshot.ready[0].status, "completed");
  assert.equal(review.readyResults[0].resultFile, `${stateRootRef}/target-results/result-1.json`);

  const pack = parseOk(run(root, ["review-pack", "--group", "GROUP-STATE"]));
  assert.equal(pack.reviewPack.gates.controllerReviewReady, true);
  assert.equal(pack.reviewPack.targetResults[0].stateRootResult, true);
  assert.equal(pack.reviewPack.targetResults[0].evidenceRefSummaries[0].resolvedAgainst, "state-root");

  const returned = parseOk(run(root, [
    "build-controller-return",
    "--group",
    "GROUP-STATE",
    "--trigger-target",
    "AlembicPlugin",
    "--trigger-task-id",
    "CSMR-TASK-1",
    "--write",
  ]));
  assert.equal(returned.envelope.groupSnapshot.allResultsPresent, true);
  assert.equal(returned.envelope.groupSnapshot.ready[0].resultFile, `${stateRootRef}/target-results/result-1.json`);
});

test("state-root review-pack reads target results from controller state root", () => {
  const { root, stateRootRef, stateRoot } = makeFixture();
  const absoluteEvidence = path.join(root, "absolute-evidence.json");
  writeText(path.join(stateRoot, "reports/plugin-result.json"), "{\"ok\": true}");
  writeText(path.join(root, "wakeflow-ledger/evidence/plugin-result.json"), "{\"workspaceRelative\": true}");
  writeText(absoluteEvidence, "{\"absolute\": true}");
  writeJson(path.join(stateRoot, "target-results/result-1.json"), {
    schemaVersion: 1,
    resultId: "result-1",
    demandKey: "CSMR-FIXTURE",
    taskPackageId: "CSMR-PKG-1",
    targetTaskId: "CSMR-TASK-1",
    targetWindow: "AlembicPlugin",
    status: "completed",
    evidenceRefs: ["reports/plugin-result.json", "wakeflow-ledger/evidence/plugin-result.json", absoluteEvidence],
    verification: ["unit tests passed"],
    risks: [],
    createdAt: "2026-06-05T00:01:00.000Z",
  });

  const payload = parseOk(run(root, ["review-pack", "--state-root", stateRootRef]));
  assert.equal(payload.source, "wakeflow-state-root");
  assert.equal(payload.decision, "needs-controller-review");
  assert.equal(payload.reviewPack.wakeflowTrace.artifactKind, "review-pack");
  assert.equal(payload.reviewPack.wakeflowTrace.dispatchGroup, "CSMR-FIXTURE");
  assert.equal(payload.reviewPack.wakeflowTrace.stateRoot, stateRootRef);
  assert.equal(payload.reviewPack.wakeflowTrace.stateRevision, 3);
  assert.equal(payload.reviewPack.gates.stateRootBased, true);
  assert.equal(payload.reviewPack.gates.controllerReviewReady, true);
  assert.equal(payload.reviewPack.gates.missingEvidenceRefsPresent, false);
  assert.equal(payload.reviewPack.targetResults[0].stateRootResult, true);
  assert.equal(payload.reviewPack.rawEvidenceRequired[0].evidenceRefs[0], "reports/plugin-result.json");
  const summaries = payload.reviewPack.targetResults[0].evidenceRefSummaries;
  assert.equal(summaries[0].stateRootRelativePath, `${stateRootRef}/reports/plugin-result.json`);
  assert.equal(summaries[0].resolvedAgainst, "state-root");
  assert.equal(summaries[1].ref, "wakeflow-ledger/evidence/plugin-result.json");
  assert.equal(summaries[1].exists, true);
  assert.equal(summaries[1].path, "wakeflow-ledger/evidence/plugin-result.json");
  assert.equal(summaries[1].resolvedAgainst, "workspace-root");
  assert.equal(summaries[2].ref, absoluteEvidence);
  assert.equal(summaries[2].exists, true);
  assert.equal(summaries[2].stateRootRelativePath, undefined);
});

test("state-root review-pack does not mark empty target lists as review ready", () => {
  const { root, stateRootRef, stateRoot } = makeFixture();
  const stateFile = path.join(stateRoot, "wakeflow-state.json");
  const state = JSON.parse(readFileSync(stateFile, "utf8"));
  state.taskPackages = [];
  state.targetTasks = [];
  state.windows = [];
  writeJson(stateFile, state);

  const payload = parseOk(run(root, ["review-pack", "--state-root", stateRootRef]));
  assert.equal(payload.decision, "no-target-tasks");
  assert.equal(payload.groupStatus, "empty");
  assert.equal(payload.reviewPack.gates.noTargetTasks, true);
  assert.equal(payload.reviewPack.gates.controllerReviewReady, false);
  assert.equal(payload.reviewPack.gates.totalControlVerdictRequired, false);
  assert.equal(payload.reviewPack.nextAction, "add-task-package-before-review");
  assert.equal(payload.agentNext, "No target tasks are reviewable; add a task package before dispatch or review.");
});

test("completed state-root review-pack stops instead of asking for another verdict", () => {
  const { root, stateRootRef, stateRoot } = makeFixture();
  writeText(path.join(stateRoot, "reports/plugin-result.json"), "{\"ok\": true}");
  writeJson(path.join(stateRoot, "target-results/result-1.json"), {
    schemaVersion: 1,
    resultId: "result-1",
    demandKey: "CSMR-FIXTURE",
    taskPackageId: "CSMR-PKG-1",
    targetTaskId: "CSMR-TASK-1",
    targetWindow: "AlembicPlugin",
    status: "completed",
    evidenceRefs: ["reports/plugin-result.json"],
    verification: ["unit tests passed"],
    risks: [],
    createdAt: "2026-06-05T00:01:00.000Z",
  });
  const stateFile = path.join(stateRoot, "wakeflow-state.json");
  const state = JSON.parse(readFileSync(stateFile, "utf8"));
  state.state = "completed";
  state.stateReason = "done";
  state.revision = 5;
  state.taskPackages[0].status = "accepted";
  state.targetTasks[0].status = "accepted";
  state.targetTasks[0].resultId = "result-1";
  state.targetTasks[0].reviewDecision = "accept";
  state.windows[0].windowState = "accepted";
  state.review = {
    status: "demand-completed",
    readyResultIds: ["result-1"],
    blockedResultIds: [],
    missingResultIds: [],
  };
  writeJson(stateFile, state);

  const payload = parseOk(run(root, ["review-pack", "--state-root", stateRootRef]));
  assert.equal(payload.decision, "completed");
  assert.equal(payload.groupStatus, "completed");
  assert.equal(payload.reviewPack.controllerState, "completed");
  assert.equal(payload.reviewPack.gates.controllerReviewReady, false);
  assert.equal(payload.reviewPack.gates.totalControlVerdictRequired, false);
  assert.equal(payload.reviewPack.gates.rawEvidencePullRequired, false);
  assert.equal(payload.reviewPack.nextAction, "demand-completed-stop-without-next-dispatch");
  assert.equal(payload.agentNext, "Demand is completed; stop without creating new deliveries.");
});

test("completed target results require reviewable evidence", () => {
  const { root } = makeFixture();
  const result = run(root, [
    "record-target-result",
    "--target-window",
    "AlembicPlugin",
    "--task-id",
    "CSMR-TASK-1",
    "--status",
    "completed",
    "--write",
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /completed results require/);
});

test("record-delivery-run enforces sent readback evidence", () => {
  const { root, stateRootRef, stateRoot } = makeFixture();
  registerThread(root, "AlembicPlugin");
  const prepared = prepareDispatch(root, stateRootRef);

  const missingEvidence = run(root, [
    "record-delivery-run",
    "--delivery-file",
    prepared.deliveryFile,
    "--status",
    "sent",
    "--readback-ok",
    "true",
    "--write",
  ]);
  assert.notEqual(missingEvidence.status, 0);
  assert.match(missingEvidence.stdout, /sent delivery runs require/);

  const recorded = parseOk(run(root, [
    "record-delivery-run",
    "--delivery-file",
    prepared.deliveryFile,
    "--status",
    "sent",
    "--readback-ok",
    "true",
    "--evidence",
    "read_thread latest turn is inProgress",
    "--write",
  ]));
  assert.equal(recorded.status, "sent");
  assert.equal(recorded.run.readback.ok, true);
  assert.equal(recorded.stateUpdate.updated, true);
  assert.equal(recorded.stateUpdate.targetTaskId, "CSMR-TASK-1");
  assert.equal(recorded.stateUpdate.projectionStatus, "stale");
  assert.equal(recorded.run.wakeflowTrace.artifactKind, "delivery-run");
  assert.equal(recorded.run.wakeflowTrace.deliveryId, recorded.run.deliveryId);
  assert.equal(recorded.run.wakeflowTrace.deliveryRunId, recorded.run.deliveryRunId);
  assert.equal(recorded.run.wakeflowTrace.dispatchGroup, "GROUP-STATE");
  assert.equal(recorded.run.wakeflowTrace.stateRoot, stateRootRef);
  assert.match(recorded.agentNext, /Controller-side delivery is complete/);
  assert.match(recorded.agentNext, /Do not poll, sleep, or run review-results/);
  assert.doesNotMatch(recorded.agentNext, /Wait for the target result envelope/);
  assert.doesNotMatch(JSON.stringify(recorded), /0192fac-AlembicPlugin/);

  const state = JSON.parse(readFileSync(path.join(stateRoot, "wakeflow-state.json"), "utf8"));
  assert.equal(state.state, "dispatched");
  assert.equal(state.taskPackages[0].status, "sent");
  assert.equal(state.targetTasks[0].status, "sent");
  assert.equal(state.targetTasks[0].delivery.deliveryFile, prepared.deliveryFile);
  assert.equal(state.targetTasks[0].delivery.deliveryRunId, recorded.run.deliveryRunId);
  assert.equal(state.windows[0].windowState, "active");
  assert.equal(state.projection.status, "stale");
  const events = readFileSync(path.join(stateRoot, "controller-events.jsonl"), "utf8");
  assert.match(events, /"type":"delivery\.sent"/);
  const deliveryEvent = events.trim().split("\n").map((line) => JSON.parse(line)).find((event) => event.type === "delivery.sent");
  assert.equal(deliveryEvent.wakeflowTrace.artifactKind, "controller-event");
  assert.equal(deliveryEvent.wakeflowTrace.deliveryRunId, recorded.run.deliveryRunId);
  assert.equal(deliveryEvent.wakeflowTrace.dispatchGroup, "GROUP-STATE");
  assert.equal(deliveryEvent.wakeflowTrace.stateRoot, stateRootRef);

  const duplicate = parseOk(run(root, [
    "record-delivery-run",
    "--delivery-file",
    prepared.deliveryFile,
    "--status",
    "sent",
    "--readback-ok",
    "true",
    "--evidence",
    "read_thread latest turn is inProgress",
    "--write",
  ]));
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.idempotentReplay, true);
  assert.equal(duplicate.wrote, false);
  assert.equal(duplicate.stateUpdate.updated, false);
  assert.equal(duplicate.stateUpdate.reason, "target-task-already-sent");
  const replayedState = JSON.parse(readFileSync(path.join(stateRoot, "wakeflow-state.json"), "utf8"));
  assert.equal(replayedState.revision, state.revision);
  const replayedEvents = readFileSync(path.join(stateRoot, "controller-events.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(replayedEvents.filter((event) => event.type === "delivery.sent").length, 1);

  const retry = parseOk(run(root, [
    "record-delivery-run",
    "--delivery-file",
    prepared.deliveryFile,
    "--delivery-run-id",
    "run-retry-readback",
    "--status",
    "sent",
    "--readback-ok",
    "true",
    "--evidence",
    "read_thread retry readback matched the same prompt",
    "--write",
  ]));
  assert.equal(retry.wrote, true);
  assert.equal(retry.run.idempotency.key, "delivery-run:delivery-GROUP-STATE__AlembicPlugin__CSMR-TASK-1:run-retry-readback");
  assert.equal(retry.stateUpdate.updated, false);
  assert.equal(retry.stateUpdate.reason, "target-task-already-sent");
  const retryState = JSON.parse(readFileSync(path.join(stateRoot, "wakeflow-state.json"), "utf8"));
  assert.equal(retryState.revision, state.revision);
  const status = parseOk(run(root, ["status"]));
  assert.equal(status.runtimeSummary.nextAction, "wait-for-target-result");
  assert.equal(status.runtimeSummary.health.status, "attention");
  assert.equal(status.runtimeSummary.health.checks.targetResults.missingCount, 1);
  assert.equal(status.runtimeSummary.health.checks.projection.staleCount, 1);
  assert.deepEqual(status.runtimeSummary.health.checks.projection.staleStateRoots, [stateRootRef]);
  assert.equal(status.runtimeSummary.replay.status, "has-replay-history");
  assert.equal(status.runtimeSummary.replay.deliveryAttemptCount, 2);
  assert.equal(status.runtimeSummary.replay.repeatedDeliveryAttemptCount, 1);
  assert.equal(status.runtimeSummary.replay.repeatedDeliveryAttempts[0].runIds.length, 2);
  assert.equal(status.runtimeSummary.resumePlan.status, "waiting");
  assert.equal(status.runtimeSummary.resumePlan.stopRequired, true);
  assert.equal(status.runtimeSummary.resumePlan.steps[0].kind, "stop-and-wait");
});

test("record-target-result is idempotent and requires explicit supersede for changed content", () => {
  const { root } = makeFixture();
  const first = parseOk(run(root, [
    "record-target-result",
    "--target-window",
    "AlembicPlugin",
    "--task-id",
    "CSMR-TASK-1",
    "--group",
    "GROUP-STATE",
    "--status",
    "completed",
    "--evidence-ref",
    "reports/result.json",
    "--verification",
    "focused smoke passed",
    "--write",
  ]));
  assert.equal(first.wrote, true);
  assert.equal(first.result.idempotency.key, "target-result:GROUP-STATE:AlembicPlugin:CSMR-TASK-1");

  const duplicate = parseOk(run(root, [
    "record-target-result",
    "--target-window",
    "AlembicPlugin",
    "--task-id",
    "CSMR-TASK-1",
    "--group",
    "GROUP-STATE",
    "--status",
    "completed",
    "--evidence-ref",
    "reports/result.json",
    "--verification",
    "focused smoke passed",
    "--write",
  ]));
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.idempotentReplay, true);
  assert.equal(duplicate.wrote, false);
  assert.equal(duplicate.result.reportedAt, first.result.reportedAt);

  const changedWithoutSupersede = run(root, [
    "record-target-result",
    "--target-window",
    "AlembicPlugin",
    "--task-id",
    "CSMR-TASK-1",
    "--group",
    "GROUP-STATE",
    "--status",
    "completed",
    "--evidence-ref",
    "reports/result-v2.json",
    "--verification",
    "focused smoke passed",
    "--write",
  ]);
  assert.notEqual(changedWithoutSupersede.status, 0);
  assert.match(changedWithoutSupersede.stdout, /already exists/);
  assert.match(changedWithoutSupersede.stdout, /--supersede-result/);

  const superseded = parseOk(run(root, [
    "record-target-result",
    "--target-window",
    "AlembicPlugin",
    "--task-id",
    "CSMR-TASK-1",
    "--group",
    "GROUP-STATE",
    "--status",
    "completed",
    "--evidence-ref",
    "reports/result-v2.json",
    "--verification",
    "focused smoke passed",
    "--supersede-result",
    "--write",
  ]));
  assert.equal(superseded.superseded, true);
  assert.match(superseded.supersededFile, /target-results\/superseded\//);
  assert.equal(superseded.result.supersedes.status, "completed");
  const archived = JSON.parse(readFileSync(path.join(root, superseded.supersededFile), "utf8"));
  assert.equal(archived.evidenceRefs[0], "reports/result.json");
  assert.equal(archived.supersededBy.resultFile, superseded.resultFile);
  const current = JSON.parse(readFileSync(path.join(root, superseded.resultFile), "utf8"));
  assert.equal(current.evidenceRefs[0], "reports/result-v2.json");
  const status = parseOk(run(root, ["status"]));
  assert.equal(status.runtimeSummary.replay.status, "has-replay-history");
  assert.equal(status.runtimeSummary.replay.targetResultCount, 1);
  assert.equal(status.runtimeSummary.replay.supersededTargetResultCount, 1);
  assert.equal(status.runtimeSummary.replay.supersededTargetResults[0].archivedResultFile, superseded.supersededFile);
});

test("state-root target result import exposes controller-return context from delivery envelope", () => {
  const { root, stateRootRef, stateRoot } = makeFixture();
  registerThread(root, "AlembicPlugin");
  const prepared = prepareDispatch(root, stateRootRef);
  parseOk(run(root, [
    "record-delivery-run",
    "--delivery-file",
    prepared.deliveryFile,
    "--status",
    "sent",
    "--readback-ok",
    "true",
    "--evidence",
    "host thread accepted prompt",
    "--write",
  ]));

  const imported = parseOk(runState(root, [
    "import-target-result",
    "--state-root",
    stateRootRef,
    "--target-task-id",
    "CSMR-TASK-1",
    "--target-window",
    "AlembicPlugin",
    "--status",
    "completed",
    "--result-id",
    "CSMR-RESULT-CALLBACK",
    "--evidence-ref",
    "reports/plugin-result.json",
    "--verification",
    "unit test passed",
    "--write",
  ]));

  assert.equal(imported.dispatchGroup, "GROUP-STATE");
  assert.equal(imported.deliveryContext.resolution, "controller-return-required");
  assert.equal(imported.deliveryContext.deliveryFile, prepared.deliveryFile);
  assert.equal(imported.deliveryContext.deliveryEnvelopeFile, prepared.deliveryFile);
  assert.equal(imported.controllerReturn.required, true);
  assert.equal(imported.controllerReturn.route, "controller");
  assert.deepEqual(imported.controllerReturn.policy, { mode: "group-ready" });
  assert.match(imported.agentNext, /resolved delivery envelope has returnRoute=controller/);
  assert.match(imported.agentNext, /wakeflow_review_pack/);
  assert.match(imported.agentNext, /wakeflow_record_delivery/);

  const resultFile = JSON.parse(readFileSync(path.join(stateRoot, "target-results/CSMR-RESULT-CALLBACK.json"), "utf8"));
  assert.equal(resultFile.dispatchGroup, "GROUP-STATE");
  assert.equal(resultFile.deliveryContext.deliveryEnvelopeFile, prepared.deliveryFile);
  assert.equal(resultFile.controllerActionRequired, true);
  assert.equal(resultFile.wakeflowTrace.artifactKind, "target-result");
  assert.equal(resultFile.wakeflowTrace.resultId, "CSMR-RESULT-CALLBACK");
  assert.equal(resultFile.wakeflowTrace.dispatchGroup, "GROUP-STATE");
  assert.equal(resultFile.wakeflowTrace.stateRoot, stateRootRef);
  assert.equal(resultFile.wakeflowTrace.targetTaskId, "CSMR-TASK-1");
  const status = parseOk(run(root, ["status"]));
  assert.equal(status.runtimeSummary.nextAction, "build-controller-return");
  assert.equal(status.runtimeSummary.health.checks.controllerCallback.readyUnitCount, 1);
  assert.equal(status.runtimeSummary.resumePlan.controllerDecisionRequired, false);
  assert.equal(status.runtimeSummary.resumePlan.steps[0].kind, "prepare-controller-return");
  assert.equal(status.runtimeSummary.resumePlan.steps[0].tool, "wakeflow_prepare_delivery");
  assert.deepEqual(status.runtimeSummary.resumePlan.steps[0].arguments, {
    direction: "controller-return",
    dispatchGroup: "GROUP-STATE",
    triggerTarget: "AlembicPlugin",
    triggerTaskId: "CSMR-TASK-1",
  });

  const stateRootPack = parseOk(run(root, [
    "review-pack",
    "--state-root",
    stateRootRef,
  ]));
  assert.equal(stateRootPack.reviewPack.callbackPlan.dispatchGroup, "GROUP-STATE");
  assert.equal(stateRootPack.reviewPack.callbackPlan.status, "ready-to-build");
  assert.equal(stateRootPack.reviewPack.callbackPlan.counts.readyToBuildCount, 1);
  assert.equal(stateRootPack.reviewPack.gates.controllerReturnReady, true);
  assert.equal(stateRootPack.reviewPack.controllerReturnDelivery.status, "not-built");
  assert.equal(stateRootPack.reviewPack.nextAction, "build-controller-return");
  assert.equal(stateRootPack.reviewPack.callbackPlan.units[0].triggerTarget, "AlembicPlugin");
  assert.equal(stateRootPack.reviewPack.callbackPlan.units[0].triggerTaskId, "CSMR-TASK-1");

  const traceByGroup = parseOk(run(root, [
    "trace-spine",
    "--group",
    "GROUP-STATE",
  ]));
  assert.equal(traceByGroup.traceSpine.kind, "WakeflowTraceSpine");
  assert.equal(traceByGroup.coverage.stateRootCount, 1);
  assert.equal(traceByGroup.coverage.dispatchGroupCount, 1);
  assert.equal(traceByGroup.coverage.dispatchPacketCount, 1);
  assert.equal(traceByGroup.coverage.deliveryEnvelopeCount, 1);
  assert.equal(traceByGroup.coverage.deliveryRunCount, 1);
  assert.equal(traceByGroup.coverage.targetResultCount, 1);
  assert.equal(traceByGroup.coverage.controllerEventCount, 1);
  assert.equal(traceByGroup.traceSpine.dispatchPackets[0].id, "GROUP-STATE__AlembicPlugin__CSMR-TASK-1");
  assert.equal(traceByGroup.traceSpine.deliveryEnvelopes[0].deliveryId, prepared.envelope.deliveryId);
  assert.equal(traceByGroup.traceSpine.deliveryRuns[0].status, "sent");
  assert.equal(traceByGroup.traceSpine.targetResults[0].id, "CSMR-RESULT-CALLBACK");
  assert.equal(traceByGroup.traceSpine.review.decision, "needs-controller-review");
  assert.match(traceByGroup.agentNext, /read-only/);

  const traceByDeliveryId = parseOk(run(root, [
    "trace-spine",
    "--delivery-id",
    prepared.envelope.deliveryId,
  ]));
  assert.equal(traceByDeliveryId.selector.dispatchGroup, "GROUP-STATE");
  assert.equal(traceByDeliveryId.coverage.dispatchPacketCount, 1);
  assert.equal(traceByDeliveryId.coverage.targetResultCount, 1);

  const traceByResultFile = parseOk(run(root, [
    "trace-spine",
    "--result-file",
    `${stateRootRef}/target-results/CSMR-RESULT-CALLBACK.json`,
  ]));
  assert.equal(traceByResultFile.selector.deliveryId, prepared.envelope.deliveryId);
  assert.equal(traceByResultFile.coverage.deliveryEnvelopeCount, 1);
  assert.equal(traceByResultFile.coverage.targetResultCount, 1);
});

test("record-delivery-run infers workspace root from an absolute delivery file", () => {
  const { root, stateRootRef } = makeFixture();
  const caller = mkdtempSync(path.join(os.tmpdir(), "wakeflow-other-cwd-"));
  registerThread(root, "AlembicPlugin");
  const prepared = prepareDispatch(root, stateRootRef);
  const absoluteDeliveryFile = path.join(root, prepared.deliveryFile);

  const recorded = runSync(process.execPath, [
    script,
    "record-delivery-run",
    "--delivery-file",
    absoluteDeliveryFile,
    "--status",
    "sent",
    "--readback-ok",
    "true",
    "--evidence",
    "host thread accepted prompt",
    "--write",
    "--json",
  ], {
    cwd: caller,
    encoding: "utf8",
  });

  const payload = parseOk(recorded);
  assert.equal(payload.ok, true);
  assert.equal(payload.runFile.startsWith(".wakeflow-local/wakeflow-delivery/delivery-runs/"), true);
  assert.equal(
    existsSync(path.join(root, payload.runFile)),
    true,
    "delivery run should be written beside the delivery envelope workspace",
  );
  assert.equal(
    existsSync(path.join(caller, payload.runFile)),
    false,
    "delivery run must not be written under the caller cwd",
  );
});

test("waiting review results tell total control to stop instead of polling", () => {
  const { root, stateRootRef } = makeFixture();
  registerThread(root, "AlembicPlugin");
  prepareDispatch(root, stateRootRef);

  const waiting = parseOk(run(root, [
    "review-results",
    "--group",
    "GROUP-STATE",
  ]));

  assert.equal(waiting.decision, "wait");
  assert.match(waiting.agentNext, /stop this turn/);
  assert.match(waiting.agentNext, /instead of polling or sleeping/);
  assert.doesNotMatch(waiting.agentNext, /Wait for missing target result envelopes/);
});

test("stop-loop writes a stop marker without creating new delivery state", () => {
  const { root } = makeFixture();
  const payload = parseOk(run(root, [
    "stop-loop",
    "--reason",
    "test complete",
    "--write",
  ]));
  assert.equal(payload.command, "stop-loop");
  assert.equal(payload.reason, "test complete");
  assert.equal(payload.keepLive.active, false);
});


test("record-delivery-run validates envelope-state consistency before writing the run file", () => {
  const { root, stateRootRef } = makeFixture();
  registerThread(root, "AlembicPlugin");
  const prepared = prepareDispatch(root, stateRootRef);
  const deliveryFile = path.join(root, ".wakeflow-local/wakeflow-delivery/delivery-envelopes", `${prepared.envelope.deliveryId}.json`);
  const envelope = JSON.parse(readFileSync(deliveryFile, "utf8"));
  envelope.stateRef.taskPackageId = "CSMR-PKG-WRONG";
  writeJson(deliveryFile, envelope);

  const result = run(root, ["record-delivery-run", "--delivery-file", deliveryFile, "--status", "sent", "--readback-ok", "true", "--evidence", "test send evidence", "--write"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout + result.stderr, /task package mismatch/);
  const runFile = path.join(root, ".wakeflow-local/wakeflow-delivery/delivery-runs", `run-${prepared.envelope.deliveryId}.json`);
  assert.equal(existsSync(runFile), false, "a mismatched record must not leave a wedged run file on disk");
});

test("record-delivery-run writes the shared window lock and record-target-result releases it", () => {
  const { root, stateRootRef } = makeFixture();
  registerThread(root, "AlembicPlugin");
  const prepared = prepareDispatch(root, stateRootRef);
  const deliveryFile = path.join(root, ".wakeflow-local/wakeflow-delivery/delivery-envelopes", `${prepared.envelope.deliveryId}.json`);
  parseOk(run(root, ["record-delivery-run", "--delivery-file", deliveryFile, "--status", "sent", "--readback-ok", "true", "--evidence", "test send evidence", "--write"]));

  const lockFile = path.join(root, ".wakeflow-local/wakeflow-delivery/locks/AlembicPlugin.json");
  assert.equal(existsSync(lockFile), true, "sent delivery must write the shared window lock");
  const lock = JSON.parse(readFileSync(lockFile, "utf8"));
  assert.equal(lock.host, "codex");
  assert.equal(lock.deliveryId, prepared.envelope.deliveryId);

  const recorded = parseOk(run(root, [
    "record-target-result",
    "--target-window", "AlembicPlugin",
    "--task-id", "CSMR-TASK-1",
    "--status", "completed",
    "--evidence-ref", "docs/evidence.md",
    "--write",
  ]));
  assert.equal(recorded.lockReleased, true, "result for the locked delivery must release the lock");
  assert.equal(existsSync(lockFile), false);
  assert.equal(recorded.result.dispatchGroup, "GROUP-STATE", "group auto-resolves from the dispatch packet");
});

test("record-target-result preserves a fresh lock for a different task in the same window", () => {
  const { root, stateRootRef } = makeFixture();
  registerThread(root, "AlembicPlugin");
  prepareDispatch(root, stateRootRef);
  const lockFile = path.join(root, ".wakeflow-local/wakeflow-delivery/locks/AlembicPlugin.json");
  const newerDeliveryId = "delivery-CSMR-TASK-2";
  writeJson(path.join(root, ".wakeflow-local/wakeflow-delivery/delivery-runs", `run-${newerDeliveryId}.json`), {
    kind: "DirectThreadDeliveryRun",
    version: 1,
    deliveryRunId: `run-${newerDeliveryId}`,
    deliveryId: newerDeliveryId,
    targetWindow: "AlembicPlugin",
    taskId: "CSMR-TASK-2",
    status: "sent",
    createdAt: "2026-06-05T00:00:00.000Z",
  });
  writeJson(lockFile, {
    kind: "WakeflowWindowDeliveryLock",
    version: 1,
    windowName: "AlembicPlugin",
    host: "codex",
    deliveryId: newerDeliveryId,
    createdAt: "2026-06-05T00:00:00.000Z",
    expiresAt: "2999-01-01T00:00:00.000Z",
  });

  const recorded = parseOk(run(root, [
    "record-target-result",
    "--target-window", "AlembicPlugin",
    "--task-id", "CSMR-TASK-1",
    "--status", "completed",
    "--evidence-ref", "docs/evidence.md",
    "--write",
  ]));
  assert.equal(recorded.lockReleased, false, "an old result must not release a newer same-window task lock");
  assert.equal(JSON.parse(readFileSync(lockFile, "utf8")).deliveryId, newerDeliveryId);
});

test("F51: state-script import-target-result (the MCP path) releases the matching window lock", () => {
  const { root, stateRootRef } = makeFixture();
  registerThread(root, "AlembicPlugin");
  const prepared = prepareDispatch(root, stateRootRef);
  const deliveryFile = path.join(root, ".wakeflow-local/wakeflow-delivery/delivery-envelopes", `${prepared.envelope.deliveryId}.json`);
  parseOk(run(root, ["record-delivery-run", "--delivery-file", deliveryFile, "--status", "sent", "--readback-ok", "true", "--evidence", "state-script send", "--write"]));
  const lockFile = path.join(root, ".wakeflow-local/wakeflow-delivery/locks/AlembicPlugin.json");
  assert.equal(existsSync(lockFile), true, "sent delivery must write the shared window lock");

  // wakeflow_record_target_result maps to the STATE-script import-target-result; its
  // lock-release path (state.mjs) was previously untested (assessment F51).
  parseOk(runState(root, [
    "import-target-result",
    "--state-root", stateRootRef,
    "--target-task-id", "CSMR-TASK-1",
    "--target-window", "AlembicPlugin",
    "--status", "completed",
    "--evidence-ref", "docs/evidence.md",
    "--write",
  ]));
  assert.equal(existsSync(lockFile), false, "the state-script import must release the matching delivery lock");
});

test("F52: dispatch is fail-closed against a fresh other-host window lock", () => {
  const { root, stateRootRef } = makeFixture();
  registerThread(root, "AlembicPlugin");
  const lockFile = path.join(root, ".wakeflow-local/wakeflow-delivery/locks/AlembicPlugin.json");
  writeJson(lockFile, {
    kind: "WakeflowWindowDeliveryLock",
    version: 1,
    windowName: "AlembicPlugin",
    host: "claude-code",
    deliveryId: "delivery-other-host",
    createdAt: "2026-06-05T00:00:00.000Z",
    expiresAt: "2999-01-01T00:00:00.000Z",
  });
  const blocked = run(root, [
    "prepare-dispatch-from-state",
    "--state-root", stateRootRef,
    "--target-task-id", "CSMR-TASK-1",
    "--group", "GROUP-STATE",
    "--controller-window", "AlembicWorkspace",
    "--human-context-ref", `${stateRootRef}/developer-progress.md`,
    "--require-thread",
    "--write",
  ]);
  assert.notEqual(blocked.status, 0, "a fresh other-host lock must fail closed");
  assert.match(blocked.stdout + blocked.stderr, /lock/i);
});

test("F53: an expired other-host window lock self-heals and allows dispatch", () => {
  const { root, stateRootRef } = makeFixture();
  registerThread(root, "AlembicPlugin");
  const lockFile = path.join(root, ".wakeflow-local/wakeflow-delivery/locks/AlembicPlugin.json");
  writeJson(lockFile, {
    kind: "WakeflowWindowDeliveryLock",
    version: 1,
    windowName: "AlembicPlugin",
    host: "claude-code",
    deliveryId: "delivery-stale",
    createdAt: "2000-01-01T00:00:00.000Z",
    expiresAt: "2000-01-01T01:00:00.000Z",
  });
  const prepared = prepareDispatch(root, stateRootRef);
  assert.ok(prepared.envelope?.deliveryId, "an expired other-host lock is treated as absent");
});

test("RA2: record-delivery-run sets per-task dispatchCount and is idempotent on replay", () => {
  const { root, stateRootRef } = makeFixture();
  registerThread(root, "AlembicPlugin");
  const prepared = prepareDispatch(root, stateRootRef);
  const deliveryFile = path.join(root, ".wakeflow-local/wakeflow-delivery/delivery-envelopes", `${prepared.envelope.deliveryId}.json`);
  const sendArgs = ["record-delivery-run", "--delivery-file", deliveryFile, "--status", "sent", "--readback-ok", "true", "--evidence", "send evidence", "--write"];
  parseOk(run(root, sendArgs));
  const stateFile = path.join(root, stateRootRef, "wakeflow-state.json");
  const task = () => JSON.parse(readFileSync(stateFile, "utf8")).targetTasks.find((t) => t.targetTaskId === "CSMR-TASK-1");
  assert.equal(task().counts?.dispatchCount, 1, "the first sent delivery sets dispatchCount=1");
  // replay the same delivery — the already-sent guard must skip the state advance, so no double-count
  run(root, sendArgs);
  assert.equal(task().counts?.dispatchCount, 1, "replaying the same delivery must not double-count dispatchCount");
});

test("RA2: task-ledger reports a unified per-task rollup with handling counts", () => {
  const { root, stateRootRef } = makeFixture();
  registerThread(root, "AlembicPlugin");
  const prepared = prepareDispatch(root, stateRootRef);
  const deliveryFile = path.join(root, ".wakeflow-local/wakeflow-delivery/delivery-envelopes", `${prepared.envelope.deliveryId}.json`);
  parseOk(run(root, ["record-delivery-run", "--delivery-file", deliveryFile, "--status", "sent", "--readback-ok", "true", "--evidence", "send evidence", "--write"]));
  const ledger = parseOk(run(root, ["task-ledger", "--state-root", stateRootRef]));
  assert.equal(ledger.command, "task-ledger");
  assert.equal(ledger.kind, "WakeflowTaskLedger");
  assert.equal(ledger.taskCount, 1, "the ledger scans all target tasks");
  const entry = ledger.tasks.find((item) => item.targetTaskId === "CSMR-TASK-1");
  assert.ok(entry, "the ledger must include the task");
  assert.equal(entry.status, "sent");
  assert.equal(entry.counts.dispatchCount, 1, "dispatchCount surfaced in the ledger");
  assert.equal(entry.counts.reworkCount, 0);
  assert.equal(entry.counts.retestCount, 0);
  assert.equal(entry.counts.redesignCount, 0);
  assert.equal(entry.recurringProblem, false);
});

test("RA2: retestCount counts rounds dispatched to a Test window, not test-card files", () => {
  const { root, stateRootRef, stateRoot } = makeFixture();
  const stateFile = path.join(stateRoot, "wakeflow-state.json");
  const state = JSON.parse(readFileSync(stateFile, "utf8"));
  // A Test-targeted task dispatched twice = two retest rounds (test -> fix -> test again).
  // The fixture config has no testWindow override, so it defaults to "Test".
  state.targetTasks.push({
    targetTaskId: "CSMR-RETEST-1",
    taskPackageId: "CSMR-PKG-1",
    targetWindow: "Test",
    summary: "Real-scenario retest task",
    status: "sent",
    counts: { dispatchCount: 2, reworkCount: 0 },
    createdAt: "2026-06-05T00:02:00.000Z",
  });
  writeJson(stateFile, state);
  const ledger = parseOk(run(root, ["task-ledger", "--state-root", stateRootRef]));
  const retest = ledger.tasks.find((t) => t.targetTaskId === "CSMR-RETEST-1");
  assert.equal(retest.counts.retestCount, 2, "Test-window dispatches count as retest rounds");
  const product = ledger.tasks.find((t) => t.targetTaskId === "CSMR-TASK-1");
  assert.equal(product.counts.retestCount, 0, "non-Test tasks never accrue retest rounds");
  assert.equal(ledger.retestCount, 2, "demand-wide retestCount sums Test-dispatch rounds");
});

test("RA4: window-view returns a window's own tasks and file areas", () => {
  const { root, stateRootRef } = makeFixture();
  const view = parseOk(runState(root, ["window-view", "--state-root", stateRootRef, "--window", "AlembicPlugin"]));
  assert.equal(view.command, "window-view");
  assert.equal(view.window, "AlembicPlugin");
  assert.equal(view.counts.total, 1, "the fixture window owns one task");
  assert.ok(view.tasks.find((t) => t.targetTaskId === "CSMR-TASK-1"), "window-view lists the window's task");
  assert.ok(view.fileAreas?.stateRoot, "window-view includes the state-root file area");
  assert.ok(view.fileAreas?.transport?.dispatchPacketsDir, "window-view includes transport dirs");
  assert.match(view.fileAreas?.host?.threadRegistryFile ?? "", /AlembicPlugin/, "per-window host registry path");
  const other = parseOk(runState(root, ["window-view", "--state-root", stateRootRef, "--window", "AlembicWorkspace"]));
  assert.equal(other.counts.total, 0, "a different window sees none of this window's tasks");
});

test("F18: re-dispatch clears a prior rework decision so a fresh result is not mislabeled", () => {
  const { root, stateRootRef } = makeFixture();
  // simulate a prior rework decision on the fixture task + package
  const stateFile = path.join(root, stateRootRef, "wakeflow-state.json");
  const state = JSON.parse(readFileSync(stateFile, "utf8"));
  state.state = "needs-rework";
  state.targetTasks[0].status = "needs-rework";
  state.targetTasks[0].reviewDecision = "rework";
  state.taskPackages[0].status = "needs-rework";
  writeJson(stateFile, state);
  registerThread(root, "AlembicPlugin");
  const prepared = prepareDispatch(root, stateRootRef);
  const deliveryFile = path.join(root, ".wakeflow-local/wakeflow-delivery/delivery-envelopes", `${prepared.envelope.deliveryId}.json`);
  parseOk(run(root, ["record-delivery-run", "--delivery-file", deliveryFile, "--status", "sent", "--readback-ok", "true", "--evidence", "redispatch evidence", "--write"]));
  const after = JSON.parse(readFileSync(stateFile, "utf8"));
  const task = after.targetTasks.find((t) => t.targetTaskId === "CSMR-TASK-1");
  assert.equal(task.status, "sent", "re-dispatch returns the task to sent");
  assert.equal(task.reviewDecision, null, "re-dispatch clears the stale rework decision");
});

test("rework-first dispatch blocks ordinary next-step targets until rework is dispatched", () => {
  const { root, stateRootRef, stateRoot } = makeFixture();
  const stateFile = path.join(stateRoot, "wakeflow-state.json");
  const state = JSON.parse(readFileSync(stateFile, "utf8"));
  state.state = "planned";
  state.targetTasks[0].status = "needs-rework";
  state.targetTasks[0].reviewDecision = "rework";
  state.taskPackages[0].status = "needs-rework";
  state.taskPackages.push({
    taskPackageId: "CSMR-PKG-2",
    summary: "Ordinary next step",
    status: "pending",
    createdAt: "2026-06-05T00:01:00.000Z",
  });
  state.targetTasks.push({
    targetTaskId: "CSMR-TASK-2",
    taskPackageId: "CSMR-PKG-2",
    targetWindow: "AlembicPlugin",
    summary: "Ordinary next-step task",
    status: "pending",
    createdAt: "2026-06-05T00:01:00.000Z",
  });
  state.windows[0].taskPackageIds.push("CSMR-PKG-2");
  state.windows[0].targetTaskIds.push("CSMR-TASK-2");
  writeJson(stateFile, state);
  writeJson(path.join(stateRoot, "task-packages/CSMR-PKG-2.json"), {
    schemaVersion: 1,
    taskPackageId: "CSMR-PKG-2",
    demandKey: "CSMR-FIXTURE",
    summary: "Ordinary next step",
    status: "pending",
    targetTasks: [{
      targetTaskId: "CSMR-TASK-2",
      taskPackageId: "CSMR-PKG-2",
      targetWindow: "AlembicPlugin",
      summary: "Ordinary next-step task",
      status: "pending",
    }],
    createdAt: "2026-06-05T00:01:00.000Z",
  });
  registerThread(root, "AlembicPlugin");

  const ordinary = run(root, [
    "prepare-dispatch-from-state",
    "--state-root",
    stateRootRef,
    "--target-task-id",
    "CSMR-TASK-2",
    "--group",
    "GROUP-NEXT",
    "--controller-window",
    "AlembicWorkspace",
    "--human-context-ref",
    `${stateRootRef}/developer-progress.md`,
    "--require-thread",
    "--write",
  ]);
  assert.notEqual(ordinary.status, 0);
  assert.match(ordinary.stdout, /cannot prepare dispatch for CSMR-TASK-2 while rework is open/);
  assert.match(ordinary.stdout, /CSMR-TASK-1/);

  const rework = prepareDispatch(root, stateRootRef, { group: "GROUP-REWORK", targetTaskId: "CSMR-TASK-1" });
  assert.equal(rework.ok, true);
  assert.equal(rework.envelope.stateRef.targetTaskId, "CSMR-TASK-1");
});

test("F25: a stale lock for the answered delivery is released (unified freshness-agnostic policy)", () => {
  const { root, stateRootRef } = makeFixture();
  registerThread(root, "AlembicPlugin");
  const prepared = prepareDispatch(root, stateRootRef);
  const deliveryFile = path.join(root, ".wakeflow-local/wakeflow-delivery/delivery-envelopes", `${prepared.envelope.deliveryId}.json`);
  parseOk(run(root, ["record-delivery-run", "--delivery-file", deliveryFile, "--status", "sent", "--readback-ok", "true", "--evidence", "send", "--write"]));
  const lockFile = path.join(root, ".wakeflow-local/wakeflow-delivery/locks/AlembicPlugin.json");
  // make the lock stale but still belonging to the answered delivery
  const lock = JSON.parse(readFileSync(lockFile, "utf8"));
  lock.expiresAt = "2000-01-01T00:00:00.000Z";
  writeJson(lockFile, lock);
  const recorded = parseOk(run(root, [
    "record-target-result", "--target-window", "AlembicPlugin", "--task-id", "CSMR-TASK-1",
    "--status", "completed", "--evidence-ref", "docs/e.md", "--write",
  ]));
  assert.equal(recorded.lockReleased, true, "a stale lock for the answered delivery is released under the unified policy");
  assert.equal(existsSync(lockFile), false);
});

test("record-target-result rejects a group that matches no dispatch packet", () => {
  const { root, stateRootRef } = makeFixture();
  registerThread(root, "AlembicPlugin");
  prepareDispatch(root, stateRootRef);
  const result = run(root, [
    "record-target-result",
    "--target-window", "AlembicPlugin",
    "--task-id", "CSMR-TASK-1",
    "--status", "completed",
    "--evidence-ref", "docs/evidence.md",
    "--group", "WRONG-GROUP",
    "--write",
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout + result.stderr, /does not match any dispatch packet/);
});


test("envelope prompts follow the demand interfaceLanguage (zh)", () => {
  const { root, stateRootRef } = makeFixture();
  registerThread(root, "AlembicPlugin");
  // switch the demand to Chinese, as a zh workspace init would stamp it
  const stateFile = path.join(root, stateRootRef, "wakeflow-state.json");
  const state = JSON.parse(readFileSync(stateFile, "utf8"));
  state.interfaceLanguage = "zh";
  writeJson(stateFile, state);

  const prepared = prepareDispatch(root, stateRootRef);
  const prompt = prepared.envelope.prompt;
  assert.match(prompt, /\u7ee7\u7eed\u5f53\u524d\u7a97\u53e3\u4efb\u52a1\uff1a/, "zh headline");
  assert.match(prompt, /\u53d8\u91cf\uff1a/, "zh variables label");
  assert.match(prompt, /- currentWindow: AlembicPlugin/, "machine keys stay English");
  assert.match(prompt, /- skill: skills\/wakeflow-target\/SKILL\.md/, "skill pointer unchanged");
});

test("controller-return prompt localizes sentences for zh demands", async () => {
  const { formatControllerReturnPrompt } = await import("../plugins/codex-wakeflow/scripts/lib/wakeflow-controller-return.mjs");
  const zhPrompt = formatControllerReturnPrompt({
    dispatchGroup: "GRP-1",
    triggerTarget: "WindowA",
    triggerTaskId: "T1",
    stateRef: { stateRoot: ".wakeflow-active/current/demo" },
    reviewScope: "single",
    groupSnapshot: { readyTargets: ["WindowA"], blockedTargets: [], missingTargets: ["WindowB"], pendingDispatchTargets: [] },
    interfaceLanguage: "zh",
  });
  assert.match(zhPrompt, /\u7ee7\u7eed\u603b\u63a7\u8bc4\u5ba1\uff1aWindowA \u56de\u586b\u3002/, "zh title");
  assert.match(zhPrompt, /\u53d8\u91cf\uff1a/, "zh variables label");
  assert.match(zhPrompt, /- trigger: WindowA \/ T1/, "machine keys stay English");

  const enPrompt = formatControllerReturnPrompt({
    dispatchGroup: "GRP-1",
    triggerTarget: "WindowA",
    triggerTaskId: "T1",
    stateRef: { stateRoot: ".wakeflow-active/current/demo" },
    reviewScope: "single",
    groupSnapshot: { readyTargets: ["WindowA"], blockedTargets: [], missingTargets: [], pendingDispatchTargets: [] },
  });
  assert.match(enPrompt, /Continue controller review: WindowA backfill\./, "en default unchanged");
});


test("prepare-dispatch acquires the shared window lock at envelope time (generic, both hosts)", () => {
  const { root, stateRootRef } = makeFixture();
  registerThread(root, "AlembicPlugin");
  const prepared = prepareDispatch(root, stateRootRef);
  const lockFile = path.join(root, ".wakeflow-local/wakeflow-delivery/locks/AlembicPlugin.json");
  assert.equal(existsSync(lockFile), true, "lock acquired when the envelope is written");
  const lock = JSON.parse(readFileSync(lockFile, "utf8"));
  assert.equal(lock.host, "codex", "acquired by the dispatching host");
  assert.equal(lock.deliveryId, prepared.envelope.deliveryId, "lock carries the delivery id");

  // replay refreshes the same lock without a same-host warning (own delivery)
  const replay = prepareDispatch(root, stateRootRef);
  assert.equal(replay.windowLockWarning ?? null, null, "own-delivery lock does not warn");
});

test("release-window-lock is dry-run by default and releases with --write", () => {
  const { root, stateRootRef } = makeFixture();
  registerThread(root, "AlembicPlugin");
  prepareDispatch(root, stateRootRef);
  const lockFile = path.join(root, ".wakeflow-local/wakeflow-delivery/locks/AlembicPlugin.json");
  assert.equal(existsSync(lockFile), true);

  const dry = parseOk(run(root, ["release-window-lock", "--window", "AlembicPlugin"]));
  assert.equal(dry.released, false);
  assert.equal(dry.dryRun, true);
  assert.equal(existsSync(lockFile), true, "dry-run must not delete the lock");

  const released = parseOk(run(root, ["release-window-lock", "--window", "AlembicPlugin", "--write"]));
  assert.equal(released.released, true);
  assert.equal(released.releasedLock.deliveryId.startsWith("delivery-"), true);
  assert.equal(existsSync(lockFile), false);

  const again = parseOk(run(root, ["release-window-lock", "--window", "AlembicPlugin", "--write"]));
  assert.equal(again.released, false, "idempotent when no lock present");
});


test("release-window-lock removes a corrupt lock file with --write", () => {
  const { root } = makeFixture();
  const locksDir = path.join(root, ".wakeflow-local/wakeflow-delivery/locks");
  mkdirSync(locksDir, { recursive: true });
  const lockFile = path.join(locksDir, "WinX.json");
  writeFileSync(lockFile, "{not json");

  const dry = parseOk(run(root, ["release-window-lock", "--window", "WinX"]));
  assert.equal(dry.released, false);
  assert.match(dry.note, /corrupt/);
  assert.equal(existsSync(lockFile), true, "dry-run keeps the corrupt file");

  const released = parseOk(run(root, ["release-window-lock", "--window", "WinX", "--write"]));
  assert.equal(released.released, true);
  assert.match(released.note, /corrupt/);
  assert.equal(existsSync(lockFile), false);
});

test("record-target-result releases the lock even when the run used a custom --delivery-run-id", () => {
  const { root, stateRootRef } = makeFixture();
  registerThread(root, "AlembicPlugin");
  const prepared = prepareDispatch(root, stateRootRef);
  const deliveryFile = path.join(root, ".wakeflow-local/wakeflow-delivery/delivery-envelopes", `${prepared.envelope.deliveryId}.json`);
  parseOk(run(root, ["record-delivery-run", "--delivery-file", deliveryFile, "--delivery-run-id", "retry-custom-7", "--status", "sent", "--readback-ok", "true", "--evidence", "retry evidence", "--write"]));

  const lockFile = path.join(root, ".wakeflow-local/wakeflow-delivery/locks/AlembicPlugin.json");
  assert.equal(existsSync(lockFile), true, "sent record refreshes the lock");

  const recorded = parseOk(run(root, [
    "record-target-result",
    "--target-window", "AlembicPlugin",
    "--task-id", "CSMR-TASK-1",
    "--status", "completed",
    "--evidence-ref", "docs/evidence.md",
    "--write",
  ]));
  assert.equal(recorded.lockReleased, true, "release matches the delivery id via the runs scan");
  assert.equal(existsSync(lockFile), false);
});


test("--compact payloads drop the structured echoes but keep ids, files, and prompt", () => {
  const { root, stateRootRef } = makeFixture();
  registerThread(root, "AlembicPlugin");
  const compact = parseOk(run(root, [
    "prepare-dispatch-from-state",
    "--state-root", stateRootRef,
    "--target-task-id", "CSMR-TASK-1",
    "--group", "GROUP-STATE",
    "--controller-window", "AlembicWorkspace",
    "--human-context-ref", `${stateRootRef}/developer-progress.md`,
    "--require-thread", "--write", "--compact",
  ]));
  assert.equal(compact.compact, true);
  assert.equal(compact.envelope, undefined, "no envelope echo");
  assert.equal(compact.packet, undefined, "no packet echo");
  assert.equal(compact.windowConfig, undefined, "no windowConfig echo");
  assert.ok(compact.deliveryId, "delivery id present");
  assert.ok(compact.deliveryFile, "delivery file path present");
  assert.ok(compact.prompt.includes("CSMR-TASK-1"), "prompt text present for the host send");

  const deliveryFile = path.join(root, compact.deliveryFile);
  const recorded = parseOk(run(root, ["record-delivery-run", "--delivery-file", deliveryFile, "--status", "sent", "--readback-ok", "true", "--evidence", "ev", "--write", "--compact"]));
  assert.equal(recorded.compact, true);
  assert.equal(recorded.run, undefined, "no run echo");
  assert.ok(recorded.deliveryRunId);
  assert.ok(recorded.stateUpdate, "state update summary kept");

  const result = parseOk(run(root, ["record-target-result", "--target-window", "AlembicPlugin", "--task-id", "CSMR-TASK-1", "--status", "completed", "--evidence-ref", "docs/e.md", "--write", "--compact"]));
  assert.equal(result.compact, true);
  assert.equal(result.result, undefined, "no result echo");
  assert.ok(result.resultId);
});
