import { closeSync, existsSync, fsyncSync, openSync, writeFileSync } from "node:fs";
import path from "node:path";
import { privateDirectory, sha256 } from "../verification/files.js";
import { LiveError, type LivePlan, textField, WINDOW_ID } from "./contracts.js";
import { loadLivePlan, observeLiveWorkspace } from "./plan.js";

export function liveAttemptFile(repository: string, plan: LivePlan, windowId: string): string {
  // Stable across re-planning, candidate changes and titles. This records an attempt,
  // never proof that a host call was made or that a window exists.
  const key = sha256(JSON.stringify([plan.root, plan.project.hostId, windowId])).slice(7);
  return path.join(repository, ".build/live/attempts", `attempt-${key}.json`);
}

export async function recordLiveAttempt(
  repository: string,
  id: string,
  windowId: string,
  signal?: AbortSignal,
) {
  if (!WINDOW_ID.test(windowId)) throw new LiveError("live-invalid-window-id");
  const plan = loadLivePlan(repository, id);
  const window = plan.windows.find((w) => w.windowId === windowId);
  if (window === undefined) throw new LiveError("live-window-not-in-plan");
  if (window.bindingStatus !== "unregistered")
    throw new LiveError("live-existing-binding-requires-reconciliation");
  const current = await observeLiveWorkspace(plan.root, plan.candidate, signal);
  if (
    current.configFileDigest !== plan.configFileDigest ||
    current.artifactDigest !== plan.artifactDigest ||
    current.windows.find((w) => w.windowId === windowId)?.bindingStatus !== "unregistered"
  )
    throw new LiveError("live-plan-stale");
  const directory = privateDirectory(repository, ".build/live/attempts");
  const file = liveAttemptFile(repository, plan, windowId);
  if (existsSync(file)) throw new LiveError("live-attempt-already-recorded-reconcile");
  // Preserve a partial write on failure: ambiguous records cannot authorize retry.
  const fd = openSync(file, "wx", 0o600);
  try {
    writeFileSync(
      fd,
      JSON.stringify({
        kind: "WakeflowHostAttempt",
        schemaVersion: 1,
        planDigest: plan.planDigest,
        windowId,
        recordedAt: new Date().toISOString(),
        outcome: "host-call-not-observed",
      }),
    );
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  const parent = openSync(directory, "r");
  try {
    fsyncSync(parent);
  } finally {
    closeSync(parent);
  }
  return {
    kind: "WakeflowLiveAttemptRecorded",
    schemaVersion: 1,
    status: "passed" as const,
    id,
    windowId,
    hostTool: textField(window.instruction.tool),
    hostEffectsPerformed: false,
    authorization: "external-user-authorization-required",
    resume: "reconcile-this-attempt-never-repeat-creation",
  };
}
