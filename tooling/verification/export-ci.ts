import { mkdtempSync, readdirSync } from "node:fs";
import path from "node:path";
import { assertCanonicalDirectory } from "../lab/inventory.js";
import { modelTestOptions } from "../testing/model-options.js";
import { inspectTestRecording } from "../testing/test-recording.js";
import { isRecord, privateDirectory, readBoundedFile, sha256, writeReport } from "./files.js";

const STATUSES = ["passed", "failed", "interrupted", "unavailable"];
const PROFILES = ["quick", "gate", "artifact"];
const STAGES = [
  "typecheck",
  "check:architecture",
  "lint",
  "format:check",
  "check:unused",
  "focused-tests",
  "gate",
  "build:check",
  "smoke:artifacts",
];

function object(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new Error("Invalid verification receipt.");
  return value;
}
function choice(value: unknown, allowed: readonly string[]): string {
  if (typeof value !== "string" || !allowed.includes(value))
    throw new Error("Invalid verification category.");
  return value;
}
function digest(value: unknown): string {
  if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(value))
    throw new Error("Invalid verification digest.");
  return value;
}
function integer(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > 1_000_000_000
  )
    throw new Error("Invalid verification count.");
  return value;
}
function instant(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u.test(value) ||
    !Number.isFinite(Date.parse(value))
  )
    throw new Error("Invalid verification instant.");
  if (new Date(value).toISOString() !== value) throw new Error("Invalid verification instant.");
  return value;
}

function publicCounts(value: unknown) {
  const counts = object(value);
  return Object.fromEntries(
    ["tests", "passed", "failed", "cancelled", "skipped", "todo", "suites"].map((key) => [
      key,
      integer(counts[key]),
    ]),
  );
}

function modelSummary(value: unknown) {
  if (value === null || value === undefined) return null;
  const model = object(value);
  const parsed = modelTestOptions({
    WAKEFLOW_MODEL_SEED: String(model.seed),
    WAKEFLOW_MODEL_RUNS: String(model.numRuns),
  });
  return {
    seed: parsed.seed,
    numRuns: parsed.numRuns,
    replayRequested: model.path !== undefined || model.replayPath !== undefined,
  };
}

function testSummary(receipt: Record<string, unknown>, directory: string) {
  if (receipt.tests === null) return null;
  const proof = object(receipt.testEvidence);
  for (const [key, file] of [
    ["selection", "test-selection.json"],
    ["events", "test-events.jsonl"],
  ] as const) {
    if (
      sha256(readBoundedFile(path.join(directory, file), 128 * 1024 * 1024)) !==
      digest(object(proof[key]).digest)
    )
      throw new Error("Test evidence differs from its receipt.");
  }
  const tests = inspectTestRecording(directory);
  const recorded = object(receipt.tests);
  const counts = publicCounts(recorded.counts);
  for (const [key, value] of Object.entries(publicCounts(tests.counts))) {
    if (integer(counts[key]) !== value) throw new Error("Test counts differ from receipt.");
  }
  if (recorded.complete !== tests.complete || recorded.passed !== tests.passed)
    throw new Error("Test outcome differs from receipt.");
  return {
    complete: tests.complete,
    passed: tests.passed,
    counts: publicCounts(tests.counts),
    selectedFiles: tests.selectedFiles.length,
    files: tests.fileResults.map((entry) => {
      if (
        typeof entry.file !== "string" ||
        !/^tests\/[A-Za-z0-9_./-]+\.test\.ts$/u.test(entry.file) ||
        entry.file.includes("//") ||
        entry.file.split("/").some((part) => part === "." || part === "..") ||
        typeof entry.success !== "boolean"
      )
        throw new Error("Invalid public test path.");
      return { file: entry.file, success: entry.success, counts: publicCounts(entry.counts) };
    }),
  };
}

/** The only exported fields are bounded categories, integers, timestamps and digests.
 * Raw commands, logs, exceptions, case names and arbitrary environment fields never enter this file. */
export function exportCiVerification(repository: string, summaryFile: string) {
  assertCanonicalDirectory(repository);
  const summary = object(JSON.parse(readBoundedFile(summaryFile, 64 * 1024).toString("utf8")));
  if (
    summary.kind !== "WakeflowVerificationSummary" ||
    summary.schemaVersion !== 1 ||
    typeof summary.receipt !== "string" ||
    !/^\.build\/verification\/run-[A-Za-z0-9]+\/receipt\.json$/u.test(summary.receipt)
  )
    throw new Error("Invalid verification summary.");
  const file = path.join(repository, summary.receipt);
  const directory = path.dirname(file);
  assertCanonicalDirectory(directory);
  const bytes = readBoundedFile(file);
  const receipt = object(JSON.parse(bytes.toString("utf8")));
  if (
    receipt.kind !== "WakeflowVerificationRun" ||
    receipt.schemaVersion !== 1 ||
    receipt.status !== summary.status ||
    receipt.profile !== summary.profile
  )
    throw new Error("Summary and receipt disagree.");
  const status = choice(receipt.status, STATUSES);
  const profile = choice(receipt.profile, PROFILES);
  const input = object(receipt.input);
  const environment = object(receipt.environment);
  if (
    typeof input.commit !== "string" ||
    !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(input.commit) ||
    typeof environment.node !== "string" ||
    !/^\d+\.\d+\.\d+$/u.test(environment.node)
  )
    throw new Error("Invalid verification identity.");
  if (
    !Array.isArray(receipt.stages) ||
    receipt.stages.length > 10 ||
    !Array.isArray(input.artifacts) ||
    input.artifacts.length > 2
  )
    throw new Error("Invalid verification scope.");
  const stages = receipt.stages.map((value: unknown) => {
    const stage = object(value);
    return {
      name: choice(stage.name, STAGES),
      status: choice(stage.status, STATUSES),
      durationMs: integer(stage.durationMs),
      exitCode: stage.exitCode === null ? null : integer(stage.exitCode),
    };
  });
  const tests = testSummary(receipt, directory);
  const expected =
    profile === "gate"
      ? ["gate"]
      : profile === "artifact"
        ? ["build:check", "smoke:artifacts"]
        : STAGES.slice(0, 6);
  if (
    status === "passed" &&
    (JSON.stringify(stages.map((s) => s.name)) !== JSON.stringify(expected) ||
      stages.some((s) => s.status !== "passed" || s.exitCode !== 0) ||
      receipt.inputsUnchanged !== true ||
      (profile !== "artifact" && tests?.passed !== true))
  )
    throw new Error("Incomplete verification cannot export as passed.");
  if (
    status === "passed" &&
    (object(receipt.inputAfter).digest !== input.digest ||
      object(receipt.inputAfter).commit !== input.commit)
  )
    throw new Error("Verification inputs disagree.");
  if (Date.parse(instant(receipt.finishedAt)) < Date.parse(instant(receipt.startedAt)))
    throw new Error("Verification timestamps disagree.");
  const artifacts = input.artifacts.map((value: unknown) => {
    const artifact = object(value);
    return {
      artifact: choice(artifact.path, [
        "plugins/codex-wakeflow/artifact-manifest.json",
        "plugins/claude-code-wakeflow/artifact-manifest.json",
      ]),
      manifestDigest: digest(artifact.manifestDigest),
    };
  });
  const report = {
    kind: "WakeflowCiVerification",
    schemaVersion: 1,
    source: "unsigned-local-verification-receipt",
    status,
    profile,
    startedAt: instant(receipt.startedAt),
    finishedAt: instant(receipt.finishedAt),
    receiptDigest: sha256(bytes),
    input: {
      commit: input.commit,
      digest: digest(input.digest),
      lockfileDigest: input.lockfileDigest === null ? null : digest(input.lockfileDigest),
    },
    environment: {
      node: environment.node,
      platform: choice(environment.platform, ["darwin", "linux", "win32"]),
      arch: choice(environment.arch, ["arm64", "x64", "ia32", "arm", "ppc64", "s390x", "riscv64"]),
    },
    inputsUnchanged: receipt.inputsUnchanged === true,
    stages,
    tests,
    modelTests: modelSummary(receipt.modelTests),
    artifacts,
    nativeHostAcceptance: "unverified",
  };
  const out = mkdtempSync(path.join(privateDirectory(repository, ".build/ci"), "report-"));
  writeReport(path.join(out, "report.json"), report);
  const reportDigest = sha256(readBoundedFile(path.join(out, "report.json")));
  writeReport(path.join(out, "manifest.json"), {
    kind: "WakeflowCiExportManifest",
    schemaVersion: 1,
    files: [{ path: "report.json", digest: reportDigest }],
  });
  return {
    kind: "WakeflowCiExport",
    schemaVersion: 1,
    status: "passed" as const,
    verificationStatus: status,
    directory: path.relative(repository, out).split(path.sep).join("/"),
    reportDigest,
    changesToSource: false,
  };
}

/** Hard byte-integrity check after copying/downloading an export. Never authenticates its origin. */
export function verifyCiBundle(directory: string) {
  assertCanonicalDirectory(directory);
  if (
    JSON.stringify(readdirSync(directory).sort()) !==
    JSON.stringify(["manifest.json", "report.json"])
  )
    throw new Error("CI bundle contains unexpected files.");
  const manifest = object(
    JSON.parse(readBoundedFile(path.join(directory, "manifest.json"), 4096).toString("utf8")),
  );
  if (
    manifest.kind !== "WakeflowCiExportManifest" ||
    manifest.schemaVersion !== 1 ||
    !Array.isArray(manifest.files) ||
    manifest.files.length !== 1
  )
    throw new Error("Invalid CI bundle manifest.");
  const expected = object(manifest.files[0]);
  const bytes = readBoundedFile(path.join(directory, "report.json"));
  if (expected.path !== "report.json" || digest(expected.digest) !== sha256(bytes))
    throw new Error("CI bundle digest mismatch.");
  const report = object(JSON.parse(bytes.toString("utf8")));
  if (
    report.kind !== "WakeflowCiVerification" ||
    report.schemaVersion !== 1 ||
    report.source !== "unsigned-local-verification-receipt"
  )
    throw new Error("Invalid CI bundle report.");
  return {
    kind: "WakeflowCiBundleInspection",
    schemaVersion: 1,
    status: "passed" as const,
    verificationStatus: choice(report.status, STATUSES),
    reportDigest: sha256(bytes),
    integrity: "matched",
    origin: "unverified",
    nativeHostAcceptance: "unverified",
    changesApplied: false,
  };
}
