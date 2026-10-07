import { existsSync, lstatSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import { assertCanonicalDirectory } from "../lab/inventory.js";
import { privateDirectory } from "../verification/files.js";
import { runLoggedCommand } from "../verification/process.js";
import {
  CaptureError,
  canonicalDigest,
  object,
  readJson,
  readObservedFile,
  requireCapture,
  selfDigest,
  writeExclusiveJson,
} from "./io.js";
import { observationsEqual, observeProduct } from "./observations.js";
import {
  type CapturePlan,
  captureCommand,
  readCapturePlan,
  validateExecutablePlan,
} from "./plan.js";

/** The read-only half of privateDirectory: existing segments must be real directories; missing ones are fine. */
function assertCreatablePrivateDirectory(root: string, relative: string): void {
  let current = root;
  for (const name of relative.split("/")) {
    if (name === "" || name === "." || name === "..") throw new Error("Invalid directory segment.");
    current = path.join(current, name);
    const stat = lstatSync(current, { throwIfNoEntry: false });
    if (stat === undefined) return;
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Unsafe directory.");
  }
}

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { readonly code: unknown }).code)
    : undefined;
}

export function captureAttemptFile(repository: string, plan: CapturePlan, stepId: string): string {
  const key = canonicalDigest([
    plan.selection.root,
    plan.subject.programId,
    plan.subject.demandId,
    plan.subject.targetTaskId,
    plan.subject.testAttemptId,
    stepId,
  ]).slice(7);
  return path.join(repository, ".build/capture/attempts", `step-${key}.json`);
}

function stepDirectory(plan: CapturePlan, stepId: string) {
  requireCapture(
    /^test-attempt_[a-f0-9-]{36}$/u.test(plan.subject.testAttemptId) &&
      /^ts-[1-9][0-9]?$/u.test(stepId),
    "capture-invalid-step-identity",
  );
  return path.join(plan.outputRoot, plan.subject.testAttemptId, stepId);
}

function currentInputs(plan: CapturePlan, stepId: string) {
  const configuration = readObservedFile(
    path.join(plan.selection.root, "wakeflow.config.json"),
  ).observation;
  const frozenConfig = plan.inputs.find((row) => row.ref === plan.artifactRefs.config);
  requireCapture(
    configuration.digest === frozenConfig?.observation.digest,
    "capture-config-changed",
  );
  const files = plan.commandInputs.find((row) => row.stepId === stepId)?.files;
  requireCapture(files !== undefined, "capture-command-inputs-missing");
  const command = captureCommand(plan, stepId);
  requireCapture(files.length === command.inputFiles.length, "capture-command-inputs-mismatch");
  const harness = files.map((file, index) => {
    requireCapture(
      file.sourcePath === path.join(plan.executionRoot, command.inputFiles[index] ?? ""),
      "capture-command-inputs-mismatch",
    );
    const observed = readObservedFile(file.sourcePath).observation;
    requireCapture(observationsEqual(observed, file.observation), "capture-harness-changed");
    return { sourcePath: file.sourcePath, observation: observed };
  });
  const products = plan.products.map(observeProduct);
  requireCapture(
    observationsEqual(products, plan.productObservations),
    "capture-product-input-changed",
  );
  return { configurationDigest: configuration.digest, products, harness };
}

function safeCaptureCode(error: unknown): string {
  return error instanceof CaptureError ? error.code : "capture-observation-unavailable";
}

/** Executes only an explicit frozen command. No verdict, evidence import, retry or host transport. */
export async function runCapture(
  repository: string,
  id: string,
  stepId: string,
  signal?: AbortSignal,
) {
  const plan = readCapturePlan(repository, id);
  validateExecutablePlan(repository, id, plan);
  const command = captureCommand(plan, stepId);
  requireCapture(signal?.aborted !== true, "capture-cancelled-before-start");
  const before = currentInputs(plan, stepId);
  // Refuse an unusable output location before the step's single attempt is claimed: a symlinked
  // or occupied output directory must not consume the marker that a corrected plan then needs.
  assertCreatablePrivateDirectory(plan.executionRoot, plan.selection.outputDirectory);
  assertCreatablePrivateDirectory(plan.outputRoot, plan.subject.testAttemptId);
  const directory = stepDirectory(plan, stepId);
  requireCapture(!existsSync(directory), "capture-step-output-already-exists");
  privateDirectory(repository, ".build/capture/attempts");
  const attemptFile = captureAttemptFile(repository, plan, stepId);
  requireCapture(!existsSync(attemptFile), "capture-attempt-already-recorded");
  const marker = {
    kind: "WakeflowCaptureStepStarted",
    schemaVersion: 1,
    planDigest: plan.planDigest,
    subject: plan.subject,
    stepId,
    commandDigest: canonicalDigest(command),
    recordedAt: new Date().toISOString(),
    outcome: "command-not-yet-observed",
  };
  // This exclusive marker is stable across re-planning and output-directory changes. It is
  // claimed before anything is created under the Test root, so a concurrent run of the same
  // step loses here with its own code and leaves no empty step directory behind.
  try {
    writeExclusiveJson(attemptFile, marker);
  } catch (error: unknown) {
    requireCapture(errorCode(error) !== "EEXIST", "capture-attempt-already-recorded");
    throw error;
  }
  privateDirectory(plan.executionRoot, plan.selection.outputDirectory);
  privateDirectory(plan.outputRoot, plan.subject.testAttemptId);
  mkdirSync(directory, { mode: 0o700 });
  writeExclusiveJson(path.join(directory, "started.json"), marker);
  const logs = {
    stdout: path.join(directory, "stdout.log"),
    stderr: path.join(directory, "stderr.log"),
  };
  const stop = new AbortController();
  let outputIssue: string | null = null;
  const checkBudget = () => {
    try {
      const bytes = Object.values(logs).reduce((sum, file) => {
        const stat = lstatSync(file, { throwIfNoEntry: false });
        if (stat === undefined) return sum;
        requireCapture(
          stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1,
          "capture-log-replaced",
        );
        return sum + stat.size;
      }, 0);
      if (bytes > command.outputBudgetBytes) {
        outputIssue = "capture-output-budget";
        stop.abort();
      }
    } catch (error: unknown) {
      outputIssue = safeCaptureCode(error);
      stop.abort();
    }
  };
  const watcher = setInterval(checkBudget, 50);
  watcher.unref();
  const issues: string[] = [];
  let settlement: Awaited<ReturnType<typeof runLoggedCommand>> | null = null;
  try {
    settlement = await runLoggedCommand(plan.executionRoot, command, logs, {
      signal: signal === undefined ? stop.signal : AbortSignal.any([signal, stop.signal]),
      timeoutMs: command.timeoutMs,
      env: { ...process.env },
    });
  } catch {
    issues.push("capture-command-settlement-unavailable");
  } finally {
    clearInterval(watcher);
  }
  checkBudget();
  if (outputIssue !== null) issues.push(outputIssue);
  let after: ReturnType<typeof currentInputs> | null = null;
  try {
    after = currentInputs(plan, stepId);
    requireCapture(observationsEqual(before, after), "capture-inputs-changed-during-command");
  } catch (error: unknown) {
    issues.push(safeCaptureCode(error));
  }
  const outputs = Object.entries(logs).map(([stream, file]) => {
    try {
      return { stream, file: path.basename(file), observation: readObservedFile(file).observation };
    } catch (error: unknown) {
      issues.push(safeCaptureCode(error));
      return { stream, file: path.basename(file), observation: null };
    }
  });
  const body = {
    kind: "WakeflowTestStepCapture",
    schemaVersion: 1,
    planDigest: plan.planDigest,
    markerDigest: canonicalDigest(marker),
    subject: plan.subject,
    stepId,
    command,
    executionRoot: plan.executionRoot,
    before,
    after,
    settlement,
    outputs,
    issues,
    completedAt: new Date().toISOString(),
    captureRuntime: { node: process.version, platform: process.platform },
    authorization: "imported-unverified",
    testVerdict: "not-assessed",
    controllerAcceptance: "not-performed",
  };
  writeExclusiveJson(path.join(directory, "record.json"), {
    ...body,
    recordDigest: canonicalDigest(body),
  });
  try {
    const readback = inspectCapture(repository, id).steps.find((entry) => entry.stepId === stepId);
    if (readback?.integrity !== "matched") issues.push("capture-record-integrity-unavailable");
  } catch {
    issues.push("capture-record-integrity-unavailable");
  }
  const exitCode =
    issues.length > 0 || settlement?.status === "interrupted" || settlement === null
      ? 2
      : settlement.status === "failed"
        ? 1
        : 0;
  return {
    kind: "WakeflowTestCaptureRunResult",
    schemaVersion: 1,
    status: exitCode === 0 ? "captured" : exitCode === 1 ? "failed" : "unavailable",
    exitCode,
    id,
    stepId,
    outputFromExecutionRoot: path.relative(plan.executionRoot, directory),
    issues,
    commandStatus: settlement?.status ?? "unavailable",
    authorization: "imported-unverified",
    testVerdict: "not-assessed",
    controllerAcceptance: "not-performed",
  };
}

/** Offline integrity inspection: absence or a partial write is not a successful execution. */
export function inspectCapture(repository: string, id: string) {
  const plan = readCapturePlan(repository, id);
  const steps = plan.steps.map((step) => {
    const stepId = String(step.stepId);
    const directory = stepDirectory(plan, stepId);
    try {
      const marker = readJson(captureAttemptFile(repository, plan, stepId));
      const record = readJson(path.join(directory, "record.json"));
      selfDigest(record, "recordDigest");
      requireCapture(
        marker.kind === "WakeflowCaptureStepStarted" &&
          marker.schemaVersion === 1 &&
          record.kind === "WakeflowTestStepCapture" &&
          record.schemaVersion === 1 &&
          marker.planDigest === plan.planDigest &&
          marker.stepId === stepId &&
          record.planDigest === plan.planDigest &&
          record.stepId === stepId &&
          canonicalDigest(marker) === record.markerDigest &&
          canonicalDigest(marker.subject) === canonicalDigest(plan.subject) &&
          canonicalDigest(record.subject) === canonicalDigest(plan.subject) &&
          marker.commandDigest === canonicalDigest(captureCommand(plan, stepId)) &&
          canonicalDigest(readJson(path.join(directory, "started.json"))) === record.markerDigest &&
          canonicalDigest(record.command) === canonicalDigest(captureCommand(plan, stepId)),
        "capture-record-mismatch",
      );
      assertCanonicalDirectory(directory);
      requireCapture(
        readdirSync(directory).sort().join("\n") ===
          "record.json\nstarted.json\nstderr.log\nstdout.log",
        "capture-unknown-step-files",
      );
      requireCapture(
        Array.isArray(record.outputs) &&
          record.outputs.length === 2 &&
          new Set(record.outputs.map((row) => object(row).stream)).size === 2,
        "capture-invalid-outputs",
      );
      for (const output of record.outputs) {
        const row = object(output);
        requireCapture(
          (row.stream === "stdout" || row.stream === "stderr") && row.file === `${row.stream}.log`,
          "capture-invalid-outputs",
        );
        const observed = readObservedFile(path.join(directory, String(row.file))).observation;
        requireCapture(
          row.observation !== null && observationsEqual(observed, row.observation),
          "capture-output-drift",
        );
      }
      const settlement = object(record.settlement);
      requireCapture(
        Array.isArray(record.issues) &&
          record.issues.length === 0 &&
          record.after !== null &&
          observationsEqual(record.before, record.after),
        "capture-incomplete-observation",
      );
      requireCapture(
        settlement.status === "passed" || settlement.status === "failed",
        "capture-interrupted",
      );
      requireCapture(
        settlement.status === "passed"
          ? settlement.exitCode === 0 && settlement.signal === null && settlement.reason === "exit"
          : settlement.exitCode !== 0 &&
              ["exit", "spawn-failed"].includes(String(settlement.reason)),
        "capture-settlement-inconsistent",
      );
      return { stepId, integrity: "matched", commandStatus: String(settlement.status) };
    } catch (error: unknown) {
      return { stepId, integrity: "unavailable", code: safeCaptureCode(error) };
    }
  });
  const unavailable = steps.some((step) => step.integrity !== "matched");
  const failed = steps.some((step) => step.commandStatus === "failed");
  return {
    kind: "WakeflowTestCaptureInspection",
    schemaVersion: 1,
    id,
    status: unavailable ? "unavailable" : failed ? "failed" : "matched",
    exitCode: unavailable ? 2 : failed ? 1 : 0,
    steps,
    // Inspection reads the plan copy, the attempt markers and the step outputs under the Test
    // root; it never re-observes products, Git state or the live configuration.
    readsWorkspaceState: false,
    readsStepOutputs: true,
    source: "local-capture-records",
    authorization: "imported-unverified",
    testVerdict: "not-assessed",
    controllerAcceptance: "not-performed",
  };
}
