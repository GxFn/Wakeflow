import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sharedModulePath = path.join(
  repositoryRoot,
  "core/scripts/lib/wakeflow-host-activation-scope.mjs",
);
const codexModulePath = path.join(
  repositoryRoot,
  "plugins/codex-wakeflow/scripts/lib/wakeflow-codex-activation-scope.mjs",
);
const claudeModulePath = path.join(
  repositoryRoot,
  "plugins/claude-code-wakeflow/scripts/lib/wakeflow-claude-activation-scope.mjs",
);

const WORKSPACE_SUBJECT_DIGEST = `sha256:${"a".repeat(64)}`;
const OTHER_WORKSPACE_SUBJECT_DIGEST = `sha256:${"b".repeat(64)}`;
const OBSERVED_AT = "2026-08-09T12:00:00.000Z";

const SHARED_EXPORTS = Object.freeze([
  "HOST_ACTIVATION_SCOPES",
  "WAKEFLOW_HOST_ACTIVATION_SCOPE_KIND",
  "WAKEFLOW_HOST_ACTIVATION_SCOPE_SCHEMA_VERSION",
  "WakeflowHostActivationScopeError",
  "hostActivationScopeCanonicalBytes",
  "hostActivationScopeDigest",
  "validateHostActivationScopeObservation",
]);
const CODEX_EXPORTS = Object.freeze([
  "WAKEFLOW_CODEX_ACTIVATION_SCOPE_HOST_ID",
  "WAKEFLOW_CODEX_ACTIVATION_SCOPE_PLUGIN_ID",
  "WakeflowCodexActivationScopeError",
  "inspectCodexHostActivationScope",
  "wakeflowHostActivationScopeAdapter",
]);
const CLAUDE_EXPORTS = Object.freeze([
  "WAKEFLOW_CLAUDE_ACTIVATION_SCOPE_HOST_ID",
  "WAKEFLOW_CLAUDE_ACTIVATION_SCOPE_PLUGIN_ID",
  "WAKEFLOW_CLAUDE_INSTALLATION_OBSERVATION_KIND",
  "WAKEFLOW_CLAUDE_INSTALLATION_OBSERVATION_SCHEMA_VERSION",
  "WakeflowClaudeActivationScopeError",
  "inspectClaudeHostActivationScope",
  "wakeflowHostActivationScopeAdapter",
]);

async function loadModules() {
  return Promise.all([
    import(pathToFileURL(sharedModulePath).href),
    import(pathToFileURL(codexModulePath).href),
    import(pathToFileURL(claudeModulePath).href),
  ]);
}

function claudeHostObservation(effectiveScopes, complete = true) {
  return {
    kind: "ClaudePluginInstallationScopeObservation",
    schemaVersion: 1,
    complete,
    effectiveScopes,
  };
}

async function inspectClaude(effectiveScopes, {
  complete = true,
  workspaceSubjectDigest = WORKSPACE_SUBJECT_DIGEST,
  onRequest = null,
} = {}) {
  const { inspectClaudeHostActivationScope } = await import(pathToFileURL(claudeModulePath).href);
  return inspectClaudeHostActivationScope({ workspaceSubjectDigest }, {
    observeInstallation: async (request) => {
      onRequest?.(request);
      return claudeHostObservation(effectiveScopes, complete);
    },
    clock: () => OBSERVED_AT,
  });
}

test("M4-T13 exposes one transient scope codec and two asymmetric host observers", async () => {
  assert.equal(existsSync(sharedModulePath), true);
  assert.equal(existsSync(codexModulePath), true);
  assert.equal(existsSync(claudeModulePath), true);
  const [shared, codex, claude] = await loadModules();
  assert.deepEqual(Object.keys(shared).sort(), [...SHARED_EXPORTS].sort());
  assert.deepEqual(Object.keys(codex).sort(), [...CODEX_EXPORTS].sort());
  assert.deepEqual(Object.keys(claude).sort(), [...CLAUDE_EXPORTS].sort());
  for (const [hostId, module] of [["codex", codex], ["claude-code", claude]]) {
    assert.equal(Object.isFrozen(module.wakeflowHostActivationScopeAdapter), true);
    assert.deepEqual(
      Object.keys(module.wakeflowHostActivationScopeAdapter).sort(),
      ["hostId", "inspect", "pluginId"],
    );
    assert.equal(module.wakeflowHostActivationScopeAdapter.hostId, hostId);
    assert.equal(module.wakeflowHostActivationScopeAdapter.pluginId, "wakeflow@gxfn");
    assert.equal(typeof module.wakeflowHostActivationScopeAdapter.inspect, "function");
  }
  assert.deepEqual(shared.HOST_ACTIVATION_SCOPES, ["per-workspace", "host-wide", "unknown"]);
  assert.equal(Object.isFrozen(shared.HOST_ACTIVATION_SCOPES), true);
});

test("M4-T13 Codex cannot accept a caller scope and always returns unknown manual coverage", async () => {
  const [shared, codex] = await Promise.all([
    import(pathToFileURL(sharedModulePath).href),
    import(pathToFileURL(codexModulePath).href),
  ]);
  const result = await codex.inspectCodexHostActivationScope({
    workspaceSubjectDigest: WORKSPACE_SUBJECT_DIGEST,
  }, {
    clock: () => OBSERVED_AT,
  });
  assert.equal(result.hostId, "codex");
  assert.equal(result.pluginId, "wakeflow@gxfn");
  assert.equal(result.workspaceSubjectDigest, WORKSPACE_SUBJECT_DIGEST);
  assert.equal(result.scope, "unknown");
  assert.equal(result.evidence.kind, "host-observation-unavailable");
  assert.equal(result.evidence.digest, null);
  assert.equal(result.evidence.reasonCode, "host-observation-unavailable");
  assert.equal(result.unattendedEligibility, "forbidden");
  assert.equal(result.observedAt, OBSERVED_AT);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.evidence), true);
  assert.equal(
    shared.hostActivationScopeCanonicalBytes(result).toString("utf8").endsWith("\n"),
    true,
  );
  assert.equal(shared.hostActivationScopeDigest(result), shared.hostActivationScopeDigest(result));
  await assert.rejects(
    codex.inspectCodexHostActivationScope({
      workspaceSubjectDigest: WORKSPACE_SUBJECT_DIGEST,
      scope: "per-workspace",
    }, { clock: () => OBSERVED_AT }),
    /unknown|scope|contract/iu,
  );
  assert.throws(
    () => shared.validateHostActivationScopeObservation({ ...result, workspaceRoot: "/private/work" }),
    /unknown|field|contract/iu,
  );
  assert.throws(
    () => shared.validateHostActivationScopeObservation({
      ...result,
      observedAt: "2026-02-31T12:00:00.000Z",
    }),
    (error) => error?.code === "wakeflow-host-activation-scope-time",
  );
  await assert.rejects(
    codex.inspectCodexHostActivationScope({
      workspaceSubjectDigest: WORKSPACE_SUBJECT_DIGEST,
    }, {
      clock: () => "2026-02-31T12:00:00.000Z",
    }),
    (error) => error?.code === "wakeflow-codex-activation-scope-time",
  );
});

test("M4-T13 Claude maps only exact current project or local evidence to per-workspace", async () => {
  let observerRequest;
  const project = await inspectClaude([
    { scope: "project", workspaceSubjectDigest: WORKSPACE_SUBJECT_DIGEST },
  ], { onRequest: (request) => { observerRequest = request; } });
  assert.deepEqual(Object.keys(observerRequest).sort(), ["hostId", "pluginId", "workspaceSubjectDigest"]);
  assert.deepEqual(observerRequest, {
    hostId: "claude-code",
    pluginId: "wakeflow@gxfn",
    workspaceSubjectDigest: WORKSPACE_SUBJECT_DIGEST,
  });
  assert.equal(Object.isFrozen(observerRequest), true);
  assert.equal(project.scope, "per-workspace");
  assert.equal(project.evidence.kind, "exact-host-installation-observation");
  assert.match(project.evidence.digest, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(project.evidence.reasonCode, "workspace-scoped-installation-observed");
  assert.equal(project.unattendedEligibility, "m6-evaluation-required");
  assert.equal(JSON.stringify(project).includes("project"), false);

  const combined = await inspectClaude([
    { scope: "local", workspaceSubjectDigest: WORKSPACE_SUBJECT_DIGEST },
    { scope: "project", workspaceSubjectDigest: WORKSPACE_SUBJECT_DIGEST },
  ]);
  const reversed = await inspectClaude([
    { scope: "project", workspaceSubjectDigest: WORKSPACE_SUBJECT_DIGEST },
    { scope: "local", workspaceSubjectDigest: WORKSPACE_SUBJECT_DIGEST },
  ]);
  assert.equal(combined.scope, "per-workspace");
  assert.equal(combined.evidence.digest, reversed.evidence.digest);
});

test("M4-T13 Claude broad scopes are host-wide and never unattended", async () => {
  for (const scope of ["user", "managed"]) {
    const result = await inspectClaude([{ scope, workspaceSubjectDigest: null }]);
    assert.equal(result.scope, "host-wide", scope);
    assert.equal(result.evidence.kind, "exact-host-installation-observation");
    assert.equal(result.evidence.reasonCode, "host-wide-installation-observed");
    assert.equal(result.unattendedEligibility, "forbidden");
  }
  const broadWins = await inspectClaude([
    { scope: "project", workspaceSubjectDigest: WORKSPACE_SUBJECT_DIGEST },
    { scope: "user", workspaceSubjectDigest: null },
  ]);
  assert.equal(broadWins.scope, "host-wide");
  assert.equal(broadWins.unattendedEligibility, "forbidden");
});

test("M4-T13 Claude absence, incomplete, session-only, and ambiguous coverage remain unknown", async () => {
  const cases = [
    {
      name: "empty",
      effectiveScopes: [],
      reasonCode: "no-active-installation-observed",
    },
    {
      name: "incomplete",
      effectiveScopes: [
        { scope: "project", workspaceSubjectDigest: WORKSPACE_SUBJECT_DIGEST },
      ],
      complete: false,
      reasonCode: "host-observation-incomplete",
    },
    {
      name: "session-only",
      effectiveScopes: [{ scope: "session", workspaceSubjectDigest: null }],
      reasonCode: "session-only-installation-observed",
    },
    {
      name: "another-workspace",
      effectiveScopes: [
        { scope: "project", workspaceSubjectDigest: OTHER_WORKSPACE_SUBJECT_DIGEST },
      ],
      reasonCode: "host-observation-ambiguous",
    },
    {
      name: "mixed-session-and-project",
      effectiveScopes: [
        { scope: "project", workspaceSubjectDigest: WORKSPACE_SUBJECT_DIGEST },
        { scope: "session", workspaceSubjectDigest: null },
      ],
      reasonCode: "host-observation-ambiguous",
    },
  ];
  for (const fixture of cases) {
    const result = await inspectClaude(fixture.effectiveScopes, {
      complete: fixture.complete ?? true,
    });
    assert.equal(result.scope, "unknown", fixture.name);
    assert.equal(result.evidence.reasonCode, fixture.reasonCode, fixture.name);
    assert.equal(result.unattendedEligibility, "forbidden", fixture.name);
  }

  const { inspectClaudeHostActivationScope } = await import(pathToFileURL(claudeModulePath).href);
  const unavailable = await inspectClaudeHostActivationScope({
    workspaceSubjectDigest: WORKSPACE_SUBJECT_DIGEST,
  }, {
    clock: () => OBSERVED_AT,
  });
  assert.equal(unavailable.scope, "unknown");
  assert.equal(unavailable.evidence.kind, "host-observation-unavailable");
  assert.equal(unavailable.evidence.digest, null);

  const failed = await inspectClaudeHostActivationScope({
    workspaceSubjectDigest: WORKSPACE_SUBJECT_DIGEST,
  }, {
    observeInstallation: async () => {
      throw new Error("private host path /Users/example/.claude/settings.json");
    },
    clock: () => OBSERVED_AT,
  });
  assert.equal(failed.scope, "unknown");
  assert.equal(JSON.stringify(failed).includes("/Users/example"), false);

  const malformed = await inspectClaudeHostActivationScope({
    workspaceSubjectDigest: WORKSPACE_SUBJECT_DIGEST,
  }, {
    observeInstallation: async () => ({ scope: "per-workspace", workspaceRoot: "/private/work" }),
    clock: () => OBSERVED_AT,
  });
  assert.equal(malformed.scope, "unknown");
  assert.equal(malformed.evidence.digest, null);
});

test("M4-T13 Claude rejects behavioral or decorated scope arrays without executing slots", async () => {
  const { inspectClaudeHostActivationScope } = await import(pathToFileURL(claudeModulePath).href);
  const cases = [];

  const hidden = [
    { scope: "project", workspaceSubjectDigest: WORKSPACE_SUBJECT_DIGEST },
  ];
  Object.defineProperty(hidden, "authority", { value: "host-wide", enumerable: false });
  cases.push(hidden);

  const symbol = [
    { scope: "project", workspaceSubjectDigest: WORKSPACE_SUBJECT_DIGEST },
  ];
  symbol[Symbol("authority")] = "host-wide";
  cases.push(symbol);

  const customPrototype = [
    { scope: "project", workspaceSubjectDigest: WORKSPACE_SUBJECT_DIGEST },
  ];
  Object.setPrototypeOf(customPrototype, { map: Array.prototype.map });
  cases.push(customPrototype);

  let getterCalls = 0;
  const accessor = new Array(1);
  Object.defineProperty(accessor, "0", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return { scope: "project", workspaceSubjectDigest: WORKSPACE_SUBJECT_DIGEST };
    },
  });
  cases.push(accessor);

  for (const effectiveScopes of cases) {
    const result = await inspectClaudeHostActivationScope({
      workspaceSubjectDigest: WORKSPACE_SUBJECT_DIGEST,
    }, {
      observeInstallation: async () => claudeHostObservation(effectiveScopes),
      clock: () => OBSERVED_AT,
    });
    assert.equal(result.scope, "unknown");
    assert.equal(result.evidence.kind, "host-observation-unavailable");
  }
  assert.equal(getterCalls, 0);
});

test("M4-T13 Claude snapshots admitted callbacks before clock and await boundaries", async () => {
  const { inspectClaudeHostActivationScope } = await import(pathToFileURL(claudeModulePath).href);
  let originalCalls = 0;
  let replacementCalls = 0;
  const adapters = {
    observeInstallation: async () => {
      originalCalls += 1;
      return claudeHostObservation([
        { scope: "project", workspaceSubjectDigest: WORKSPACE_SUBJECT_DIGEST },
      ]);
    },
    clock: () => {
      adapters.observeInstallation = async () => {
        replacementCalls += 1;
        return claudeHostObservation([{ scope: "user", workspaceSubjectDigest: null }]);
      };
      return OBSERVED_AT;
    },
  };
  const result = await inspectClaudeHostActivationScope({
    workspaceSubjectDigest: WORKSPACE_SUBJECT_DIGEST,
  }, adapters);
  assert.equal(originalCalls, 1);
  assert.equal(replacementCalls, 0);
  assert.equal(result.scope, "per-workspace");

  await assert.rejects(
    inspectClaudeHostActivationScope({
      workspaceSubjectDigest: WORKSPACE_SUBJECT_DIGEST,
    }, {
      clock: () => "2026-02-31T12:00:00.000Z",
    }),
    (error) => error?.code === "wakeflow-claude-activation-scope-time",
  );
});

test("M4-T13 capability and packaging seams remain internal and create no workspace registry", async () => {
  const [coreProfile, codexProfile, claudeProfile] = await Promise.all([
    import("../core/scripts/lib/wakeflow-host-profile.mjs").then((module) => module.hostProfile),
    import("../plugins/codex-wakeflow/scripts/lib/wakeflow-host-profile.mjs").then((module) => module.hostProfile),
    import("../plugins/claude-code-wakeflow/scripts/lib/wakeflow-host-profile.mjs").then((module) => module.hostProfile),
  ]);
  for (const profile of [coreProfile, codexProfile, claudeProfile]) {
    assert.deepEqual(profile.capabilities.activation, {
      applicable: true,
      realization: "runtime-probed",
    });
  }
  assert.equal(coreProfile.artifact.activationScopeHostFile, null);
  assert.equal(
    codexProfile.artifact.activationScopeHostFile,
    "scripts/lib/wakeflow-codex-activation-scope.mjs",
  );
  assert.equal(
    claudeProfile.artifact.activationScopeHostFile,
    "scripts/lib/wakeflow-claude-activation-scope.mjs",
  );
  assert.equal(
    existsSync(path.join(repositoryRoot, "plugins/codex-wakeflow/scripts/lib/wakeflow-claude-activation-scope.mjs")),
    false,
  );
  assert.equal(
    existsSync(path.join(repositoryRoot, "plugins/claude-code-wakeflow/scripts/lib/wakeflow-codex-activation-scope.mjs")),
    false,
  );
  const sources = [sharedModulePath, codexModulePath, claudeModulePath]
    .map((file) => readFileSync(file, "utf8"))
    .join("\n");
  assert.doesNotMatch(sources, /\.wakeflow-local|workspace[-_ ]registry|readdir|glob|enabledPlugins|plugin list/iu);
  for (const file of [
    "plugins/codex-wakeflow/lib/wakeflow-mcp-tools.mjs",
    "plugins/codex-wakeflow/scripts/wakeflow-cli.mjs",
    "plugins/codex-wakeflow/scripts/wakeflow-setup.mjs",
    "plugins/claude-code-wakeflow/lib/wakeflow-mcp-tools.mjs",
    "plugins/claude-code-wakeflow/scripts/wakeflow-cli.mjs",
    "plugins/claude-code-wakeflow/scripts/wakeflow-setup.mjs",
  ]) {
    const source = readFileSync(path.join(repositoryRoot, file), "utf8");
    assert.doesNotMatch(source, /wakeflow-(?:host|codex|claude)-activation-scope\.mjs/u, file);
  }
});
