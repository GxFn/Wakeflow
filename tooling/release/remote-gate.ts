import { spawnSync } from "node:child_process";

/**
 * Wakeflow Tooling / Release：远端门的状态（open-items C12，gate-log §13.237、§13.244）。
 *
 * 远端 `verify.yml` 自 2026-10-19 起连续 29 次失败而没有人看见，六个 tag 打在远端为红的提交上：本地门是绿的，
 * 而没有任何一步会去读远端的结果。这里是那一步的读取端——经 `gh run list` 读 verify 工作流的运行，只读，
 * 不改任何东西。`gh` 不在、没有登录、没有网络、仓库没有 GitHub 远端或输出读不懂，一律是"未核对"（null），
 * 由调用方决定未核对算什么：交接清单把它当信息，发布门把它当失败。
 */

export interface RemoteGateRun {
  readonly headSha: string;
  readonly headBranch: string | null;
  readonly event: string | null;
  /** `completed`、`in_progress`、`queued` 等；GitHub 的原值。 */
  readonly status: string;
  /** `success`、`failure`、`cancelled` 等；没结束时为 null。 */
  readonly conclusion: string | null;
  readonly createdAt: string;
}

export interface RemoteGateQuery {
  readonly branch?: string;
  readonly commit?: string;
}

/** 读远端运行；读不到为 null。测试注入替身，缺省经 `gh`。 */
export type RemoteGateReader = (
  root: string,
  query: Readonly<RemoteGateQuery>,
) => readonly Readonly<RemoteGateRun>[] | null;

export type RemoteGateState = "green" | "red" | "pending" | "none" | "unchecked";

export interface RemoteGateVerdict {
  readonly state: RemoteGateState;
  /** 判定所依据的那次运行的提交；没有运行时为 null。 */
  readonly headSha: string | null;
  readonly conclusion: string | null;
}

const WORKFLOW_FILE = "verify.yml";
const RUN_LIMIT = 20;
const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const BRANCH_PATTERN = /^[A-Za-z0-9._/-]{1,200}$/u;

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= 256 ? value : null;
}

/** `gh run list --json …` 的输出；形状不对的条目丢掉，整体读不懂为 null。 */
export function parseRemoteGateRuns(output: string): readonly Readonly<RemoteGateRun>[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const runs: RemoteGateRun[] = [];
  for (const entry of parsed) {
    if (typeof entry !== "object" || entry === null) continue;
    const record = entry as Readonly<Record<string, unknown>>;
    const headSha = text(record.headSha);
    const status = text(record.status);
    const createdAt = text(record.createdAt);
    if (headSha === null || !SHA_PATTERN.test(headSha) || status === null || createdAt === null) {
      continue;
    }
    runs.push(
      Object.freeze({
        headSha,
        headBranch: text(record.headBranch),
        event: text(record.event),
        status,
        conclusion: text(record.conclusion),
        createdAt,
      }),
    );
  }
  return Object.freeze(runs);
}

/** 这个检出有没有指向 GitHub 的 origin：没有就不去起 `gh`（夹具仓库、离线镜像）。 */
function hasGitHubOrigin(root: string): boolean {
  const result = spawnSync("git", ["config", "--get", "remote.origin.url"], {
    cwd: root,
    encoding: "utf8",
    shell: false,
    timeout: 10_000,
  });
  return result.status === 0 && /github\.com[:/]/u.test(result.stdout);
}

/** 缺省读取：`gh run list`，二十秒上限。任何读不到的情形都是 null。 */
export const readRemoteGateRuns: RemoteGateReader = (root, query) => {
  if (query.branch !== undefined && !BRANCH_PATTERN.test(query.branch)) return null;
  if (query.commit !== undefined && !SHA_PATTERN.test(query.commit)) return null;
  if (!hasGitHubOrigin(root)) return null;
  const result = spawnSync(
    "gh",
    [
      "run",
      "list",
      "--workflow",
      WORKFLOW_FILE,
      "--limit",
      String(RUN_LIMIT),
      "--json",
      "headSha,headBranch,event,status,conclusion,createdAt",
      ...(query.branch === undefined ? [] : ["--branch", query.branch]),
      ...(query.commit === undefined ? [] : ["--commit", query.commit]),
    ],
    { cwd: root, encoding: "utf8", shell: false, timeout: 20_000, maxBuffer: 1024 * 1024 },
  );
  if (result.error !== undefined || result.status !== 0) return null;
  return parseRemoteGateRuns(result.stdout);
};

/**
 * 一组运行里最近的那一次说了什么。`select` 筛出算数的运行（例如只要对 main 的 push）；没有读到是
 * `unchecked`，读到了但没有算数的运行是 `none`。
 */
export function judgeRemoteGate(
  runs: readonly Readonly<RemoteGateRun>[] | null,
  select: (run: Readonly<RemoteGateRun>) => boolean = () => true,
): Readonly<RemoteGateVerdict> {
  if (runs === null) return Object.freeze({ state: "unchecked", headSha: null, conclusion: null });
  const latest = runs
    .filter(select)
    .sort((left, right) => (left.createdAt < right.createdAt ? 1 : -1))[0];
  if (latest === undefined)
    return Object.freeze({ state: "none", headSha: null, conclusion: null });
  const state: RemoteGateState =
    latest.status !== "completed" ? "pending" : latest.conclusion === "success" ? "green" : "red";
  return Object.freeze({ state, headSha: latest.headSha, conclusion: latest.conclusion });
}
