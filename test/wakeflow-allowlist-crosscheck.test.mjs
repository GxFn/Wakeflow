import { runSync } from "../plugins/codex-wakeflow/lib/wakeflow-process.mjs";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

// Guards W0-3 / RA7 (P2-13/F8): wakeflow-check-scripts cross-checks that every runtime
// allow-list entry has at least one real caller and WARNS (never fails) on an orphan, so a
// retired-but-still-listed script is visible without breaking the pipeline before removal.
// Synthetic allow-list keeps this decoupled from the live compact-index orphan.

const checkScript = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../plugins/codex-wakeflow/scripts/wakeflow-check-scripts.mjs",
);

function writeFile(file, content) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${content.trimEnd()}\n`);
}

function makeFixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "wf-allowlist-"));
  const scriptsDir = path.join(root, "scripts");
  writeFile(path.join(scriptsDir, "wakeflow-called-fixture.mjs"), "#!/usr/bin/env node\n");
  writeFile(path.join(scriptsDir, "wakeflow-orphan-fixture.mjs"), "#!/usr/bin/env node\n");
  // a caller that references the called entry's logical name (the cross-check matches it)
  writeFile(
    path.join(scriptsDir, "wakeflow-caller.mjs"),
    '#!/usr/bin/env node\n// runWakeflowRuntime({ script: "wakeflow-called-fixture" });\n',
  );
  writeFile(
    path.join(scriptsDir, "README.md"),
    `
# Workspace Scripts

Current scripts:
- scripts/wakeflow-called-fixture.mjs: called fixture.
- scripts/wakeflow-orphan-fixture.mjs: orphan fixture.
- scripts/wakeflow-caller.mjs: caller fixture.
`,
  );
  // the runtime registry sibling triggers the cross-check; synthetic two-entry allow-list
  writeFile(
    path.join(root, "lib", "wakeflow-runtime.mjs"),
    `const allowedScripts = new Map([
  ["wakeflow-called-fixture", "wakeflow-called-fixture.mjs"],
  ["wakeflow-orphan-fixture", "wakeflow-orphan-fixture.mjs"],
]);
`,
  );
  return root;
}

test("allow-list cross-check warns on an orphan entry but not a called one", () => {
  const root = makeFixture();
  const result = runSync(process.execPath, [checkScript, "--root", root, "--json"], { encoding: "utf8" });
  // an orphan is a WARNING, never a failing issue
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.ok, true);
  const orphanWarnings = parsed.warnings.filter((w) => w.includes("wakeflow-orphan-fixture"));
  assert.equal(orphanWarnings.length, 1, "the orphan entry must be flagged exactly once");
  assert.match(orphanWarnings[0], /no detected caller/);
  assert.equal(
    parsed.warnings.some((w) => w.includes("wakeflow-called-fixture") && w.includes("no detected caller")),
    false,
    "a called entry must not be flagged as orphaned",
  );
});
