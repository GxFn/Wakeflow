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

// Guards RA2: the unified per-task rollup is reachable as a read-only MCP tool.
test("wakeflow_task_ledger MCP tool is registered with a handler", () => {
  const ledger = tools.find((t) => t.name === "wakeflow_task_ledger");
  assert.ok(ledger, "wakeflow_task_ledger tool must be registered");
  const props = ledger.inputSchema?.properties ?? {};
  for (const field of ["stateRoot", "taskId", "targetWindow"]) {
    assert.equal(props[field]?.type, "string", `wakeflow_task_ledger must expose a string '${field}' input`);
  }
  assert.equal(typeof handlers.wakeflow_task_ledger, "function", "wakeflow_task_ledger must have a handler");
});

// Guards RA4: the per-window orientation card is reachable as a read-only MCP tool.
test("wakeflow_window_view MCP tool is registered with a handler", () => {
  const view = tools.find((t) => t.name === "wakeflow_window_view");
  assert.ok(view, "wakeflow_window_view tool must be registered");
  const props = view.inputSchema?.properties ?? {};
  for (const field of ["stateRoot", "window"]) {
    assert.equal(props[field]?.type, "string", `wakeflow_window_view must expose a string '${field}' input`);
  }
  assert.equal(typeof handlers.wakeflow_window_view, "function", "wakeflow_window_view must have a handler");
});

// Guards RA5 part 3: the focus-doc generator is reachable as an MCP tool (a write tool).
test("wakeflow_focus_doc MCP tool is registered with a handler", () => {
  const focus = tools.find((t) => t.name === "wakeflow_focus_doc");
  assert.ok(focus, "wakeflow_focus_doc tool must be registered");
  const props = focus.inputSchema?.properties ?? {};
  for (const field of ["stateRoot", "window", "phase", "apply"]) {
    assert.ok(props[field], `wakeflow_focus_doc must expose '${field}'`);
  }
  assert.equal(typeof handlers.wakeflow_focus_doc, "function", "wakeflow_focus_doc must have a handler");
});

test("wakeflow_claim_next MCP tool is registered with a handler", () => {
  const claim = tools.find((t) => t.name === "wakeflow_claim_next");
  assert.ok(claim, "wakeflow_claim_next tool must be registered");
  const props = claim.inputSchema?.properties ?? {};
  assert.equal(props.designKey?.type, "string", "wakeflow_claim_next must expose a string 'designKey' input");
  assert.equal(props.apply?.type, "boolean", "wakeflow_claim_next must expose a boolean 'apply' input");
  assert.equal(typeof handlers.wakeflow_claim_next, "function", "wakeflow_claim_next must have a handler");
});

test("wakeflow_prune_runtime MCP tool is registered with a handler", () => {
  const prune = tools.find((t) => t.name === "wakeflow_prune_runtime");
  assert.ok(prune, "wakeflow_prune_runtime tool must be registered");
  const props = prune.inputSchema?.properties ?? {};
  assert.equal(props.before?.type, "string", "wakeflow_prune_runtime must expose a string 'before' input");
  assert.equal(props.apply?.type, "boolean", "wakeflow_prune_runtime must expose a boolean 'apply' input");
  assert.equal(typeof handlers.wakeflow_prune_runtime, "function", "wakeflow_prune_runtime must have a handler");
});
