import assert from "node:assert/strict";
import test from "node:test";
import { handlers, tools } from "../core/lib/wakeflow-mcp-tools.mjs";

test("wakeflow_recover_state_transition exposes one closed owner-selected v3 envelope", () => {
  const recovery = tools.find((tool) => tool.name === "wakeflow_recover_state_transition");
  assert.ok(recovery, "wakeflow_recover_state_transition must be registered");
  assert.deepEqual(recovery.inputSchema?.required, ["root", "operation", "request"]);
  assert.deepEqual(
    Object.keys(recovery.inputSchema?.properties ?? {}),
    ["root", "demandId", "operation", "request"],
  );
  assert.deepEqual(recovery.inputSchema.properties.operation.enum, ["generic", "lifecycle"]);
  assert.equal(recovery.inputSchema.properties.request.type, "object");
  assert.equal(recovery.inputSchema.additionalProperties, false);
  assert.equal(recovery.annotations.readOnlyHint, false);
  assert.equal(recovery.annotations.destructiveHint, false);
  assert.equal(recovery.annotations.idempotentHint, true);
  assert.equal(typeof handlers.wakeflow_recover_state_transition, "function");
});

test("wakeflow_recover_state_transition rejects retired flattened dry-run/apply inputs", async () => {
  await assert.rejects(
    handlers.wakeflow_recover_state_transition({}),
    (error) => error?.code === "wakeflow-public-mcp-domain",
  );
  await assert.rejects(
    handlers.wakeflow_recover_state_transition({
      root: "/tmp/legacy-recovery",
      stateRoot: ".wakeflow-active/current/RECOVERY",
      apply: true,
    }),
    (error) => error?.code === "wakeflow-public-mcp-domain",
  );
});
