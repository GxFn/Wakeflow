import { realpathSync } from "node:fs";
import path from "node:path";

import type { WakeflowConfigModel } from "../configuration/wakeflow-config.js";
import { readWakeflowConfigAuthoritySnapshot } from "../configuration/wakeflow-config-authority-snapshot.js";
import {
  WAKEFLOW_ROLE_TOOL_ACCESS,
  type WakeflowWindowRole,
} from "../contracts/vocabulary/wakeflow-role-tool-access.js";
import { RootedDirectory } from "../foundation/filesystem/rooted-directory.js";
import { fail } from "../kernel/error.js";

/**
 * Wakeflow Entrypoints：按窗口角色的运行时工具校验（ADR-0020 决定 3 与 6，open-items F1）。
 *
 * 公共工具的请求只带工作区根，没有调用者身份；归属表（哪个角色用哪些工具）此前只靠技能文本与宿主的允许
 * 规则守着。但每个窗口的会话在它自己的执行根里启动，宿主把这个服务进程起在同一个目录：进程的工作目录恰好
 * 是某一种角色的窗口的执行根时，调用方的角色就是它，归属表之外的工具在这里被拒绝。
 *
 * 认不出就不收窄：工作目录就是工作区根（Controller，或所有窗口都在根上启动的项目聊天宿主），不是任何窗口
 * 的执行根（维护者工具、引导会话、测试），同一个目录属于不止一种角色，或配置读不出来（那是各工具自己要报
 * 的错）。这是降低误用——被仓库内容牵着走的产品 Agent 调到 Controller 的工具会被挡下并留下一条可读的拒绝
 * ——不是隔离：同一用户的进程换个目录再起一个服务就绕过去了，ADR-0020 对这一点从不承诺。
 */

/** 一个窗口的角色与它的执行根（相对工作区根，可以是 `../Repo` 这样的兄弟目录）。 */
export interface WakeflowWindowExecutionRoot {
  readonly role: WakeflowWindowRole;
  readonly placement: string;
}

export interface WakeflowCallerRoleGateOptions {
  /** 服务进程的工作目录；组合根传 `process.cwd()`。 */
  readonly cwd: string;
  /** 宿主按这份配置给出每个窗口的执行根（宿主知道自己的 worktree 检出放在哪里）。 */
  readonly executionRoots: (
    model: Readonly<WakeflowConfigModel>,
  ) => readonly Readonly<WakeflowWindowExecutionRoot>[];
}

/** 一次工具调用之前的校验：越权即以 `precondition-failed` / `tool-not-for-role` 拒绝，否则什么都不做。 */
export type WakeflowCallAuthorizer = (
  toolName: string,
  request: unknown,
  signal?: AbortSignal,
) => Promise<void>;

function realpathOrNull(target: string): string | null {
  try {
    return realpathSync(target);
  } catch {
    return null;
  }
}

async function readModel(
  root: string,
  signal: AbortSignal | undefined,
): Promise<Readonly<WakeflowConfigModel> | null> {
  let rooted: RootedDirectory | null = null;
  try {
    rooted = await RootedDirectory.open(root);
    return (
      await readWakeflowConfigAuthoritySnapshot(rooted, signal === undefined ? {} : { signal })
    ).model;
  } catch {
    return null;
  } finally {
    await rooted?.close().catch(() => undefined);
  }
}

/** 这份配置里，执行根恰好是 `cwd` 的窗口的角色；同一个目录属于不止一种角色时认不出是谁（null）。 */
function roleAt(
  cwd: string,
  root: string,
  entries: readonly Readonly<WakeflowWindowExecutionRoot>[],
): WakeflowWindowRole | null {
  const roles = new Set<WakeflowWindowRole>();
  for (const entry of entries) {
    if (realpathOrNull(path.resolve(root, entry.placement)) === cwd) roles.add(entry.role);
  }
  return roles.size === 1 ? ([...roles][0] ?? null) : null;
}

function requestRoot(request: unknown): string | null {
  if (request === null || typeof request !== "object" || !("root" in request)) return null;
  return typeof request.root === "string" ? request.root : null;
}

export function createWakeflowCallerRoleGate(
  options: Readonly<WakeflowCallerRoleGateOptions>,
): WakeflowCallAuthorizer {
  // 服务进程的工作目录在它的一生里不变：只解析一次。
  const cwd = realpathOrNull(options.cwd);

  async function callerRole(
    rootValue: string,
    signal: AbortSignal | undefined,
  ): Promise<WakeflowWindowRole | null> {
    if (cwd === null || !path.isAbsolute(rootValue)) return null;
    const root = realpathOrNull(rootValue);
    // 在工作区根上起的服务：Controller，或窗口都从根启动的宿主——没有可以收窄的身份。
    if (root === null || root === cwd) return null;
    const model = await readModel(root, signal);
    if (model === null) return null;
    try {
      return roleAt(cwd, root, options.executionRoots(model));
    } catch {
      return null;
    }
  }

  return async (toolName, request, signal) => {
    const root = requestRoot(request);
    if (root === null) return;
    const role = await callerRole(root, signal);
    if (role === null || role === "controller") return;
    if (WAKEFLOW_ROLE_TOOL_ACCESS[role].includes(toolName)) return;
    fail("precondition-failed", "tool-not-for-role", "$caller", {
      details: { role, tool: toolName },
    });
  };
}
