#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const workspaceRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const checkScript = path.join(workspaceRoot, "scripts/check-script-docs.mjs");

function writeFile(file, content) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${content.trimEnd()}\n`);
}

function makeFixture({ includeRuntimeInReadme = true, includeTestInVerifier = true } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), "script-docs-"));
  const scriptsDir = path.join(root, "scripts");
  mkdirSync(scriptsDir, { recursive: true });
  writeFile(path.join(scriptsDir, "foo.mjs"), "#!/usr/bin/env node\n");
  writeFile(path.join(scriptsDir, "foo.test.mjs"), "#!/usr/bin/env node\n");
  writeFile(
    path.join(scriptsDir, "README.md"),
    `
# Workspace Scripts

Current scripts:
${includeRuntimeInReadme ? "- scripts/foo.mjs: fixture script." : ""}
- scripts/verify-control-center.mjs: fixture verifier.

Workspace script tests:

\`\`\`bash
node --test scripts/foo.test.mjs
\`\`\`
`,
  );
  writeFile(
    path.join(scriptsDir, "verify-control-center.mjs"),
    includeTestInVerifier
      ? 'const args = ["--test", "scripts/foo.test.mjs"];\n'
      : 'const args = ["--test"];\n',
  );
  return root;
}

function run(root) {
  return spawnSync("node", [checkScript, "--root", root, "--json"], {
    encoding: "utf8",
  });
}

test("passes when scripts, tests, README, and verifier are aligned", () => {
  const result = run(makeFixture());
  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.runtimeScriptCount, 2);
  assert.equal(parsed.testScriptCount, 1);
});

test("fails when a runtime script is missing from README", () => {
  const result = run(makeFixture({ includeRuntimeInReadme: false }));
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /foo\.mjs is not documented/);
});

test("fails when a test script is missing from verify-control-center", () => {
  const result = run(makeFixture({ includeTestInVerifier: false }));
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /foo\.test\.mjs is not included/);
});

test("fails when a script uses direct process.exit", () => {
  const root = makeFixture();
  writeFile(path.join(root, "scripts/foo.mjs"), "#!/usr/bin/env node\nprocess.exit(1);\n");
  const result = run(root);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /foo\.mjs:2 uses process\.exit/);
});
