/**
 * Wakeflow Capabilities / Endpoint：Claude 桌面会话观察的分类器（ADR-0025 D3，open-items X17）。
 *
 * 输入是 Agent 交回的会话行，输出是封闭的状态词汇。行取自桌面自己的会话清单 `list_sessions`：会话只要还在
 * 侧栏（未归档）就在清单里，进程空闲退出后也一样（L18：`claude agents --json` 只列进程存活的会话，空闲后进程
 * 结束的会话会被误判为 absent）。助手的 `sessions` 是进程视图，只作补充，行形状相同。
 *
 * 匹配：行的 `sessionId`（去掉 `local_` 前缀的会话 UUID）等于绑定句柄，或行的 `desktopSessionId` 等于定位器
 * 记下的桌面 id——界面建的会话（Controller 自己）两者不同，只能按桌面 id 对上。匹配且未归档即 present-busy /
 * present-idle；没有匹配行或只有归档行即 absent。与 tmux pane 分类器同形：纯函数，不读文件、不执行 claude，
 * Agent 不判存活。
 */

const DESKTOP_SESSION_STATUSES = Object.freeze(["present-busy", "present-idle", "absent"] as const);

export type DesktopSessionStatus = (typeof DESKTOP_SESSION_STATUSES)[number];

/**
 * 一行会话观察。`status` 由 Agent 按清单原样映射：`list_sessions` 的 `isRunning: true` 是 `busy`、否则 `idle`；
 * `archived` 是它的 `isArchived`。cwd、name 与 pid 只是随行信息，分类不读它们。
 */
export interface DesktopSessionObservation {
  readonly sessionId: string;
  readonly desktopSessionId?: string | null;
  readonly status: "busy" | "idle";
  readonly archived?: boolean;
  readonly cwd?: string | null;
  readonly name?: string | null;
  readonly pid?: number | null;
}

/** 绑定的两个标识：句柄（Claude 会话 id）与定位器里的桌面 id（`local_…`，没有定位器时为 null）。 */
export interface DesktopSessionIdentity {
  readonly sessionId: string;
  readonly desktopSessionId: string | null;
}

function matches(
  identity: Readonly<DesktopSessionIdentity>,
  session: Readonly<DesktopSessionObservation>,
): boolean {
  if (session.sessionId === identity.sessionId) return true;
  return (
    identity.desktopSessionId !== null &&
    typeof session.desktopSessionId === "string" &&
    session.desktopSessionId === identity.desktopSessionId
  );
}

/** 按会话标识匹配清单；归档行不算在场；同一会话出现多行时只要有一行 busy 就是 present-busy。 */
export function classifyDesktopSessions(
  identity: Readonly<DesktopSessionIdentity>,
  sessions: readonly DesktopSessionObservation[],
): DesktopSessionStatus {
  const present = sessions.filter(
    (session) => matches(identity, session) && session.archived !== true,
  );
  if (present.length === 0) return "absent";
  return present.some((session) => session.status === "busy") ? "present-busy" : "present-idle";
}
