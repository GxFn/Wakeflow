// 工作区布局、配置与标识（两个助手共用）：助手从自身位置推导工作区根，状态只读 Wakeflow 的私有运行时目录。

import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync,
  statSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HelperFailure, refuse } from "./failure.mjs";
import { isControl } from "./text.mjs";

export const HOST_ID = "claude-code";
export const HANDLE_KIND = "claude-session";
export const WORKSPACE_ROOT_PLACEHOLDER = "<workspace root>";
const RUNTIME = ".wakeflow-local/runtime/hosts/claude-code";
export const LOCATORS = `${RUNTIME}/identity/window-locators`;
export const BINDINGS = `${RUNTIME}/identity/window-bindings`;
export const HOOKS = `${RUNTIME}/observations/hooks`;
// 助手落盘的宿主观察（open-items K2）；与内核布局的 hostHelperObservationsRootRef 同一个目录。
export const HELPER_OBSERVATIONS = `${RUNTIME}/observations/helper`;
const MAX_CONFIG_BYTES = 1048576;
export const MAX_RECORD_BYTES = 65536;
export const WINDOW_ID_PATTERN =
  /^window_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
// 每个启动或续上的会话都带的两条 allow 规则（--allowedTools）：该角色的 Wakeflow MCP 规则与按本助手绝对路径调用的
// 助手本身。产品与测试窗口的根没有工作区根的 settings，助手又按绝对路径调用，相对规则对不上。
// MCP 规则必须等于 WAKEFLOW_CLAUDE_CODE_MCP_PERMISSION_RULE（测试核对）。
// 按角色的 MCP 允许规则（ADR-0020 决定 3，F2，§13.168）：Controller 整服务器，其他角色只放行归属表里的工具；
// 表由 contracts 的归属表在装配发布字节时填入。
const ROLE_MCP_PERMISSION_RULES = __WAKEFLOW_ROLE_MCP_PERMISSION_RULES__;
// 受管路径的写拒绝（ADR-0020 决定 6，open-items F1）：Controller 之外的窗口都把工作区根挂成附加目录，自动接受
// 编辑的会话因此改得动 Controller 免提示运行的助手、放行它的 settings、配置、活动 Demand 文件与账本。这些角色的
// 会话在启动与续上时带 deny 规则（--disallowedTools；deny 先于 allow 与权限模式）。角色与路径表在装配发布字节时
// 填入，账本根读配置。它只拦宿主的编辑工具与宿主认得的 Bash 文件命令，拦不住任意子进程：降低误用，不是隔离。
const MANAGED_WRITE_DENY = __WAKEFLOW_MANAGED_WRITE_DENY__;
// 规则语法里有含义的字符：路径带着它们时这条规则写不准，宁可不写并报数，也不留一条匹配不到的规则。
const RULE_SYNTAX_CHARACTERS = /[()[\]{}*?!\\,"']/u;

/** @param {string} spelling */
function ruleUnsafePath(spelling) {
  return (
    RULE_SYNTAX_CHARACTERS.test(spelling) ||
    [...spelling].some((character) => isControl(character.codePointAt(0) ?? 0))
  );
}

// 片段被内联进助手，所以这里是发布出去的助手文件自己的路径；工作区根由它向上六层推出，从不看 cwd。
const ASSET_PATH = fileURLToPath(import.meta.url);
export const ROOT = path.resolve(path.dirname(ASSET_PATH), "..", "..", "..", "..", "..", "..");

/**
 * 有界、不跟随符号链接地读一个 JSON 文件；读不到、超限、读的过程中文件被换掉或不是合法 JSON 时为 null。
 * @param {string} file
 * @param {number} maximumBytes
 * @returns {any}
 */
export function readBoundedJson(file, maximumBytes) {
  let descriptor = null;
  try {
    descriptor = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const opened = fstatSync(descriptor);
    if (!opened.isFile() || opened.size > maximumBytes) return null;
    const bytes = Buffer.alloc(opened.size);
    let offset = 0;
    while (offset < bytes.length) {
      const count = readSync(descriptor, bytes, offset, bytes.length - offset, null);
      if (count === 0) break;
      offset += count;
    }
    const after = lstatSync(file);
    if (offset !== opened.size || after.ino !== opened.ino || after.size !== opened.size)
      return null;
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, offset)));
  } catch {
    return null;
  } finally {
    if (descriptor !== null) {
      try {
        closeSync(descriptor);
      } catch {
        // diagnostic read is already closed
      }
    }
  }
}

/** @returns {HelperConfig} */
export function readConfig() {
  if (!existsSync(path.join(ROOT, "wakeflow.config.json"))) refuse("root-unresolved");
  const parsed = readBoundedJson(path.join(ROOT, "wakeflow.config.json"), MAX_CONFIG_BYTES);
  if (
    parsed === null ||
    typeof parsed !== "object" ||
    parsed.kind !== "WakeflowConfig" ||
    parsed.schemaVersion !== __WAKEFLOW_CONFIG_SCHEMA_VERSION__
  ) {
    refuse("config-invalid");
  }
  if (
    typeof parsed.program?.programId !== "string" ||
    !Array.isArray(parsed.topology?.windows) ||
    !Array.isArray(parsed.pods)
  ) {
    refuse("config-invalid");
  }
  return parsed;
}

/**
 * @param {unknown} value
 * @param {string} name
 * @returns {string}
 */
export function parseWindowId(value, name) {
  if (typeof value !== "string" || !WINDOW_ID_PATTERN.test(value))
    refuse("window-id-invalid", { argument: name });
  return value;
}

/**
 * @param {unknown} role
 * @returns {role is string}
 */
export function knownRole(role) {
  return typeof role === "string" && Object.hasOwn(ROLE_MCP_PERMISSION_RULES, role);
}

/** @param {unknown} placement */
export function resolvePlacement(placement) {
  if (typeof placement !== "string" || placement.length === 0)
    refuse("intent-invalid", { field: "cwd" });
  // 仓库可以放在工作区根旁边（配置里的 "../X"），所以只要求目录存在，不要求在根之内。
  const absolute = path.resolve(ROOT, placement);
  const relative = path.relative(ROOT, absolute);
  try {
    if (!statSync(absolute).isDirectory()) refuse("cwd-missing");
  } catch (error) {
    if (error instanceof HelperFailure) throw error;
    refuse("cwd-missing");
  }
  return Object.freeze({ absolute, relative: relative.length === 0 ? "." : relative });
}

/** @param {string} target */
export function realpathOrNull(target) {
  try {
    return realpathSync(target);
  } catch {
    return null;
  }
}

// 绝对路径只在助手进程里算出、只进 claude 的启动命令，不进任何输出。
/** @param {unknown} role */
function sessionPermissionRules(role) {
  if (!knownRole(role)) refuse("intent-invalid", { field: "role" });
  return [...ROLE_MCP_PERMISSION_RULES[role], `Bash(node ${ASSET_PATH} *)`];
}

/**
 * 配置里的账本根（绝对路径）；配置读不出或没有这一项时为 null。这里不拒绝：配置的对错由各命令自己报。
 * @returns {string | null}
 */
function configuredLedgerRoot() {
  const parsed = readBoundedJson(path.join(ROOT, "wakeflow.config.json"), MAX_CONFIG_BYTES);
  const ledgerRoot = parsed?.storage?.ledgerRoot;
  return typeof ledgerRoot === "string" && ledgerRoot.length > 0
    ? path.resolve(ROOT, ledgerRoot)
    : null;
}

/**
 * 这个角色的会话要带的写拒绝规则。`unexpressed` 是写不成规则的受管路径数（路径里有规则语法的字符，或账本根
 * 读不出）：那几处对这个窗口没有这层拒绝，调用方把数目报给 Controller。
 * @param {unknown} role
 * @returns {{ rules: string[], unexpressed: number }}
 */
function sessionWriteDenyRules(role) {
  if (!MANAGED_WRITE_DENY.roles.includes(String(role))) return { rules: [], unexpressed: 0 };
  const ledgerRoot = configuredLedgerRoot();
  /** @type {{ target: string, suffix: string }[]} */
  const targets = [
    ...MANAGED_WRITE_DENY.directories.map((entry) => ({
      target: path.join(ROOT, entry),
      suffix: "/**",
    })),
    ...MANAGED_WRITE_DENY.files.map((entry) => ({ target: path.join(ROOT, entry), suffix: "" })),
    ...(ledgerRoot === null ? [] : [{ target: ledgerRoot, suffix: "/**" }]),
  ];
  const rules = new Set();
  let unexpressed = ledgerRoot === null ? 1 : 0;
  for (const { target, suffix } of targets) {
    // 宿主按真实路径也按字面路径比对：目标是符号链接（或还不存在）时两种写法都给。
    const spellings = new Set([target, realpathOrNull(target) ?? target]);
    if ([...spellings].some(ruleUnsafePath)) {
      unexpressed += 1;
      continue;
    }
    // 规则里的绝对路径以 `//` 开头（单个 `/` 是相对设置文件所在目录）。
    for (const spelling of spellings) rules.add(`Edit(/${spelling}${suffix})`);
  }
  return { rules: [...rules], unexpressed };
}

/**
 * 每条 claude 启动命令末尾的规则参数：两个都是变长参数，必须排在意图自己的参数与位置参数之后，各只出现一次。
 * @param {unknown} role
 * @returns {string[]}
 */
export function sessionRuleArguments(role) {
  const deny = sessionWriteDenyRules(role).rules;
  return [
    "--allowedTools",
    ...sessionPermissionRules(role),
    ...(deny.length === 0 ? [] : ["--disallowedTools", ...deny]),
  ];
}

/**
 * 助手结果里的写拒绝摘要：只有数目，规则本身带绝对路径，从不输出。
 * @param {unknown} role
 */
export function sessionWriteDenyReport(role) {
  const deny = sessionWriteDenyRules(role);
  return { rules: deny.rules.length, unexpressed: deny.unexpressed };
}
