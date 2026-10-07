import { realpathSync } from "node:fs";
import path from "node:path";
import type { TestEvent } from "node:test/reporters";

function sourcePath(file: string | undefined): string | null {
  if (file === undefined) return null;
  let root = process.cwd();
  try {
    root = realpathSync(root);
  } catch {
    /* Preserve an unavailable path as null below. */
  }
  const relative = path.relative(root, file).split(path.sep).join("/");
  if (relative.startsWith("../") || path.isAbsolute(relative)) return null;
  return relative.replace(/^\.build\/tests\/(.*)\.js$/u, "tests/$1.ts");
}

/** Event data is private test evidence. Do not serialize Error objects or arbitrary stdout. */
export default async function* testEventReporter(source: AsyncIterable<TestEvent>) {
  yield `${JSON.stringify({ kind: "WakeflowTestEvents", schemaVersion: 1 })}\n`;
  for await (const event of source) {
    if (event.type === "test:complete") {
      const data = event.data;
      yield `${JSON.stringify({
        type: "test",
        file: sourcePath(data.file),
        name: data.name.slice(0, 4096),
        nesting: data.nesting,
        passed: data.details.passed,
        durationMs: data.details.duration_ms,
        skip: Boolean(data.skip),
        todo: Boolean(data.todo),
      })}\n`;
    } else if (event.type === "test:summary") {
      const data = event.data;
      // Node 24 emits failed although older @types/node releases omit that field.
      const counts = data.counts as typeof data.counts & { readonly failed?: number };
      yield `${JSON.stringify({
        type: "summary",
        scope: data.file === undefined ? "run" : "file",
        file: sourcePath(data.file),
        success: data.success,
        durationMs: data.duration_ms,
        counts: {
          tests: counts.tests,
          passed: counts.passed,
          failed: counts.failed ?? null,
          cancelled: counts.cancelled,
          skipped: counts.skipped,
          todo: counts.todo,
          suites: counts.suites,
        },
      })}\n`;
    }
  }
  yield `${JSON.stringify({ type: "end" })}\n`;
}
