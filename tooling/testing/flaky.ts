import { mkdtempSync } from "node:fs";
import path from "node:path";
import { BUILD_LOCK_TOKEN_VARIABLE, withBuildLock } from "../build-lock.js";
import { privateDirectory, writeReport } from "../verification/files.js";
import { npmCommand, runLoggedCommand } from "../verification/process.js";

/**
 * Wakeflow Tooling / Flaky triage：同一组测试文件重复运行 N 次，记录每次的结果与耗时。
 *
 * 它回答"这个失败是偶发还是稳定"，不自动重试洗绿：任何一次失败都让整体非零退出，混合结果标为
 * `flaky`。每次运行的日志留在 `.build/flaky/run-…/`；整个分诊持有仓库构建锁。
 */

export interface FlakyTriageResult {
  readonly kind: "WakeflowFlakyTriage";
  readonly schemaVersion: 1;
  readonly status: "passed" | "failed" | "unavailable";
  readonly files: readonly string[];
  readonly runs: readonly Readonly<{
    index: number;
    status: string;
    reason: string;
    durationMs: number;
  }>[];
  readonly passes: number;
  readonly failures: number;
  readonly flaky: boolean;
  readonly logs: string;
  readonly exitCode: 0 | 1 | 2;
}

export async function triageFlakyTests(
  rootInput: string,
  request: Readonly<{ files: readonly string[]; runs: string; signal?: AbortSignal }>,
): Promise<Readonly<FlakyTriageResult>> {
  const root = path.resolve(rootInput);
  const runs = Number(request.runs);
  if (!Number.isSafeInteger(runs) || runs < 1 || runs > 20)
    throw new Error("--runs must be an integer from 1 to 20.");
  if (request.files.length === 0)
    throw new Error("--files must name at least one test source or directory.");
  const parent = privateDirectory(root, ".build/flaky");
  const directory = mkdtempSync(path.join(parent, "run-"));
  const results: Array<{ index: number; status: string; reason: string; durationMs: number }> = [];
  await withBuildLock(
    root,
    "wf test flaky",
    async (token) => {
      for (let index = 1; index <= runs; index += 1) {
        if (request.signal?.aborted === true) break;
        const prefix = String(index).padStart(2, "0");
        const settlement = await runLoggedCommand(
          root,
          npmCommand(["run", "test:typescript:focused", "--", ...request.files]),
          {
            stdout: path.join(directory, `${prefix}.stdout.log`),
            stderr: path.join(directory, `${prefix}.stderr.log`),
          },
          {
            timeoutMs: 30 * 60 * 1000,
            env: { ...process.env, [BUILD_LOCK_TOKEN_VARIABLE]: token },
            ...(request.signal === undefined ? {} : { signal: request.signal }),
          },
        );
        results.push({
          index,
          status: settlement.status,
          reason: settlement.reason,
          durationMs: settlement.durationMs,
        });
        if (settlement.status === "interrupted") break;
      }
    },
    request.signal === undefined ? {} : { signal: request.signal },
  );
  const passes = results.filter((run) => run.status === "passed").length;
  const failures = results.filter((run) => run.status === "failed").length;
  const interrupted = results.length < runs || results.some((run) => run.status === "interrupted");
  const status = interrupted ? "unavailable" : failures === 0 ? "passed" : "failed";
  const report = Object.freeze({
    kind: "WakeflowFlakyTriage" as const,
    schemaVersion: 1 as const,
    status,
    files: request.files,
    runs: Object.freeze(results),
    passes,
    failures,
    flaky: passes > 0 && failures > 0,
    logs: path.relative(root, directory).split(path.sep).join("/"),
    exitCode: status === "passed" ? 0 : status === "failed" ? 1 : 2,
  });
  writeReport(path.join(directory, "triage.json"), report);
  return report;
}
