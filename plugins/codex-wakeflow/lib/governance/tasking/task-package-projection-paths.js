import { parseWakeflowDurableIdOfKind, WakeflowDurableIdError, } from "../../contracts/identity/wakeflow-durable-id.js";
import { parsePortableResourcePath, } from "../../foundation/filesystem/portable-resource-path.js";
/**
 * Wakeflow Governance / Tasking：TaskPackage 可重建文件投影的路径词汇。
 *
 * 每个持久 `taskPackageId` 在一个 Demand 根内只对应
 * `artifacts/task-packages/<taskPackageId>.json`。路径函数不探测文件、不读取事件，
 * 也不把投影存在性提升为任务规划权威。
 */
export const TASK_PACKAGE_PROJECTIONS_ROOT_REF = parsePortableResourcePath("artifacts/task-packages");
const TASK_PACKAGE_PROJECTION_FILE_PATTERN = /^(?<taskPackageId>task-package_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.json$/u;
const ERROR_MESSAGES = {
    identifier: "TaskPackage projection identity is invalid.",
    "file-name": "TaskPackage projection filename is invalid.",
};
export class TaskPackageProjectionPathError extends Error {
    name = "TaskPackageProjectionPathError";
    code = "wakeflow-task-package-projection-path";
    reason;
    path;
    constructor(reason, path) {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
        this.path = path;
    }
}
function fail(reason, path) {
    throw new TaskPackageProjectionPathError(reason, path);
}
function parseTaskPackageId(value, path) {
    try {
        return parseWakeflowDurableIdOfKind(value, "task-package", path);
    }
    catch (error) {
        if (error instanceof WakeflowDurableIdError)
            fail("identifier", path);
        throw error;
    }
}
/** 从 TaskPackage 身份派生唯一投影引用。 */
export function taskPackageProjectionRef(value) {
    const taskPackageId = parseTaskPackageId(value, "$taskPackageId");
    return parsePortableResourcePath(`${TASK_PACKAGE_PROJECTIONS_ROOT_REF}/${taskPackageId}.json`);
}
/** 从严格文件名恢复 TaskPackage 身份与完整投影引用。 */
export function parseTaskPackageProjectionFileName(value) {
    if (typeof value !== "string")
        fail("file-name", "$fileName");
    const taskPackageIdText = TASK_PACKAGE_PROJECTION_FILE_PATTERN.exec(value)?.groups?.taskPackageId;
    if (taskPackageIdText === undefined)
        fail("file-name", "$fileName");
    let taskPackageId;
    try {
        taskPackageId = parseTaskPackageId(taskPackageIdText, "$fileName");
    }
    catch (error) {
        if (error instanceof TaskPackageProjectionPathError) {
            fail("file-name", "$fileName");
        }
        throw error;
    }
    const fileName = `${taskPackageId}.json`;
    if (fileName !== value)
        fail("file-name", "$fileName");
    return Object.freeze({
        taskPackageId,
        fileName,
        resourcePath: taskPackageProjectionRef(taskPackageId),
    });
}
