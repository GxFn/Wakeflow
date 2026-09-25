import { computeCanonicalJsonSha256Digest } from "../../foundation/crypto/canonical-json-sha256.js";
import { BoundedDirectoryTreeScanError, scanBoundedResourceDirectoryTree, } from "../../foundation/filesystem/bounded-directory-tree-scan.js";
import { parsePortableResourcePath, } from "../../foundation/filesystem/portable-resource-path.js";
import { classifyPrivateNode, convergePrivateNodeMode, PrivateModeConvergenceError, } from "../../foundation/filesystem/private-mode-convergence.js";
import { RootedDirectory } from "../../foundation/filesystem/rooted-directory.js";
/**
 * Wakeflow Workspace / Maintenance：私有树的模式普查与安全收敛（gate-log §13.130 D8）。
 *
 * `.wakeflow-local` 与 `.wakeflow-active` 是私有树：目录 0700、文件 0600。普查逐棵有界遍历，
 * 树根与每个后代节点都按 `classifyPrivateNode` 分类；安全漂移（例如 `chmod -R go+rX` 之后的
 * 0755 / 0644）可以被收敛，unsafe 节点只报告、从不修。收敛按普查顺序（父目录在前）逐个节点
 * 执行，节点在普查与收敛之间变化或变得 unsafe 时跳过并计数，绝不强行覆盖。
 *
 * 错误与普查结果不回显绝对路径，只含工作区内的可移植资源路径。
 */
export const WAKEFLOW_PRIVATE_TREE_REFS = Object.freeze([
    parsePortableResourcePath(".wakeflow-local"),
    parsePortableResourcePath(".wakeflow-active"),
]);
const MAXIMUM_ENTRIES = 100_000;
const MAXIMUM_DEPTH = 24;
const DEFAULT_AREA_MAXIMUM = 3;
const AREA_SEGMENTS = 3;
const ERROR_MESSAGES = {
    input: "Wakeflow private mode census input is invalid.",
    aborted: "Wakeflow private mode census was aborted.",
    convergence: "Wakeflow private mode convergence failed.",
};
/** 私有模式普查与收敛的稳定错误；不回显绝对路径或底层原因。 */
export class WakeflowPrivateModeCensusError extends Error {
    name = "WakeflowPrivateModeCensusError";
    code = "wakeflow-private-mode-census";
    reason;
    path;
    constructor(reason, path) {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
        this.path = path;
    }
}
function fail(reason, path) {
    throw new WakeflowPrivateModeCensusError(reason, path);
}
function compareCodeUnits(left, right) {
    if (left < right)
        return -1;
    return left > right ? 1 : 0;
}
function parseSignal(options) {
    if (options === undefined)
        return undefined;
    if (typeof options !== "object" || options === null)
        fail("input", "$options");
    const signal = options.signal;
    if (signal === undefined)
        return undefined;
    if (!(signal instanceof AbortSignal))
        fail("input", "$options.signal");
    return signal;
}
function assertNotAborted(signal) {
    if (signal?.aborted === true)
        fail("aborted", "$signal");
}
function censusDigestOf(status, drifted, unsafe) {
    return computeCanonicalJsonSha256Digest({
        kind: "WakeflowPrivateModeCensus",
        status,
        drifted: drifted.map((entry) => ({
            resourcePath: entry.resourcePath,
            kind: entry.node.kind,
            deviceId: entry.node.deviceId.toString(),
            inodeId: entry.node.inodeId.toString(),
            permissionBits: entry.node.permissionBits,
        })),
        unsafe: [...unsafe],
    });
}
function freezeCensus(status, drifted, unsafe, issue) {
    drifted.sort((left, right) => compareCodeUnits(left.resourcePath, right.resourcePath));
    unsafe.sort(compareCodeUnits);
    return Object.freeze({
        status,
        drifted: Object.freeze(drifted),
        unsafe: Object.freeze(unsafe),
        issue,
        censusDigest: censusDigestOf(status, drifted, unsafe),
    });
}
function record(resourcePath, node, drifted, unsafe) {
    const nodeClass = classifyPrivateNode(node);
    if (nodeClass === "safe-drift")
        drifted.push(Object.freeze({ resourcePath, node }));
    else if (nodeClass === "unsafe")
        unsafe.push(resourcePath);
}
/**
 * 普查两棵私有树的模式。不存在的树跳过；树根是符号链接或非目录记为 unsafe；其他遍历失败使
 * 整体 `unavailable`（列表为空，issue 为遍历失败原因）。优先级：unavailable > unsafe >
 * safe-drift > current。只读，不修改任何节点。
 */
export async function inspectWakeflowPrivateModes(root, options) {
    if (!(root instanceof RootedDirectory))
        fail("input", "$root");
    const signal = parseSignal(options);
    assertNotAborted(signal);
    const drifted = [];
    const unsafe = [];
    for (const treeRef of WAKEFLOW_PRIVATE_TREE_REFS) {
        assertNotAborted(signal);
        try {
            const scan = await scanBoundedResourceDirectoryTree(root, treeRef, {
                maximumEntries: MAXIMUM_ENTRIES,
                maximumDepth: MAXIMUM_DEPTH,
                ...(signal === undefined ? {} : { signal }),
            });
            record(treeRef, scan.treeRootNode, drifted, unsafe);
            for (const entry of scan.entries)
                record(entry.resourcePath, entry.node, drifted, unsafe);
        }
        catch (error) {
            if (!(error instanceof BoundedDirectoryTreeScanError))
                throw error;
            if (error.reason === "not-found")
                continue;
            if (error.reason === "symlink" || error.reason === "not-directory") {
                unsafe.push(treeRef);
                continue;
            }
            if (error.reason === "aborted")
                fail("aborted", "$signal");
            return freezeCensus("unavailable", [], [], error.reason);
        }
    }
    let status = "current";
    if (unsafe.length > 0)
        status = "unsafe";
    else if (drifted.length > 0)
        status = "safe-drift";
    return freezeCensus(status, drifted, unsafe, null);
}
/**
 * 按普查顺序（父目录在前）收敛 `census.drifted`。变化或变得 unsafe 的节点计入 `changed` 并跳过；
 * 从不触碰普查中的 unsafe 节点。已是私有模式的节点计入 `current`，因此中断后可以用新普查重跑。
 */
export async function convergeWakeflowPrivateModes(root, census, options) {
    if (!(root instanceof RootedDirectory))
        fail("input", "$root");
    if (typeof census !== "object" || census === null || !Array.isArray(census.drifted)) {
        fail("input", "$census");
    }
    const signal = parseSignal(options);
    let converged = 0;
    let current = 0;
    let changed = 0;
    for (const entry of census.drifted) {
        assertNotAborted(signal);
        try {
            const outcome = await convergePrivateNodeMode(root, entry.resourcePath, entry.node, signal === undefined ? {} : { signal });
            if (outcome === "converged")
                converged += 1;
            else
                current += 1;
        }
        catch (error) {
            if (!(error instanceof PrivateModeConvergenceError))
                throw error;
            if (error.reason === "resource-changed" || error.reason === "resource-unsafe") {
                changed += 1;
                continue;
            }
            if (error.reason === "aborted")
                fail("aborted", "$signal");
            fail("convergence", `$${entry.resourcePath}`);
        }
    }
    return Object.freeze({ converged, current, changed });
}
/**
 * 公开输出用：每个路径截到前三段，只留最小覆盖（祖先已在列的区域不再重复），排序，最多
 * `maximum` 个（默认 3）。整棵树漂移时报的是树根，零星漂移报到它所在的第三段。
 */
export function wakeflowPrivateModeAreas(paths, maximum = DEFAULT_AREA_MAXIMUM) {
    if (!Array.isArray(paths))
        fail("input", "$paths");
    if (!Number.isSafeInteger(maximum) || maximum < 0)
        fail("input", "$maximum");
    const areas = new Set();
    for (const path of paths)
        areas.add(path.split("/").slice(0, AREA_SEGMENTS).join("/"));
    const covering = [...areas].filter((area) => {
        const segments = area.split("/");
        for (let length = 1; length < segments.length; length += 1) {
            if (areas.has(segments.slice(0, length).join("/")))
                return false;
        }
        return true;
    });
    return Object.freeze(covering.sort(compareCodeUnits).slice(0, maximum));
}
