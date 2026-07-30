import assert from "node:assert/strict";
import test from "node:test";
import { tools, handlers } from "../plugins/codex-wakeflow/lib/wakeflow-mcp-tools.mjs";

// Guards W0-2 / RA7 (F17/F39): the runtime-residue gate must be reachable by an
// installed MCP-only controller, so wakeflow_verify exposes withRuntime/strictRuntime
// (the CLI already consumes --with-runtime/--strict-runtime; the handler forwards them).

test("wakeflow_verify MCP tool exposes the runtime-residue flags", () => {
  const verify = tools.find((t) => t.name === "wakeflow_verify");
  assert.ok(verify, "wakeflow_verify tool must be registered");
  const props = verify.inputSchema?.properties ?? {};
  for (const flag of ["scriptTests", "withRuntime", "strictRuntime"]) {
    assert.equal(
      props[flag]?.type,
      "boolean",
      `wakeflow_verify must expose a boolean '${flag}' input`,
    );
  }
});

// Guards RA2/RA4/RA5p3 (converged): the per-task rollup, per-window orientation card,
// the focus-doc generator, and the evidence-spine trace are reachable through the unified
// read/projection tool wakeflow_view, selected by scope.
test("wakeflow_view MCP tool is registered with a handler and scope routing", () => {
  const view = tools.find((t) => t.name === "wakeflow_view");
  assert.ok(view, "wakeflow_view tool must be registered");
  const props = view.inputSchema?.properties ?? {};
  assert.deepEqual(view.inputSchema?.required, ["scope"]);
  assert.deepEqual(
    props.scope?.enum,
    ["task-ledger", "window", "focus", "trace", "storage"],
    "wakeflow_view scope must enumerate task-ledger|window|focus|trace|storage",
  );
  // Inputs fused from the former task_ledger / window_view / focus_doc / trace_spine tools.
  for (const field of [
    "stateRoot", "taskId", "targetWindow", "window", "phase", "apply", "dispatchGroup", "deliveryId",
  ]) {
    assert.ok(props[field], `wakeflow_view must expose '${field}'`);
  }
  assert.equal(typeof handlers.wakeflow_view, "function", "wakeflow_view must have a handler");
});

test("wakeflow_claim_next MCP tool is registered with a handler", () => {
  const claim = tools.find((t) => t.name === "wakeflow_claim_next");
  assert.ok(claim, "wakeflow_claim_next tool must be registered");
  const props = claim.inputSchema?.properties ?? {};
  assert.equal(props.designKey?.type, "string", "wakeflow_claim_next must expose a string 'designKey' input");
  assert.equal(props.apply?.type, "boolean", "wakeflow_claim_next must expose a boolean 'apply' input");
  assert.equal(typeof handlers.wakeflow_claim_next, "function", "wakeflow_claim_next must have a handler");
});

test("task-package MCP tools expose bounded acceptance anchors", () => {
  const addTask = tools.find((tool) => tool.name === "wakeflow_add_task");
  const createDemand = tools.find((tool) => tool.name === "wakeflow_create_demand");
  const continueDemand = tools.find((tool) => tool.name === "wakeflow_continue_demand");
  assert.equal(addTask.inputSchema.properties.acceptanceAnchors.type, "array");
  assert.equal(
    createDemand.inputSchema.properties.taskPackages.items.properties.acceptanceAnchors.type,
    "array",
  );
  assert.equal(continueDemand.inputSchema.properties.acceptanceAnchors.type, "array");
});

test("wakeflow_prune_runtime MCP tool is registered with a handler", () => {
  const prune = tools.find((t) => t.name === "wakeflow_prune_runtime");
  assert.ok(prune, "wakeflow_prune_runtime tool must be registered");
  const props = prune.inputSchema?.properties ?? {};
  assert.equal(props.before?.type, "string", "wakeflow_prune_runtime must expose a string 'before' input");
  assert.equal(props.apply?.type, "boolean", "wakeflow_prune_runtime must expose a boolean 'apply' input");
  assert.equal(typeof handlers.wakeflow_prune_runtime, "function", "wakeflow_prune_runtime must have a handler");
});

// Guards RA6 (converged): demand/todo/docs archival is reachable through the unified
// wakeflow_archive tool selected by target; the demand redaction-guard inputs survive
// the merge. Transport-runtime GC stays separate as wakeflow_prune_runtime (asserted above).
test("wakeflow_archive MCP tool is registered with a handler and target routing", () => {
  const archive = tools.find((t) => t.name === "wakeflow_archive");
  assert.ok(archive, "wakeflow_archive tool must be registered");
  const props = archive.inputSchema?.properties ?? {};
  assert.deepEqual(archive.inputSchema?.required, ["target"]);
  assert.deepEqual(
    props.target?.enum,
    ["demand", "todo", "docs"],
    "wakeflow_archive target must enumerate demand|todo|docs",
  );
  // demand redaction-guard inputs + todo/docs inputs fused into one tool.
  assert.equal(props.redact?.type, "boolean", "wakeflow_archive must keep a boolean 'redact' input (target=demand)");
  for (const field of ["stateRoot", "reason", "evidenceRefs", "month", "date", "files", "topic", "apply"]) {
    assert.ok(props[field], `wakeflow_archive must expose '${field}'`);
  }
  assert.equal(typeof handlers.wakeflow_archive, "function", "wakeflow_archive must have a handler");
});

test("wakeflow_archive target=demand fails closed before runtime when required inputs are missing", async () => {
  await assert.rejects(
    handlers.wakeflow_archive({ target: "demand" }),
    /wakeflow_archive target=demand requires stateRoot/,
  );
  await assert.rejects(
    handlers.wakeflow_archive({ target: "demand", stateRoot: ".wakeflow-active/current/x" }),
    /wakeflow_archive target=demand requires reason/,
  );
});

test("wakeflow_sanitize_archive exposes only the bounded archived-root repair inputs", () => {
  const sanitize = tools.find((tool) => tool.name === "wakeflow_sanitize_archive");
  assert.ok(sanitize, "wakeflow_sanitize_archive tool must be registered");
  assert.deepEqual(sanitize.inputSchema?.required, ["stateRoot", "reason"]);
  assert.deepEqual(Object.keys(sanitize.inputSchema?.properties ?? {}).sort(), ["apply", "reason", "root", "stateRoot"]);
  assert.equal(typeof handlers.wakeflow_sanitize_archive, "function");
  assert.throws(
    () => handlers.wakeflow_sanitize_archive({}),
    /wakeflow_sanitize_archive requires stateRoot/,
  );
  assert.throws(
    () => handlers.wakeflow_sanitize_archive({ stateRoot: "wakeflow-ledger/workspace/archive/x" }),
    /wakeflow_sanitize_archive requires reason/,
  );
});
