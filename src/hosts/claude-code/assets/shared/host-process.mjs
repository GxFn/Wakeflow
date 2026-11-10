// 宿主命令的运行（两个助手共用）：环境收窄、时间上限、有界诊断，以及 node 与 claude 的版本与安装形态。

import { spawnSync } from "node:child_process";
import { closeSync, openSync, readSync } from "node:fs";
import path from "node:path";
import { refuse } from "./failure.mjs";
import { SGR_PATTERN, cleanLabel } from "./text.mjs";
import { ROOT, realpathOrNull } from "./workspace.mjs";

export const MAX_VERSION = 64;
const DEFAULT_COMMAND_TIMEOUT_MS = 10000;
const DEFAULT_UTF8_LOCALE = "en_US.UTF-8";

// spawn 宿主命令（tmux、git、ps、claude、script）前的环境（§13.117 D4，§13.132）：剥掉 TMUX / TMUX_PANE 与全部
// CLAUDE* 变量，只留下用户自己的 Claude 配置。Controller 的 Bash 带着 CLAUDECODE=1 与桌面应用、SDK 注入的变量
// （CLAUDE_EFFORT、CLAUDE_CODE_DISABLE_CRON、会话与消息通道标识……）：交给新会话会让它以为自己是嵌套会话或改变
// 行为，从 Controller 的 Bash 里首次启动的 tmux 服务器还会把环境交给每个新窗口。宿主注入的名字随版本增减，
// 所以按"用户配置白名单"放行，而不是按"会话变量黑名单"剥离；ANTHROPIC_* 等非 CLAUDE 变量照旧传下去。
const USER_CLAUDE_ENVIRONMENT_NAMES = Object.freeze([
  "CLAUDE_CONFIG_DIR",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "CLAUDE_CODE_MAX_OUTPUT_TOKENS",
  "CLAUDE_CODE_API_KEY_HELPER_TTL_MS",
  "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC",
  "CLAUDE_CODE_CLIENT_CERT",
  "CLAUDE_CODE_CLIENT_KEY",
  "CLAUDE_CODE_CLIENT_KEY_PASSPHRASE",
]);

// 选择模型提供方与跳过其认证的变量族（CLAUDE_CODE_USE_BEDROCK / _VERTEX / _FOUNDRY、CLAUDE_CODE_SKIP_*_AUTH）。
const USER_CLAUDE_ENVIRONMENT_PREFIXES = Object.freeze(["CLAUDE_CODE_USE_", "CLAUDE_CODE_SKIP_"]);
// Node 引擎范围与边界由 contracts 的声明在装配发布字节时填入（A6，§13.167）；preflight 用它核对当前 node。
export const NODE_ENGINES = __WAKEFLOW_NODE_ENGINES__;
const NODE_ENGINE_BOUNDS = __WAKEFLOW_NODE_ENGINE_BOUNDS__;

/** @param {string} version */
export function nodeVersionSupported(version) {
  const parts = /^v?(\d+)\.(\d+)\.(\d+)/u.exec(version);
  if (parts === null) return false;
  const [major, minor, patch] = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
  const [minMajor, minMinor, minPatch] = NODE_ENGINE_BOUNDS.minimum;
  if (major >= NODE_ENGINE_BOUNDS.exclusiveMajor) return false;
  if (major !== minMajor) return major > minMajor;
  if (minor !== minMinor) return minor > minMinor;
  return patch >= minPatch;
}

// 拒绝附带的有界诊断（§13.165 G6）：子进程输出的第一行，去掉 SGR 属性、单行化、≤200 字符，工作区根与 home 换成
// 占位符，其余绝对路径一律 <path>；没有输出就没有 detail。它是给用户转告的提示，不进入任何 Wakeflow 记录。
const MAX_DETAIL = 200;
const ABSOLUTE_PATH_IN_DETAIL = /(?<=^|[\s'"(])\/[^\s'"()]+/gu;

/**
 * @param {unknown} output
 * @returns {string | undefined}
 */
export function boundedDetail(output) {
  if (typeof output !== "string") return undefined;
  const first = output
    .replace(SGR_PATTERN, "")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (first === undefined) return undefined;
  let text = cleanLabel(first, "", MAX_DETAIL * 2);
  text = text.split(ROOT).join("<workspace>");
  const home = process.env.HOME;
  if (typeof home === "string" && home.length > 1) text = text.split(home).join("~");
  text = text.replace(ABSOLUTE_PATH_IN_DETAIL, "<path>").slice(0, MAX_DETAIL);
  return text.length === 0 ? undefined : text;
}

/** @returns {NodeJS.ProcessEnv} */
export function hostEnvironment() {
  /** @type {NodeJS.ProcessEnv} */
  const environment = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (name === "TMUX" || name === "TMUX_PANE") continue;
    if (
      name.startsWith("CLAUDE") &&
      !USER_CLAUDE_ENVIRONMENT_NAMES.includes(name) &&
      !USER_CLAUDE_ENVIRONMENT_PREFIXES.some((prefix) => name.startsWith(prefix))
    ) {
      continue;
    }
    environment[name] = value;
  }
  // 子进程一律在 UTF-8 locale 下运行（旧 transport 同一规则，复审 T10）：tmux 助手的屏幕判定依赖 tmux 原样输出
  // Claude Code 的输入框与省略号字符，桌面助手读的 --bg 输出行用 "·" 分隔；非 UTF-8 的 locale 会把它们改写。
  const locale = environment.LC_ALL ?? environment.LANG;
  if (typeof locale !== "string" || !/utf-?8/iu.test(locale)) {
    environment.LANG = DEFAULT_UTF8_LOCALE;
    environment.LC_ALL = DEFAULT_UTF8_LOCALE;
  }
  return environment;
}

// 每个子进程（tmux、git、ps、claude、script）都有时间上限（复审 T11）：挂住的宿主命令不能拖住 Controller 的一轮，
// 也绝不能被当成"会话不存在"或"pane 不在"去推断。超时即拒绝 host-command-timeout；上限只供测试经环境变量
// 缩短，变量名每个助手一个，装配发布字节时填入。
function commandTimeoutMs() {
  const raw = process.env[__WAKEFLOW_COMMAND_TIMEOUT_VARIABLE__];
  const parsed = typeof raw === "string" && /^[0-9]{1,6}$/u.test(raw) ? Number(raw) : Number.NaN;
  return parsed >= 100 && parsed <= 60000 ? parsed : DEFAULT_COMMAND_TIMEOUT_MS;
}

/**
 * @param {string} command
 * @param {readonly string[]} args
 * @param {RunOptions} [options]
 * @returns {Readonly<RunResult>}
 */
export function run(command, args, options) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    env: options?.env ?? hostEnvironment(),
    maxBuffer: 8 * 1024 * 1024,
    timeout: commandTimeoutMs(),
    ...(options?.input === undefined ? {} : { input: options.input }),
    ...(options?.cwd === undefined ? {} : { cwd: options.cwd }),
    // 现场 L18：script(1) 对继承来的管道 stdin 做 tcgetattr 会失败（Operation not supported on socket），
    // 伪终端包装一律把 stdin 接到 /dev/null；其它子进程保持缺省管道。
    ...(options?.stdin === "ignore" ? { stdio: ["ignore", "pipe", "pipe"] } : {}),
  });
  if (
    result.error !== undefined &&
    /** @type {NodeJS.ErrnoException} */ (result.error).code === "ETIMEDOUT"
  ) {
    refuse("host-command-timeout", {
      command: path.basename(command),
      subcommand:
        typeof args[0] === "string" && !args[0].startsWith("-")
          ? args[0]
          : typeof args[2] === "string"
            ? args[2]
            : null,
      timeoutMs: commandTimeoutMs(),
    });
  }
  const ok = result.error === undefined && result.status === 0;
  return Object.freeze({
    ok,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    status: result.status,
  });
}

// A5（§13.167）：claude 的安装形态——原生二进制（无 shebang）、npm 包装的 node 脚本（shebang 指向 node 或位于
// node_modules 下）、其他解释器的包装脚本；只读文件头 128 字节，解析不出就是 unknown。
/** @param {string} binary */
export function claudeInstallForm(binary) {
  const resolved = realpathOrNull(binary);
  if (resolved === null) return "unknown";
  if (resolved.includes(`${path.sep}node_modules${path.sep}`)) return "node";
  let descriptor = null;
  try {
    descriptor = openSync(resolved, "r");
    const head = Buffer.alloc(128);
    const length = readSync(descriptor, head, 0, head.length, 0);
    const firstLine = head.toString("utf8", 0, length).split("\n")[0] ?? "";
    if (!firstLine.startsWith("#!")) return "native";
    return firstLine.includes("node") ? "node" : "wrapper";
  } catch {
    return "unknown";
  } finally {
    if (descriptor !== null) closeSync(descriptor);
  }
}

/**
 * @param {string} command
 * @param {readonly string[]} versionArguments
 */
export function versionOf(command, versionArguments) {
  const result = run(command, versionArguments);
  if (!result.ok) return Object.freeze({ available: false, version: null });
  const line = result.stdout.split("\n").find((entry) => entry.trim().length > 0) ?? "";
  return Object.freeze({ available: true, version: cleanLabel(line, "unknown", MAX_VERSION) });
}

/**
 * 宿主 CLI 的版本（`claude --version` 的第一行，有界）：随登记用的 observation 交给 Wakeflow，记进窗口的绑定，
 * status 里就看得见每个窗口是在哪个版本的宿主下启动的（open-items A3）。读不到就是 null，从不因此拒绝。
 * @param {string} binary
 */
export function hostVersionOf(binary) {
  const version = versionOf(binary, ["--version"]);
  return version.available && version.version !== "unknown" ? version.version : null;
}

// §13.130：git 调用去掉会把仓库重定向到别处的 GIT_* 变量，只认 cwd 所在的仓库。
const GIT_REDIRECT_VARIABLES = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_COMMON_DIR",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_CEILING_DIRECTORIES",
];

/**
 * @param {string} repositoryRoot
 * @param {readonly string[]} args
 */
export function git(repositoryRoot, args) {
  const env = hostEnvironment();
  for (const name of GIT_REDIRECT_VARIABLES) delete env[name];
  return run("git", args, { cwd: repositoryRoot, env });
}
