import type { RootedDirectory } from "../../foundation/filesystem/rooted-directory.js";
import type {
  WakeflowWorkspaceHostId,
  WakeflowWorkspaceHostResourceProfile,
} from "../workspace-host-resource-profile.js";
import type {
  WakeflowMaintenanceExecutionPlan,
} from "./wakeflow-maintenance-execution-plan.js";
import type {
  WakeflowMaintenanceExecutionTransactionReceipt,
} from "./wakeflow-maintenance-execution-transaction.js";
import type {
  WakeflowMaintenanceOperationId,
} from "./wakeflow-maintenance-operation-id.js";
import type {
  WakeflowStaticMaterializationPreviewRequest,
} from "./wakeflow-static-materialization-preview-contract.js";

/**
 * Wakeflow Workspace / Maintenance：公共协调器使用的单宿主固定端口。
 *
 * 该端口不是 action registry，也不是运行时可发现的插件系统。每个发布制品只在自己的
 * entrypoint 组装一个实现；共享协调器因此既不导入具体宿主，也不能按请求切换能力。
 */
export interface WakeflowMaintenancePublicHostFacade {
  readonly hostId: WakeflowWorkspaceHostId;
  readonly currentHostProfile:
    Readonly<WakeflowWorkspaceHostResourceProfile>;
  readonly hostProfiles: readonly [
    Readonly<WakeflowWorkspaceHostResourceProfile>,
    Readonly<WakeflowWorkspaceHostResourceProfile>,
  ];
  readonly preview: (
    root: RootedDirectory,
    request: WakeflowStaticMaterializationPreviewRequest,
  ) => Promise<Readonly<WakeflowMaintenanceExecutionPlan>>;
  readonly apply: (
    root: RootedDirectory,
    plan: unknown,
    request: WakeflowStaticMaterializationPreviewRequest,
  ) => Promise<Readonly<WakeflowMaintenanceExecutionTransactionReceipt>>;
  readonly recover: (
    root: RootedDirectory,
    operationId: WakeflowMaintenanceOperationId,
  ) => Promise<Readonly<WakeflowMaintenanceExecutionTransactionReceipt>>;
}
