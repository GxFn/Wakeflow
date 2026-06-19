import assert from "node:assert/strict";
import test from "node:test";
import { tools } from "../plugins/codex-wakeflow/lib/wakeflow-mcp-tools.mjs";

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
