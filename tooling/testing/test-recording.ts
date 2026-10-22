import { lstatSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { isRecord, readBoundedFile, sha256 } from "../verification/files.js";

/** 运行器的一条"道"：一组按派发顺序排好的测试源与它们自己的文件并发度（run-typescript-tests.ts）。 */
export interface TestLane {
  readonly name: "all" | "chain" | "isolated" | "normal";
  readonly concurrency: number;
  /** 等这条道全部结束后才开始；null 为立即开始。 */
  readonly after: TestLane["name"] | null;
  /** 仓库相对测试源路径，保持传入的派发顺序。 */
  readonly files: readonly string[];
}

export function prepareTestRecording(
  root: string,
  directory: string,
  files: readonly string[],
  concurrency: number,
  lanes: readonly TestLane[] | null = null,
) {
  const resolved = path.resolve(directory);
  const parent = path.join(realpathSync(root), ".build", "verification");
  if (path.dirname(resolved) !== parent || !/^run-[a-zA-Z0-9]+$/u.test(path.basename(resolved)))
    throw new Error("Test recording requires one verification run directory.");
  if (realpathSync(parent) !== parent || realpathSync(resolved) !== resolved)
    throw new Error("Test recording cannot follow symlinks.");
  const stat = lstatSync(resolved);
  if (!stat.isDirectory() || (stat.mode & 0o777) !== 0o700)
    throw new Error("Test recording directory must be private.");
  const selected = files.map((file) =>
    path
      .relative(root, file)
      .split(path.sep)
      .join("/")
      .replace(/^\.build\/tests\/(.*)\.js$/u, "tests/$1.ts"),
  );
  writeFileSync(
    path.join(resolved, "test-selection.json"),
    `${JSON.stringify(
      {
        kind: "WakeflowTestSelection",
        schemaVersion: 1,
        files: selected,
        compiledEntrypoints: files.map((file, index) => ({
          source: selected[index],
          digest: sha256(readBoundedFile(file)),
        })),
        concurrency,
        // 道计划是排程事实的一部分：哪些文件在哪条道、几个 worker、等谁结束才开始。
        lanes,
      },
      null,
      2,
    )}\n`,
    { flag: "wx", mode: 0o600 },
  );
  const events = path.join(resolved, "test-events.jsonl");
  writeFileSync(events, "", { flag: "wx", mode: 0o600 });
  return { events, selected };
}

export interface TestCounts {
  readonly tests: number;
  readonly passed: number;
  readonly failed: number;
  readonly cancelled: number;
  readonly skipped: number;
  readonly todo: number;
  readonly suites: number;
}

const COUNT_KEYS = ["tests", "passed", "failed", "cancelled", "skipped", "todo", "suites"] as const;

function validCounts(value: unknown): value is TestCounts {
  return (
    isRecord(value) &&
    COUNT_KEYS.every(
      (key) =>
        typeof value[key] === "number" && Number.isSafeInteger(value[key]) && value[key] >= 0,
    )
  );
}

export function inspectTestRecording(directory: string) {
  const selection: unknown = JSON.parse(
    readBoundedFile(path.join(directory, "test-selection.json")).toString("utf8"),
  );
  if (
    !isRecord(selection) ||
    selection.kind !== "WakeflowTestSelection" ||
    !Array.isArray(selection.files) ||
    selection.files.length === 0 ||
    selection.files.some((file) => typeof file !== "string")
  )
    throw new Error("Invalid test selection record.");
  const files = selection.files as string[];
  // Same bound as the verifier's log identity: an events file is never digested at one size and
  // refused at another.
  const lines = readBoundedFile(path.join(directory, "test-events.jsonl"), 128 * 1024 * 1024)
    .toString("utf8")
    .trimEnd()
    .split("\n");
  const events: unknown[] = lines.map((line) => JSON.parse(line));
  const first = events[0];
  if (!isRecord(first) || first.kind !== "WakeflowTestEvents" || first.schemaVersion !== 1)
    throw new Error("Invalid test event stream.");
  if (
    events
      .slice(1, -1)
      .some((event) => !isRecord(event) || !["test", "summary"].includes(String(event.type)))
  )
    throw new Error("Unexpected or concatenated test event stream.");
  const summaries = events.filter(
    (event): event is Record<string, unknown> => isRecord(event) && event.type === "summary",
  );
  const run = summaries.filter((event) => event.scope === "run");
  const perFile = summaries.filter((event) => event.scope === "file");
  const summary = run[0];
  const end = events.at(-1);
  const complete =
    isRecord(end) &&
    end.type === "end" &&
    run.length === 1 &&
    perFile.length === files.length &&
    new Set(files).size === files.length &&
    files.every((file) => perFile.filter((event) => event.file === file).length === 1) &&
    perFile.every(
      (event) =>
        typeof event.success === "boolean" &&
        validCounts(event.counts) &&
        typeof event.durationMs === "number" &&
        Number.isFinite(event.durationMs) &&
        event.durationMs >= 0,
    );
  if (summary === undefined || !validCounts(summary.counts) || typeof summary.success !== "boolean")
    throw new Error("Missing valid run summary.");
  const counts = summary.counts;
  const passed =
    complete &&
    summary.success &&
    !events.some((event) => isRecord(event) && event.type === "test" && event.passed === false) &&
    perFile.every((event) => event.success === true) &&
    COUNT_KEYS.every(
      (key) =>
        perFile.reduce(
          (sum, event) => sum + (validCounts(event.counts) ? event.counts[key] : 0),
          0,
        ) === counts[key],
    ) &&
    counts.tests > 0 &&
    counts.failed === 0 &&
    counts.cancelled === 0 &&
    counts.skipped === 0 &&
    counts.todo === 0;
  return {
    complete,
    passed,
    counts,
    selectedFiles: files,
    concurrency: selection.concurrency,
    lanes: Array.isArray(selection.lanes) ? (selection.lanes as readonly TestLane[]) : null,
    fileResults: perFile.map((event) => ({
      file: event.file,
      success: event.success,
      counts: event.counts,
    })),
    fileDurations: perFile.map((event) => ({ file: event.file, durationMs: event.durationMs })),
  };
}
