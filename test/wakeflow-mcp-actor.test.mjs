import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { authorizeMcpToolCall } from "../core/lib/wakeflow-mcp-actor.mjs";
import { hostProfile } from "../core/scripts/lib/wakeflow-host-profile.mjs";
import { handlers } from "../plugins/codex-wakeflow/lib/wakeflow-mcp-tools.mjs";

function writeJson(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function makeFixture({ registrations = true } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), "wakeflow-mcp-actor-"));
  writeJson(path.join(root, "wakeflow.config.json"), {
    workspaceName: "ActorFixture",
    controllerWindow: "Controller",
    designWindow: "Design",
    testWindow: "Test",
    internalDesignPath: "Design",
    internalTestPath: "Test",
    repositories: [
      { windowName: "Target", path: "Target" },
      { windowName: "Design", path: "Design" },
      { windowName: "Test", path: "Test" },
    ],
  });
  for (const dir of ["Design", "Test", "Target"]) mkdirSync(path.join(root, dir), { recursive: true });
  const stateRoot = ".wakeflow-active/current/actor-demand";
  writeJson(path.join(root, stateRoot, "wakeflow-state.json"), {
    demandKey: "actor-demand",
    controllerWindow: "Controller",
    state: "planned",
    revision: 1,
  });
  if (registrations) {
    const registry = path.join(root, ".wakeflow-local/wakeflow-delivery/hosts/codex/thread-registry");
    for (const [windowName, threadId] of [
      ["Controller", "controller-thread"],
      ["Design", "design-thread"],
      ["Target", "target-thread"],
      ["Controller__pod-a", "pod-controller-thread"],
    ]) {
      writeJson(path.join(registry, `${windowName}.json`), {
        kind: hostProfile.kinds.windowRegistration,
        version: 2,
        windowName,
        threadId,
        registeredAt: "2026-07-11T00:00:00.000Z",
        lastVerifiedAt: "2026-07-11T00:00:00.000Z",
      });
    }
  }
  return { root, stateRoot };
}

function authorize(toolName, args, callerHandle = "controller-thread", callerProjectDir = "") {
  return authorizeMcpToolCall({
    toolName,
    args,
    context: { enforceActor: true, callerHandle, callerProjectDir },
    defaultRoot: args.root,
    hostProfile,
  });
}

test("MCP actor guard blocks Design from controller writes and permits Design delivery", () => {
  const { root } = makeFixture();
  try {
    assert.throws(
      () => authorize("wakeflow_create_demand", { root, demandKey: "x", title: "X", apply: true }, "design-thread"),
      /caller window Design is design; required the demand controller Controller/,
    );
    assert.throws(
      () => authorize("wakeflow_initialize_workspace", { root, resetInitialization: true, apply: true }, "design-thread"),
      /caller window Design is design; required the demand controller Controller/,
    );
    assert.throws(
      () => authorize("wakeflow_register_window", { root, window: "Target", windowHandle: "new-target", apply: true }, "design-thread"),
      /caller window Design is design; required the demand controller Controller/,
    );
    assert.equal(
      authorize("wakeflow_deliver", { root, type: "research", designKey: "x", title: "X", apply: true }, "design-thread").actorRole,
      "design",
    );
    assert.throws(
      () => authorize("wakeflow_deliver", { root, type: "research", designKey: "x", title: "X", apply: true }),
      /caller window Controller is controller; required Design Design/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("MCP actor guard binds target result and controller-return writes to the target window", () => {
  const { root, stateRoot } = makeFixture();
  try {
    assert.equal(authorize("wakeflow_record_target_result", {
      root,
      stateRoot,
      targetWindow: "Target",
      taskId: "T1",
      status: "completed",
    }, "target-thread").actorWindow, "Target");
    assert.throws(
      () => authorize("wakeflow_record_target_result", {
        root,
        stateRoot,
        targetWindow: "Target",
        taskId: "T1",
        status: "completed",
      }),
      /required the result target Target/,
    );
    assert.equal(authorize("wakeflow_prepare_delivery", {
      root,
      direction: "controller-return",
      stateRoot,
      dispatchGroup: "G1",
      triggerTarget: "Target",
      triggerTaskId: "T1",
    }, "target-thread").actorWindow, "Target");
    assert.throws(
      () => authorize("wakeflow_prepare_delivery", {
        root,
        direction: "target",
        stateRoot,
        taskId: "T1",
      }, "design-thread"),
      /required the demand controller Controller/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("MCP actor guard validates delivery direction and pod controller ownership", () => {
  const { root, stateRoot } = makeFixture();
  try {
    const targetEnvelope = path.join(root, ".wakeflow-local/wakeflow-delivery/delivery-envelopes/target.json");
    writeJson(targetEnvelope, {
      kind: "DeliveryEnvelope",
      controllerWindow: "Controller",
      stateRef: { stateRoot },
    });
    const returnEnvelope = path.join(root, ".wakeflow-local/wakeflow-delivery/delivery-envelopes/return.json");
    writeJson(returnEnvelope, {
      kind: "ControllerReturnEnvelope",
      controllerWindow: "Controller",
      triggerTarget: "Target",
      stateRef: { stateRoot },
    });
    assert.equal(authorize("wakeflow_record_delivery", {
      root,
      deliveryFile: targetEnvelope,
      status: "sent",
    }).actorWindow, "Controller");
    assert.throws(
      () => authorize("wakeflow_record_delivery", { root, deliveryFile: targetEnvelope, status: "sent" }, "design-thread"),
      /required the demand controller Controller/,
    );
    assert.equal(authorize("wakeflow_record_delivery", {
      root,
      deliveryFile: returnEnvelope,
      status: "sent",
    }, "target-thread").actorWindow, "Target");

    const podStateRoot = ".wakeflow-active/current/pod-a";
    writeJson(path.join(root, podStateRoot, "wakeflow-state.json"), {
      demandKey: "pod-a",
      controllerWindow: "Controller__pod-a",
      state: "planned",
      revision: 1,
    });
    assert.equal(authorize("wakeflow_add_task", {
      root,
      stateRoot: podStateRoot,
      taskId: "T2",
      targetWindow: "Target__pod-a",
      summary: "Pod task",
    }, "pod-controller-thread").actorWindow, "Controller__pod-a");
    assert.throws(
      () => authorize("wakeflow_add_task", {
        root,
        stateRoot: podStateRoot,
        taskId: "T2",
        targetWindow: "Target__pod-a",
        summary: "Pod task",
      }),
      /required the demand controller Controller__pod-a/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("MCP actor guard fails closed for unknown handles and supports verified cwd fallback", () => {
  const { root } = makeFixture();
  try {
    assert.throws(
      () => authorize("wakeflow_create_demand", { root, demandKey: "x", title: "X", apply: true }, "unknown-thread"),
      /caller is not a registered Wakeflow window/,
    );
    assert.equal(authorize("wakeflow_deliver", {
      root,
      type: "research",
      designKey: "x",
      title: "X",
      apply: true,
    }, "", path.join(root, "Design")).actorWindow, "Design");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }

  const bootstrap = makeFixture({ registrations: false });
  try {
    assert.throws(
      () => authorize("wakeflow_create_demand", {
        root: bootstrap.root,
        demandKey: "x",
        title: "X",
        apply: true,
      }, "unknown-thread"),
      /caller is not a registered Wakeflow window/,
    );
    assert.equal(authorize("wakeflow_register_window", {
      root: bootstrap.root,
      window: "Controller",
      windowHandle: "new-controller-thread",
      apply: true,
    }, "new-controller-thread").actorSource, "controller-self-bootstrap");
    assert.throws(
      () => authorize("wakeflow_register_window", {
        root: bootstrap.root,
        window: "Target",
        windowHandle: "new-target-thread",
        apply: true,
      }, "new-target-thread"),
      /empty registry may bootstrap only/,
    );
    assert.throws(
      () => authorize("wakeflow_create_demand", {
        root: bootstrap.root,
        demandKey: "x",
        title: "X",
        apply: true,
      }, "", path.join(bootstrap.root, "Design")),
      /required the demand controller Controller/,
    );
  } finally {
    rmSync(bootstrap.root, { recursive: true, force: true });
  }
});

test("MCP handler propagates the verified actor into the machine audit trail", async () => {
  const { root } = makeFixture();
  try {
    assert.throws(
      () => handlers.wakeflow_create_demand({
        root,
        demandKey: "design-denied",
        title: "Design denied",
        apply: true,
      }, { enforceActor: true, callerHandle: "design-thread" }),
      /Wakeflow actor authorization failed/,
    );

    const result = await handlers.wakeflow_create_demand({
      root,
      demandKey: "controller-created",
      title: "Controller created",
      goal: "Prove actor audit propagation.",
      completionDefinition: "The state event records the verified controller window.",
      stagePlan: "Create only.",
      apply: true,
    }, { enforceActor: true, callerHandle: "controller-thread" });
    assert.equal(result.ok, true, result.stderr || result.stdout);
    const eventFile = path.join(root, ".wakeflow-active/current/controller-created/controller-events.jsonl");
    const events = readFileSync(eventFile, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    assert.equal(events[0].actor, "controller");
    assert.equal(events[0].actorWindow, "Controller");
    assert.equal(events[0].actorRole, "controller");
    assert.equal(events[0].actorVerified, true);

    const added = await handlers.wakeflow_add_task({
      root,
      stateRoot: ".wakeflow-active/current/controller-created",
      packageId: "P1",
      taskId: "T1",
      targetWindow: "Target",
      summary: "Projection refresh task",
      commitExpectation: "leave-uncommitted",
    }, { enforceActor: true, callerHandle: "controller-thread" });
    assert.equal(added.ok, true, added.stderr || added.stdout);
    assert.equal(added.projectionRefresh.ok, true);
    let state = JSON.parse(readFileSync(path.join(root, ".wakeflow-active/current/controller-created/wakeflow-state.json"), "utf8"));
    assert.equal(state.projection.status, "synced");

    const prepared = await handlers.wakeflow_prepare_delivery({
      root,
      direction: "target",
      stateRoot: ".wakeflow-active/current/controller-created",
      taskId: "T1",
      dispatchGroup: "G1",
    }, { enforceActor: true, callerHandle: "controller-thread" });
    assert.equal(prepared.ok, true, prepared.stderr || prepared.stdout);
    const deliveryFile = prepared.parsedJson.deliveryFile;
    const recorded = await handlers.wakeflow_record_delivery({
      root,
      deliveryFile,
      status: "sent",
      readbackOk: true,
      evidence: "target thread accepted the prompt",
    }, { enforceActor: true, callerHandle: "controller-thread" });
    assert.equal(recorded.ok, true, recorded.stderr || recorded.stdout);
    assert.equal(recorded.projectionRefresh.ok, true);
    state = JSON.parse(readFileSync(path.join(root, ".wakeflow-active/current/controller-created/wakeflow-state.json"), "utf8"));
    assert.equal(state.state, "dispatched");
    assert.equal(state.projection.status, "synced", "record-delivery MCP path refreshes the progress projection");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
