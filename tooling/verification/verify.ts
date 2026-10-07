import { mkdtempSync, realpathSync } from "node:fs";
import { availableParallelism } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { modelTestOptions } from "../testing/model-options.js";
import { resolveTestConcurrency } from "../testing/run-typescript-tests.js";
import { inspectTestRecording } from "../testing/test-recording.js";
import { privateDirectory, readBoundedFile, sha256, writeReport } from "./files.js";
import { captureVerificationInput } from "./input-identity.js";
import { npmCommand, runLoggedCommand } from "./process.js";

export type VerificationProfile = "quick" | "gate" | "artifact";

const RUNNER_IDENTITY = Object.freeze({
  verifierDigest: sha256(readBoundedFile(fileURLToPath(import.meta.url))),
  testRunnerDigest: sha256(
    readBoundedFile(fileURLToPath(new URL("../testing/run-typescript-tests.js", import.meta.url))),
  ),
  testReporterDigest: sha256(
    readBoundedFile(fileURLToPath(new URL("../testing/test-event-reporter.js", import.meta.url))),
  ),
});

interface VerificationRequest {
  readonly profile: VerificationProfile;
  readonly files: readonly string[];
  readonly concurrency?: string;
  readonly signal?: AbortSignal;
}

function stagesFor(request: VerificationRequest) {
  if (request.profile === "gate") return [{ name: "gate", args: ["test"] }];
  if (request.profile === "artifact")
    return ["build:check", "smoke:artifacts"].map((name) => ({ name, args: ["run", name] }));
  if (request.files.length === 0)
    throw new Error("Quick verification requires explicit test files.");
  return [
    ...["typecheck", "check:architecture", "lint", "format:check", "check:unused"].map((name) => ({
      name,
      args: ["run", name],
    })),
    { name: "focused-tests", args: ["run", "test:typescript:focused", "--", ...request.files] },
  ];
}

function logIdentity(root: string, file: string) {
  const bytes = readBoundedFile(file, 128 * 1024 * 1024);
  return {
    path: path.relative(root, file).split(path.sep).join("/"),
    bytes: bytes.length,
    digest: sha256(bytes),
  };
}

function testOutcome(directory: string, required: boolean) {
  if (!required) return { tests: null, problem: null };
  try {
    const tests = inspectTestRecording(directory);
    return {
      tests,
      problem: tests.passed
        ? null
        : {
            status: tests.complete ? ("failed" as const) : ("unavailable" as const),
            reason: tests.complete ? "tests-not-passing" : "test-record-incomplete",
          },
    };
  } catch {
    return {
      tests: null,
      problem: { status: "unavailable" as const, reason: "test-record-unavailable" },
    };
  }
}

export async function verifyRepository(rootInput: string, request: VerificationRequest) {
  const root = realpathSync(rootInput);
  const phases = stagesFor(request);
  const concurrency = resolveTestConcurrency(
    request.concurrency ?? process.env.WAKEFLOW_TEST_CONCURRENCY,
    Math.max(1, availableParallelism()),
  );
  const before = captureVerificationInput(root);
  const parent = privateDirectory(root, ".build/verification");
  const directory = mkdtempSync(path.join(parent, "run-"));
  const receiptPath = path.join(directory, "receipt.json");
  const startedAt = new Date().toISOString();
  const stages: Array<Record<string, unknown>> = [];
  const base = {
    kind: "WakeflowVerificationRun",
    schemaVersion: 1,
    privacy: "private-local-evidence",
    profile: request.profile,
    startedAt,
    environment: { node: process.versions.node, platform: process.platform, arch: process.arch },
    concurrency,
    modelTests: request.profile === "artifact" ? null : modelTestOptions(process.env),
    input: before,
    runner: RUNNER_IDENTITY,
    stages,
  };
  writeReport(receiptPath, { ...base, status: "running", finishedAt: null });
  let status: "passed" | "failed" | "interrupted" | "unavailable" = "passed";
  let reason: string | null = null;
  let tests: ReturnType<typeof inspectTestRecording> | null = null;
  let testEvidence: Record<string, ReturnType<typeof logIdentity>> | null = null;
  let after: ReturnType<typeof captureVerificationInput> | null = null;
  try {
    for (const [index, phase] of phases.entries()) {
      const prefix = `${String(index + 1).padStart(2, "0")}-${phase.name.replaceAll(":", "-")}`;
      const stdout = path.join(directory, `${prefix}.stdout.log`);
      const stderr = path.join(directory, `${prefix}.stderr.log`);
      const command = npmCommand(phase.args);
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        WAKEFLOW_TEST_CONCURRENCY: String(concurrency),
      };
      delete env.NODE_TEST_CONTEXT;
      delete env.WAKEFLOW_TEST_RECORD_DIR;
      if (request.profile !== "artifact") env.WAKEFLOW_TEST_RECORD_DIR = directory;
      process.stderr.write(`wakeflow verify: ${phase.name}\n`);
      const result = await runLoggedCommand(
        root,
        command,
        { stdout, stderr },
        {
          // The gate phase is the whole `npm test`; the tracked duration table alone sums to
          // about 28 minutes at two workers, so it gets its own budget (gate-log §13.161).
          timeoutMs: (phase.name === "gate" ? 90 : 30) * 60 * 1000,
          env,
          ...(request.signal === undefined ? {} : { signal: request.signal }),
        },
      );
      stages.push({
        name: phase.name,
        command,
        ...result,
        stdout: logIdentity(root, stdout),
        stderr: logIdentity(root, stderr),
      });
      writeReport(receiptPath, { ...base, status: "running", finishedAt: null });
      if (result.status !== "passed") {
        status = result.status;
        reason = result.reason;
        break;
      }
    }
    const tested = testOutcome(directory, request.profile !== "artifact");
    tests = tested.tests;
    if (tests !== null)
      testEvidence = {
        selection: logIdentity(root, path.join(directory, "test-selection.json")),
        events: logIdentity(root, path.join(directory, "test-events.jsonl")),
      };
    if (status === "passed" && tested.problem !== null) {
      status = tested.problem.status;
      reason = tested.problem.reason;
    }
    after = captureVerificationInput(root);
    if ((after.digest !== before.digest || after.commit !== before.commit) && status === "passed") {
      status = "unavailable";
      reason = "verification-input-changed";
    }
  } catch {
    status = "unavailable";
    reason = "verification-settlement-failed";
  }
  const receipt = {
    ...base,
    status,
    reason,
    finishedAt: new Date().toISOString(),
    inputAfter: after,
    inputsUnchanged:
      after !== null && after.digest === before.digest && after.commit === before.commit,
    tests,
    testEvidence,
  };
  writeReport(receiptPath, receipt);
  return {
    kind: "WakeflowVerificationSummary",
    schemaVersion: 1,
    status,
    reason,
    profile: request.profile,
    receipt: path.relative(root, receiptPath).split(path.sep).join("/"),
    counts: tests?.counts ?? null,
    inputsUnchanged: receipt.inputsUnchanged,
    exitCode:
      status === "passed" ? 0 : status === "failed" ? 1 : status === "interrupted" ? 130 : 2,
  };
}
