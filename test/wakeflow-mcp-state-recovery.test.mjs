#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { handlers, tools } from "../core/lib/wakeflow-mcp-tools.mjs";

test("wakeflow_recover_state_transition exposes only the bounded recovery inputs", () => {
  const recovery = tools.find((tool) => tool.name === "wakeflow_recover_state_transition");
  assert.ok(recovery, "wakeflow_recover_state_transition must be registered");
  assert.deepEqual(recovery.inputSchema?.required, ["stateRoot"]);
  assert.deepEqual(
    Object.keys(recovery.inputSchema?.properties ?? {}).sort(),
    ["apply", "root", "stateRoot"],
  );
  assert.equal(recovery.inputSchema.properties.apply.type, "boolean");
  assert.equal(recovery.annotations.readOnlyHint, false);
  assert.equal(recovery.annotations.destructiveHint, false);
  assert.equal(recovery.annotations.idempotentHint, true);
  assert.equal(typeof handlers.wakeflow_recover_state_transition, "function");
});

test("wakeflow_recover_state_transition requires an explicit state root", () => {
  assert.throws(
    () => handlers.wakeflow_recover_state_transition({}),
    /wakeflow_recover_state_transition requires stateRoot/,
  );
});

test("wakeflow_recover_state_transition routes dry-run and apply to the state CLI", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "wakeflow-mcp-recovery-"));
  const stateRoot = ".wakeflow-active/current/RECOVERY";

  const dryRun = await handlers.wakeflow_recover_state_transition({ root, stateRoot });
  assert.equal(dryRun.script, "wakeflow-state");
  assert.deepEqual(dryRun.args, [
    "recover-state-transition",
    "--state-root", stateRoot,
    "--root", root,
    "--json",
  ]);

  const applied = await handlers.wakeflow_recover_state_transition({
    root,
    stateRoot,
    apply: true,
  });
  assert.equal(applied.script, "wakeflow-state");
  assert.deepEqual(applied.args, [
    "recover-state-transition",
    "--state-root", stateRoot,
    "--root", root,
    "--write",
    "--json",
  ]);
});
