import { verifyArtifactAgainstManifest } from "../artifacts/check-plugin-artifacts.js";
import { assertCanonicalDirectory } from "../lab/inventory.js";
import { type LabToolObservation, withLabMcp } from "../lab/mcp-session.js";
import { isRecord, safeErrorCode, sha256 } from "../verification/files.js";

const PROVENANCE = {
  source: "new-generated-stdio-observer",
  hostSelection: "not-observed",
  nativeHostAcceptance: "unverified",
  windowRuntimeAssociation: "unverified",
  changesApplied: false,
} as const;
const TOKEN = /^[a-z][a-z0-9-]{0,79}$/u;
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
export interface DiagnosticGate {
  readonly name: string;
  readonly status: "pass" | "fail" | "unavailable";
  readonly code: string | null;
}

function record(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new Error("Malformed public observation.");
  return value;
}

function token(value: unknown): string {
  if (typeof value !== "string" || !TOKEN.test(value)) throw new Error("Malformed public token.");
  return value;
}

function rows(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value) || value.length > 256) throw new Error("Malformed public list.");
  return value.map(record);
}

function count(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw new Error("Malformed public count.");
  return value;
}

function digest(value: unknown): string {
  if (typeof value !== "string" || !DIGEST.test(value)) throw new Error("Malformed public digest.");
  return value;
}

function instant(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/u.test(value) ||
    !Number.isFinite(Date.parse(value))
  )
    throw new Error("Malformed observation time.");
  return value;
}

/** Only these public fact categories enter the diagnostic; never copy raw records, paths or IDs. */
export function summarizeWorkspaceProbe(
  status: Record<string, unknown>,
  verify: Record<string, unknown>,
) {
  if (status.kind !== "WakeflowStatus" || verify.kind !== "WakeflowVerification")
    throw new Error("Unexpected public observation kind.");
  const runtime = record(status.runtime);
  const windows = rows(status.windows);
  const gates = rows(verify.gates).map((gate): DiagnosticGate => {
    const state = gate.status;
    if (state !== "pass" && state !== "fail" && state !== "unavailable")
      throw new Error("Invalid verification verdict.");
    const code = gate.code;
    return {
      name: token(gate.name),
      status: state,
      code:
        code === null
          ? null
          : typeof code === "string" &&
              (TOKEN.test(code) || /^window-runtime-unverified:[0-9]{1,5}$/u.test(code))
            ? code
            : "detail-omitted",
    };
  });
  if (gates.length === 0 || new Set(gates.map((gate) => gate.name)).size !== gates.length)
    throw new Error("Incomplete verification gate list.");
  const counts = { pass: 0, fail: 0, unavailable: 0 };
  for (const gate of gates) counts[gate.status]++;
  const summary = record(verify.summary);
  if (
    Object.keys(counts).some((key) => summary[key] !== counts[key as keyof typeof counts]) ||
    verify.ok !== (counts.fail === 0 && counts.unavailable === 0)
  )
    throw new Error("Inconsistent verification summary.");
  const maintenance = record(status.maintenance);
  const next = record(verify.next);
  const omitted = Object.fromEntries(
    [
      "windows",
      "demands",
      "claims",
      "pods",
      "repositories",
      "archives",
      "unmergedAccepted",
      "worktrees",
    ].map((key) => [key, count(record(status.truncated)[key])]),
  );
  const statusConfig = digest(record(status.config).configDigest);
  const verifyConfig = digest(verify.configDigest);
  return {
    observedAt: { status: instant(status.observedAt), verification: instant(verify.observedAt) },
    config: {
      statusDigest: statusConfig,
      verificationDigest: verifyConfig,
      unchangedBetweenObservations: statusConfig === verifyConfig,
    },
    omitted,
    overall: token(status.overall),
    runtime: {
      artifactManifestDigest: digest(runtime.artifactManifestDigest),
      artifactOnDisk: token(runtime.artifactOnDisk),
    },
    maintenance: {
      protocol: token(maintenance.protocol),
      residues: rows(maintenance.residues).length,
    },
    activeWork: { demands: rows(status.demands).length, claims: rows(status.claims).length },
    windows: {
      total: windows.length,
      registered: windows.filter((window) => window.identity === "registered").length,
      runtimeUnverified: windows.filter((window) => record(window.runtime).status === "unverified")
        .length,
    },
    hooks: rows(status.hooks).map((hook) => ({
      hostId: token(hook.hostId),
      status: token(hook.status),
      records: count(hook.records),
      skipped: count(hook.skipped),
    })),
    verification: { ok: verify.ok, summary: counts, gates },
    next: {
      frontier: next.frontier === null ? null : token(next.frontier),
      owner: token(next.owner),
    },
  };
}

async function diagnoseWorkspace(
  root: string,
  candidate: string,
  observations: LabToolObservation[],
  signal?: AbortSignal,
) {
  const base = { kind: "WakeflowWorkspaceDiagnosis", schemaVersion: 1, ...PROVENANCE };
  let checkedArtifact: { hostId: string; version: string; manifestDigest: string } | null = null;
  try {
    signal?.throwIfAborted();
    assertCanonicalDirectory(root);
    assertCanonicalDirectory(candidate);
    const checked = verifyArtifactAgainstManifest(candidate);
    if (
      typeof checked.manifest.version !== "string" ||
      !/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9][a-zA-Z0-9.-]{0,63})?$/u.test(checked.manifest.version)
    )
      throw new Error("Malformed artifact version.");
    const artifact = {
      hostId: token(checked.manifest.hostId),
      version: checked.manifest.version,
      manifestDigest: sha256(checked.manifestBytes),
    };
    checkedArtifact = artifact;
    const facts = await withLabMcp(
      candidate,
      root,
      observations,
      async (call) => {
        const status = await call("wakeflow_status", { root });
        const verify = await call("wakeflow_verify", { root });
        return summarizeWorkspaceProbe(status, verify);
      },
      signal,
    );
    const unchanged =
      sha256(verifyArtifactAgainstManifest(candidate).manifestBytes) === artifact.manifestDigest;
    const runtimeMatches =
      facts.runtime.artifactManifestDigest === artifact.manifestDigest &&
      facts.runtime.artifactOnDisk === "same";
    const status =
      !unchanged || !runtimeMatches || facts.verification.summary.fail > 0
        ? "failed"
        : facts.verification.summary.unavailable > 0 ||
            !facts.config.unchangedBetweenObservations ||
            Object.values(facts.omitted).some((value) => value > 0)
          ? "unavailable"
          : "passed";
    return {
      ...base,
      status,
      artifact,
      observerMatchesArtifact: unchanged && runtimeMatches,
      facts,
      completedAt: new Date().toISOString(),
      exitCode: status === "passed" ? 0 : status === "failed" ? 1 : 2,
    };
  } catch (error: unknown) {
    const status = signal?.aborted ? "interrupted" : "unavailable";
    return {
      ...base,
      status,
      reason: safeErrorCode(error),
      ...(checkedArtifact === null ? {} : { artifact: checkedArtifact }),
      toolError: observations.at(-1)?.mcpError ?? null,
      exitCode: signal?.aborted ? 130 : 2,
    };
  }
}

/** Private projected SDK observations, including partial failure; never native wire receipts. */
export async function inspectWorkspaceWithObservations(
  root: string,
  candidate: string,
  signal?: AbortSignal,
) {
  const observations: LabToolObservation[] = [];
  const diagnosis = await diagnoseWorkspace(root, candidate, observations, signal);
  return { diagnosis, observations };
}

/** Runs only status and verify in a newly launched observer. It cannot attest a native peer. */
export async function inspectWorkspace(root: string, candidate: string, signal?: AbortSignal) {
  return (await inspectWorkspaceWithObservations(root, candidate, signal)).diagnosis;
}
