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
 * 八项检查各自给出 passed / failed / unavailable：空白错误（`git diff --check`）、私有内容
 * （本机家目录与临时目录路径、凭证样式）、制品新鲜度（`npm run build:check`）、版本字节
 * （ADR-0021：当前版本的 `v<version>` tag 存在时两份制品清单的文件摘要必须与 tag 一致，
 * 字节变了先 bump；tag 不存在只记录未比较）、文档指针
 * （docs/README 的"最新节点"是否指向 gate-log 最后一节，reviews/references 是否都被索引，
 * 脚手架的"验证待填"占位与 README 的"待填"是否还留着，最后一节写"未提交"而树里只有 docs
 * 改动时按 review 点名）、耗时表覆盖（tests 下的每个 `.test.ts` 在 `test-durations.json` 里
 * 有条目，按 review 点名缺口）、指令文件一致（`CLAUDE.md` 与 `AGENTS.md` 除标题与 Host
 * Boundary 一节外逐节相同）与 Git 概况。它不改任何文件，不是隐私门的替代：内核的隐私扫描
 * 仍是证据与归档的权威，这里只是提交前的维护者便利检查。
 */

export interface HandoffCheck {
  readonly name:
    | "whitespace"
    | "private-content"
    | "artifacts"
    | "version-bytes"
    | "docs-pointers"
    | "test-durations"
    | "instructions-parity"
    | "git";
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
  /\b(?:sk-(?:ant-)?[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{20,}|npm_[A-Za-z0-9]{20,}|xox[abepr]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,}|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})/u;
const PRIVATE_KEY_PATTERN = /-----BEGIN [A-Z ]*PRIVATE KEY(?: BLOCK)?-----/u;
// 值必须像一个字面秘密：只含令牌字符、同时有字母和数字；`token = process.env[X]` 这类代码不算。
const ASSIGNMENT_PATTERN =
  /(?<![\p{L}\p{N}_])(?:[\p{L}\p{N}_]*_)?(?:password|passwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|secret[_-]?key)["']?[ \t]*[:=][ \t]*["']?(?=[A-Za-z0-9_\-+/=.]*[0-9])(?=[A-Za-z0-9_\-+/=.]*[A-Za-z])([A-Za-z0-9_\-+/=.]{16,})/iu;
const PLACEHOLDER_PATTERN =
  /synthetic|example|placeholder|fixture|redacted|<[^>]*>|\$\{|xxx|\.\.\./iu;
/** `wf scaffold node` 留下的占位注释；节写完就该删掉。 */
const GATE_LOG_SCAFFOLD_PLACEHOLDER_PATTERN = /<!-- §(13\.\d+) 验证待填 -->/u;
const TEST_DURATIONS_PATH = "tooling/testing/test-durations.json";
const INSTRUCTION_FILES = Object.freeze(["CLAUDE.md", "AGENTS.md"] as const);
/** 两份指令文件里按宿主写的那一节：标题含 Host Boundary 的节不参加一致性比较。 */
const HOST_SPECIFIC_SECTION_PATTERN = /Host Boundary/u;

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
  const placeholder = GATE_LOG_SCAFFOLD_PLACEHOLDER_PATTERN.exec(gateLog);
  if (placeholder !== null)
    details.push(`gate log §${placeholder[1]} still carries the scaffold placeholder 验证待填`);
  if (index.includes("（待填）")) details.push("docs/README.md still says （待填）");
  const reviews: string[] = [];
  if (latest !== undefined && /未提交/u.test(gateLog.slice(gateLog.lastIndexOf(`### ${latest}`)))) {
    const changed = git(root, ["diff", "HEAD", "--name-only"]);
    const outsideDocs = changed.stdout
      .split("\n")
      .filter((file) => file !== "" && !file.startsWith("docs/"));
    if (changed.status === 0 && outsideDocs.length === 0)
      reviews.push(
        `§${latest} says 未提交 but only docs/ differ from HEAD; update it if the batch is committed`,
      );
  }
  return {
    name: "docs-pointers",
    status: details.length === 0 ? "passed" : "failed",
    details: bounded([...details, ...reviews.map((entry) => `review ${entry}`)]),
  };
}

function listTestFiles(root: string): string[] {
  const files: string[] = [];
  const pending = ["tests"];
  while (pending.length > 0) {
    const directory = pending.pop() ?? "";
    let entries: import("node:fs").Dirent[];
    try {
      entries = readdirSync(path.join(root, directory), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const relative = `${directory}/${entry.name}`;
      if (entry.isDirectory()) pending.push(relative);
      else if (entry.isFile() && entry.name.endsWith(".test.ts")) files.push(relative);
    }
  }
  return files.sort();
}

/** 耗时表只是调度提示，缺口按 review 点名：完整门之后 `wf timings apply` 补上。 */
function testDurationsCheck(root: string): HandoffCheck {
  const table = readText(root, TEST_DURATIONS_PATH);
  if (table === null)
    return { name: "test-durations", status: "passed", details: [`no ${TEST_DURATIONS_PATH}`] };
  let durations: unknown;
  try {
    durations = (JSON.parse(table) as { durationsMs?: unknown }).durationsMs;
  } catch {
    durations = undefined;
  }
  if (typeof durations !== "object" || durations === null || Array.isArray(durations))
    return {
      name: "test-durations",
      status: "unavailable",
      details: [`${TEST_DURATIONS_PATH} has no durationsMs object`],
    };
  const measured = new Set(Object.keys(durations));
  const files = listTestFiles(root);
  const present = new Set(files);
  const details = [
    ...files
      .filter((file) => !measured.has(file))
      .map(
        (file) =>
          `review ${file} has no measured duration (run wf timings apply after a full gate)`,
      ),
    ...[...measured]
      .filter((file) => !present.has(file))
      .sort()
      .map((file) => `review ${file} is in ${TEST_DURATIONS_PATH} but no longer exists`),
  ];
  return { name: "test-durations", status: "passed", details: bounded(details) };
}

interface InstructionSections {
  readonly preamble: string;
  readonly sections: ReadonlyMap<string, string>;
  readonly headings: readonly string[];
}

function splitInstructionSections(text: string): InstructionSections {
  const parts = text.split(/^(?=## )/mu);
  const preamble = (parts[0] ?? "").split("\n").slice(1).join("\n");
  const sections = new Map<string, string>();
  const headings: string[] = [];
  for (const part of parts.slice(1)) {
    const newline = part.indexOf("\n");
    const heading = (newline === -1 ? part : part.slice(0, newline)).slice("## ".length);
    if (HOST_SPECIFIC_SECTION_PATTERN.test(heading)) continue;
    headings.push(heading);
    sections.set(heading, newline === -1 ? "" : part.slice(newline + 1));
  }
  return { preamble, sections, headings };
}

/** CLAUDE.md 与 AGENTS.md 是同一份仓库规则的两个宿主入口：除标题与 Host Boundary 一节外逐节相同。 */
function instructionsParityCheck(root: string): HandoffCheck {
  const claude = readText(root, INSTRUCTION_FILES[0]);
  const agents = readText(root, INSTRUCTION_FILES[1]);
  if (claude === null && agents === null)
    return { name: "instructions-parity", status: "passed", details: ["no instruction files"] };
  if (claude === null || agents === null)
    return {
      name: "instructions-parity",
      status: "failed",
      details: [`only one of ${INSTRUCTION_FILES.join(" and ")} exists`],
    };
  const left = splitInstructionSections(claude);
  const right = splitInstructionSections(agents);
  const details: string[] = [];
  if (left.preamble !== right.preamble)
    details.push("the text between the title and the first section differs");
  if (left.headings.join("\n") !== right.headings.join("\n"))
    details.push(
      `section headings differ: CLAUDE.md [${left.headings.join(", ")}] vs AGENTS.md [${right.headings.join(", ")}]`,
    );
  else
    for (const heading of left.headings)
      if (left.sections.get(heading) !== right.sections.get(heading))
        details.push(`section "${heading}" differs between CLAUDE.md and AGENTS.md`);
  return {
    name: "instructions-parity",
    status: details.length === 0 ? "passed" : "failed",
    details: bounded(details),
  };
}

const VERSION_INPUT_PATH = "assets/release/version.json";
const ARTIFACT_MANIFEST_PATHS: readonly string[] = Object.freeze([
  "plugins/codex-wakeflow/artifact-manifest.json",
  "plugins/claude-code-wakeflow/artifact-manifest.json",
]);
const MAXIMUM_MANIFEST_BYTES = 8 * 1024 * 1024;

interface ManifestFiles {
  readonly version: string | null;
  readonly files: ReadonlyMap<string, string>;
}

/** 制品清单里的版本与 `files[]` 的 path → sha256；形状不对返回 null，交由调用方点名。 */
function parseManifestFiles(text: string): ManifestFiles | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const record = parsed as { version?: unknown; files?: unknown };
  if (!Array.isArray(record.files)) return null;
  const files = new Map<string, string>();
  for (const entry of record.files) {
    if (entry === null || typeof entry !== "object") return null;
    const { path: filePath, sha256 } = entry as { path?: unknown; sha256?: unknown };
    if (typeof filePath !== "string" || typeof sha256 !== "string") return null;
    files.set(filePath, sha256);
  }
  return { version: typeof record.version === "string" ? record.version : null, files };
}

function changedManifestFiles(
  atTag: ReadonlyMap<string, string>,
  current: ReadonlyMap<string, string>,
): string[] {
  const changed = new Set<string>();
  for (const [filePath, sha256] of current)
    if (atTag.get(filePath) !== sha256) changed.add(filePath);
  for (const filePath of atTag.keys()) if (!current.has(filePath)) changed.add(filePath);
  return [...changed].sort();
}

/** ADR-0021 规则 2：tag 已存在的版本不得再换字节；同一版本下制品清单的文件摘要变了就得先 bump。 */
function versionBytesCheck(root: string): HandoffCheck {
  const name = "version-bytes" as const;
  let version: string;
  try {
    const parsed = JSON.parse(readFileSync(path.join(root, VERSION_INPUT_PATH), "utf8")) as {
      version?: unknown;
    };
    if (typeof parsed.version !== "string" || parsed.version.length === 0)
      throw new Error("version");
    version = parsed.version;
  } catch {
    return { name, status: "passed", details: [`no ${VERSION_INPUT_PATH}; nothing to compare`] };
  }
  const tag = `v${version}`;
  const resolved = git(root, ["rev-parse", "-q", "--verify", `refs/tags/${tag}^{commit}`]);
  if (resolved.status !== 0) {
    return {
      name,
      status: "passed",
      details: [`tag ${tag} is absent locally; artifact bytes were not compared`],
    };
  }
  const details: string[] = [];
  for (const manifest of ARTIFACT_MANIFEST_PATHS) {
    const tagged = git(root, ["show", `${tag}:${manifest}`]);
    if (tagged.status !== 0) {
      details.push(`${manifest} is missing at ${tag}`);
      continue;
    }
    const atTag = parseManifestFiles(tagged.stdout);
    let currentText: string;
    try {
      const stat = lstatSync(path.join(root, manifest));
      if (!stat.isFile() || stat.size > MAXIMUM_MANIFEST_BYTES) throw new Error("manifest");
      currentText = readFileSync(path.join(root, manifest), "utf8");
    } catch {
      details.push(`${manifest} is unreadable in the working tree`);
      continue;
    }
    const current = parseManifestFiles(currentText);
    if (atTag === null || current === null) {
      details.push(`${manifest} is not a readable artifact manifest (working tree or ${tag})`);
      continue;
    }
    if (current.version !== version) {
      details.push(
        `${manifest} says ${current.version ?? "no version"}; ${VERSION_INPUT_PATH} says ${version}`,
      );
    }
    const changed = changedManifestFiles(atTag.files, current.files);
    if (changed.length > 0) {
      const sample = changed.slice(0, 5).join(", ") + (changed.length > 5 ? ", …" : "");
      details.push(
        `${manifest}: ${changed.length} file(s) differ from ${tag} (${sample}); bump ${VERSION_INPUT_PATH} before shipping new bytes under ${version}`,
      );
    }
  }
  return details.length === 0
    ? { name, status: "passed", details: [`artifact bytes match ${tag}`] }
    : { name, status: "failed", details: bounded(details) };
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
  checks.push(
    await artifactsCheck(root, options),
    versionBytesCheck(root),
    docsPointersCheck(root),
    testDurationsCheck(root),
    instructionsParityCheck(root),
    gitCheck(root),
  );
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
