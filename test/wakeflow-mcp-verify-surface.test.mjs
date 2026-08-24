import assert from "node:assert/strict";
import test from "node:test";
import { tools, handlers } from "../plugins/codex-wakeflow/lib/wakeflow-mcp-tools.mjs";

const routedOperations = Object.freeze({
  wakeflow_status: ["inspect"],
  wakeflow_replace_windows: ["inspect", "replace", "decommission"],
  wakeflow_register_window: ["register"],
  wakeflow_create_demand: ["preview", "apply", "recover"],
  wakeflow_add_task: ["create"],
  wakeflow_prepare_delivery: [
    "target-preview",
    "target-apply",
    "target-claim",
    "target-rearm",
    "controller-preview",
    "controller-apply",
    "controller-pre-send",
  ],
  wakeflow_record_delivery: ["target-outcome", "controller-outcome"],
  wakeflow_record_target_result: ["import"],
  wakeflow_review_pack: ["group", "trace"],
  wakeflow_reduce_results: ["create"],
  wakeflow_decide_review: ["decide"],
  wakeflow_complete_demand: ["preview", "apply", "recover"],
  wakeflow_continue_demand: ["create"],
  wakeflow_recover_state_transition: ["generic", "lifecycle"],
  wakeflow_release_window_lock: ["release"],
  wakeflow_view: ["config", "storage", "verification", "result-trace"],
  wakeflow_storage_preserve: ["inspect", "preview", "preview-release", "apply", "recover"],
  wakeflow_archive: ["preview", "apply", "inspect", "recover"],
  wakeflow_intake_test_card: ["create"],
  wakeflow_deliver: ["append"],
  wakeflow_next_work: ["inspect"],
  wakeflow_claim_next: ["inspect", "claim", "recover"],
  wakeflow_cancel_demand: ["preview", "apply", "recover"],
  wakeflow_pod_open: [
    "inspect-materialization",
    "plan-materialization",
    "launch-preview",
    "launch-apply",
    "product-preview",
    "product-apply",
  ],
  wakeflow_pod_record: [
    "record-materialization",
    "design-handoff",
    "test-access-observe",
    "test-access-receipt",
    "close-observe",
    "close-receipt",
  ],
  wakeflow_pod_bind: ["creation-receipt", "binding-decommission"],
  wakeflow_pod_plan: [
    "design-request",
    "test-access-plan",
    "test-access-inspect",
    "close-intent",
    "close-inspect",
  ],
  wakeflow_prune_runtime: ["preview", "apply", "recover"],
  wakeflow_verify: ["inspect"],
});

test("every routed public v3 tool exposes one closed owner envelope and exact operations", () => {
  for (const [name, operations] of Object.entries(routedOperations)) {
    const tool = tools.find((entry) => entry.name === name);
    assert.ok(tool, `${name} must be registered`);
    assert.deepEqual(tool.inputSchema.required, ["root", "operation", "request"], name);
    assert.deepEqual(Object.keys(tool.inputSchema.properties), ["root", "demandId", "operation", "request"], name);
    assert.deepEqual(tool.inputSchema.properties.operation.enum, operations, name);
    assert.equal(tool.inputSchema.properties.request.type, "object", name);
    assert.equal(tool.inputSchema.additionalProperties, false, name);
    assert.equal(typeof handlers[name], "function", `${name} must have one handler`);
  }
});

test("all public tools publish the exact read-only and destructive annotation matrix", () => {
  const readOnly = new Set([
    "wakeflow_status",
    "wakeflow_review_pack",
    "wakeflow_view",
    "wakeflow_next_work",
    "wakeflow_verify",
  ]);
  const destructive = new Set([
    "wakeflow_maintain_workspace",
    "wakeflow_replace_windows",
    "wakeflow_release_window_lock",
    "wakeflow_storage_preserve",
    "wakeflow_archive",
    "wakeflow_pod_bind",
    "wakeflow_prune_runtime",
  ]);
  for (const tool of tools) {
    assert.equal(tool.annotations.readOnlyHint, readOnly.has(tool.name), tool.name);
    assert.equal(tool.annotations.destructiveHint, destructive.has(tool.name), tool.name);
    assert.equal(tool.annotations.idempotentHint, true, tool.name);
    assert.equal(tool.annotations.openWorldHint, false, tool.name);
  }
});

test("wakeflow_status remains the only live status operation", async () => {
  const view = tools.find((entry) => entry.name === "wakeflow_view");
  assert.equal(view.inputSchema.properties.operation.enum.includes("status"), false);
  assert.match(view.description, /live status remains owned by wakeflow_status/u);
  await assert.rejects(
    handlers.wakeflow_view({
      root: process.cwd(),
      operation: "status",
      request: { language: "zh" },
    }),
    (error) => error?.code === "wakeflow-public-mcp-domain"
      && error?.details?.causeCode === "wakeflow-public-v3-operation",
  );
});

test("public v3 keeps host effects and whole-demand archive ownership explicit", () => {
  const prepare = tools.find((entry) => entry.name === "wakeflow_prepare_delivery");
  const record = tools.find((entry) => entry.name === "wakeflow_record_delivery");
  const archive = tools.find((entry) => entry.name === "wakeflow_archive");
  const preserve = tools.find((entry) => entry.name === "wakeflow_storage_preserve");

  assert.match(prepare.description, /without executing a host send/);
  assert.match(record.description, /not the host-effect fence/);
  assert.match(archive.description, /portable whole-demand BusinessArchive/);
  assert.match(preserve.description, /typed local preservation mutation/);
  assert.equal(tools.some((entry) => entry.name === "wakeflow_sanitize_archive"), false);
  assert.equal(tools.some((entry) => entry.name === "wakeflow_render_progress"), false);
  assert.equal(tools.some((entry) => entry.name === "wakeflow_pod_list"), false);
});

test("legacy flattened requests are rejected by the normal v3 handler boundary", async () => {
  await assert.rejects(
    handlers.wakeflow_view({ scope: "storage" }),
    (error) => error?.code === "wakeflow-public-mcp-domain",
  );
  await assert.rejects(
    handlers.wakeflow_archive({ target: "sanitize-demand" }),
    (error) => error?.code === "wakeflow-public-mcp-domain",
  );
});
