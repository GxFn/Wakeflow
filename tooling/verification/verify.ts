import { mkdtempSync, realpathSync } from "node:fs";
import { availableParallelism } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BUILD_LOCK_TOKEN_VARIABLE, BuildLockError, withBuildLock } from "../build-lock.js";
import { type ImpactedTestSelection, selectImpactedTests } from "../testing/impacted-tests.js";
import { modelTestOptions } from "../testing/model-options.js";
import { resolveTestConcurrency } from "../testing/run-typescript-tests.js";
import { inspectTestRecording } from "../testing/test-recording.js";
import { privateDirectory, readBoundedFile, sha256, writeReport } from "./files.js";
import { captureVerificationInput } from "./input-identity.js";
import { npmCommand, runLoggedCommand } from "./process.js";

export type VerificationProfile = "quick" | "gate" | "artifact";
type VerificationStatus = "passed" | "failed" | "interrupted" | "unavailable";

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
  /** quick：从 Git 变更集推导受影响测试（`--changed [--since REF]`），而不是显式文件。 */
  readonly changed?: boolean;
  readonly since?: string;
  readonly concurrency?: string;
  readonly signal?: AbortSignal;
}

function stagesFor(request: VerificationRequest, files: readonly string[]) {
  if (request.profile === "gate") return [{ name: "gate", args: ["test"] }];
  if (request.profile === "artifact")
    return ["build:check", "smoke:artifacts"].map((name) => ({ name, args: ["run", name] }));
  if (files.length === 0 && request.changed !== true)
    throw new Error("Quick verification requires explicit test files.");
  return [
    ...["typecheck", "check:architecture", "lint", "format:check", "check:unused"].map((name) => ({
      name,
      args: ["run", name],
    })),
    // 没有受影响的测试时只跑静态检查；回执里的 selection 说明为什么没有测试阶段。
    ...(files.length === 0
      ? []
      : [{ name: "focused-tests", args: ["run", "test:typescript:focused", "--", ...files] }]),
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

interface VerificationOutcome {
  status: VerificationStatus;
  reason: string | null;
}

interface PhaseContext {
  readonly root: string;
  readonly request: VerificationRequest;
  readonly directory: string;
  readonly receiptPath: string;
  readonly base: Record<string, unknown>;
  readonly stages: Array<Record<string, unknown>>;
  readonly concurrency: number;
}

function resolveSelection(root: string, request: VerificationRequest) {
  if (request.changed !== true) return { selection: null, files: request.files };
  if (request.profile !== "quick" || request.files.length > 0)
    throw new Error("--changed applies to quick verification without explicit files.");
  const selection = selectImpactedTests(
    root,
    request.since === undefined ? {} : { since: request.since },
  );
  return { selection, files: selection.tests };
}

function summarizeSelection(selection: Readonly<ImpactedTestSelection> | null) {
  return selection === null
    ? null
    : {
        since: selection.since,
        changed: selection.changed.length,
        tests: selection.tests.length,
        fullGateRecommended: selection.fullGateRecommended,
        fullGateReasons: selection.fullGateReasons,
      };
}

async function runPhase(
  context: PhaseContext,
  phase: Readonly<{ name: string; args: readonly string[] }>,
  index: number,
  token: string,
) {
  const prefix = `${String(index + 1).padStart(2, "0")}-${phase.name.replaceAll(":", "-")}`;
  const stdout = path.join(context.directory, `${prefix}.stdout.log`);
  const stderr = path.join(context.directory, `${prefix}.stderr.log`);
  const command = npmCommand(phase.args);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    WAKEFLOW_TEST_CONCURRENCY: String(context.concurrency),
    [BUILD_LOCK_TOKEN_VARIABLE]: token,
  };
  delete env.NODE_TEST_CONTEXT;
  delete env.WAKEFLOW_TEST_RECORD_DIR;
  if (context.request.profile !== "artifact") env.WAKEFLOW_TEST_RECORD_DIR = context.directory;
  process.stderr.write(`wakeflow verify: ${phase.name}\n`);
  const result = await runLoggedCommand(
    context.root,
    command,
    { stdout, stderr },
    {
      // The gate phase is the whole `npm test`; the tracked duration table alone sums to
      // about 28 minutes at two workers, so it gets its own budget (gate-log §13.161).
      timeoutMs: (phase.name === "gate" ? 90 : 30) * 60 * 1000,
      env,
      ...(context.request.signal === undefined ? {} : { signal: context.request.signal }),
    },
  );
  context.stages.push({
    name: phase.name,
    command,
    ...result,
    stdout: logIdentity(context.root, stdout),
    stderr: logIdentity(context.root, stderr),
  });
  writeReport(context.receiptPath, { ...context.base, status: "running", finishedAt: null });
  return result;
}

/** 所有阶段都在仓库构建锁之下：另一条并行的编译或制品重建不能改写本次正在读的 .build/。 */
async function runPhasesUnderLock(
  context: PhaseContext,
  phases: readonly Readonly<{ name: string; args: readonly string[] }>[],
  outcome: VerificationOutcome,
): Promise<void> {
  try {
    await withBuildLock(
      context.root,
      `wf verify ${context.request.profile}`,
      async (token) => {
        for (const [index, phase] of phases.entries()) {
          const result = await runPhase(context, phase, index, token);
          if (result.status !== "passed") {
            outcome.status = result.status;
            outcome.reason = result.reason;
            return;
          }
        }
      },
      context.request.signal === undefined ? {} : { signal: context.request.signal },
    );
  } catch (error: unknown) {
    if (!(error instanceof BuildLockError)) throw error;
    // 等锁时被取消按中断记录；锁一直被占用是本次不可验证，不是检查失败。
    outcome.status = error.code === "build-lock-aborted" ? "interrupted" : "unavailable";
    outcome.reason = error.code === "build-lock-aborted" ? "cancelled" : error.code;
  }
}

export async function verifyRepository(rootInput: string, request: VerificationRequest) {
  const root = realpathSync(rootInput);
  const { selection, files } = resolveSelection(root, request);
  const phases = stagesFor(request, files);
  const concurrency = resolveTestConcurrency(
    request.concurrency ?? process.env.WAKEFLOW_TEST_CONCURRENCY,
    Math.max(1, availableParallelism()),
  );
  const before = captureVerificationInput(root);
  const parent = privateDirectory(root, ".build/verification");
  const directory = mkdtempSync(path.join(parent, "run-"));
  const receiptPath = path.join(directory, "receipt.json");
  const stages: Array<Record<string, unknown>> = [];
  const base = {
    kind: "WakeflowVerificationRun",
    schemaVersion: 1,
    privacy: "private-local-evidence",
    profile: request.profile,
    startedAt: new Date().toISOString(),
    environment: { node: process.versions.node, platform: process.platform, arch: process.arch },
    concurrency,
    modelTests: request.profile === "artifact" ? null : modelTestOptions(process.env),
    input: before,
    runner: RUNNER_IDENTITY,
    selection,
    stages,
  };
  writeReport(receiptPath, { ...base, status: "running", finishedAt: null });
  // 阶段在锁闭包里结算，所以用一个对象承载状态，闭包外的类型不会被控制流收窄。
  const outcome: VerificationOutcome = { status: "passed", reason: null };
  let tests: ReturnType<typeof inspectTestRecording> | null = null;
  let testEvidence: Record<string, ReturnType<typeof logIdentity>> | null = null;
  let after: ReturnType<typeof captureVerificationInput> | null = null;
  try {
    await runPhasesUnderLock(
      { root, request, directory, receiptPath, base, stages, concurrency },
      phases,
      outcome,
    );
    const tested = testOutcome(
      directory,
      request.profile === "gate" || (request.profile === "quick" && files.length > 0),
    );
    tests = tested.tests;
    if (tests !== null)
      testEvidence = {
        selection: logIdentity(root, path.join(directory, "test-selection.json")),
        events: logIdentity(root, path.join(directory, "test-events.jsonl")),
      };
    if (outcome.status === "passed" && tested.problem !== null) {
      outcome.status = tested.problem.status;
      outcome.reason = tested.problem.reason;
    }
    after = captureVerificationInput(root);
    if (
      (after.digest !== before.digest || after.commit !== before.commit) &&
      outcome.status === "passed"
    ) {
      outcome.status = "unavailable";
      outcome.reason = "verification-input-changed";
    }
  } catch {
    outcome.status = "unavailable";
    outcome.reason = "verification-settlement-failed";
  }
  const { status, reason } = outcome;
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
    selection: summarizeSelection(selection),
    counts: tests?.counts ?? null,
    inputsUnchanged: receipt.inputsUnchanged,
    exitCode:
      status === "passed" ? 0 : status === "failed" ? 1 : status === "interrupted" ? 130 : 2,
  };
}
