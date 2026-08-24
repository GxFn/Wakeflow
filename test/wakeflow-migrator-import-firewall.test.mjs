import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  inspectLiteralModuleGraph,
  WAKEFLOW_BOOTSTRAP_CLOSURE_PATHS,
  WAKEFLOW_HOST_NORMAL_ROOTS,
  WAKEFLOW_MIGRATION_PARSER_PATHS,
  WAKEFLOW_NORMAL_ROOTS,
} from "./support/wakeflow-m7a-boundary.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifacts = Object.freeze({
  codex: path.join(repositoryRoot, "plugins/codex-wakeflow"),
  claude: path.join(repositoryRoot, "plugins/claude-code-wakeflow"),
});

test("normal public and current host graphs cannot reach the explicit migration parser", () => {
  for (const [edition, artifactRoot] of Object.entries(artifacts)) {
    const graph = inspectLiteralModuleGraph({
      artifactRoot,
      roots: [...WAKEFLOW_NORMAL_ROOTS, ...WAKEFLOW_HOST_NORMAL_ROOTS[edition]],
    });
    assert.deepEqual(graph.boundaryViolations, [], `${edition} normal graph crossed its artifact boundary`);
    assert.deepEqual(
      graph.visited.filter((file) => WAKEFLOW_MIGRATION_PARSER_PATHS.includes(file)),
      [],
      `${edition} normal graph reached migration-only code`,
    );
  }
});

test("the exact bootstrap entry retains its complete shared migration closure", () => {
  for (const [edition, artifactRoot] of Object.entries(artifacts)) {
    const graph = inspectLiteralModuleGraph({
      artifactRoot,
      roots: ["scripts/wakeflow-bootstrap.mjs"],
    });
    assert.deepEqual(graph.missingRoots, []);
    assert.deepEqual(graph.boundaryViolations, []);
    assert.deepEqual(graph.edges.filter((edge) => !edge.exists), []);
    assert.deepEqual(graph.edges.filter((edge) => !edge.admitted), []);
    for (const relativePath of WAKEFLOW_BOOTSTRAP_CLOSURE_PATHS) {
      assert.ok(graph.visited.includes(relativePath), `${edition} bootstrap misses ${relativePath}`);
    }
  }
});

test("no other shipped top-level script can start the migration parser", () => {
  for (const [edition, artifactRoot] of Object.entries(artifacts)) {
    const scriptsRoot = path.join(artifactRoot, "scripts");
    const entrypoints = readdirSync(scriptsRoot)
      .filter((name) => name.endsWith(".mjs") && name !== "wakeflow-bootstrap.mjs")
      .map((name) => `scripts/${name}`)
      .sort();
    for (const entrypoint of entrypoints) {
      const graph = inspectLiteralModuleGraph({ artifactRoot, roots: [entrypoint] });
      assert.deepEqual(graph.boundaryViolations, [], `${edition} ${entrypoint} crossed its artifact boundary`);
      assert.deepEqual(
        graph.visited.filter((file) => WAKEFLOW_MIGRATION_PARSER_PATHS.includes(file)),
        [],
        `${edition} ${entrypoint} reaches migration-only code`,
      );
    }
  }
});

test("literal graph inspection reports escaped and symbolic-link imports without traversing them", (t) => {
  const parentRoot = mkdtempSync(path.join(os.tmpdir(), "wakeflow-module-graph-"));
  t.after(() => rmSync(parentRoot, { recursive: true, force: true }));
  const artifactRoot = path.join(parentRoot, "artifact");
  const outsideFile = path.join(parentRoot, "outside.mjs");
  writeFileSync(outsideFile, "export const outside = true;\n");
  mkdirSync(artifactRoot);
  writeFileSync(
    path.join(artifactRoot, "entry.mjs"),
    'import "../outside.mjs";\nimport "./linked.mjs";\n',
  );
  symlinkSync(outsideFile, path.join(artifactRoot, "linked.mjs"));

  const graph = inspectLiteralModuleGraph({ artifactRoot, roots: ["entry.mjs"] });
  assert.deepEqual(graph.visited, ["entry.mjs"]);
  assert.deepEqual(
    graph.boundaryViolations.map(({ reason, to }) => ({ reason, to })),
    [
      { reason: "import-escaped-artifact", to: "../outside.mjs" },
      { reason: "import-symbolic-link", to: "linked.mjs" },
    ],
  );
  assert.deepEqual(graph.edges.filter(({ admitted }) => admitted), []);
});

test("bootstrap remains an explicit packaged path, not a normal package bin or MCP command", () => {
  for (const [edition, artifactRoot] of Object.entries(artifacts)) {
    const packageJson = JSON.parse(readFileSync(path.join(artifactRoot, "package.json"), "utf8"));
    assert.deepEqual(packageJson.bin, { "wakeflow-mcp": "./mcp/server.cjs" });
    const mcpSource = readFileSync(path.join(artifactRoot, "lib/wakeflow-mcp-tools.mjs"), "utf8");
    const cliSource = readFileSync(path.join(artifactRoot, "scripts/wakeflow-cli.mjs"), "utf8");
    assert.doesNotMatch(mcpSource, /wakeflow-bootstrap|wakeflow_migrat/iu, edition);
    assert.doesNotMatch(cliSource, /wakeflow-bootstrap|wakeflow_migrat/iu, edition);
  }
});
