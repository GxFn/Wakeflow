import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  WAKEFLOW_CLAUDE_HOST_COMMANDS,
  routeClaudeHostCommand,
} from "../plugins/claude-code-wakeflow/scripts/lib/wakeflow-claude-host.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const helperFile = path.join(
  repoRoot,
  "plugins/claude-code-wakeflow/scripts/lib/wakeflow-claude-host.mjs",
);
const DIGEST = `sha256:${"1".repeat(64)}`;

const EXPECTED_COMMANDS = Object.freeze([
  "activation-scope",
  "activity-ensure",
  "activity-inspect",
  "activity-stop",
  "arrange-windows",
  "controller-return",
  "decommission-execute",
  "decommission-plan",
  "decommission-recover",
  "launch-window",
  "pod-materialize",
  "pod-normalize-observation",
  "pod-plan",
  "preflight",
  "prompt-temp-inspect",
  "prompt-temp-sweep",
  "resume-window",
  "retitle-window",
  "settings-inspect",
  "settings-plan",
  "target-delivery",
  "transport-recover",
  "window-status",
]);

function runCli(command, payload, extraArgs = []) {
  return spawnSync(process.execPath, [helperFile, command, ...extraArgs], {
    cwd: repoRoot,
    encoding: "utf8",
    input: typeof payload === "string" ? payload : JSON.stringify(payload),
  });
}

function parseCli(result) {
  assert.equal(result.stderr, "");
  const lines = result.stdout.trim().split("\n");
  assert.equal(lines.length, 1, "the facade returns one bounded JSON document");
  return JSON.parse(lines[0]);
}

test("M7A-T04/T05 exposes one closed current Claude host command surface", () => {
  assert.equal(Object.isFrozen(WAKEFLOW_CLAUDE_HOST_COMMANDS), true);
  assert.deepEqual(WAKEFLOW_CLAUDE_HOST_COMMANDS, EXPECTED_COMMANDS);

  const source = readFileSync(helperFile, "utf8");
  for (const required of [
    "wakeflow-claude-activation-scope.mjs",
    "wakeflow-claude-activity.mjs",
    "wakeflow-claude-decommission.mjs",
    "wakeflow-claude-lifecycle.mjs",
    "wakeflow-claude-pod-host.mjs",
    "wakeflow-claude-settings.mjs",
    "wakeflow-claude-transport.mjs",
  ]) {
    assert.equal(source.includes(required), true, `facade must route through ${required}`);
  }
  for (const retired of [
    "wakeflow-artifact-identity.mjs",
    "wakeflow-config.mjs",
    "wakeflow-host-send-adapter.mjs",
    "wakeflow-pod-runtime.mjs",
    "wakeflow-stream-overlay.mjs",
    "runtime-meta",
    "stream-open",
    "stream-close",
    "stream-list",
    "replace-all",
    "check-workspace",
    "stamp-runtime",
  ]) {
    assert.equal(source.includes(retired), false, `facade must not retain ${retired}`);
  }
});

test("M7A-T04 facade delegates activation scope through an internal adapter without raw host output", async () => {
  const calls = [];
  const result = await routeClaudeHostCommand(
    "activation-scope",
    { workspaceSubjectDigest: DIGEST },
    {
      activation: {
        clock: () => "2026-08-11T00:00:00.000Z",
        observeInstallation(request) {
          calls.push(request);
          return {
            kind: "ClaudePluginInstallationScopeObservation",
            schemaVersion: 1,
            complete: true,
            effectiveScopes: [{ scope: "project", workspaceSubjectDigest: DIGEST }],
          };
        },
      },
    },
  );
  assert.equal(result.scope, "per-workspace");
  assert.equal(result.unattendedEligibility, "m6-evaluation-required");
  assert.deepEqual(calls, [{
    hostId: "claude-code",
    pluginId: "wakeflow@gxfn",
    workspaceSubjectDigest: DIGEST,
  }]);
  assert.equal(JSON.stringify(result).includes("session"), false);
  assert.equal(JSON.stringify(result).includes(repoRoot), false);
});

test("M7A-T04 Pod physical execution remains an explicit in-process adapter boundary", async () => {
  await assert.rejects(
    routeClaudeHostCommand("pod-materialize", {}),
    { code: "wakeflow-claude-host-adapter-required" },
  );
  await assert.rejects(
    routeClaudeHostCommand("pod-materialize", {}, {
      pod: { inspectExisting() {} },
    }),
    { code: "wakeflow-claude-host-adapter-required" },
  );
  await assert.rejects(
    routeClaudeHostCommand("preflight", {}, { unexpected: {} }),
    { code: "wakeflow-claude-host-contract" },
  );
});

test("R62 facade rejects behavioral payload and adapter properties without invoking them", async () => {
  let payloadGetterCalls = 0;
  const payload = { response: {} };
  Object.defineProperty(payload, "plan", {
    enumerable: true,
    get() {
      payloadGetterCalls += 1;
      return {};
    },
  });
  await assert.rejects(
    routeClaudeHostCommand("pod-normalize-observation", payload),
    { code: "wakeflow-claude-host-contract" },
  );
  assert.equal(payloadGetterCalls, 0);

  let facadeAdapterGetterCalls = 0;
  const adapters = {};
  Object.defineProperty(adapters, "activation", {
    enumerable: true,
    get() {
      facadeAdapterGetterCalls += 1;
      return {};
    },
  });
  await assert.rejects(
    routeClaudeHostCommand("activation-scope", { workspaceSubjectDigest: DIGEST }, adapters),
    { code: "wakeflow-claude-host-contract" },
  );
  assert.equal(facadeAdapterGetterCalls, 0);

  let podAdapterGetterCalls = 0;
  const pod = { create() {} };
  Object.defineProperty(pod, "inspectExisting", {
    enumerable: true,
    get() {
      podAdapterGetterCalls += 1;
      return () => [];
    },
  });
  await assert.rejects(
    routeClaudeHostCommand("pod-materialize", {}, { pod }),
    { code: "wakeflow-claude-host-adapter-required" },
  );
  assert.equal(podAdapterGetterCalls, 0);
});

test("R62 facade requires the complete Pod observation tuple", async () => {
  await assert.rejects(
    routeClaudeHostCommand("pod-normalize-observation", { plan: {} }),
    { code: "wakeflow-claude-host-contract" },
  );
});

test("M7A-T04 executable facade accepts one command token and one strict JSON stdin request", () => {
  const success = runCli("activation-scope", { workspaceSubjectDigest: DIGEST });
  assert.equal(success.status, 0, success.stdout);
  const payload = parseCli(success);
  assert.equal(payload.ok, true);
  assert.equal(payload.command, "activation-scope");
  assert.equal(payload.result.scope, "unknown");
  assert.equal(payload.result.unattendedEligibility, "forbidden");

  for (const invalid of ["", "null", "[]", "{not-json"] ) {
    const failed = runCli("activation-scope", invalid);
    assert.equal(failed.status, 1);
    assert.equal(parseCli(failed).ok, false);
  }

  const extraArg = runCli("activation-scope", { workspaceSubjectDigest: DIGEST }, ["--root"]);
  assert.equal(extraArg.status, 1);
  assert.equal(parseCli(extraArg).code, "wakeflow-claude-host-argv");

  const oversized = runCli("activation-scope", " ".repeat((1024 * 1024) + 1));
  assert.equal(oversized.status, 1);
  assert.equal(parseCli(oversized).code, "wakeflow-claude-host-stdin");

  const source = readFileSync(helperFile, "utf8");
  assert.doesNotMatch(source, /readFileSync\(0\)/u, "stdin must be bounded while it is read");
});

test("M7A-T04/T05 retired aggregate commands fail closed and perform no compatibility routing", () => {
  for (const command of [
    "check-workspace",
    "deliver",
    "ensure-server",
    "pod-close",
    "pod-open",
    "replace-all",
    "seed-permissions",
    "send",
    "stamp-runtime",
    "stream-close",
    "stream-list",
    "stream-open",
    "wait-results",
  ]) {
    const result = runCli(command, {});
    assert.equal(result.status, 1, command);
    const failure = parseCli(result);
    assert.equal(failure.ok, false);
    assert.equal(failure.command, command);
    assert.equal(failure.code, "wakeflow-claude-host-command");
    assert.equal(JSON.stringify(failure).includes("window-host"), false);
  }
});
