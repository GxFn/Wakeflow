import { verifyRepository } from "../verification/verify.js";

/** Existing deterministic regressions. Labels describe test techniques, not native-host acceptance. */
const SUITES = [
  {
    name: "locks",
    techniques: ["real-filesystem", "child-process", "injected-errors"],
    invariant:
      "Unknown lock owners are never retired by acquisition; scope failures retain cleanup responsibility.",
    files: [
      "tests/foundation/filesystem/rooted-exclusive-file-lock.test.ts",
      "tests/foundation/filesystem/rooted-read-write-scope.test.ts",
      "tests/kernel/workspace-operation-scope.test.ts",
    ],
  },
  {
    name: "recovery",
    techniques: ["real-filesystem", "child-process", "injected-errors"],
    invariant:
      "Interrupted publication recovers only exact owned candidates; committed history is not duplicated.",
    files: [
      "tests/foundation/filesystem/durable-atomic-file-stage-recovery.test.ts",
      "tests/capabilities/workspace/demand-runtime-recovery.test.ts",
    ],
  },
  {
    name: "privacy",
    techniques: ["deterministic-text-cases", "public-preview", "real-filesystem"],
    invariant:
      "Opaque controls and path normalization cannot conceal credentials or widen allowances.",
    files: [
      "tests/kernel/privacy-scan.test.ts",
      "tests/kernel/privacy-model.test.ts",
      "tests/capabilities/requirement/service.test.ts",
    ],
  },
  {
    name: "delivery",
    techniques: ["deterministic-decisions", "prompt-rendering"],
    invariant:
      "Delivery decisions preserve ambiguity; callback summaries retain complete Git object identities.",
    files: [
      "tests/capabilities/delivery/decide.test.ts",
      "tests/capabilities/result-review/decide.test.ts",
      "tests/capabilities/result-review/prompt.test.ts",
    ],
  },
  {
    name: "file-boundaries",
    techniques: ["real-filesystem", "injected-errors"],
    invariant:
      "Replaced resources and malformed bytes are rejected without deleting unknown files.",
    files: [
      "tests/foundation/filesystem/stable-file-read.test.ts",
      "tests/foundation/filesystem/stable-directory-read.test.ts",
      "tests/foundation/filesystem/strict-text-file.test.ts",
    ],
  },
  {
    name: "storage-sweep",
    techniques: ["real-filesystem", "child-process", "snapshot-replay"],
    invariant:
      "Each replayed kill point of a snapshot-sweep file falls in exactly one of five classes: healed by the first round (status, the mutating follow-up, status again, and that last status names no recovery; a point whose first status is refused while the follow-up still heals it is pinned in the file's healed-after-status-refusal table); healed by following named recoveries only, at most three hops - a retry when the refusal is retryable, the tool a recovery-required refusal names in details.tool with the id it gives (details.operationId, or details.demandId for the evidence tool; it must be the scenario's declared Demand), or for the maintenance tool its recover or reconcile (signposted, pinned by index with its route); healed the same way where at least one hop was named only by a status result - maintenance first: a recoverable maintenance residue or a maintenance protocol left in recovery-required; then next naming demand-recovery (it counts only when status was asked with the Demand id) or a nextActions entry naming it for the Demand (status-named, pinned by index); healed only by a route nothing named, tried from the restored kill point (unsignposted: every file asserts there is none); or stuck, pinned with the refusal that no public call gets past and asserted empty in the default scope. A follow-up that calls nothing never counts as healing. Each file also pins the points whose first hop a refusal named while the first status did not name the same tool. At every point that is not stuck, each file pins what is left after healing: by index, path and count the L1-L7 lock and lease files and the atomic stages that point at them; by index and path the recovery records (a renamed-away root, a restore candidate, the lifecycle journal, the publication marker, the publication stage tree); by index, path and count the atomic stages in the Demand root's index, snapshot and task-package directories. Each file also pins the indices it replayed in each scope, and in the full scope the class of one power-loss state per directory sync that covers a new entry change, with at most one reader lease, the locks other than reader leases and the recovery records left after healing it. The lock-residue-combinations files assert that the next acquisition or scope entry clears every combination of dead locks, leases and create stages they leave, except dead reader leases under shared entry, and leaves live owners untouched.",
    description:
      "The default scope (WAKEFLOW_SNAPSHOT_SWEEP_SCOPE unset or locks) replays the control point, the snapshots around L1-L7 lock operations and the route points each scenario lists (one or two per recovery route that does not touch a lock); zero stuck points in the default scope: cancel, complete, continue, create, maintenance, plan, publish. WAKEFLOW_SNAPSHOT_SWEEP_SCOPE=all replays every seam snapshot plus one after each content sync of a file inside the snapshot set that was created through the seam's exclusive open (a write that never syncs its content has no such point), against the same tables without filtering, plus the power-loss states of the scenarios that ask for them.",
    files: [
      "tests/capabilities/workspace/storage-snapshot-sweep-cancel.load.test.ts",
      "tests/capabilities/workspace/storage-snapshot-sweep-complete.load.test.ts",
      "tests/capabilities/workspace/storage-snapshot-sweep-continue.load.test.ts",
      "tests/capabilities/workspace/storage-snapshot-sweep-create.load.test.ts",
      "tests/capabilities/workspace/storage-snapshot-sweep-maintenance.load.test.ts",
      "tests/capabilities/workspace/storage-snapshot-sweep-plan.load.test.ts",
      "tests/capabilities/workspace/storage-snapshot-sweep-publish.load.test.ts",
      "tests/foundation/filesystem/lock-residue-combinations.load.test.ts",
      "tests/foundation/filesystem/lock-residue-combinations-scope-exclusive.load.test.ts",
      "tests/foundation/filesystem/lock-residue-combinations-scope-shared.load.test.ts",
    ],
  },
] as const;

export function listFaultSuites() {
  return {
    kind: "WakeflowFaultSuites",
    schemaVersion: 1,
    status: "passed" as const,
    suites: SUITES,
    autoRetry: false,
    nativeHostAcceptance: "unverified",
    durability: "existing-test-specific-contracts-unchanged",
  };
}

export async function runFaultSuite(
  root: string,
  suite: string,
  concurrency?: string,
  signal?: AbortSignal,
) {
  const selected = suite === "all" ? SUITES : SUITES.filter((entry) => entry.name === suite);
  if (selected.length === 0) throw new Error("Unknown fault suite.");
  const result = await verifyRepository(root, {
    profile: "quick",
    files: [...new Set(selected.flatMap((entry) => [...entry.files]))],
    ...(concurrency === undefined ? {} : { concurrency }),
    ...(signal === undefined ? {} : { signal }),
  });
  return {
    ...result,
    kind: "WakeflowFaultRun",
    suites: selected,
    autoRetry: false,
    nativeHostAcceptance: "unverified",
  };
}
