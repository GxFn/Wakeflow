import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

// Guards the reference-only demand `state` enum (W0-1 / RA7 / upgrade-plan P2-6/F19):
// the enum must list exactly the values the reducers write to `state.state`
// (plus `archived`, written by the planned archive-demand), with the transport
// `dispatched` present and the pure-vestige values dropped. Schema is reference-only
// (no runtime Ajv); this test is the contract guard in its place.

const schemaRel = "schemas/wakeflow-state-machine/wakeflow-state.schema.json";
const sources = {
  core: new URL("../core/" + schemaRel, import.meta.url),
  codex: new URL("../plugins/codex-wakeflow/" + schemaRel, import.meta.url),
  "claude-code": new URL("../plugins/claude-code-wakeflow/" + schemaRel, import.meta.url),
};

async function readStateEnum(url) {
  const json = JSON.parse(await fs.readFile(url, "utf8"));
  return json.properties.state.enum;
}

// Values the reducers actually assign to state.state, plus `archived` (written by
// the planned archive-demand). `dispatched` is asserted live at
// wakeflow-delivery.test.mjs and written at result-recording-commands.mjs.
const WRITTEN_OR_RESERVED = [
  "intake",
  "planned",
  "dispatched",
  "waiting-results",
  "review-ready",
  "needs-rework",
  "blocked",
  "completed",
  "archived",
];

// Removed: zero connection to state.state (never written, no state.state read-guard).
// `needs-confirmation` lives only in the Design-handoff confirmation set; `idle` only in
// the separate window/runtime status vocabulary — neither is a demand state.
const REMOVED_VESTIGE = ["idle", "designing", "needs-confirmation", "dispatching"];

test("demand state enum includes the transport-written 'dispatched'", async () => {
  const values = await readStateEnum(sources.core);
  assert.ok(values.includes("dispatched"), "enum must include the written 'dispatched' state");
});

test("demand state enum drops the pure-vestige values", async () => {
  const values = await readStateEnum(sources.core);
  for (const v of REMOVED_VESTIGE) {
    assert.ok(!values.includes(v), `enum must not include vestige value '${v}'`);
  }
});

test("every written/reserved demand state is present in the enum", async () => {
  const values = await readStateEnum(sources.core);
  for (const v of WRITTEN_OR_RESERVED) {
    assert.ok(values.includes(v), `enum must include written/reserved state '${v}'`);
  }
});

test("demand state enum is identical across core and both editions", async () => {
  const core = await readStateEnum(sources.core);
  for (const name of ["codex", "claude-code"]) {
    const edition = await readStateEnum(sources[name]);
    assert.deepEqual(edition, core, `${name} state enum must match core`);
  }
});
