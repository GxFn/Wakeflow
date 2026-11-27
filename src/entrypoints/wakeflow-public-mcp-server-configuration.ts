import type { WakeflowNarrowedWindowRole } from "../contracts/vocabulary/wakeflow-role-tool-access.js";
import type { DemandEventStreamCommitWriter } from "../governance/demand/event-sourcing/demand-event-stream-commit.js";
import type { WakeflowCallAuthorizer } from "./wakeflow-caller-role-gate.js";
import type { WakeflowPublicMcpExecutors } from "./wakeflow-public-mcp-catalog.js";

/** Public Server固定组合所需的完整、关闭依赖集合。 */
export interface CreateWakeflowPublicMcpServerOptions extends WakeflowPublicMcpExecutors {
  readonly serverName: string;
  readonly serverVersion: string;
  readonly beforeMutation?: () => void;
  /**
   * 本进程的写者戳（C11）：组合根从制品身份映射，服务把它放进每次调用的执行上下文；省略或 null
   * 即不盖戳（测试构建没有 manifest）。严格准入归各持久写入。
   */
  readonly writer?: Readonly<DemandEventStreamCommitWriter> | null;
  /**
   * 每次工具调用之前的调用方校验（ADR-0020 决定 3，open-items F1）：组合根给出按窗口角色的门；省略即不校验
   * （测试与没有窗口身份可认的构建）。
   */
  readonly authorizeCall?: WakeflowCallAuthorizer;
  /**
   * 启动时认出的窗口角色（ADR-0029）：给了就只登记归属表里它用得到的工具；省略或 null 登记全部
   * （Controller、认不出角色的进程、测试）。
   */
  readonly listedRole?: WakeflowNarrowedWindowRole | null;
}
