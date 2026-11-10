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

export const HOST_ID = "claude-code";
export const HANDLE_KIND = "claude-session";
export const WORKSPACE_ROOT_PLACEHOLDER = "<workspace root>";
const RUNTIME = ".wakeflow-local/runtime/hosts/claude-code";
export const LOCATORS = `${RUNTIME}/identity/window-locators`;
export const BINDINGS = `${RUNTIME}/identity/window-bindings`;
export const HOOKS = `${RUNTIME}/observations/hooks`;
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
export function sessionPermissionRules(role) {
  if (!knownRole(role)) refuse("intent-invalid", { field: "role" });
  return [...ROLE_MCP_PERMISSION_RULES[role], `Bash(node ${ASSET_PATH} *)`];
}
