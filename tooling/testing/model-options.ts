import { mkdirSync, writeFileSync } from "node:fs";
import nodePath from "node:path";

/** Bounded, reproducible pure-model inputs; these never enable runtime fault injection. */
export function modelTestOptions(environment: Readonly<Record<string, string | undefined>>) {
  const seedText = environment.WAKEFLOW_MODEL_SEED ?? "20261003";
  const runsText = environment.WAKEFLOW_MODEL_RUNS ?? "200";
  const path = environment.WAKEFLOW_MODEL_PATH;
  const replayPath = environment.WAKEFLOW_MODEL_REPLAY_PATH;
  const seed = Number(seedText);
  const numRuns = Number(runsText);
  if (
    !/^-?\d+$/u.test(seedText) ||
    !Number.isInteger(seed) ||
    seed < -2147483648 ||
    seed > 2147483647 ||
    !/^\d+$/u.test(runsText) ||
    !Number.isInteger(numRuns) ||
    numRuns < 1 ||
    numRuns > 1000 ||
    (path !== undefined && (path.length > 512 || !/^\d+(?::\d+)*$/u.test(path))) ||
    (replayPath !== undefined &&
      (replayPath.length > 1024 || !/^[A-Za-z0-9+/]*:[A-Za-z0-9+/]*$/u.test(replayPath)))
  )
    throw new Error("Invalid bounded model test options.");
  return {
    seed,
    numRuns,
    ...(path === undefined ? {} : { path }),
    ...(replayPath === undefined ? {} : { replayPath }),
  };
}

/**
 * 模型测试失败时把反例落盘（§13.169 批次 5）：fast-check 的 seed、path 与反例文本写到
 * `.build/model/<name>.json`，CI 的轮换种子因此有回放依据（`WAKEFLOW_MODEL_SEED` + `WAKEFLOW_MODEL_PATH`）。
 * 只写失败；写不了不吞异常本身。
 */
export function persistModelCounterexample(
  repositoryRoot: string,
  name: string,
  options: Readonly<{ readonly seed: number; readonly numRuns: number }>,
  error: unknown,
): string | null {
  if (!/^[a-z][a-z0-9-]{0,63}$/u.test(name)) return null;
  const message = error instanceof Error ? error.message : String(error);
  const path = /Path:\s*"([0-9:]+)"/u.exec(message)?.[1] ?? null;
  const counterexample =
    /Counterexample:\s*([\s\S]*?)(?:\n\nShrunk|\nGot |\n\n|$)/u.exec(message)?.[1]?.trim() ?? null;
  const record = {
    kind: "WakeflowModelCounterexample",
    name,
    seed: options.seed,
    numRuns: options.numRuns,
    path,
    counterexample: counterexample === null ? null : counterexample.slice(0, 4096),
    recordedAt: new Date().toISOString(),
  };
  try {
    const directory = nodePath.join(repositoryRoot, ".build", "model");
    mkdirSync(directory, { recursive: true });
    const file = nodePath.join(directory, `${name}.json`);
    writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
    return file;
  } catch {
    return null;
  }
}
