import { mkdirSync, writeFileSync } from "node:fs";
import nodePath from "node:path";

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
