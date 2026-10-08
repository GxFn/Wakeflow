import { spawnSync } from "node:child_process";
import { lstatSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { userInfo } from "node:os";
import path from "node:path";
import { BUILD_LOCK_TOKEN_VARIABLE, withBuildLock } from "../build-lock.js";
import { privateDirectory, writeReport } from "../verification/files.js";
import { npmCommand, runLoggedCommand } from "../verification/process.js";

/**
 * Wakeflow Tooling / Handoff：交接前的只读检查单，把 CLAUDE.md 的交接规则变成一条命令。
 *
 * 五项检查各自给出 passed / failed / unavailable：空白错误（`git diff --check`）、私有内容
 * （本机家目录与临时目录路径、凭证样式）、制品新鲜度（`npm run build:check`）、文档指针
 * （docs/README 的"最新节点"是否指向 gate-log 最后一节，reviews/references 是否都被索引）与
 * Git 概况。它不改任何文件，不是隐私门的替代：内核的隐私扫描仍是证据与归档的权威，这里只是
 * 提交前的维护者便利检查。
 */

export interface HandoffCheck {
  readonly name: "whitespace" | "private-content" | "artifacts" | "docs-pointers" | "git";
  readonly status: "passed" | "failed" | "unavailable";
  readonly details: readonly string[];
}

export interface HandoffReport {
  readonly kind: "WakeflowHandoffCheck";
  readonly schemaVersion: 1;
  readonly status: "passed" | "failed" | "unavailable";
  readonly checks: readonly Readonly<HandoffCheck>[];
  readonly exitCode: 0 | 1 | 2;
}

export interface HandoffOptions {
  /** 运行 `npm run build:check`；缺省运行。关闭时该项报告 unavailable。 */
  readonly artifacts?: boolean;
  readonly signal?: AbortSignal;
}

const MAXIMUM_SCANNED_BYTES = 2 * 1024 * 1024;
const MAXIMUM_DETAILS = 40;
const SKIPPED_PATH_PATTERN = /^(?:\.build|node_modules|coverage|dist)\/|\/node_modules\//u;
const BINARY_EXTENSION_PATTERN = /\.(?:png|jpe?g|gif|webp|pdf|zip|gz|tgz|woff2?|ttf|ico|lock)$/iu;
const PROVIDER_CREDENTIAL_PATTERN =
  /\b(?:sk-(?:ant-)?[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{20,}|npm_[A-Za-z0-9]{20,}|xox[abp]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,})/u;
const PRIVATE_KEY_PATTERN = /-----BEGIN [A-Z ]*PRIVATE KEY(?: BLOCK)?-----/u;
// 值必须像一个字面秘密：只含令牌字符、同时有字母和数字；`token = process.env[X]` 这类代码不算。
const ASSIGNMENT_PATTERN =
  /(?<![\p{L}\p{N}_])(?:[\p{L}\p{N}_]*_)?(?:password|passwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|secret[_-]?key)["']?[ \t]*[:=][ \t]*["']?(?=[A-Za-z0-9_\-+/=.]*[0-9])(?=[A-Za-z0-9_\-+/=.]*[A-Za-z])([A-Za-z0-9_\-+/=.]{16,})/iu;
const PLACEHOLDER_PATTERN =
  /synthetic|example|placeholder|fixture|redacted|<[^>]*>|\$\{|xxx|\.\.\./iu;

function git(root: string, args: readonly string[]) {
  return spawnSync("git", [...args], {
    cwd: root,
    encoding: "utf8",
    shell: false,
    timeout: 20_000,
    maxBuffer: 32 * 1024 * 1024,
  });
}

function bounded(details: string[]): readonly string[] {
  return details.length > MAXIMUM_DETAILS
    ? Object.freeze([
        ...details.slice(0, MAXIMUM_DETAILS),
        `… ${details.length - MAXIMUM_DETAILS} more`,
      ])
    : Object.freeze([...details]);
}

function whitespaceCheck(root: string): HandoffCheck {
  const details: string[] = [];
  let unavailable = false;
  for (const args of [
    ["diff", "--check"],
    ["diff", "--cached", "--check"],
  ]) {
    const result = git(root, args);
    if (result.error !== undefined || (result.status !== 0 && result.status !== 2))
      unavailable = true;
    else if (result.status === 2)
      details.push(...result.stdout.split("\n").filter((line) => line !== ""));
  }
  return {
    name: "whitespace",
    status: unavailable ? "unavailable" : details.length === 0 ? "passed" : "failed",
    details: bounded(details),
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/** 当前用户的家目录路径一定是本机泄露；临时目录前缀也可能只是文档或模式本身，按 review 列出。 */
function machinePathPatterns(): Readonly<{ home: RegExp; temporary: RegExp }> {
  const user = escapeRegExp(userInfo().username);
  return {
    home: new RegExp(`(?:/Users|/home)/${user}(?:/|\\b)`, "u"),
    temporary: /\/private\/tmp\/claude-|\/tmp\/claude-|\/var\/folders\//u,
  };
}

type Severity = "fail" | "review";

function classifyLine(
  file: string,
  line: string,
  machinePath: Readonly<{ home: RegExp; temporary: RegExp }>,
): Readonly<{ severity: Severity; kind: string }> | null {
  if (machinePath.home.test(line)) return { severity: "fail", kind: "machine-path" };
  if (machinePath.temporary.test(line)) return { severity: "review", kind: "temporary-path" };
  const credential =
    PROVIDER_CREDENTIAL_PATTERN.test(line) || PRIVATE_KEY_PATTERN.test(line)
      ? "credential"
      : (() => {
          const match = ASSIGNMENT_PATTERN.exec(line);
          return match !== null && !PLACEHOLDER_PATTERN.test(match[1] ?? "")
            ? "credential-assignment"
            : null;
        })();
  if (credential === null) return null;
  return { severity: file.startsWith("tests/") ? "review" : "fail", kind: credential };
}

function addedLinesByFile(root: string): Map<string, string[]> | null {
  const result = git(root, ["diff", "HEAD", "--unified=0", "--no-color", "--no-ext-diff", "--"]);
  if (result.error !== undefined || result.status !== 0) return null;
  const files = new Map<string, string[]>();
  let current: string | null = null;
  for (const line of result.stdout.split("\n")) {
    if (line.startsWith("+++ ")) {
      current = line.startsWith("+++ b/") ? line.slice(6) : null;
      continue;
    }
    if (current !== null && line.startsWith("+") && !line.startsWith("+++")) {
      let lines = files.get(current);
      if (lines === undefined) {
        lines = [];
        files.set(current, lines);
      }
      lines.push(line.slice(1));
    }
  }
  return files;
}

function untrackedTextFiles(root: string): Map<string, string[]> | null {
  const result = git(root, ["ls-files", "--others", "--exclude-standard", "-z"]);
  if (result.error !== undefined || result.status !== 0) return null;
  const files = new Map<string, string[]>();
  for (const file of result.stdout.split("\0").filter((entry) => entry !== "")) {
    if (SKIPPED_PATH_PATTERN.test(file) || BINARY_EXTENSION_PATTERN.test(file)) continue;
    const absolute = path.join(root, file);
    const stat = lstatSync(absolute, { throwIfNoEntry: false });
    if (
      stat === undefined ||
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.size > MAXIMUM_SCANNED_BYTES
    )
      continue;
    const bytes = readFileSync(absolute);
    if (bytes.includes(0)) continue;
    files.set(file, bytes.toString("utf8").split("\n"));
  }
  return files;
}

function privateContentCheck(root: string): HandoffCheck {
  const added = addedLinesByFile(root);
  const untracked = untrackedTextFiles(root);
  if (added === null || untracked === null)
    return {
      name: "private-content",
      status: "unavailable",
      details: ["git diff or ls-files failed"],
    };
  const machinePath = machinePathPatterns();
  const failures: string[] = [];
  const reviews: string[] = [];
  for (const [file, lines] of [...added, ...untracked]) {
    if (SKIPPED_PATH_PATTERN.test(file)) continue;
    lines.forEach((line, index) => {
      const hit = classifyLine(file, line, machinePath);
      if (hit === null) return;
      (hit.severity === "fail" ? failures : reviews).push(`${file}:${index + 1}: ${hit.kind}`);
    });
  }
  return {
    name: "private-content",
    status: failures.length === 0 ? "passed" : "failed",
    details: bounded([...failures, ...reviews.map((entry) => `review ${entry}`)]),
  };
}

async function artifactsCheck(root: string, options: HandoffOptions): Promise<HandoffCheck> {
  if (options.artifacts === false)
    return {
      name: "artifacts",
      status: "unavailable",
      details: ["build:check not run (--no-artifacts)"],
    };
  const parent = privateDirectory(root, ".build/handoff");
  const directory = mkdtempSync(path.join(parent, "run-"));
  try {
    const settlement = await withBuildLock(
      root,
      "wf handoff build:check",
      (token) =>
        runLoggedCommand(
          root,
          npmCommand(["run", "build:check"]),
          {
            stdout: path.join(directory, "build-check.stdout.log"),
            stderr: path.join(directory, "build-check.stderr.log"),
          },
          {
            timeoutMs: 30 * 60 * 1000,
            env: { ...process.env, [BUILD_LOCK_TOKEN_VARIABLE]: token },
            ...(options.signal === undefined ? {} : { signal: options.signal }),
          },
        ),
      { ...(options.signal === undefined ? {} : { signal: options.signal }) },
    );
    writeReport(path.join(directory, "settlement.json"), settlement);
    const logs = path.relative(root, directory).split(path.sep).join("/");
    return {
      name: "artifacts",
      status:
        settlement.status === "passed"
          ? "passed"
          : settlement.status === "failed"
            ? "failed"
            : "unavailable",
      details: [`build:check ${settlement.status} (${settlement.reason}); logs under ${logs}`],
    };
  } catch (error: unknown) {
    const code =
      error instanceof Error && "code" in error && typeof error.code === "string"
        ? error.code
        : "build-check-unavailable";
    return { name: "artifacts", status: "unavailable", details: [code] };
  }
}

function readText(root: string, relative: string): string | null {
  try {
    const stat = lstatSync(path.join(root, relative));
    if (!stat.isFile() || stat.size > MAXIMUM_SCANNED_BYTES) return null;
    return readFileSync(path.join(root, relative), "utf8");
  } catch {
    return null;
  }
}

function docsPointersCheck(root: string): HandoffCheck {
  const gateLog = readText(root, "docs/progress/consolidation-gate-log.md");
  const index = readText(root, "docs/README.md");
  if (gateLog === null || index === null)
    return {
      name: "docs-pointers",
      status: "unavailable",
      details: ["docs/README.md or the gate log is unreadable"],
    };
  const details: string[] = [];
  const sections = [...gateLog.matchAll(/^### (13\.\d+)\b/gmu)].map((match) => match[1] ?? "");
  const latest = sections.at(-1);
  const pointer = /最新节点 §(13\.\d+)/u.exec(index)?.[1];
  if (latest === undefined) details.push("gate log has no ### 13.N section");
  else if (pointer !== latest)
    details.push(`docs/README.md points at §${pointer ?? "?"} but the gate log ends at §${latest}`);
  for (const directory of ["docs/reviews", "docs/references"]) {
    let entries: string[];
    try {
      entries = readdirSync(path.join(root, directory))
        .filter((name) => name.endsWith(".md"))
        .sort();
    } catch {
      continue;
    }
    for (const name of entries) {
      const reference = `${directory.slice("docs/".length)}/${name}`;
      if (!index.includes(reference))
        details.push(`${directory}/${name} is not indexed in docs/README.md`);
    }
  }
  return {
    name: "docs-pointers",
    status: details.length === 0 ? "passed" : "failed",
    details: bounded(details),
  };
}

function gitCheck(root: string): HandoffCheck {
  const branch = git(root, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (branch.error !== undefined || branch.status !== 0)
    return { name: "git", status: "unavailable", details: ["not a Git checkout"] };
  const status = git(root, ["status", "--porcelain", "--untracked-files=all"]);
  const lines = status.stdout.split("\n").filter((line) => line !== "");
  const untracked = lines.filter((line) => line.startsWith("??")).length;
  const details = [
    `branch ${branch.stdout.trim()}`,
    `${lines.length - untracked} modified, ${untracked} untracked`,
  ];
  const counts = git(root, ["rev-list", "--left-right", "--count", "origin/main...HEAD"]);
  if (counts.status === 0) {
    const [behind, ahead] = counts.stdout.trim().split(/\s+/u);
    details.push(`ahead ${ahead ?? "?"} / behind ${behind ?? "?"} of local origin/main`);
  }
  return { name: "git", status: "passed", details };
}

export async function checkHandoff(
  rootInput: string,
  options: HandoffOptions = {},
): Promise<Readonly<HandoffReport>> {
  const root = path.resolve(rootInput);
  const checks: HandoffCheck[] = [whitespaceCheck(root), privateContentCheck(root)];
  checks.push(await artifactsCheck(root, options), docsPointersCheck(root), gitCheck(root));
  const status = checks.some((check) => check.status === "failed")
    ? "failed"
    : checks.some((check) => check.status === "unavailable" && check.name !== "artifacts")
      ? "unavailable"
      : "passed";
  return Object.freeze({
    kind: "WakeflowHandoffCheck",
    schemaVersion: 1,
    status,
    checks: Object.freeze(checks),
    exitCode: status === "passed" ? 0 : status === "failed" ? 1 : 2,
  });
}
