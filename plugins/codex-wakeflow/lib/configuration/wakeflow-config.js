import { WAKEFLOW_CONFIG_SCHEMA, } from "../contracts/generated/configuration/wakeflow-config.generated.js";
import { computeCanonicalJsonSha256Digest } from "../foundation/crypto/canonical-json-sha256.js";
import { JsonValueError, parseJsonValue, } from "../foundation/data/json-value.js";
import { parseWakeflowDurableId, parseWakeflowDurableIdOfKind, WakeflowDurableIdError, } from "../contracts/identity/wakeflow-durable-id.js";
import { createRuntimeJsonSchemaValidator } from "../foundation/schema/runtime-json-schema.js";
/**
 * Wakeflow Configuration：公开配置的 Schema 准入与跨字段领域模型。
 *
 * JSON Schema 2020-12 与 Ajv 严格校验器负责限制字段集合、值域、基数和词法。本模块
 * 只补充 Schema 无法表达的类型化标识全局冲突、实体引用、能力匹配、每个 Repository
 * 的 Product 职责所有者、重复残留路径，以及 pod 作用域的窗口基数（ADR-0010 D1、D2：
 * 每个 pod 恰好一个 controller、design、test；primary pod 每仓库至少一个 product，
 * worktree pod 每仓库恰好一个 product 且每个 product 窗口恰好一条 worktree 意图）。输入先转换为无副作用、与源容器解除引用关系
 * 并递归冻结的 JSON 树，因此校验器不会执行访问器、代理陷阱或自定义行为。
 *
 * 本层不读取文件、不解析工作区位置的物理状态、不缓存当前配置，也不注入宿主
 * 默认值。Config 权威快照负责组合配置文件字节和物理根目录权威事实；
 * 写入和比较并交换仍属于后续 Config 职责所有者。
 */
// 配置身份三元组归词汇层所有（两个不加载校验器的轻读者也要认它），这里只转发。
export { WAKEFLOW_CONFIG_KIND, WAKEFLOW_CONFIG_SCHEMA_ID, WAKEFLOW_CONFIG_SCHEMA_VERSION, } from "../contracts/vocabulary/wakeflow-config-identity.js";
export const WAKEFLOW_ACTIVE_ROOT = ".wakeflow-active";
export const WAKEFLOW_LOCAL_ROOT = ".wakeflow-local";
export const WAKEFLOW_PRESENTATION_LANGUAGES = Object.freeze([
    "en",
    "zh-Hans",
]);
/**
 * Fresh Config producer 在用户未选择语言时写入的显式值。
 * Parser 不会为缺失字段注入默认值，持久文档始终保存唯一语言权威。
 */
export const WAKEFLOW_DEFAULT_PRESENTATION_LANGUAGE = "en";
const ERROR_MESSAGES = {
    "json-value": "Wakeflow config input is not passive JSON data.",
    "schema": "Wakeflow config does not satisfy the public Schema.",
    "identifier": "Wakeflow config contains an invalid typed identifier.",
    "identifier-collision": "Wakeflow config durable identifiers collide.",
    "reference": "Wakeflow config contains an unresolved typed reference.",
    "topology": "Wakeflow config topology relationships are inconsistent.",
    "placement": "Wakeflow config contains a non-canonical placement.",
};
/** 配置内存模型失败的稳定、脱敏错误。 */
export class WakeflowConfigError extends Error {
    name = "WakeflowConfigError";
    code = "wakeflow-config";
    reason;
    path;
    constructor(reason, path) {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
        this.path = path;
    }
}
const CONTROL_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;
const WINDOWS_DRIVE_PATTERN = /^[A-Za-z]:/u;
function fail(reason, path) {
    throw new WakeflowConfigError(reason, path);
}
const validateWireConfig = createRuntimeJsonSchemaValidator(WAKEFLOW_CONFIG_SCHEMA);
/** 兄弟根放置至多一个前导 `..`：hook 观察脚本按"祖先或祖先的直接子目录"找回工作区（§13.97 D2e）。 */
const SIBLING_PLACEMENT_MAXIMUM_PARENT_SEGMENTS = 1;
function parsePlacement(value, path, maximumParentSegments = Number.POSITIVE_INFINITY) {
    if (!value.isWellFormed()
        || value.normalize("NFC") !== value
        || CONTROL_PATTERN.test(value)
        || value.includes("\\")
        || WINDOWS_DRIVE_PATTERN.test(value)) {
        fail("placement", path);
    }
    const segments = value.split("/");
    let parentSegments = 0;
    while (segments[parentSegments] === "..")
        parentSegments += 1;
    if (parentSegments > maximumParentSegments)
        fail("placement", path);
    if (parentSegments === segments.length
        || segments.slice(parentSegments).some((segment) => segment.length === 0
            || segment === "."
            || segment === ".."
            || segment.trim() !== segment)) {
        fail("placement", path);
    }
    return value;
}
/** 将单个相对位置值准入为 Config 使用的规范 placement；不检查物理存在性。 */
export function parseWakeflowConfigPlacement(value, path = "$placement") {
    if (typeof value !== "string")
        fail("placement", path);
    return parsePlacement(value, path);
}
function parseIdentity(value, kind, path) {
    try {
        return parseWakeflowDurableIdOfKind(value, kind, path);
    }
    catch (error) {
        if (error instanceof WakeflowDurableIdError)
            fail("identifier", path);
        throw error;
    }
}
function registerIdentity(value, kind, path, uuids) {
    parseIdentity(value, kind, path);
    let uuid;
    try {
        uuid = parseWakeflowDurableId(value, path).uuid;
    }
    catch (error) {
        if (error instanceof WakeflowDurableIdError)
            fail("identifier", path);
        throw error;
    }
    if (uuids.has(uuid))
        fail("identifier-collision", path);
    uuids.add(uuid);
}
function validatePlacements(model) {
    parsePlacement(model.storage.ledgerRoot, "$/storage/ledgerRoot");
    for (const [index, repository] of model.topology.repositories.entries()) {
        parsePlacement(repository.path, `$/topology/repositories/${index}/path`, SIBLING_PLACEMENT_MAXIMUM_PARENT_SEGMENTS);
        for (const [residueIndex, residue] of (repository.validation?.residueExceptions ?? []).entries()) {
            parsePlacement(residue.path, `$/topology/repositories/${index}/validation/residueExceptions/${residueIndex}/path`, 0);
        }
    }
    for (const [index, surface] of model.topology.supportSurfaces.entries()) {
        parsePlacement(surface.path, `$/topology/supportSurfaces/${index}/path`, SIBLING_PLACEMENT_MAXIMUM_PARENT_SEGMENTS);
    }
}
function validateResidueUniqueness(model) {
    for (const [repositoryIndex, repository] of model.topology.repositories.entries()) {
        const seen = new Set();
        for (const [residueIndex, residue] of (repository.validation?.residueExceptions ?? []).entries()) {
            if (seen.has(residue.path)) {
                fail("topology", `$/topology/repositories/${repositoryIndex}/validation/residueExceptions/${residueIndex}/path`);
            }
            seen.add(residue.path);
        }
    }
}
function validateTopology(model) {
    const uuids = new Set();
    registerIdentity(model.program.programId, "program", "$/program/programId", uuids);
    const repositories = new Map();
    for (const [index, repository] of model.topology.repositories.entries()) {
        const at = `$/topology/repositories/${index}/repositoryId`;
        registerIdentity(repository.repositoryId, "repository", at, uuids);
        repositories.set(repository.repositoryId, repository);
    }
    const surfaces = new Map();
    for (const [index, surface] of model.topology.supportSurfaces.entries()) {
        const at = `$/topology/supportSurfaces/${index}/surfaceId`;
        registerIdentity(surface.surfaceId, "surface", at, uuids);
        surfaces.set(surface.surfaceId, surface);
    }
    const pods = validatePodRecords(model, uuids);
    for (const [index, window] of model.topology.windows.entries()) {
        registerIdentity(window.windowId, "window", `$/topology/windows/${index}/windowId`, uuids);
        const podAt = `$/topology/windows/${index}/podId`;
        if (!pods.has(parseIdentity(window.podId, "pod", podAt)))
            fail("reference", podAt);
        if (window.role === "design" || window.role === "test") {
            const at = `$/topology/windows/${index}/root/surfaceId`;
            const ref = parseIdentity(window.root.surfaceId, "surface", at);
            const surface = surfaces.get(ref);
            if (surface === undefined)
                fail("reference", at);
            if (surface.capability !== window.role)
                fail("topology", at);
        }
        else if (window.role === "product") {
            const at = `$/topology/windows/${index}/root/repositoryId`;
            const ref = parseIdentity(window.root.repositoryId, "repository", at);
            if (!repositories.has(ref))
                fail("reference", at);
        }
    }
    validatePodScopes(model, repositories);
    validateResidueUniqueness(model);
}
const POD_SINGLETON_ROLES = Object.freeze(["controller", "design", "test"]);
/** pod 记录本身：标识、名称唯一、恰好一个 primary、primary 不带 worktree 与 closing。 */
function validatePodRecords(model, uuids) {
    const pods = new Set();
    const names = new Set();
    let primaryCount = 0;
    for (const [index, pod] of model.pods.entries()) {
        const at = `$/pods/${index}`;
        registerIdentity(pod.podId, "pod", `${at}/podId`, uuids);
        pods.add(pod.podId);
        if (names.has(pod.name))
            fail("identifier-collision", `${at}/name`);
        names.add(pod.name);
        if ((pod.closing === null) !== (pod.lifecycle === "open"))
            fail("topology", `${at}/closing`);
        if (pod.placement === "primary") {
            primaryCount += 1;
            if (pod.lifecycle !== "open")
                fail("topology", `${at}/lifecycle`);
            if (pod.worktrees.length > 0)
                fail("topology", `${at}/worktrees`);
        }
    }
    if (primaryCount !== 1)
        fail("topology", "$/pods");
    return pods;
}
function podWindowCensus(model) {
    const census = new Map();
    for (const pod of model.pods) {
        census.set(pod.podId, {
            roles: new Map(),
            productByRepository: new Map(),
            productWindowIds: new Map(),
        });
    }
    for (const window of model.topology.windows) {
        const entry = census.get(window.podId);
        if (entry === undefined)
            continue;
        entry.roles.set(window.role, (entry.roles.get(window.role) ?? 0) + 1);
        if (window.role !== "product")
            continue;
        const members = entry.productByRepository.get(window.root.repositoryId) ?? [];
        members.push(window);
        entry.productByRepository.set(window.root.repositoryId, members);
        entry.productWindowIds.set(window.windowId, window);
    }
    return census;
}
/** worktree pod 的每条 worktree 意图指向本 pod 内该仓库唯一的产品窗口，且每个产品窗口恰好一条。 */
function validatePodWorktrees(pod, index, entry, repositories) {
    const seen = new Set();
    for (const [worktreeIndex, worktree] of pod.worktrees.entries()) {
        const at = `$/pods/${index}/worktrees/${worktreeIndex}`;
        if (!repositories.has(worktree.repositoryId))
            fail("reference", `${at}/repositoryId`);
        if (seen.has(worktree.repositoryId))
            fail("topology", `${at}/repositoryId`);
        seen.add(worktree.repositoryId);
        const window = entry.productWindowIds.get(worktree.windowId);
        if (window === undefined)
            fail("reference", `${at}/windowId`);
        if (window.root.repositoryId !== worktree.repositoryId)
            fail("topology", `${at}/windowId`);
    }
    if (pod.placement === "worktree" && seen.size !== entry.productWindowIds.size) {
        fail("topology", `$/pods/${index}/worktrees`);
    }
    if (pod.closing !== null) {
        const branches = new Set();
        for (const [branchIndex, branch] of pod.closing.branches.entries()) {
            const at = `$/pods/${index}/closing/branches/${branchIndex}/repositoryId`;
            if (!seen.has(branch.repositoryId) || branches.has(branch.repositoryId)) {
                fail("topology", at);
            }
            branches.add(branch.repositoryId);
        }
    }
}
/** 每个 pod：controller、design、test 各恰好一个；primary 每仓库至少一个 product，worktree 每仓库恰好一个。 */
function validatePodScopes(model, repositories) {
    const census = podWindowCensus(model);
    const repositoryIds = new Set(repositories.keys());
    for (const [index, pod] of model.pods.entries()) {
        const entry = census.get(pod.podId);
        if (entry === undefined)
            fail("topology", `$/pods/${index}/podId`);
        for (const role of POD_SINGLETON_ROLES) {
            if ((entry.roles.get(role) ?? 0) !== 1)
                fail("topology", `$/pods/${index}/podId`);
        }
        for (const repositoryId of repositoryIds) {
            const count = entry.productByRepository.get(repositoryId)?.length ?? 0;
            const valid = pod.placement === "primary" ? count >= 1 : count === 1;
            if (!valid)
                fail("topology", `$/pods/${index}/podId`);
        }
        validatePodWorktrees(pod, index, entry, repositoryIds);
    }
}
/** 把任意内存值解析为严格、递归冻结的公开配置领域模型。 */
export function parseWakeflowConfig(value) {
    let json;
    try {
        json = parseJsonValue(value, "$config");
    }
    catch (error) {
        if (error instanceof JsonValueError)
            fail("json-value", error.path);
        throw error;
    }
    const result = validateWireConfig(json);
    if (!result.ok)
        fail("schema", result.path);
    validatePlacements(result.value);
    validateTopology(result.value);
    // Ajv、位置和类型化引用校验已经恢复 Schema 无法表达的领域类型品牌。
    return result.value;
}
/** 基于规范化 JSON 语义计算配置时效性摘要，不绑定空白或键顺序。 */
export function computeWakeflowConfigDigest(model) {
    return computeCanonicalJsonSha256Digest(model);
}
function frozenRecord(entries) {
    return Object.freeze(Object.fromEntries(entries));
}
/** 为已验证模型建立冻结的常用实体索引；索引不会反向成为配置权威事实。 */
export function buildWakeflowConfigIndexes(model) {
    const repositoryById = frozenRecord(model.topology.repositories.map((repository) => [
        repository.repositoryId,
        repository,
    ]));
    const surfaceById = frozenRecord(model.topology.supportSurfaces.map((surface) => [
        surface.surfaceId,
        surface,
    ]));
    const windowEntries = [];
    const podIdEntries = [];
    for (const window of model.topology.windows) {
        windowEntries.push([window.windowId, window]);
        podIdEntries.push([window.windowId, window.podId]);
    }
    const scopeEntries = model.pods.map((pod) => [pod.podId, buildPodScope(model, pod)]);
    const primary = scopeEntries.find(([, scope]) => scope.pod.placement === "primary");
    if (primary === undefined)
        fail("topology", "$/pods");
    const primaryPod = primary[1];
    return Object.freeze({
        repositoryById: repositoryById,
        surfaceById: surfaceById,
        windowById: frozenRecord(windowEntries),
        podById: frozenRecord(model.pods.map((pod) => [pod.podId, pod])),
        podIdByWindowId: frozenRecord(podIdEntries),
        podScopes: frozenRecord(scopeEntries),
        primaryPod,
        windowsByRepositoryId: primaryPod.windowsByRepositoryId,
        controllerWindow: primaryPod.controllerWindow,
        designWindow: primaryPod.designWindow,
        testWindow: primaryPod.testWindow,
        productWindows: primaryPod.productWindows,
    });
}
function buildPodScope(model, pod) {
    const windows = model.topology.windows.filter((window) => window.podId === pod.podId);
    const productWindows = [];
    const windowsByRepository = new Map(model.topology.repositories.map((repository) => [repository.repositoryId, []]));
    let controllerWindow;
    let designWindow;
    let testWindow;
    for (const window of windows) {
        if (window.role === "controller") {
            controllerWindow = window;
        }
        else if (window.role === "design") {
            designWindow = window;
        }
        else if (window.role === "test") {
            testWindow = window;
        }
        else {
            productWindows.push(window);
            const members = windowsByRepository.get(window.root.repositoryId);
            if (members === undefined)
                fail("topology", "$/topology/windows");
            members.push(window);
        }
    }
    if (controllerWindow === undefined
        || designWindow === undefined
        || testWindow === undefined) {
        fail("topology", "$/pods");
    }
    return Object.freeze({
        pod,
        windows: Object.freeze(windows),
        controllerWindow,
        designWindow,
        testWindow,
        productWindows: Object.freeze(productWindows),
        windowsByRepositoryId: frozenRecord(model.topology.repositories.map((repository) => [
            repository.repositoryId,
            Object.freeze(windowsByRepository.get(repository.repositoryId) ?? []),
        ])),
    });
}
