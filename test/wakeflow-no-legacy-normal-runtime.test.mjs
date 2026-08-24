import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  inspectLiteralModuleGraph,
  WAKEFLOW_HOST_NORMAL_ROOTS,
  WAKEFLOW_NORMAL_ROOTS,
  WAKEFLOW_RETIRED_NORMAL_RUNTIME_PATHS,
} from "./support/wakeflow-m7a-boundary.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactRoots = Object.freeze({
  core: path.join(repositoryRoot, "core"),
  codex: path.join(repositoryRoot, "plugins/codex-wakeflow"),
  claude: path.join(repositoryRoot, "plugins/claude-code-wakeflow"),
});

test("M7A and R67 remove the exact 63-file normal legacy island from core and both artifacts", () => {
  assert.equal(WAKEFLOW_RETIRED_NORMAL_RUNTIME_PATHS.length, 63);
  assert.equal(new Set(WAKEFLOW_RETIRED_NORMAL_RUNTIME_PATHS).size, 63);
  assert.deepEqual([...WAKEFLOW_RETIRED_NORMAL_RUNTIME_PATHS].sort(), WAKEFLOW_RETIRED_NORMAL_RUNTIME_PATHS);

  for (const [edition, root] of Object.entries(artifactRoots)) {
    for (const relativePath of WAKEFLOW_RETIRED_NORMAL_RUNTIME_PATHS) {
      assert.equal(existsSync(path.join(root, relativePath)), false, `${edition} still ships ${relativePath}`);
    }
  }
});

test("normal public and host roots have a closed literal graph with no retired dependency", () => {
  for (const [edition, root] of Object.entries({ codex: artifactRoots.codex, claude: artifactRoots.claude })) {
    const roots = [...WAKEFLOW_NORMAL_ROOTS, ...WAKEFLOW_HOST_NORMAL_ROOTS[edition]];
    const graph = inspectLiteralModuleGraph({ artifactRoot: root, roots });
    assert.deepEqual(graph.missingRoots, [], `${edition} normal root is missing`);
    assert.deepEqual(graph.boundaryViolations, [], `${edition} normal graph crossed its artifact boundary`);

    const retiredEdges = graph.edges.filter((edge) => WAKEFLOW_RETIRED_NORMAL_RUNTIME_PATHS.includes(edge.to));
    assert.deepEqual(retiredEdges, [], `${edition} normal graph references a retired file`);
    assert.deepEqual(
      graph.edges.filter((edge) => !edge.exists),
      [],
      `${edition} normal graph has an unresolved local dependency`,
    );
    assert.deepEqual(
      graph.edges.filter((edge) => !edge.admitted),
      [],
      `${edition} normal graph has a local dependency outside the admitted artifact tree`,
    );
  }
});

test("the current Claude executable surface is the thin v3 facade and Codex does not ship it", () => {
  assert.equal(
    existsSync(path.join(artifactRoots.claude, "scripts/lib/wakeflow-claude-host.mjs")),
    true,
  );
  assert.equal(
    existsSync(path.join(artifactRoots.claude, "scripts/lib/wakeflow-claude-lifecycle.mjs")),
    true,
  );
  assert.equal(
    existsSync(path.join(artifactRoots.codex, "scripts/lib/wakeflow-claude-host.mjs")),
    false,
  );
  assert.equal(
    existsSync(path.join(artifactRoots.codex, "scripts/lib/wakeflow-claude-lifecycle.mjs")),
    false,
  );
});
