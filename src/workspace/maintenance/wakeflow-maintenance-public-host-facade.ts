import type { RootedDirectory } from "../../foundation/filesystem/rooted-directory.js";
import type {
  WakeflowWorkspaceHostId,
  WakeflowWorkspaceHostResourceProfile,
} from "../workspace-host-resource-profile.js";
import type { WakeflowMaintenanceExecutionPlan } from "./wakeflow-maintenance-execution-plan.js";
import type { WakeflowMaintenanceExecutionTransactionReceipt } from "./wakeflow-maintenance-execution-transaction.js";
import type { WakeflowMaintenanceOperationId } from "./wakeflow-maintenance-operation-id.js";
import type { WakeflowMaintenanceWriter } from "./wakeflow-maintenance-writer.js";
import type { WakeflowStaticMaterializationPreviewRequest } from "./wakeflow-static-materialization-preview-contract.js";

/** 协调器交给 apply 与 recover 的执行选项：取消信号与本进程的写者戳（C11）。 */
export interface WakeflowMaintenancePublicHostExecutionOptions {
  readonly signal?: AbortSignal;
  readonly writer?: Readonly<WakeflowMaintenanceWriter> | null;
}

/**
 * Wakeflow Workspace / Maintenance：公共协调器使用的单宿主固定端口。
 *
 * 该端口不是 action registry，也不是运行时可发现的插件系统。每个发布制品只在自己的
 * entrypoint 组装一个实现；共享协调器因此既不导入具体宿主，也不能按请求切换能力。
 */
export interface WakeflowMaintenancePublicHostFacade {
  readonly hostId: WakeflowWorkspaceHostId;
  /**
   * 已装载制品的根（realpath）；入口在装载时从自身位置推导，无法解析时为 null。维护拒绝包含
   * 该制品或位于其中的工作区根，以及与之重叠的配置根（旧实现 bootstrap 的同一护栏，§13.124）。
   */
  readonly artifactRoot: string | null;
  readonly currentHostProfile: Readonly<WakeflowWorkspaceHostResourceProfile>;
  readonly hostProfiles: readonly Readonly<WakeflowWorkspaceHostResourceProfile>[];
  readonly preview: (
    root: RootedDirectory,
    request: WakeflowStaticMaterializationPreviewRequest,
  ) => Promise<Readonly<WakeflowMaintenanceExecutionPlan>>;
  readonly apply: (
    root: RootedDirectory,
    plan: unknown,
    request: WakeflowStaticMaterializationPreviewRequest,
    options?: Readonly<WakeflowMaintenancePublicHostExecutionOptions>,
  ) => Promise<Readonly<WakeflowMaintenanceExecutionTransactionReceipt>>;
  readonly recover: (
    root: RootedDirectory,
    operationId: WakeflowMaintenanceOperationId,
    options?: Readonly<WakeflowMaintenancePublicHostExecutionOptions>,
  ) => Promise<Readonly<WakeflowMaintenanceExecutionTransactionReceipt>>;
}
