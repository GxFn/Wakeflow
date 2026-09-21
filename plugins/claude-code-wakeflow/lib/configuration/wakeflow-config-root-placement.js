import { types } from "node:util";
import nodePath from "node:path";
import { AbsoluteDirectoryPlacementError, inspectAbsoluteDirectoryPlacement, } from "../foundation/filesystem/absolute-directory-placement.js";
import { RootedDirectory, RootedDirectoryError, } from "../foundation/filesystem/rooted-directory.js";
import { WAKEFLOW_ACTIVE_ROOT, WAKEFLOW_LOCAL_ROOT, } from "./wakeflow-config.js";
const ERROR_MESSAGES = {
    "input": "Wakeflow config placement input is invalid.",
    "root-scope": "Wakeflow workspace root changed during placement admission.",
    "lexical-overlap": "Wakeflow configured roots overlap lexically.",
    "symlink": "Wakeflow configured root contains a symbolic link.",
    "not-directory": "Wakeflow configured root contains a non-directory node.",
    "alias": "Wakeflow configured root does not use its canonical physical spelling.",
    "physical-overlap": "Wakeflow configured roots overlap physically.",
    "inspection-failure": "Wakeflow configured roots could not be inspected safely.",
};
/** 配置根目录位置准入失败时返回的稳定、脱敏错误。 */
export class WakeflowConfigRootPlacementError extends Error {
    name = "WakeflowConfigRootPlacementError";
    code = "wakeflow-config-root-placement";
    reason;
    path;
    constructor(reason, path) {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
        this.path = path;
    }
}
function fail(reason, path) {
    throw new WakeflowConfigRootPlacementError(reason, path);
}
function assertRoot(value) {
    if (typeof value !== "object"
        || value === null
        || types.isProxy(value)
        || !(value instanceof RootedDirectory)) {
        fail("input", "$root");
    }
}
function portableComparisonPath(value) {
    return nodePath.normalize(value).normalize("NFC").toLowerCase();
}
function asPlacement(value) {
    // 固定协议根由本模块常量提供；配置字段已由 WakeflowConfigModel parser 授予品牌。
    return value;
}
function planRoots(workspaceRoot, model) {
    const values = [
        { key: "active.root", configuredPath: asPlacement(WAKEFLOW_ACTIVE_ROOT) },
        { key: "local.root", configuredPath: asPlacement(WAKEFLOW_LOCAL_ROOT) },
        { key: "ledger.root", configuredPath: model.storage.ledgerRoot },
        ...model.topology.supportSurfaces.map((surface) => ({
            key: `support.${surface.surfaceId}.root`,
            configuredPath: surface.path,
        })),
        ...model.topology.repositories.map((repository) => ({
            key: `repository.${repository.repositoryId}.root`,
            configuredPath: repository.path,
        })),
    ];
    return Object.freeze(values.map((value) => Object.freeze({
        ...value,
        absolutePath: nodePath.resolve(workspaceRoot, ...value.configuredPath.split("/")),
    })));
}
function assertNoOverlap(roots, pathOf, reason) {
    const indexByPath = new Map();
    for (const [index, root] of roots.entries()) {
        const key = portableComparisonPath(pathOf(root));
        const duplicate = indexByPath.get(key);
        if (duplicate !== undefined) {
            fail(reason, `$placements/${duplicate}|${index}`);
        }
        indexByPath.set(key, index);
    }
    for (const [index, root] of roots.entries()) {
        let current = portableComparisonPath(pathOf(root));
        while (true) {
            const parent = nodePath.dirname(current);
            if (parent === current)
                break;
            const ancestor = indexByPath.get(parent);
            if (ancestor !== undefined) {
                const left = Math.min(ancestor, index);
                const right = Math.max(ancestor, index);
                fail(reason, `$placements/${left}|${right}`);
            }
            current = parent;
        }
    }
}
function mapInspectionError(error, path) {
    if (error.reason === "symlink")
        fail("symlink", path);
    if (error.reason === "not-directory")
        fail("not-directory", path);
    if (error.reason === "input")
        fail("input", path);
    fail("inspection-failure", path);
}
async function observeRoot(planned, index) {
    const path = `$placements/${index}`;
    try {
        return await inspectAbsoluteDirectoryPlacement(planned.absolutePath, path);
    }
    catch (error) {
        if (error instanceof AbsoluteDirectoryPlacementError) {
            mapInspectionError(error, path);
        }
        throw error;
    }
}
async function assertCurrentRoot(root) {
    try {
        await root.assertCurrent("$root");
    }
    catch (error) {
        if (error instanceof RootedDirectoryError)
            fail("root-scope", "$root");
        throw error;
    }
}
/** 验证配置声明根目录的确定性词法拓扑和当前物理位置。 */
export async function validateWakeflowConfigRootPlacements(root, model) {
    assertRoot(root);
    await assertCurrentRoot(root);
    const planned = planRoots(root.absolutePath, model);
    assertNoOverlap(planned, (entry) => entry.absolutePath, "lexical-overlap");
    const observed = [];
    for (const [index, entry] of planned.entries()) {
        const observation = await observeRoot(entry, index);
        if (observation.state === "present"
            && observation.spellingIsCanonical !== true) {
            fail("alias", `$placements/${index}`);
        }
        if (observation.state === "missing") {
            if (observation.nearestExistingAncestor === null) {
                fail("inspection-failure", `$placements/${index}`);
            }
            if (observation.nearestExistingAncestor.spellingIsCanonical !== true) {
                fail("alias", `$placements/${index}`);
            }
        }
        observed.push(observation);
    }
    const physicallyPresent = planned.flatMap((entry, index) => {
        const observation = observed[index];
        return observation?.state === "present" && observation.realPath !== null
            ? [Object.freeze({ ...entry, realPath: observation.realPath })]
            : [];
    });
    assertNoOverlap(physicallyPresent, (entry) => entry.realPath, "physical-overlap");
    await assertCurrentRoot(root);
    const roots = Object.freeze(planned.map((entry, index) => {
        const observation = observed[index];
        if (observation === undefined)
            fail("inspection-failure", "$placements");
        return Object.freeze({
            key: entry.key,
            configuredPath: entry.configuredPath,
            absolutePath: entry.absolutePath,
            state: observation.state,
            realPath: observation.realPath,
        });
    }));
    return Object.freeze({
        workspaceRoot: root.absolutePath,
        roots,
        missingRootKeys: Object.freeze(roots.filter((entry) => entry.state === "missing")
            .map((entry) => entry.key)),
    });
}
