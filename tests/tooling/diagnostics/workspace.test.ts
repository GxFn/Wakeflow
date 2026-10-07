import { deepEqual, equal, ok, rejects, throws } from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { runToolingCli } from "../../../tooling/cli.js";
import {
  inspectWorkspace,
  summarizeWorkspaceProbe,
} from "../../../tooling/diagnostics/workspace.js";
import { inventoryDigest, snapshotLabTree } from "../../../tooling/lab/inventory.js";
import { createLab } from "../../../tooling/lab/lab.js";

function observations() {
  const observedAt = "2026-10-04T07:00:00.000Z";
  const status = {
    kind: "WakeflowStatus",
    observedAt,
    config: { configDigest: `sha256:${"b".repeat(64)}` },
    truncated: {
      windows: 0,
      demands: 0,
      claims: 0,
      pods: 0,
      repositories: 0,
      archives: 0,
      unmergedAccepted: 0,
      worktrees: 0,
    },
    overall: "idle",
    runtime: { artifactManifestDigest: `sha256:${"a".repeat(64)}`, artifactOnDisk: "same" },
    maintenance: { protocol: "idle", residues: [] },
    demands: [],
    claims: [],
    hooks: [{ hostId: "codex", status: "observed", records: 9, skipped: 0 }],
    windows: [{ identity: "registered", runtime: { status: "unverified" } }],
  };
  const verify = {
    kind: "WakeflowVerification",
    observedAt,
    configDigest: `sha256:${"b".repeat(64)}`,
    ok: false,
    summary: { pass: 1, fail: 0, unavailable: 1 },
    gates: [
      { name: "config-authority", status: "pass", code: null },
      { name: "runtime-artifact", status: "unavailable", code: "window-runtime-unverified:1" },
    ],
    next: { frontier: "window-runtime-unverified", owner: "controller" },
  };
  return { status, verify };
}

test("workspace summaries keep unavailable gates and original observation times without copying identities or arbitrary data", () => {
  const { status, verify } = observations();
  const secret = "SYNTHETIC-PRIVATE-DETAIL";
  const dirtyStatus = {
    ...status,
    root: secret,
    threadId: secret,
    transcript: secret,
    verified: true,
    windows: status.windows.map((window) => ({
      ...window,
      windowId: secret,
      handle: secret,
      runtime: { ...window.runtime, claimedVerified: true, details: secret },
    })),
    hooks: status.hooks.map((hook) => ({ ...hook, raw: secret })),
  };
  const dirtyVerify = {
    ...verify,
    privateData: secret,
    summary: { ...verify.summary, [secret]: 0 },
    gates: verify.gates.map((gate) => ({ ...gate, evidence: [{ ref: secret }], details: secret })),
  };
  const result = summarizeWorkspaceProbe(dirtyStatus, dirtyVerify);
  equal(result.verification.ok, false);
  equal(result.verification.summary.unavailable, 1);
  equal(result.windows.runtimeUnverified, 1);
  equal(result.observedAt.status, status.observedAt);
  equal(result.config.unchangedBetweenObservations, true);
  equal(JSON.stringify(result).includes(secret), false);
  equal(JSON.stringify(result).includes("claimedVerified"), false);
  const partial = summarizeWorkspaceProbe(
    { ...status, truncated: { ...status.truncated, windows: 5 } },
    { ...verify, configDigest: `sha256:${"c".repeat(64)}` },
  );
  equal(partial.omitted.windows, 5);
  equal(partial.config.unchangedBetweenObservations, false);
});

test("diagnostics cannot turn empty, duplicated or inconsistent verification evidence into a passing summary", () => {
  const { status, verify } = observations();
  for (const changed of [
    { ...verify, gates: [] },
    { ...verify, gates: [...verify.gates, verify.gates[0]] },
    { ...verify, ok: true },
    { ...verify, summary: { pass: 2, fail: 0, unavailable: 0 } },
    { ...verify, observedAt: "not-a-time" },
  ])
    throws(() => summarizeWorkspaceProbe(status, changed));
  const redacted = summarizeWorkspaceProbe(status, {
    ...verify,
    gates: verify.gates.map((gate) => ({ ...gate, code: "/private/fixture-detail" })),
  });
  equal(redacted.verification.gates[0]?.code, "detail-omitted");
});

test("actual generated workspace diagnosis is read-only, exposes failure and never claims native activation", {
  timeout: 90_000,
}, async (t) => {
  const base = realpathSync(mkdtempSync(path.join(os.tmpdir(), "wakeflow-workspace-doctor-")));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const repository = path.join(base, "Reports");
  mkdirSync(repository);
  const root = path.join(base, "Lab");
  const candidate = path.join(process.cwd(), "plugins/codex-wakeflow");
  const created = await createLab(repository, root, candidate);
  equal(created.status, "passed");
  const workspace = path.join(root, "Workspace");
  const before = inventoryDigest(snapshotLabTree(root));
  const result = await inspectWorkspace(workspace, candidate);
  equal(result.status, "passed", JSON.stringify(result));
  equal(result.source, "new-generated-stdio-observer");
  equal(result.hostSelection, "not-observed");
  equal(result.nativeHostAcceptance, "unverified");
  equal(result.windowRuntimeAssociation, "unverified");
  equal(result.changesApplied, false);
  equal(inventoryDigest(snapshotLabTree(root)), before);
  equal(JSON.stringify(result).includes(base), false);
  const invalidRoot = await inspectWorkspace(path.join(base, "missing"), candidate);
  equal(invalidRoot.status, "unavailable");
  const controller = new AbortController();
  controller.abort();
  equal((await inspectWorkspace(workspace, candidate, controller.signal)).exitCode, 130);
  // The failure is private-mode drift, not the presence of any extra regular file.
  // Explicit chmod avoids inheriting a test result from the caller's umask.
  const unknown = path.join(workspace, ".wakeflow-local/foreign.txt");
  writeFileSync(unknown, "keep unknown bytes", { mode: 0o600 });
  chmodSync(unknown, 0o600);
  equal((await inspectWorkspace(workspace, candidate)).status, "passed");
  chmodSync(unknown, 0o644);
  const damaged = inventoryDigest(snapshotLabTree(root));
  const failed = await runToolingCli(
    ["doctor", "workspace", "--root", workspace, "--candidate", candidate],
    repository,
  );
  equal(failed.status, "failed", JSON.stringify(failed));
  ok("facts" in failed && failed.facts.verification.summary.fail > 0);
  equal(inventoryDigest(snapshotLabTree(root)), damaged);
  await rejects(
    runToolingCli(
      [
        "doctor",
        "workspace",
        "--root",
        workspace,
        "--candidate",
        candidate,
        "--runtime-report",
        "unused.json",
      ],
      repository,
    ),
  );
  deepEqual(
    snapshotLabTree(root).find((entry) => entry.path.endsWith("foreign.txt"))?.kind,
    "file",
  );
});
