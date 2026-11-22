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
      "Each replayed kill point of a snapshot-sweep file falls in exactly one of four classes, and each file pins the points of the last three by index: healed by the first round (status, the mutating follow-up, status again; a point whose first status is refused while the follow-up still heals it is pinned in the file's healed-after-status-refusal table); healed through a signposted route (a retry when the refusal is retryable, the scenario's own recover on recovery-required - also when it only works from the restored kill point although a refusal there already pointed at it, pinned with a restored: prefix - maintenance recover on a maintenance residue, or reconcile); healed through an unsignposted route (the scenario's own recover, alone or after reconcile, from the restored kill point once every signposted route failed and no refusal pointed at that recover); or stuck, listed with the refusal that no public call gets past. A follow-up that calls nothing never counts as healing. At every point that is not stuck, the L1-L7 lock and lease files left, and the atomic stages that point at them, equal the file's pinned residue table, path and count. Each file also pins the indices it replayed in each scope. The lock-residue-combinations files assert that the next acquisition or scope entry clears every combination of dead locks, leases and create stages they leave, except dead reader leases under shared entry, and leaves live owners untouched.",
    description:
      "The default scope (WAKEFLOW_SNAPSHOT_SWEEP_SCOPE unset or locks) replays the control point and the snapshots around L1-L7 lock operations; zero stuck points in the default scope: complete, create, maintenance, plan, publish. WAKEFLOW_SNAPSHOT_SWEEP_SCOPE=all replays every seam snapshot plus one after each content sync of a file inside the snapshot set that was created through the seam's exclusive open (a write that never syncs its content has no such point), against the same tables without filtering.",
    files: [
      "tests/capabilities/workspace/storage-snapshot-sweep-complete.load.test.ts",
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
