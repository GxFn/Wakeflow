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
