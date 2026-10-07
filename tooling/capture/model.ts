import path from "node:path";
import { array, closed, relativeFile, requireCapture, textValue } from "./io.js";

export interface CaptureCommand {
  readonly stepId: string;
  readonly executable: string;
  readonly args: readonly string[];
  readonly inputFiles: readonly string[];
  readonly timeoutMs: number;
  readonly outputBudgetBytes: number;
}

export interface CaptureSelection {
  readonly kind: "WakeflowTestCaptureSelection";
  readonly schemaVersion: 1;
  readonly root: string;
  readonly taskPackageFile: string;
  readonly envelopeFile: string;
  readonly envelopeDigest: string;
  readonly previousResultFile: string | null;
  readonly outputDirectory: string;
  readonly implementations: readonly {
    readonly repositoryId: string;
    readonly checkout: string;
    readonly resultFile: string;
    readonly commit: string;
    readonly files: readonly string[];
  }[];
  readonly commands: readonly CaptureCommand[];
}

function uniqueFiles(value: unknown): readonly string[] {
  const files = array(value, 32).map(relativeFile);
  requireCapture(new Set(files).size === files.length, "capture-duplicate-file");
  return files;
}

function integer(value: unknown, fallback: number, maximum: number): number {
  const n = value === undefined ? fallback : value;
  requireCapture(
    typeof n === "number" && Number.isSafeInteger(n) && n > 0 && n <= maximum,
    "capture-invalid-budget",
  );
  return n;
}

function command(value: unknown): CaptureCommand {
  const v = closed(value, [
    "stepId",
    "executable",
    "args",
    "inputFiles",
    "timeoutMs",
    "outputBudgetBytes",
  ]);
  const stepId = textValue(v.stepId);
  requireCapture(/^ts-[1-9][0-9]?$/u.test(stepId), "capture-invalid-step");
  const args = array(v.args, 128).map((arg) => {
    requireCapture(
      typeof arg === "string" && arg.length <= 65536 && !arg.includes("\0"),
      "capture-invalid-argument",
    );
    return arg;
  });
  return {
    stepId,
    executable: textValue(v.executable),
    args,
    inputFiles: uniqueFiles(v.inputFiles),
    timeoutMs: integer(v.timeoutMs, 60_000, 600_000),
    outputBudgetBytes: integer(v.outputBudgetBytes, 8 * 1024 * 1024, 16 * 1024 * 1024),
  };
}

export function parseCaptureSelection(value: unknown, inputDirectory: string): CaptureSelection {
  const v = closed(value, [
    "kind",
    "schemaVersion",
    "root",
    "taskPackageFile",
    "envelopeFile",
    "envelopeDigest",
    "previousResultFile",
    "outputDirectory",
    "implementations",
    "commands",
  ]);
  requireCapture(
    v.kind === "WakeflowTestCaptureSelection" && v.schemaVersion === 1,
    "capture-invalid-selection",
  );
  const root = path.resolve(inputDirectory, textValue(v.root));
  const implementations = array(v.implementations).map((value) => {
    const row = closed(value, ["repositoryId", "checkout", "resultFile", "commit", "files"]);
    const commit = textValue(row.commit);
    requireCapture(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(commit), "capture-invalid-commit");
    const files = uniqueFiles(row.files);
    requireCapture(files.length > 0, "capture-product-files-required");
    return {
      repositoryId: textValue(row.repositoryId),
      checkout: path.resolve(root, textValue(row.checkout)),
      resultFile: path.resolve(root, textValue(row.resultFile)),
      commit,
      files,
    };
  });
  const commands = array(v.commands, 20).map(command);
  requireCapture(
    new Set(implementations.map((v) => v.repositoryId)).size === implementations.length &&
      new Set(commands.map((v) => v.stepId)).size === commands.length,
    "capture-duplicate-selection",
  );
  const envelopeDigest = textValue(v.envelopeDigest);
  requireCapture(/^sha256:[a-f0-9]{64}$/u.test(envelopeDigest), "capture-invalid-digest");
  return {
    kind: "WakeflowTestCaptureSelection",
    schemaVersion: 1,
    root,
    taskPackageFile: path.resolve(root, textValue(v.taskPackageFile)),
    envelopeFile: path.resolve(root, textValue(v.envelopeFile)),
    envelopeDigest,
    previousResultFile:
      v.previousResultFile === undefined || v.previousResultFile === null
        ? null
        : path.resolve(root, textValue(v.previousResultFile)),
    outputDirectory: relativeFile(v.outputDirectory),
    implementations,
    commands,
  };
}
