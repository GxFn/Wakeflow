import { deepEqual, equal, ok, rejects, throws } from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { type TestContext, test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { runToolingCli } from "../../../tooling/cli.js";
import { inventoryDigest, snapshotLabTree } from "../../../tooling/lab/inventory.js";
import { createLab } from "../../../tooling/lab/lab.js";
import { liveAttemptFile, recordLiveAttempt } from "../../../tooling/live/attempts.js";
import type { LivePlan } from "../../../tooling/live/contracts.js";
import { inspectLiveEvidence, verifyLiveEvidence } from "../../../tooling/live/evidence.js";
import { loadLivePlan, planLiveProject } from "../../../tooling/live/plan.js";

async function fixture(t: TestContext, host = "codex") {
  const base = realpathSync(mkdtempSync(path.join(os.tmpdir(), "wakeflow-live-")));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const repository = path.join(base, "Repository");
  mkdirSync(repository);
  const lab = path.join(base, "Lab");
  const created = await createLab(
    repository,
    lab,
    path.join(process.cwd(), `plugins/${host}-wakeflow`),
  );
  equal(created.status, "passed", JSON.stringify(created));
  const root = path.join(lab, "Workspace");
  const candidate = path.join(lab, "Artifact");
  const projects = path.join(base, "projects.json");
  writeFileSync(
    projects,
    JSON.stringify({
      schemaVersion: 2,
      projects: [
        {
          projectId: "synthetic-outer-project",
          projectKind: "local",
          hostId: "local",
          path: root,
          label: "untrusted display label",
        },
      ],
    }),
  );
  return { base, repository, lab, root, candidate, projects };
}

function evidence(plan: LivePlan) {
  return {
    kind: "WakeflowLiveEvidence",
    schemaVersion: 1,
    planDigest: plan.planDigest,
    verified: true,
    records: plan.windows.map((window, index) => {
      const threadId = `synthetic-thread-${index}`;
      return {
        windowId: window.windowId,
        observedAt: "2026-10-03T12:00:00.000Z",
        declaredSource: "synthetic",
        creation: {
          request: {
            target: { type: "project", projectId: plan.project.id, environment: { type: "local" } },
          },
          result: { threadId, hostId: plan.project.hostId },
        },
        membership: {
          threadId,
          projectId: plan.project.id,
          hostId: plan.project.hostId,
          projectRoot: plan.root,
          source: "host-readback",
        },
        sessionStart: {
          event: "SessionStart",
          threadId,
          cwd: plan.root,
          artifactManifestDigest: plan.artifactDigest,
        },
        execution: { threadId, cwd: window.executionRoot },
        binding: {
          kind: "WakeflowWindowBindingInspection",
          hostId: plan.host,
          windowId: window.windowId,
          binding: {
            status: "registered",
            bindingId:
              window.bindingId ??
              `window_binding_${String(index + 1).padStart(8, "0")}-1111-4111-8111-111111111111`,
            bindingDigest: `sha256:${"b".repeat(64)}`,
            launchIntentDigest: window.intentDigest,
          },
        },
        runtime: {
          threadId,
          result: {
            kind: "WakeflowStatus",
            runtime: { artifactManifestDigest: plan.artifactDigest, artifactOnDisk: "same" },
          },
        },
      };
    }),
  };
}

test("live planning consumes generated profile instructions without writes; attempts survive re-planning and cannot repeat", {
  timeout: 180_000,
}, async (t) => {
  const f = await fixture(t);
  const before = inventoryDigest(snapshotLabTree(f.lab));
  const result = await planLiveProject(f.repository, f.root, f.candidate, f.projects, "local");
  const again = await planLiveProject(f.repository, f.root, f.candidate, f.projects, "local");
  equal(result.id, again.id);
  equal(result.hostEffectsPerformed, false);
  equal(result.windows, 5);
  const plan = loadLivePlan(f.repository, result.id);
  equal(plan.project.root, f.root);
  for (const window of plan.windows) {
    equal(window.instruction.tool, "create_thread");
    equal((window.instruction.target as { type: string }).type, "project");
  }
  const window = plan.windows[0];
  ok(window !== undefined);
  const cli = fileURLToPath(new URL("../../../tooling/cli.js", import.meta.url));
  const invoke = () =>
    promisify(execFile)(
      process.execPath,
      [cli, "live", "attempt", "--id", result.id, "--window", window.windowId],
      { cwd: f.repository, timeout: 60_000 },
    );
  const [a, b] = await Promise.allSettled([invoke(), invoke()]);
  equal([a, b].filter((r) => r.status === "fulfilled").length, 1);
  equal(existsSync(liveAttemptFile(f.repository, plan, window.windowId)), true);
  await rejects(recordLiveAttempt(f.repository, again.id, window.windowId));
  const empty = {
    kind: "WakeflowLiveEvidence",
    schemaVersion: 1,
    planDigest: plan.planDigest,
    records: [],
  };
  const input = path.join(f.base, "evidence.json");
  writeFileSync(input, JSON.stringify(empty));
  const inspected = verifyLiveEvidence(f.repository, result.id, input);
  equal(inspected.status, "unavailable");
  equal(inspected.nativeHostAcceptance, "unverified");
  const report = JSON.parse(readFileSync(path.join(f.repository, inspected.report), "utf8"));
  equal(report.checks[0].name, "attempt-needs-reconciliation");
  const markerFile = liveAttemptFile(f.repository, plan, window.windowId);
  const markerBytes = readFileSync(markerFile);
  writeFileSync(markerFile, "{}");
  throws(
    () => verifyLiveEvidence(f.repository, result.id, input),
    /live-attempt-record-unavailable/u,
  );
  await rejects(recordLiveAttempt(f.repository, result.id, window.windowId));
  writeFileSync(markerFile, markerBytes);
  equal(inventoryDigest(snapshotLabTree(f.lab)), before);
  const config = path.join(f.root, "wakeflow.config.json");
  const bytes = readFileSync(config);
  writeFileSync(config, Buffer.concat([bytes, Buffer.from("\n")]));
  throws(() => verifyLiveEvidence(f.repository, result.id, input), /live-plan-stale/u);
});

test("matching imported evidence, verified flags and UI claims never become native acceptance; wrong identities fail", {
  timeout: 180_000,
}, async (t) => {
  const f = await fixture(t);
  const result = await planLiveProject(f.repository, f.root, f.candidate, f.projects, "local");
  const plan = loadLivePlan(f.repository, result.id);
  const attempted = new Set(plan.windows.map((w) => w.windowId));
  const valid = evidence(plan);
  const checked = inspectLiveEvidence(plan, valid, attempted);
  equal(checked.consistency, "passed");
  equal(checked.status, "unavailable");
  equal(checked.exitCode, 2);
  equal(checked.evidenceSource, "imported-unverified");
  equal(checked.observations[0]?.reportedSource, "synthetic");
  equal(checked.windowToMcpAssociation, "unverified");
  for (const alter of [
    (row: (typeof valid.records)[number]) => {
      row.creation.request.target.projectId = "wrong-project";
    },
    (row: (typeof valid.records)[number]) => {
      row.membership.projectRoot = path.join(f.root, "Design");
    },
    (row: (typeof valid.records)[number]) => {
      row.sessionStart.cwd = path.join(f.root, "Design");
    },
    (row: (typeof valid.records)[number]) => {
      row.sessionStart.event = "Stop";
    },
    (row: (typeof valid.records)[number]) => {
      row.execution.cwd = f.base;
    },
    (row: (typeof valid.records)[number]) => {
      row.binding.binding.launchIntentDigest = `sha256:${"0".repeat(64)}`;
    },
    (row: (typeof valid.records)[number]) => {
      row.runtime.result.runtime.artifactManifestDigest = `sha256:${"0".repeat(64)}`;
    },
  ]) {
    const input = structuredClone(valid);
    const first = input.records[0];
    ok(first !== undefined);
    alter(first);
    equal(inspectLiveEvidence(plan, input, attempted).consistency, "failed");
  }
  const pending = structuredClone(valid);
  const pendingFirst = pending.records[0];
  ok(pendingFirst !== undefined);
  Object.assign(pendingFirst.creation, {
    result: { clientThreadId: "synthetic-pending", hostId: "local" },
  });
  equal(inspectLiveEvidence(plan, pending, attempted).consistency, "unavailable");
  equal(inspectLiveEvidence(plan, valid, new Set()).consistency, "failed");
  throws(
    () =>
      inspectLiveEvidence(
        plan,
        { ...valid, records: [...valid.records, valid.records[0]] },
        attempted,
      ),
    /duplicate/u,
  );
  const duplicate = structuredClone(valid);
  const first = duplicate.records[0];
  const second = duplicate.records[1];
  ok(first && second);
  second.membership.threadId = first.membership.threadId;
  throws(() => inspectLiveEvidence(plan, duplicate, attempted), /reused/u);
  equal(JSON.stringify(checked).includes(f.base), false);
});

test("project matching refuses role roots, ambiguous inventories and wrong hosts; unsupported launch capabilities stay explicit", {
  timeout: 180_000,
}, async (t) => {
  const f = await fixture(t, "claude-code");
  const single = {
    projectId: "synthetic-project",
    projectKind: "local",
    path: f.root,
    hostId: "local",
  };
  for (const projects of [
    [{ ...single, path: path.join(f.root, "Design") }],
    [single, single],
    [{ ...single, hostId: "remote" }],
  ]) {
    writeFileSync(f.projects, JSON.stringify({ projects }));
    await rejects(
      planLiveProject(f.repository, f.root, f.candidate, f.projects, "local"),
      /live-project-missing-or-ambiguous/u,
    );
  }
  writeFileSync(f.projects, JSON.stringify({ projects: [single] }));
  await rejects(
    planLiveProject(f.repository, f.root, f.candidate, f.projects, "local"),
    /live-project-bootstrap-unsupported/u,
  );
  for (const args of [
    ["live", "plan", "--root", f.root],
    ["live", "attempt", "--id", "../../outside", "--window", "unknown"],
    ["live", "verify", "--id", "example"],
  ])
    await rejects(runToolingCli(args, f.repository));
  deepEqual(Object.keys(JSON.parse(readFileSync(f.projects, "utf8"))), ["projects"]);
});
