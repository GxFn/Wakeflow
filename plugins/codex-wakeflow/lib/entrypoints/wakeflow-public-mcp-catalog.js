import { WAKEFLOW_MAINTENANCE_PUBLIC_TOOL_NAME, } from "../capabilities/workspace/maintain-workspace.js";
import { WAKEFLOW_MAINTENANCE_PUBLIC_REQUEST_SCHEMA } from "../contracts/generated/entrypoints/wakeflow-maintenance-public-request.generated.js";
import { WAKEFLOW_MAINTENANCE_PUBLIC_RESULT_SCHEMA } from "../contracts/generated/entrypoints/wakeflow-maintenance-public-result.generated.js";
import { RECORD_EVIDENCE_TOOL_REGISTRATION, } from "../capabilities/evidence/contract.js";
import { STATUS_TOOL_REGISTRATION, VERIFY_TOOL_REGISTRATION, } from "../capabilities/observation/contract.js";
import { POD_TOOL_REGISTRATION } from "../capabilities/pod/contract.js";
import { IMPLEMENTATION_REVIEW_DECISION_TOOL_REGISTRATION, TARGET_RESULT_IMPORT_TOOL_REGISTRATION, TARGET_RESULT_REVIEW_INSPECTION_TOOL_REGISTRATION, TEST_REVIEW_DECISION_TOOL_REGISTRATION, } from "../capabilities/result-review/contract.js";
import { createWakeflowToolCatalog, } from "../kernel/tool-registry.js";
import { DEMAND_CANCELLATION_TOOL_REGISTRATION, DEMAND_COMPLETION_TOOL_REGISTRATION, DEMAND_CONTINUATION_TOOL_REGISTRATION, DEMAND_CREATION_TOOL_REGISTRATION, } from "../capabilities/demand/contract.js";
import { WINDOW_BINDING_TOOL_REGISTRATION } from "../capabilities/endpoint/contract.js";
import { PREPARE_DELIVERY_TOOL_REGISTRATION, REARM_DELIVERY_TOOL_REGISTRATION, RECORD_DELIVERY_OUTCOME_TOOL_REGISTRATION, } from "../capabilities/delivery/contract.js";
import { TARGET_TASK_PLANNING_TOOL_REGISTRATION, } from "../capabilities/tasking/contract.js";
import { BOARD_INSPECTION_TOOL_REGISTRATION, REQUIREMENT_PUBLICATION_TOOL_REGISTRATION, } from "../capabilities/requirement/contract.js";
const REGISTRATIONS = Object.freeze([
    {
        name: WAKEFLOW_MAINTENANCE_PUBLIC_TOOL_NAME,
        slice: "workspace",
        shape: "effect",
        executor: "executeMaintenance",
        title: "Maintain Wakeflow Workspace",
        description: "Preview, apply, or recover one workspace Maintenance transaction (fresh-initialize, reconfigure, reconcile): preview is read-only and returns the plan with its planDigest, apply resends the same action and request with that planDigest so Wakeflow re-derives the plan and rejects drift, and recover finishes an interrupted transaction by operationId. Every result carries next; returned window launch intents require explicit Agent host actions.",
        requestSchema: WAKEFLOW_MAINTENANCE_PUBLIC_REQUEST_SCHEMA,
        resultSchema: WAKEFLOW_MAINTENANCE_PUBLIC_RESULT_SCHEMA,
        annotations: {
            readOnlyHint: false,
            destructiveHint: true,
            idempotentHint: false,
            openWorldHint: false,
        },
    },
    WINDOW_BINDING_TOOL_REGISTRATION,
    REQUIREMENT_PUBLICATION_TOOL_REGISTRATION,
    BOARD_INSPECTION_TOOL_REGISTRATION,
    DEMAND_CREATION_TOOL_REGISTRATION,
    DEMAND_COMPLETION_TOOL_REGISTRATION,
    DEMAND_CANCELLATION_TOOL_REGISTRATION,
    DEMAND_CONTINUATION_TOOL_REGISTRATION,
    RECORD_EVIDENCE_TOOL_REGISTRATION,
    TARGET_TASK_PLANNING_TOOL_REGISTRATION,
    PREPARE_DELIVERY_TOOL_REGISTRATION,
    RECORD_DELIVERY_OUTCOME_TOOL_REGISTRATION,
    REARM_DELIVERY_TOOL_REGISTRATION,
    TARGET_RESULT_IMPORT_TOOL_REGISTRATION,
    TARGET_RESULT_REVIEW_INSPECTION_TOOL_REGISTRATION,
    IMPLEMENTATION_REVIEW_DECISION_TOOL_REGISTRATION,
    TEST_REVIEW_DECISION_TOOL_REGISTRATION,
    POD_TOOL_REGISTRATION,
    STATUS_TOOL_REGISTRATION,
    VERIFY_TOOL_REGISTRATION,
]);
/** 全部公共工具的登记表；组合根按它生成目录。 */
export const WAKEFLOW_PUBLIC_TOOL_CATALOG = createWakeflowToolCatalog(REGISTRATIONS);
/** 组合根必须绑定的 executor 名（按登记表顺序）。 */
export const WAKEFLOW_PUBLIC_MCP_EXECUTOR_FIELDS = Object.freeze(WAKEFLOW_PUBLIC_TOOL_CATALOG.tools.map((tool) => tool.executor));
