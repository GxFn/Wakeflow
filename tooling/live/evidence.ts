import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { readBoundedFile, sha256, writeReport } from "../verification/files.js";
import { liveAttemptFile } from "./attempts.js";
import {
  DIGEST,
  LiveError,
  type LivePlan,
  type LiveWindow,
  readDocument,
  record,
  textField,
  unwrapResult,
} from "./contracts.js";
import { livePlanLocation, loadLivePlan } from "./plan.js";

interface Check {
  readonly window: number;
  readonly name: string;
  readonly status: "matched" | "failed" | "unavailable";
}
type Observed = Record<string, unknown>;

function optionalRecord(value: unknown): Observed | undefined {
  return value === undefined ? undefined : record(value);
}

function matchesRoot(value: unknown, expected: string): boolean {
  return typeof value === "string" && path.isAbsolute(value) && path.resolve(value) === expected;
}

function creationMatches(row: Observed, plan: LivePlan): string | undefined {
  const creation = optionalRecord(row.creation);
  if (creation === undefined) return undefined;
  const target = record(record(creation.request).target);
  const result = unwrapResult(creation.result);
  if (
    target.type !== "project" ||
    target.projectId !== plan.project.id ||
    record(target.environment).type !== "local" ||
    result.hostId !== plan.project.hostId
  )
    throw new LiveError("live-creation-context-mismatch");
  // A pending clientThreadId is not a ready threadId.
  return result.threadId === undefined ? undefined : textField(result.threadId, 1024);
}

function checkWindow(
  plan: LivePlan,
  window: LiveWindow,
  row: Observed | undefined,
  attempted: boolean,
  index: number,
): Check[] {
  const checks: Check[] = [];
  const check = (name: string, present: boolean, matches: boolean) =>
    checks.push({
      window: index,
      name,
      status: !present ? "unavailable" : matches ? "matched" : "failed",
    });
  if (row === undefined) {
    check(attempted ? "attempt-needs-reconciliation" : "evidence-missing", false, false);
    return checks;
  }
  const when = textField(row.observedAt);
  if (!Number.isFinite(Date.parse(when)) || !when.endsWith("Z"))
    throw new LiveError("live-invalid-observation-time");
  const membership = optionalRecord(row.membership);
  const threadId = membership === undefined ? undefined : textField(membership.threadId, 1024);
  check(
    "project-membership",
    membership !== undefined,
    membership?.projectId === plan.project.id &&
      membership?.hostId === plan.project.hostId &&
      matchesRoot(membership?.projectRoot, plan.root) &&
      ["host-readback", "user-ui-confirmation"].includes(String(membership?.source)),
  );
  if (window.bindingStatus === "unregistered") {
    check("attempt-record", true, attempted);
    let created: string | undefined;
    try {
      created = creationMatches(row, plan);
    } catch {
      check("creation-context", true, false);
    }
    check(
      "ready-creation-receipt",
      created !== undefined,
      threadId !== undefined && created === threadId,
    );
  }
  const session = optionalRecord(row.sessionStart);
  check(
    "session-start",
    session !== undefined,
    threadId !== undefined &&
      session?.threadId === threadId &&
      session.event === "SessionStart" &&
      matchesRoot(session?.cwd, plan.root) &&
      session?.artifactManifestDigest === plan.artifactDigest,
  );
  const execution = optionalRecord(row.execution);
  check(
    "role-execution-root",
    execution !== undefined,
    threadId !== undefined &&
      execution?.threadId === threadId &&
      matchesRoot(execution?.cwd, window.executionRoot),
  );
  const binding = row.binding === undefined ? undefined : unwrapResult(row.binding);
  const current = binding === undefined ? undefined : record(binding.binding);
  check(
    "binding",
    binding !== undefined,
    binding?.kind === "WakeflowWindowBindingInspection" &&
      binding.windowId === window.windowId &&
      binding.hostId === plan.host &&
      current?.status === "registered" &&
      typeof current.bindingId === "string" &&
      /^window_binding_[a-f0-9-]{36}$/u.test(current.bindingId) &&
      typeof current.bindingDigest === "string" &&
      DIGEST.test(current.bindingDigest) &&
      current.launchIntentDigest === window.intentDigest &&
      (window.bindingId === null || current.bindingId === window.bindingId),
  );
  const suppliedRuntime = optionalRecord(row.runtime);
  const status = suppliedRuntime === undefined ? undefined : unwrapResult(suppliedRuntime.result);
  const runtime = status === undefined ? undefined : record(status.runtime);
  check(
    "reported-runtime",
    runtime !== undefined,
    threadId !== undefined &&
      suppliedRuntime?.threadId === threadId &&
      status?.kind === "WakeflowStatus" &&
      runtime?.artifactManifestDigest === plan.artifactDigest &&
      runtime.artifactOnDisk === "same",
  );
  return checks;
}

/** Consistency only. Caller-controlled provenance, UI confirmations and verified flags confer no trust. */
export function inspectLiveEvidence(
  plan: LivePlan,
  evidence: unknown,
  attempted: ReadonlySet<string>,
) {
  const input = record(evidence);
  if (
    input.kind !== "WakeflowLiveEvidence" ||
    input.schemaVersion !== 1 ||
    input.planDigest !== plan.planDigest ||
    !Array.isArray(input.records) ||
    input.records.length > 64
  )
    throw new LiveError("live-evidence-plan-mismatch");
  const records = new Map<string, Observed>();
  const threads = new Set<string>();
  for (const raw of input.records) {
    const row = record(raw);
    const windowId = textField(row.windowId);
    if (records.has(windowId) || !plan.windows.some((w) => w.windowId === windowId))
      throw new LiveError("live-unknown-or-duplicate-window");
    const membership = optionalRecord(row.membership);
    if (membership !== undefined) {
      const handle = textField(membership.threadId);
      if (threads.has(handle)) throw new LiveError("live-thread-reused-across-roles");
      threads.add(handle);
    }
    records.set(windowId, row);
  }
  const checks = plan.windows.flatMap((window, index) =>
    checkWindow(
      plan,
      window,
      records.get(window.windowId),
      attempted.has(window.windowId),
      index + 1,
    ),
  );
  const counts = {
    matched: checks.filter((c) => c.status === "matched").length,
    failed: checks.filter((c) => c.status === "failed").length,
    unavailable: checks.filter((c) => c.status === "unavailable").length,
  };
  const consistency =
    counts.failed > 0 ? "failed" : counts.unavailable > 0 ? "unavailable" : "passed";
  const observations = plan.windows.flatMap((window, index) => {
    const row = records.get(window.windowId);
    if (row === undefined) return [];
    const reportedSource = ["synthetic", "host-tool-return", "manual", "imported"].includes(
      String(row.declaredSource),
    )
      ? String(row.declaredSource)
      : "unspecified";
    const membership = optionalRecord(row.membership);
    const membershipSource = ["host-readback", "user-ui-confirmation"].includes(
      String(membership?.source),
    )
      ? String(membership?.source)
      : "unspecified";
    return [
      {
        window: index + 1,
        reportedAt: new Date(String(row.observedAt)).toISOString(),
        reportedSource,
        membershipSource,
      },
    ];
  });
  return {
    kind: "WakeflowLiveEvidenceInspection",
    schemaVersion: 1,
    status: consistency === "failed" ? ("failed" as const) : ("unavailable" as const),
    consistency,
    counts,
    checks,
    observations,
    evidenceSource: "imported-unverified",
    nativeHostAcceptance: "unverified",
    windowToMcpAssociation: "unverified",
    automaticHostActions: false,
    next: "reconcile-existing-attempts-with-host-and-Wakeflow; never-repeat-an-ambiguous-create",
    exitCode: consistency === "failed" ? 1 : 2,
  };
}

export function verifyLiveEvidence(repository: string, id: string, evidenceFile: string) {
  const plan = loadLivePlan(repository, id);
  if (
    sha256(readBoundedFile(path.join(plan.root, "wakeflow.config.json"))) !== plan.configFileDigest
  )
    throw new LiveError("live-plan-stale");
  const attempted = new Set(
    plan.windows
      .filter((w) => existsSync(liveAttemptFile(repository, plan, w.windowId)))
      .map((w) => w.windowId),
  );
  // The attempt key is plan-independent on purpose: a window registered after its attempt
  // changes the plan digest, so a marker from an earlier plan is an attempt under a superseded
  // plan, not an unreadable record. Only a malformed marker makes verification unavailable.
  const supersededAttempts: string[] = [];
  for (const windowId of attempted) {
    try {
      const marker = readDocument(liveAttemptFile(repository, plan, windowId));
      if (
        marker.kind !== "WakeflowHostAttempt" ||
        marker.schemaVersion !== 1 ||
        marker.windowId !== windowId ||
        typeof marker.planDigest !== "string" ||
        marker.outcome !== "host-call-not-observed"
      )
        throw new LiveError("live-attempt-record-unavailable");
      if (marker.planDigest !== plan.planDigest) supersededAttempts.push(windowId);
    } catch {
      throw new LiveError("live-attempt-record-unavailable");
    }
  }
  const evidence = readDocument(evidenceFile);
  const result = { ...inspectLiveEvidence(plan, evidence, attempted), supersededAttempts };
  const file = `verification-${randomUUID()}.json`;
  writeReport(path.join(livePlanLocation(repository, id), file), {
    ...result,
    planDigest: plan.planDigest,
    observedAt: new Date().toISOString(),
    evidenceDigest: sha256(readBoundedFile(evidenceFile)),
  });
  return {
    kind: result.kind,
    schemaVersion: 1,
    id,
    status: result.status,
    consistency: result.consistency,
    counts: result.counts,
    report: `.build/live/${id}/${file}`,
    evidenceSource: result.evidenceSource,
    nativeHostAcceptance: result.nativeHostAcceptance,
    exitCode: result.exitCode,
  };
}
