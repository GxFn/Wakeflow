import { spawnSync } from "node:child_process";
import { lstatSync } from "node:fs";
import path from "node:path";
import { verifyArtifactAgainstManifest } from "../artifacts/check-plugin-artifacts.js";
import { parseSemanticVersion } from "../artifacts/plugin-metadata.js";
import { isRecord, readBoundedFile, safeErrorCode, sha256 } from "../verification/files.js";
import { npmCommand, type ToolCommand } from "../verification/process.js";

type Status = "passed" | "failed" | "unavailable";
export interface Check {
  readonly name: string;
  readonly status: Status;
  readonly value: string | null;
  readonly reason: string | null;
}

function probeVersion(name: string, command: ToolCommand, pattern: RegExp): Check {
  const result = spawnSync(command.executable, [...command.args], {
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    timeout: 5000,
    maxBuffer: 64 * 1024,
  });
  const match = result.status === 0 ? pattern.exec(result.stdout.trim()) : null;
  return {
    name,
    status: match === null ? "unavailable" : "passed",
    value: match?.[1] ?? null,
    reason: match === null ? "version-not-observed" : null,
  };
}

function nodeEngine(root: string): Check {
  const pkg: unknown = JSON.parse(
    readBoundedFile(path.join(root, "package.json")).toString("utf8"),
  );
  const engine = isRecord(pkg) && isRecord(pkg.engines) ? pkg.engines.node : null;
  const range = typeof engine === "string" ? /^>=(\d+)\.(\d+)\.(\d+) <(\d+)$/u.exec(engine) : null;
  if (range === null)
    return {
      name: "node-engine",
      status: "unavailable",
      value: process.versions.node,
      reason: "unsupported-engine-declaration",
    };
  const current = process.versions.node.split(".").map(Number);
  const minimum = range.slice(1, 4).map(Number);
  const atLeast =
    current[0] === minimum[0]
      ? current[1] === minimum[1]
        ? (current[2] ?? 0) >= (minimum[2] ?? 0)
        : (current[1] ?? 0) > (minimum[1] ?? 0)
      : (current[0] ?? 0) > (minimum[0] ?? 0);
  const matches = atLeast && (current[0] ?? 0) < Number(range[4]);
  return {
    name: "node-engine",
    status: matches ? "passed" : "failed",
    value: process.versions.node,
    reason: matches ? null : "node-engine-mismatch",
  };
}

function overall(checks: readonly { readonly status: Status }[]): Status {
  return checks.some((check) => check.status === "failed")
    ? "failed"
    : checks.some((check) => check.status === "unavailable")
      ? "unavailable"
      : "passed";
}

export function inspectDevelopmentEnvironment(root: string) {
  let node: Check;
  try {
    node = nodeEngine(root);
  } catch {
    node = {
      name: "node-engine",
      status: "unavailable",
      value: process.versions.node,
      reason: "package-unreadable",
    };
  }
  const checks = [
    node,
    probeVersion("npm", npmCommand(["--version"]), /^(\d+\.\d+\.\d+)$/u),
    probeVersion(
      "git",
      { executable: "git", args: ["--version"] },
      /^git version (\d+\.\d+(?:\.\d+)?)/u,
    ),
  ];
  return {
    kind: "WakeflowDoctorEnvironment",
    schemaVersion: 1,
    scope: "current-cli-environment",
    status: overall(checks),
    platform: process.platform,
    arch: process.arch,
    checks,
    hostRuntime: "not-observed",
    changesApplied: false,
  };
}

type ArtifactInspection = Readonly<{
  status: Status;
  reason: string | null;
  version: string | null;
  hostId: string | null;
  manifestDigest: string | null;
  fileCount: number | null;
}>;

function inspectArtifact(root: string): ArtifactInspection {
  const absent = { version: null, hostId: null, manifestDigest: null, fileCount: null };
  try {
    if (lstatSync(root, { throwIfNoEntry: false }) === undefined)
      return { ...absent, status: "unavailable", reason: "artifact-not-found" };
    const checked = verifyArtifactAgainstManifest(root);
    const version = parseSemanticVersion(checked.manifest.version, "artifact version");
    const hostId = checked.manifest.hostId;
    if (hostId !== "codex" && hostId !== "claude-code") throw new Error("Unknown artifact host.");
    return {
      status: "passed",
      reason: null,
      version,
      hostId,
      manifestDigest: sha256(checked.manifestBytes),
      fileCount: checked.fileCount + 1,
    };
  } catch (error: unknown) {
    return { ...absent, status: "failed", reason: safeErrorCode(error) };
  }
}

function importedRuntime(file: string, expected: string | null) {
  const unavailable = {
    source: "imported-report",
    verified: false,
    status: "unavailable",
    manifestDigest: null,
    artifactOnDisk: "unknown",
    comparison: "not-comparable",
    observedAt: null,
  };
  try {
    let value: unknown = JSON.parse(readBoundedFile(file, 1024 * 1024).toString("utf8"));
    if (isRecord(value) && value.isError === true) return unavailable;
    if (isRecord(value) && value.structuredContent !== undefined) value = value.structuredContent;
    if (!isRecord(value) || value.kind !== "WakeflowStatus" || !isRecord(value.runtime))
      return unavailable;
    const digest = value.runtime.artifactManifestDigest;
    const onDisk = value.runtime.artifactOnDisk;
    if (
      !(digest === null || (typeof digest === "string" && /^sha256:[0-9a-f]{64}$/u.test(digest))) ||
      !["same", "changed", "unknown"].includes(String(onDisk))
    )
      return unavailable;
    const observed =
      typeof value.observedAt === "string" &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value.observedAt) &&
      Number.isFinite(Date.parse(value.observedAt))
        ? value.observedAt
        : null;
    return {
      ...unavailable,
      manifestDigest: digest,
      artifactOnDisk: onDisk,
      comparison:
        digest === null || expected === null
          ? "not-comparable"
          : digest === expected
            ? "same-manifest"
            : "different-manifest",
      observedAt: observed,
    };
  } catch {
    return unavailable;
  }
}

export function inspectArtifactInstallation(
  request: Readonly<{
    candidate: string;
    installed?: string;
    runtimeReport?: string;
  }>,
) {
  const candidate = inspectArtifact(request.candidate);
  const installed = request.installed === undefined ? null : inspectArtifact(request.installed);
  const comparable = candidate.status === "passed" && installed?.status === "passed";
  const comparison = !comparable
    ? "not-compared"
    : candidate.hostId !== installed.hostId
      ? "different-host"
      : candidate.manifestDigest === installed.manifestDigest
        ? "same-artifact"
        : candidate.version === installed.version
          ? "same-version-different-bytes"
          : "different-version";
  const checks = [candidate, ...(installed === null ? [] : [installed])];
  let status = overall(checks);
  if (comparable && comparison !== "same-artifact") status = "failed";
  const runtime =
    request.runtimeReport === undefined
      ? null
      : importedRuntime(
          request.runtimeReport,
          installed?.manifestDigest ?? candidate.manifestDigest,
        );
  // Imported files are useful comparisons, never proof of native process activation.
  if (runtime !== null && status === "passed") status = "unavailable";
  return {
    kind: "WakeflowDoctorArtifact",
    schemaVersion: 1,
    scope: installed === null ? "candidate-integrity" : "candidate-and-installation-integrity",
    status,
    candidate,
    installed,
    comparison,
    runtime,
    sourceAlignment: "not-checked",
    hostSelection: "not-observed",
    hookTrust: "not-observed",
    activation: "unverified",
    changesApplied: false,
  };
}
