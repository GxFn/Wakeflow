import { spawnSync } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import { isRecord } from "../verification/files.js";

/**
 * Wakeflow Tooling / Atlas drift：运行独立图谱子项目的 `check-atlas.mjs --require-current`，把过期
 * 指纹按专题汇总，并列出自图谱记录的基线提交以来变化的源文件。
 *
 * 它只读；刷新图谱仍按 §13.156 的方式人工复核。图谱不在根门之内，这里的结果也不是运行时权威。
 */

export interface AtlasDriftResult {
  readonly kind: "WakeflowAtlasDrift";
  readonly schemaVersion: 1;
  readonly status: "passed" | "failed" | "unavailable";
  readonly documents: number | null;
  readonly fingerprints: number | null;
  readonly stale: number;
  readonly byTopic: Readonly<Record<string, number>>;
  readonly baselineCommit: string | null;
  readonly changedSourcesSinceBaseline: number | null;
  readonly changedSample: readonly string[];
  readonly reason: string | null;
  readonly exitCode: 0 | 1 | 2;
}

const ATLAS_DIRECTORY = "wakeflow-architecture-atlas";
const SAMPLE_LIMIT = 40;

function baselineCommitOf(root: string): string | null {
  try {
    const readme = readFileSync(path.join(root, ATLAS_DIRECTORY, "README.md"), "utf8");
    return /当前工作树：`([0-9a-f]{7,40})`/u.exec(readme)?.[1] ?? null;
  } catch {
    return null;
  }
}

function changedSources(root: string, baseline: string): readonly string[] | null {
  const result = spawnSync(
    "git",
    ["diff", "--name-only", `${baseline}..HEAD`, "--", "src", "tooling"],
    {
      cwd: root,
      encoding: "utf8",
      shell: false,
      timeout: 20_000,
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  if (result.error !== undefined || result.status !== 0) return null;
  return result.stdout.split("\n").filter((line) => line !== "");
}

export function summarizeAtlasDrift(rootInput: string): Readonly<AtlasDriftResult> {
  const root = path.resolve(rootInput);
  const atlas = path.join(root, ATLAS_DIRECTORY);
  const script = path.join(atlas, "scripts", "check-atlas.mjs");
  const unavailable = (reason: string): Readonly<AtlasDriftResult> =>
    Object.freeze({
      kind: "WakeflowAtlasDrift",
      schemaVersion: 1,
      status: "unavailable",
      documents: null,
      fingerprints: null,
      stale: 0,
      byTopic: {},
      baselineCommit: baselineCommitOf(root),
      changedSourcesSinceBaseline: null,
      changedSample: [],
      reason,
      exitCode: 2,
    });
  if (lstatSync(script, { throwIfNoEntry: false })?.isFile() !== true)
    return unavailable("atlas-check-script-missing");
  const run = spawnSync(process.execPath, [script, "--require-current"], {
    cwd: atlas,
    encoding: "utf8",
    shell: false,
    timeout: 120_000,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (run.error !== undefined) return unavailable("atlas-check-not-started");
  let report: unknown;
  try {
    report = JSON.parse(run.stdout.slice(run.stdout.indexOf("{")));
  } catch {
    return unavailable("atlas-check-output-unreadable");
  }
  if (!isRecord(report) || !Array.isArray(report.staleFingerprints))
    return unavailable("atlas-check-output-unreadable");
  const stale = report.staleFingerprints.filter(
    (entry): entry is string => typeof entry === "string",
  );
  const byTopic: Record<string, number> = {};
  for (const entry of stale) {
    const topic = entry.split("/").slice(0, 2).join("/");
    byTopic[topic] = (byTopic[topic] ?? 0) + 1;
  }
  const baseline = baselineCommitOf(root);
  const changed = baseline === null ? null : changedSources(root, baseline);
  const status = stale.length === 0 && report.ok === true ? "passed" : "failed";
  return Object.freeze({
    kind: "WakeflowAtlasDrift",
    schemaVersion: 1,
    status,
    documents: typeof report.documents === "number" ? report.documents : null,
    fingerprints: typeof report.fingerprints === "number" ? report.fingerprints : null,
    stale: stale.length,
    byTopic: Object.freeze(
      Object.fromEntries(
        Object.entries(byTopic).sort(([left], [right]) => (left < right ? -1 : 1)),
      ),
    ),
    baselineCommit: baseline,
    changedSourcesSinceBaseline: changed === null ? null : changed.length,
    changedSample: Object.freeze((changed ?? []).slice(0, SAMPLE_LIMIT)),
    reason: status === "passed" ? null : "atlas-fingerprints-stale",
    exitCode: status === "passed" ? 0 : 1,
  });
}
