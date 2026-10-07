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
      "tests/workspace/maintenance/wakeflow-prepared-maintenance-recovery.test.ts",
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
