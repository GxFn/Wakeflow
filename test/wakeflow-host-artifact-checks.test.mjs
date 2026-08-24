#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createHostArtifactChecks as createCodexHostArtifactChecks,
} from "../plugins/codex-wakeflow/scripts/lib/wakeflow-host-artifact-checks.mjs";
import {
  createHostArtifactChecks as createClaudeHostArtifactChecks,
} from "../plugins/claude-code-wakeflow/scripts/lib/wakeflow-host-artifact-checks.mjs";

function writeJson(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function factoryInput(root, errors) {
  return {
    root,
    errors,
    readJson(relativePath) {
      return JSON.parse(readFileSync(path.resolve(root, relativePath), "utf8"));
    },
    requireFile() {},
    requirePath() {},
    stripDotSlash(value) {
      return String(value).replace(/^\.\//u, "");
    },
  };
}

test("Codex host checks read the repository marketplace and bind its source to the artifact root", () => {
  const repositoryRoot = mkdtempSync(path.join(os.tmpdir(), "wakeflow-codex-marketplace-"));
  const artifactRoot = path.join(repositoryRoot, "plugins/codex-wakeflow");
  try {
    writeJson(path.join(artifactRoot, ".codex-plugin/plugin.json"), {
      name: "wakeflow",
      interface: { category: "Productivity" },
    });
    const marketplaceFile = path.join(repositoryRoot, ".agents/plugins/marketplace.json");
    const marketplace = {
      name: "gxfn",
      interface: { displayName: "GxFn" },
      plugins: [{
        name: "wakeflow",
        source: { source: "local", path: "./plugins/codex-wakeflow" },
        policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
        category: "Productivity",
      }],
    };
    writeJson(marketplaceFile, marketplace);

    const acceptedErrors = [];
    createCodexHostArtifactChecks(factoryInput(artifactRoot, acceptedErrors))
      .validateMarketplaceIfPresent();
    assert.deepEqual(acceptedErrors, []);

    marketplace.plugins[0].source.path = ".";
    writeJson(marketplaceFile, marketplace);
    const rejectedErrors = [];
    createCodexHostArtifactChecks(factoryInput(artifactRoot, rejectedErrors))
      .validateMarketplaceIfPresent();
    assert.ok(rejectedErrors.some((message) => message.includes("./plugins/codex-wakeflow")));
  } finally {
    rmSync(repositoryRoot, { recursive: true, force: true });
  }
});

test("Claude host checks bind the repository marketplace source to the artifact root", () => {
  const repositoryRoot = mkdtempSync(path.join(os.tmpdir(), "wakeflow-claude-marketplace-"));
  const artifactRoot = path.join(repositoryRoot, "plugins/claude-code-wakeflow");
  try {
    writeJson(path.join(artifactRoot, ".claude-plugin/plugin.json"), { name: "wakeflow" });
    const marketplaceFile = path.join(repositoryRoot, ".claude-plugin/marketplace.json");
    const marketplace = {
      name: "gxfn",
      owner: { name: "GxFn" },
      plugins: [{ name: "wakeflow", source: "./plugins/claude-code-wakeflow" }],
    };
    writeJson(marketplaceFile, marketplace);

    const acceptedErrors = [];
    createClaudeHostArtifactChecks(factoryInput(artifactRoot, acceptedErrors))
      .validateMarketplaceIfPresent();
    assert.deepEqual(acceptedErrors, []);

    marketplace.plugins[0].source = ".";
    writeJson(marketplaceFile, marketplace);
    const rejectedErrors = [];
    createClaudeHostArtifactChecks(factoryInput(artifactRoot, rejectedErrors))
      .validateMarketplaceIfPresent();
    assert.ok(rejectedErrors.some((message) => message.includes("./plugins/claude-code-wakeflow")));
  } finally {
    rmSync(repositoryRoot, { recursive: true, force: true });
  }
});

test("both host MCP wiring contracts reject inherited workspace-root environment defaults", () => {
  const cases = [
    [
      createCodexHostArtifactChecks,
      { command: "./bin/wakeflow-mcp", cwd: ".", args: [], env: { WAKEFLOW_DEFAULT_ROOT: "/tmp" } },
    ],
    [
      createClaudeHostArtifactChecks,
      { command: "${CLAUDE_PLUGIN_ROOT}/bin/wakeflow-mcp", args: [], env: { WAKEFLOW_DEFAULT_ROOT: "/tmp" } },
    ],
  ];
  for (const [factory, server] of cases) {
    const errors = [];
    factory(factoryInput("/tmp/wakeflow-host-check", errors)).validateMcpServerWiring(server);
    assert.ok(errors.some((message) => message.includes("public requests carry explicit root")));
  }
});
