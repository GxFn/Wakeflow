import { randomUUID } from "node:crypto";
import path from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import {
  canonicalDigest,
  decodeJson,
  readObservedFile,
  requireCapture,
  selfDigest,
  writeExclusiveJson,
} from "../capture/io.js";
import { isRecord, privateDirectory } from "../verification/files.js";
import { readDiagnosticBundle } from "./bundle.js";

// Sharing categories, not a second verifier. Unknown future names are classified as other.
const GATE_NAMES = [
  "config-authority",
  "local-layout",
  "ledger-layout",
  "board-consistency",
  "demand-root-audit",
  "append-candidates-clear",
  "evidence-integrity",
  "work-claims",
  "host-hook-channel",
  "window-identity",
  "window-runtime-projection",
  "pod-execution-location",
  "host-settings-assets",
  "active-projection",
  "runtime-artifact",
  "other",
] as const;
const STATES = ["passed", "failed", "unavailable", "interrupted"];
const GATE_STATES = ["pass", "fail", "unavailable"];
const ISSUE = [null, "source-unavailable", "source-budget", "source-changed", "not-rechecked"];
const SHA = { type: "string", pattern: "^sha256:[a-f0-9]{64}$" };
const BOOL = { type: "boolean" };
const NULLABLE_BOOL = { anyOf: [BOOL, { type: "null" }] };
const COUNT = { type: "integer", minimum: 0, maximum: 1_000_000_000 };
const TIME = {
  type: "string",
  pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\\.[0-9]{1,9})?Z$",
};
function shape(properties: Record<string, unknown>) {
  return {
    type: "object",
    additionalProperties: false,
    required: Object.keys(properties),
    properties,
  };
}
const schema = shape({
  kind: { const: "WakeflowDiagnosticSummary" },
  schemaVersion: { const: 1 },
  recordedAt: TIME,
  sourceBundleDigest: SHA,
  reportDigest: SHA,
  source: { const: "new-generated-stdio-observer-and-explicit-files" },
  origin: { const: "unverified-local-record" },
  nativeHostAcceptance: { const: "unverified" },
  hostSelection: { const: "not-observed" },
  windowRuntimeAssociation: { const: "unverified" },
  workspace: { const: "workspace" },
  candidate: { const: "candidate" },
  status: { enum: STATES },
  diagnosisStatus: { enum: STATES },
  collection: shape({
    requested: COUNT,
    captured: COUNT,
    unavailable: COUNT,
    changed: COUNT,
    notRechecked: COUNT,
    coherent: BOOL,
    probeCaptured: BOOL,
  }),
  sources: {
    type: "array",
    minItems: 2,
    maxItems: 34,
    items: shape({
      alias: {
        type: "string",
        pattern: "^(configuration|candidate-manifest|attachment-([1-9]|[12][0-9]|3[0-2]))$",
      },
      copied: BOOL,
      unchangedAfter: NULLABLE_BOOL,
      issue: { enum: ISSUE },
    }),
  },
  observer: shape({
    candidateHost: { enum: ["codex", "claude-code", "other", null] },
    artifactMatches: NULLABLE_BOOL,
    configMatches: NULLABLE_BOOL,
    truncated: NULLABLE_BOOL,
    candidateManifestDigest: { anyOf: [SHA, { type: "null" }] },
    statusObservedAt: { anyOf: [TIME, { type: "null" }] },
    verificationObservedAt: { anyOf: [TIME, { type: "null" }] },
    callsSucceeded: COUNT,
    callsFailed: COUNT,
  }),
  gates: {
    type: "array",
    maxItems: 64,
    items: shape({
      name: { enum: GATE_NAMES },
      status: { enum: GATE_STATES },
      detailOmitted: BOOL,
    }),
  },
  gateCounts: shape({ pass: COUNT, fail: COUNT, unavailable: COUNT }),
  detailsRetainedPrivately: { const: true },
});
const validate = new Ajv2020({ strict: true, validateFormats: false }).compile(schema);

function record(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}
function list(value: unknown, maximum: number): Record<string, unknown>[] {
  return Array.isArray(value) && value.length <= maximum ? value.map(record) : [];
}
function instant(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    !new RegExp(TIME.pattern, "u").test(value) ||
    !Number.isFinite(Date.parse(value))
  )
    return null;
  return new Date(value).toISOString().slice(0, 19) === value.slice(0, 19) ? value : null;
}
function sha(value: unknown): string | null {
  return typeof value === "string" && /^sha256:[a-f0-9]{64}$/u.test(value) ? value : null;
}

function truncation(value: unknown): boolean | null {
  const input = record(value);
  const values = [
    "windows",
    "demands",
    "claims",
    "pods",
    "repositories",
    "archives",
    "unmergedAccepted",
    "worktrees",
  ].map((key) => input[key]);
  if (values.some((n) => typeof n !== "number" || !Number.isSafeInteger(n) || n < 0)) return null;
  return values.some((n) => Number(n) > 0);
}

function publicBody(bundle: ReturnType<typeof readDiagnosticBundle>) {
  const diagnosis = record(bundle.probe.diagnosis);
  const facts = record(diagnosis.facts);
  const observed = record(facts.observedAt);
  const observations = list(bundle.probe.observations, 2);
  const gates = list(record(facts.verification).gates, 64).map((gate) => ({
    name: GATE_NAMES.find((name) => name === gate.name) ?? "other",
    status: GATE_STATES.find((state) => state === gate.status) ?? "unavailable",
    detailOmitted: gate.code !== null,
  }));
  const recordedAt = instant(bundle.request.recordedAt);
  requireCapture(recordedAt !== null, "diagnostic-invalid-time");
  return {
    kind: "WakeflowDiagnosticSummary",
    schemaVersion: 1,
    recordedAt,
    sourceBundleDigest: bundle.manifest.bundleDigest,
    source: "new-generated-stdio-observer-and-explicit-files",
    origin: "unverified-local-record",
    nativeHostAcceptance: "unverified",
    hostSelection: "not-observed",
    windowRuntimeAssociation: "unverified",
    workspace: "workspace",
    candidate: "candidate",
    status: bundle.status,
    diagnosisStatus: bundle.diagnosisStatus,
    collection: { ...bundle.collection, probeCaptured: bundle.manifest.probeCaptured },
    sources: bundle.sources.map((source) => ({
      alias: source.alias,
      copied: source.file !== null,
      unchangedAfter: source.unchangedAfter,
      issue: source.issue,
    })),
    observer: {
      candidateHost:
        diagnosis.artifact === undefined
          ? null
          : (["codex", "claude-code"].find((name) => name === record(diagnosis.artifact).hostId) ??
            "other"),
      artifactMatches:
        typeof diagnosis.observerMatchesArtifact === "boolean"
          ? diagnosis.observerMatchesArtifact
          : null,
      configMatches:
        typeof record(facts.config).unchangedBetweenObservations === "boolean"
          ? record(facts.config).unchangedBetweenObservations
          : null,
      truncated: truncation(facts.omitted),
      candidateManifestDigest: sha(record(diagnosis.artifact).manifestDigest),
      statusObservedAt: instant(observed.status),
      verificationObservedAt: instant(observed.verification),
      callsSucceeded: observations.filter((entry) => entry.status === "passed").length,
      callsFailed: observations.filter((entry) => entry.status === "failed").length,
    },
    gates,
    gateCounts: {
      pass: gates.filter((gate) => gate.status === "pass").length,
      fail: gates.filter((gate) => gate.status === "fail").length,
      unavailable: gates.filter((gate) => gate.status === "unavailable").length,
    },
    detailsRetainedPrivately: true,
  };
}

function validateSummary(value: Record<string, unknown>) {
  requireCapture(validate(value), "diagnostic-invalid-summary");
  selfDigest(value, "reportDigest");
  requireCapture(instant(value.recordedAt) !== null, "diagnostic-invalid-time");
  const sources = list(value.sources, 34),
    counts = record(value.collection);
  requireCapture(
    sources.every(
      (source, i) =>
        source.alias ===
        (i === 0 ? "configuration" : i === 1 ? "candidate-manifest" : `attachment-${i - 1}`),
    ),
    "diagnostic-invalid-source-aliases",
  );
  requireCapture(
    counts.requested === sources.length &&
      counts.captured === sources.filter((s) => s.copied).length &&
      counts.unavailable === sources.filter((s) => !s.copied).length &&
      counts.changed === sources.filter((s) => s.unchangedAfter === false).length &&
      counts.notRechecked === sources.filter((s) => s.copied && s.unchangedAfter === null).length &&
      counts.coherent ===
        (counts.probeCaptured && sources.every((s) => s.copied && s.unchangedAfter === true)),
    "diagnostic-inconsistent-collection",
  );
  for (const source of sources)
    requireCapture(
      source.copied
        ? source.unchangedAfter === true
          ? source.issue === null
          : source.unchangedAfter === false
            ? source.issue === "source-changed"
            : source.issue === "not-rechecked"
        : source.unchangedAfter === null &&
            ["source-unavailable", "source-budget"].includes(String(source.issue)),
      "diagnostic-inconsistent-source",
    );
  const gates = list(value.gates, 64),
    gateCounts = record(value.gateCounts);
  for (const state of GATE_STATES)
    requireCapture(
      gateCounts[state] === gates.filter((gate) => gate.status === state).length,
      "diagnostic-inconsistent-gates",
    );
  const named = gates.filter((gate) => gate.name !== "other").map((gate) => gate.name);
  requireCapture(new Set(named).size === named.length, "diagnostic-duplicate-gate");
  const observer = record(value.observer);
  if (value.diagnosisStatus === "passed")
    requireCapture(
      gates.length > 0 &&
        gateCounts.fail === 0 &&
        gateCounts.unavailable === 0 &&
        observer.artifactMatches === true &&
        observer.candidateManifestDigest !== null &&
        observer.candidateHost !== null &&
        observer.callsSucceeded === 2 &&
        observer.callsFailed === 0 &&
        observer.statusObservedAt !== null &&
        observer.verificationObservedAt !== null &&
        observer.configMatches === true &&
        observer.truncated === false,
      "diagnostic-inconsistent-passing-diagnosis",
    );
  requireCapture(
    Number(observer.callsSucceeded) + Number(observer.callsFailed) <= 2,
    "diagnostic-inconsistent-calls",
  );
  for (const time of [observer.statusObservedAt, observer.verificationObservedAt])
    requireCapture(time === null || instant(time) !== null, "diagnostic-invalid-time");
  requireCapture(
    value.status === "interrupted"
      ? value.diagnosisStatus === "interrupted" || !counts.coherent
      : value.status === (counts.coherent ? value.diagnosisStatus : "unavailable"),
    "diagnostic-inconsistent-status",
  );
  return value;
}

/** Explicit local export only. Arbitrary private strings and bytes have no copy path into this shape. */
export function exportDiagnosticSummary(repository: string, id: string) {
  const bundle = readDiagnosticBundle(repository, id);
  const body = publicBody(bundle);
  const report = validateSummary({ ...body, reportDigest: canonicalDigest(body) });
  const directory = privateDirectory(repository, ".build/diagnostics/exports");
  const file = path.join(directory, `summary-${randomUUID()}.json`);
  writeExclusiveJson(file, report);
  return {
    kind: "WakeflowDiagnosticExport",
    schemaVersion: 1,
    status: "exported",
    diagnosisStatus: report.diagnosisStatus,
    file: path.relative(repository, file),
    reportDigest: report.reportDigest,
    origin: "unverified-local-record",
    nativeHostAcceptance: "unverified",
    uploaded: false,
    exitCode: 0,
  };
}

export function inspectDiagnosticSummary(file: string) {
  try {
    const report = validateSummary(decodeJson(readObservedFile(file, 128 * 1024).bytes));
    return {
      kind: "WakeflowDiagnosticSummaryIntegrity",
      schemaVersion: 1,
      status: "matched",
      integrity: "matched",
      diagnosisStatus: report.diagnosisStatus,
      reportDigest: report.reportDigest,
      origin: "unverified-local-record",
      nativeHostAcceptance: "unverified",
      exitCode: 0,
    };
  } catch {
    return {
      kind: "WakeflowDiagnosticSummaryIntegrity",
      schemaVersion: 1,
      status: "unavailable",
      integrity: "unavailable",
      reason: "diagnostic-summary-invalid-or-altered",
      nativeHostAcceptance: "unverified",
      exitCode: 2,
    };
  }
}
