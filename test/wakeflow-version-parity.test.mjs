import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

// Guards W0-4 / RA7 (P1-6/F45): the five plugin/marketplace version fields must stay
// EQUAL so a bump cannot silently ship one edition or the marketplace entry out of step.
// Equality-only — this never asserts a specific number and never bumps (versions are
// user-controlled). Excluded by design: the catalog metadata.version (1.0.0, not a plugin
// version) and the codex .agents marketplace (carries no plugin version).

const versionSources = [
  { label: "codex plugin manifest", url: new URL("../plugins/codex-wakeflow/.codex-plugin/plugin.json", import.meta.url), pick: (j) => j.version },
  { label: "codex package.json", url: new URL("../plugins/codex-wakeflow/package.json", import.meta.url), pick: (j) => j.version },
  { label: "claude plugin manifest", url: new URL("../plugins/claude-code-wakeflow/.claude-plugin/plugin.json", import.meta.url), pick: (j) => j.version },
  { label: "claude package.json", url: new URL("../plugins/claude-code-wakeflow/package.json", import.meta.url), pick: (j) => j.version },
  { label: "marketplace plugins[0].version", url: new URL("../.claude-plugin/marketplace.json", import.meta.url), pick: (j) => j.plugins[0].version },
];

test("all five plugin/marketplace version fields are equal", async () => {
  const found = [];
  for (const src of versionSources) {
    const json = JSON.parse(await fs.readFile(src.url, "utf8"));
    const value = src.pick(json);
    assert.ok(typeof value === "string" && value.length > 0, `${src.label} must carry a version string`);
    found.push({ label: src.label, value });
  }
  const reference = found[0].value;
  for (const f of found) {
    assert.equal(
      f.value,
      reference,
      `${f.label} (${f.value}) must equal ${found[0].label} (${reference}) — bump every edition + the marketplace entry together`,
    );
  }
});
