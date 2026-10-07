import { randomUUID } from "node:crypto";
import { mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import {
  array,
  canonicalDigest,
  closed,
  decodeJson,
  type FileObservation,
  object,
  readJson,
  readObservedFile,
  relativeFile,
  requireCapture,
  selfDigest,
  textValue,
  within,
  writeExclusive,
  writeExclusiveJson,
} from "../capture/io.js";
import { assertCanonicalDirectory } from "../lab/inventory.js";
import { privateDirectory } from "../verification/files.js";
import { inspectWorkspaceWithObservations } from "./workspace.js";

const FILE_BUDGET = 4 * 1024 * 1024;
const SOURCE_BUDGET = 32 * 1024 * 1024;
const PROBE_BUDGET = 8 * 1024 * 1024;
const STATUSES = ["passed", "failed", "unavailable", "interrupted"] as const;
type DiagnosisStatus = (typeof STATUSES)[number];

interface SourceCopy {
  readonly alias: string;
  readonly sourcePath: string;
  readonly file: string | null;
  readonly observation: FileObservation | null;
  readonly issue:
    | "source-unavailable"
    | "source-budget"
    | "source-changed"
    | "not-rechecked"
    | null;
  readonly unchangedAfter: boolean | null;
}

function status(value: unknown): DiagnosisStatus {
  requireCapture(STATUSES.includes(value as DiagnosisStatus), "diagnostic-invalid-status");
  return value as DiagnosisStatus;
}

export function diagnosticDirectory(repository: string, id: string) {
  requireCapture(/^diagnostic-[a-f0-9-]{36}$/u.test(id), "diagnostic-invalid-id");
  return path.join(repository, ".build/diagnostics/bundles", id);
}

function sourceRequests(root: string, candidate: string, files: readonly string[]) {
  return [
    { alias: "configuration", sourcePath: path.join(root, "wakeflow.config.json") },
    { alias: "candidate-manifest", sourcePath: path.join(candidate, "artifact-manifest.json") },
    ...files.map((file, i) => ({
      alias: `attachment-${i + 1}`,
      sourcePath: path.join(root, file),
    })),
  ];
}

function copySources(directory: string, selected: ReturnType<typeof sourceRequests>) {
  let total = 0;
  return selected.map((source, i): SourceCopy => {
    let read: ReturnType<typeof readObservedFile>;
    try {
      read = readObservedFile(source.sourcePath, FILE_BUDGET);
    } catch {
      return {
        ...source,
        file: null,
        observation: null,
        issue: "source-unavailable",
        unchangedAfter: null,
      };
    }
    if (total + read.bytes.length > SOURCE_BUDGET)
      return {
        ...source,
        file: null,
        observation: null,
        issue: "source-budget",
        unchangedAfter: null,
      };
    total += read.bytes.length;
    const file = `sources/${i}.bin`;
    // Write failures are not source failures. Leave an unsealed bundle for inspection.
    writeExclusive(path.join(directory, file), read.bytes);
    return { ...source, file, observation: read.observation, issue: null, unchangedAfter: null };
  });
}

function recheck(source: SourceCopy, signal?: AbortSignal): SourceCopy {
  if (source.observation === null) return source;
  if (signal?.aborted) return { ...source, issue: "not-rechecked" };
  try {
    const after = readObservedFile(source.sourcePath, FILE_BUDGET).observation;
    if (canonicalDigest(after) === canonicalDigest(source.observation))
      return { ...source, unchangedAfter: true };
  } catch {
    /* A missing or replaced source cannot be declared coherent. */
  }
  return { ...source, unchangedAfter: false, issue: "source-changed" };
}

function collection(sources: readonly SourceCopy[], probeCaptured: boolean) {
  return {
    requested: sources.length,
    captured: sources.filter((s) => s.file !== null).length,
    unavailable: sources.filter((s) => s.file === null).length,
    changed: sources.filter((s) => s.unchangedAfter === false).length,
    notRechecked: sources.filter((s) => s.file !== null && s.unchangedAfter === null).length,
    coherent: probeCaptured && sources.every((s) => s.file !== null && s.unchangedAfter === true),
  };
}

/** Private exact file bytes plus projected SDK observations; never host database or recursive collection. */
export async function collectDiagnosticBundle(
  repository: string,
  root: string,
  candidate: string,
  files: readonly string[] = [],
  signal?: AbortSignal,
) {
  assertCanonicalDirectory(repository);
  assertCanonicalDirectory(root);
  textValue(root);
  textValue(candidate);
  const selectedFiles = array(files, 32).map(relativeFile);
  requireCapture(
    new Set(selectedFiles).size === selectedFiles.length &&
      !selectedFiles.includes("wakeflow.config.json"),
    "diagnostic-duplicate-source",
  );
  requireCapture(
    path.isAbsolute(candidate) && path.resolve(candidate) === candidate,
    "diagnostic-invalid-candidate",
  );
  signal?.throwIfAborted();
  const id = `diagnostic-${randomUUID()}`;
  const directory = diagnosticDirectory(repository, id);
  requireCapture(
    !within(root, directory) && !within(candidate, directory),
    "diagnostic-output-overlap",
  );
  privateDirectory(repository, ".build/diagnostics/bundles");
  mkdirSync(directory, { mode: 0o700 });
  const request = {
    kind: "WakeflowDiagnosticRequest",
    schemaVersion: 1,
    id,
    root,
    candidate,
    files: selectedFiles,
    recordedAt: new Date().toISOString(),
  };
  try {
    writeExclusiveJson(path.join(directory, "request.json"), request);
    privateDirectory(directory, "sources");
    let sources = copySources(directory, sourceRequests(root, candidate, selectedFiles));
    const probe = await inspectWorkspaceWithObservations(root, candidate, signal);
    const probeBytes = Buffer.from(`${JSON.stringify(probe, null, 2)}\n`);
    const probeCaptured = probeBytes.length <= PROBE_BUDGET;
    writeExclusiveJson(
      path.join(directory, "probe.json"),
      probeCaptured
        ? probe
        : {
            diagnosis: { kind: "WakeflowWorkspaceDiagnosis", status: "unavailable" },
            observations: [],
          },
    );
    sources = sources.map((source) => recheck(source, signal));
    const observedStatus = probeCaptured ? status(probe.diagnosis.status) : "unavailable";
    const summary = collection(sources, probeCaptured);
    const outcome = signal?.aborted
      ? "interrupted"
      : summary.coherent
        ? observedStatus
        : "unavailable";
    const body = {
      kind: "WakeflowDiagnosticBundle",
      schemaVersion: 1,
      id,
      requestDigest: canonicalDigest(request),
      probeDigest: readObservedFile(path.join(directory, "probe.json"), PROBE_BUDGET).observation
        .digest,
      probeCaptured,
      diagnosisStatus: observedStatus,
      status: outcome,
      sources,
      completedAt: new Date().toISOString(),
    };
    const bundleDigest = canonicalDigest(body);
    writeExclusiveJson(path.join(directory, "bundle.json"), { ...body, bundleDigest });
    writeExclusiveJson(path.join(directory, "ready.json"), {
      kind: "WakeflowDiagnosticSeal",
      bundleDigest,
    });
    readDiagnosticBundle(repository, id);
    return {
      kind: "WakeflowDiagnosticCollection",
      schemaVersion: 1,
      id,
      status: outcome,
      diagnosisStatus: observedStatus,
      collection: summary,
      bundleSealed: true,
      source: "new-generated-stdio-observer-and-explicit-files",
      nativeHostAcceptance: "unverified",
      workspaceChangesApplied: false,
      exitCode:
        outcome === "passed" ? 0 : outcome === "failed" ? 1 : outcome === "interrupted" ? 130 : 2,
    };
  } catch {
    return {
      kind: "WakeflowDiagnosticCollection",
      schemaVersion: 1,
      id,
      status: signal?.aborted ? "interrupted" : "unavailable",
      reason: "diagnostic-bundle-incomplete",
      bundleSealed: false,
      nativeHostAcceptance: "unverified",
      workspaceChangesApplied: false,
      exitCode: signal?.aborted ? 130 : 2,
    };
  }
}

/** Offline consistency only; it neither reads current workspace files nor authenticates the capture. */
export function readDiagnosticBundle(repository: string, id: string) {
  const directory = diagnosticDirectory(repository, id);
  assertCanonicalDirectory(directory);
  const request = closed(readJson(path.join(directory, "request.json")), [
    "kind",
    "schemaVersion",
    "id",
    "root",
    "candidate",
    "files",
    "recordedAt",
  ]);
  requireCapture(
    request.kind === "WakeflowDiagnosticRequest" &&
      request.schemaVersion === 1 &&
      request.id === id,
    "diagnostic-invalid-request",
  );
  const root = textValue(request.root),
    candidate = textValue(request.candidate);
  requireCapture(
    path.isAbsolute(root) &&
      path.resolve(root) === root &&
      path.isAbsolute(candidate) &&
      path.resolve(candidate) === candidate,
    "diagnostic-invalid-roots",
  );
  const files = array(request.files, 32).map(relativeFile);
  requireCapture(
    new Set(files).size === files.length && !files.includes("wakeflow.config.json"),
    "diagnostic-duplicate-source",
  );
  const selected = sourceRequests(root, candidate, files);
  const manifest = closed(readJson(path.join(directory, "bundle.json")), [
    "kind",
    "schemaVersion",
    "id",
    "requestDigest",
    "probeDigest",
    "probeCaptured",
    "diagnosisStatus",
    "status",
    "sources",
    "completedAt",
    "bundleDigest",
  ]);
  requireCapture(
    manifest.kind === "WakeflowDiagnosticBundle" &&
      manifest.schemaVersion === 1 &&
      manifest.id === id,
    "diagnostic-invalid-bundle",
  );
  selfDigest(manifest, "bundleDigest");
  requireCapture(manifest.requestDigest === canonicalDigest(request), "diagnostic-request-drift");
  const ready = closed(readJson(path.join(directory, "ready.json")), ["kind", "bundleDigest"]);
  requireCapture(
    ready.kind === "WakeflowDiagnosticSeal" && ready.bundleDigest === manifest.bundleDigest,
    "diagnostic-unsealed",
  );
  const probeFile = readObservedFile(path.join(directory, "probe.json"), PROBE_BUDGET);
  requireCapture(probeFile.observation.digest === manifest.probeDigest, "diagnostic-probe-drift");
  const probe = closed(decodeJson(probeFile.bytes), ["diagnosis", "observations"]);
  const diagnosis = object(probe.diagnosis);
  const observations = array(probe.observations, 2).map((entry, index) => {
    const observation = closed(entry, [
      "tool",
      "durationMs",
      "status",
      "result",
      "reason",
      "mcpError",
    ]);
    requireCapture(
      observation.tool === ["wakeflow_status", "wakeflow_verify"][index],
      "diagnostic-unexpected-tool",
    );
    requireCapture(
      typeof observation.durationMs === "number" &&
        Number.isSafeInteger(observation.durationMs) &&
        observation.durationMs >= 0,
      "diagnostic-invalid-duration",
    );
    requireCapture(
      observation.status === "passed" || observation.status === "failed",
      "diagnostic-invalid-call-status",
    );
    if (observation.status === "passed") object(observation.result);
    else textValue(observation.reason, 80);
    return observation;
  });
  requireCapture(
    typeof manifest.probeCaptured === "boolean" &&
      diagnosis.kind === "WakeflowWorkspaceDiagnosis" &&
      status(diagnosis.status) === manifest.diagnosisStatus,
    "diagnostic-probe-mismatch",
  );
  requireCapture(
    diagnosis.status !== "passed" ||
      (observations.length === 2 && observations.every((row) => row.status === "passed")),
    "diagnostic-passing-probe-incomplete",
  );
  const entries = array(manifest.sources, 34);
  requireCapture(entries.length === selected.length, "diagnostic-source-set");
  let total = 0;
  const sources = entries.map((value, i): SourceCopy => {
    const row = closed(value, [
      "alias",
      "sourcePath",
      "file",
      "observation",
      "issue",
      "unchangedAfter",
    ]);
    requireCapture(
      row.alias === selected[i]?.alias && row.sourcePath === selected[i]?.sourcePath,
      "diagnostic-source-mismatch",
    );
    requireCapture(
      [null, "source-unavailable", "source-budget", "source-changed", "not-rechecked"].includes(
        row.issue as null,
      ),
      "diagnostic-invalid-source-issue",
    );
    requireCapture(
      row.unchangedAfter === null || typeof row.unchangedAfter === "boolean",
      "diagnostic-invalid-source-check",
    );
    if (row.file === null) {
      requireCapture(
        row.observation === null &&
          row.unchangedAfter === null &&
          ["source-unavailable", "source-budget"].includes(String(row.issue)),
        "diagnostic-invalid-missing-source",
      );
    } else {
      requireCapture(row.file === `sources/${i}.bin`, "diagnostic-invalid-source-ref");
      const observation = closed(row.observation, [
        "digest",
        "bytes",
        "device",
        "inode",
        "mode",
        "modified",
      ]);
      const actual = readObservedFile(path.join(directory, row.file), FILE_BUDGET).observation;
      requireCapture(
        observation.digest === actual.digest && observation.bytes === actual.bytes,
        "diagnostic-source-copy-drift",
      );
      for (const key of ["device", "inode", "mode", "modified"])
        requireCapture(
          typeof observation[key] === "string" &&
            /^-?[0-9]{1,40}$/u.test(observation[key] as string),
          "diagnostic-invalid-file-observation",
        );
      requireCapture(
        row.unchangedAfter === true
          ? row.issue === null
          : row.unchangedAfter === false
            ? row.issue === "source-changed"
            : row.issue === "not-rechecked",
        "diagnostic-inconsistent-source-check",
      );
      total += actual.bytes;
    }
    return row as unknown as SourceCopy;
  });
  requireCapture(total <= SOURCE_BUDGET, "diagnostic-source-budget");
  requireCapture(
    readdirSync(directory).sort().join("\n") ===
      "bundle.json\nprobe.json\nready.json\nrequest.json\nsources" &&
      readdirSync(path.join(directory, "sources")).sort().join("\n") ===
        sources
          .flatMap((s) => (s.file === null ? [] : [path.basename(s.file)]))
          .sort()
          .join("\n"),
    "diagnostic-unknown-bundle-files",
  );
  const summary = collection(sources, manifest.probeCaptured);
  const diagnosisStatus = status(manifest.diagnosisStatus),
    outcome = status(manifest.status);
  requireCapture(
    outcome === "interrupted"
      ? diagnosisStatus === "interrupted" || !summary.coherent
      : outcome === (summary.coherent ? diagnosisStatus : "unavailable"),
    "diagnostic-inconsistent-status",
  );
  return {
    manifest,
    request,
    probe,
    sources,
    collection: summary,
    diagnosisStatus,
    status: outcome,
  };
}

export function inspectDiagnosticBundle(repository: string, id: string) {
  try {
    const bundle = readDiagnosticBundle(repository, id);
    return {
      kind: "WakeflowDiagnosticIntegrity",
      schemaVersion: 1,
      id,
      status: "matched",
      integrity: "matched",
      diagnosisStatus: bundle.diagnosisStatus,
      collection: bundle.collection,
      source: "local-unsigned-record",
      nativeHostAcceptance: "unverified",
      readsLiveWorkspace: false,
      exitCode: 0,
    };
  } catch {
    return {
      kind: "WakeflowDiagnosticIntegrity",
      schemaVersion: 1,
      status: "unavailable",
      integrity: "unavailable",
      reason: "diagnostic-bundle-incomplete-or-altered",
      nativeHostAcceptance: "unverified",
      readsLiveWorkspace: false,
      exitCode: 2,
    };
  }
}
