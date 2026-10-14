/**
 * Wakeflow Contracts / Vocabulary：按窗口角色的工具归属（ADR-0020 决定 3，open-items F2，§13.168）。
 *
 * Controller 使用全部公共工具；其他三种角色只使用各自技能点名的工具。这张表是技能文本、Claude Code
 * 允许规则与未来运行时调用者校验的共同来源：`tests/artifacts/agent-text-honesty.test.ts` 核对它与
 * 技能正文点名的工具逐一相同，且每个名字都在公共目录里。
 */
export const WAKEFLOW_WINDOW_ROLES = Object.freeze([
  "controller",
  "design",
  "product",
  "test",
] as const);
export type WakeflowWindowRole = (typeof WAKEFLOW_WINDOW_ROLES)[number];
export type WakeflowNarrowedWindowRole = Exclude<WakeflowWindowRole, "controller">;

export const WAKEFLOW_ROLE_TOOL_ACCESS: Readonly<
  Record<WakeflowNarrowedWindowRole, readonly string[]>
> = Object.freeze({
  design: Object.freeze([
    "wakeflow_inspect_board",
    "wakeflow_publish_requirement",
    "wakeflow_status",
  ]),
  product: Object.freeze(["wakeflow_import_target_result", "wakeflow_status"]),
  test: Object.freeze([
    "wakeflow_import_target_result",
    "wakeflow_record_evidence",
    "wakeflow_status",
  ]),
});

/** 该角色可用的工具名；Controller 为 null（不收窄）。 */
export function wakeflowRoleToolAccess(role: WakeflowWindowRole): readonly string[] | null {
  return role === "controller" ? null : WAKEFLOW_ROLE_TOOL_ACCESS[role];
}
