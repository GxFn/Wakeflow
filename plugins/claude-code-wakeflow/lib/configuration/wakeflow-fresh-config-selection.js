import { types } from "node:util";
import { computeCanonicalJsonSha256Digest, } from "../foundation/crypto/canonical-json-sha256.js";
import { JsonValueError, parseJsonValue, } from "../foundation/data/json-value.js";
import { parseDenseArray, parsePlainRecord, PassiveOwnDataError, } from "../foundation/data/passive-own-data.js";
import { createWakeflowDurableId, } from "../contracts/identity/wakeflow-durable-id.js";
import { createUuidV4, deriveUuidV4, UuidV4Error, } from "../foundation/identity/uuid-v4.js";
import { computeWakeflowConfigDigest, parseWakeflowConfig, WAKEFLOW_CONFIG_KIND, WAKEFLOW_CONFIG_SCHEMA_ID, WAKEFLOW_CONFIG_SCHEMA_VERSION, WAKEFLOW_DEFAULT_PRESENTATION_LANGUAGE, WakeflowConfigError, } from "./wakeflow-config.js";
/**
 * Wakeflow Configuration：Fresh用户选择到typed Config的纯编译边界。
 *
 * Repository、Support Surface与Window使用仅在本请求内有效的selectionKey；编译器一次
 * 分配全部durable IDs并解析逻辑根引用。selectionKey不会进入Config。未注入uuidFactory时，
 * ID由整个选择的canonical digest加kind与selectionKey派生，因此选择的任何变化（含显示
 * 文本和路径）都会得到新ID；省略presentation.language时显式持久化默认`en`。
 */
const WAKEFLOW_FRESH_SELECTION_KEY_PATTERN = /^[a-z][a-z0-9-]{0,63}$/u;
const WAKEFLOW_FRESH_SELECTION_MAXIMUM_ENTITIES = 256;
const ERROR_MESSAGES = {
    input: "Wakeflow Fresh Config selection input is invalid.",
    shape: "Wakeflow Fresh Config selection has an invalid shape.",
    capacity: "Wakeflow Fresh Config selection exceeds its entity capacity.",
    "selection-key": "Wakeflow Fresh Config selection key is invalid or duplicated.",
    reference: "Wakeflow Fresh Config selection contains an unresolved logical reference.",
    "id-source": "Wakeflow Fresh Config durable identity source failed.",
    "id-collision": "Wakeflow Fresh Config generated duplicate UUID identities.",
    config: "Wakeflow Fresh Config selection does not form a valid Config model.",
};
/** Fresh Config selection 编译失败的稳定、脱敏错误。 */
export class WakeflowFreshConfigSelectionError extends Error {
    name = "WakeflowFreshConfigSelectionError";
    code = "wakeflow-fresh-config-selection";
    reason;
    path;
    constructor(reason, path) {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
        this.path = path;
    }
}
const TOP_LEVEL_FIELDS = Object.freeze([
    "governance",
    "hosts",
    "presentation",
    "program",
    "storage",
    "topology",
]);
function fail(reason, path) {
    throw new WakeflowFreshConfigSelectionError(reason, path);
}
function record(value, path) {
    try {
        return parsePlainRecord(value, path);
    }
    catch (error) {
        if (error instanceof PassiveOwnDataError)
            fail("input", error.path);
        throw error;
    }
}
function snapshotSelection(value) {
    try {
        return parseJsonValue(value, "$selection");
    }
    catch (error) {
        if (error instanceof JsonValueError)
            fail("input", error.path);
        throw error;
    }
}
function array(value, path) {
    try {
        return parseDenseArray(value, WAKEFLOW_FRESH_SELECTION_MAXIMUM_ENTITIES, path);
    }
    catch (error) {
        if (error instanceof PassiveOwnDataError) {
            if (error.reason === "array-length")
                fail("capacity", path);
            fail("input", error.path);
        }
        throw error;
    }
}
function assertFields(value, required, optional, path) {
    const allowed = new Set([...required, ...optional]);
    if (required.some((key) => !Object.hasOwn(value, key))
        || Object.keys(value).some((key) => !allowed.has(key))) {
        fail("shape", path);
    }
}
function parseOptions(value) {
    const parsed = record(value, "$options");
    if (Object.keys(parsed).some((key) => key !== "uuidFactory")
        || (parsed.uuidFactory !== undefined
            && (typeof parsed.uuidFactory !== "function"
                || types.isProxy(parsed.uuidFactory)))) {
        fail("input", "$options");
    }
    return Object.freeze({
        uuidFactory: parsed.uuidFactory,
    });
}
function selectionKey(value, path, seen) {
    if (typeof value !== "string"
        || !WAKEFLOW_FRESH_SELECTION_KEY_PATTERN.test(value)
        || seen.has(value)) {
        fail("selection-key", path);
    }
    seen.add(value);
    return value;
}
function optionalProperty(source, key) {
    return source[key] === undefined ? {} : { [key]: source[key] };
}
const FRESH_SELECTION_ID_NAMESPACE = "wakeflow-fresh-config-selection";
/** 初始化生成的 primary pod 名称；worktree pod 不得复用（配置 codec 保证名称唯一）。 */
export const WAKEFLOW_PRIMARY_POD_NAME = "main";
/**
 * 分配 typed ID。没有注入 factory 时，ID 由 selection 的规范摘要、种类与 selection key
 * 确定性派生：同一 selection 在 preview 与 apply 重算出同一 Config，摘要才可能相符。
 */
function allocateId(kind, options, seenUuid, seed, key) {
    let uuid;
    try {
        uuid = options.uuidFactory === undefined
            ? deriveUuidV4(FRESH_SELECTION_ID_NAMESPACE, seed, kind, key)
            : createUuidV4(options.uuidFactory);
    }
    catch (error) {
        if (error instanceof UuidV4Error)
            fail("id-source", "$options.uuidFactory");
        throw error;
    }
    if (seenUuid.has(uuid))
        fail("id-collision", "$options.uuidFactory");
    seenUuid.add(uuid);
    return createWakeflowDurableId(kind, uuid);
}
function sortedAllocations(values) {
    return Object.freeze([...values].sort((left, right) => (left.selectionKey < right.selectionKey
        ? -1
        : left.selectionKey > right.selectionKey
            ? 1
            : 0)));
}
/** 把闭合Fresh selection编译为完整typed Config和可审查ID allocation。 */
export function compileWakeflowFreshConfigSelection(selectionValue, optionsValue = {}) {
    const options = parseOptions(optionsValue);
    const selection = record(snapshotSelection(selectionValue), "$selection");
    if (Object.keys(selection).sort().join("\u0000")
        !== TOP_LEVEL_FIELDS.join("\u0000")) {
        fail("shape", "$selection");
    }
    const program = record(selection.program, "$/program");
    assertFields(program, ["displayName"], ["description"], "$/program");
    const presentation = record(selection.presentation, "$/presentation");
    assertFields(presentation, [], ["language"], "$/presentation");
    const topology = record(selection.topology, "$/topology");
    assertFields(topology, ["repositories", "supportSurfaces", "windows"], [], "$/topology");
    const storage = record(selection.storage, "$/storage");
    const governance = record(selection.governance, "$/governance");
    const hosts = record(selection.hosts, "$/hosts");
    const repositoryValues = array(topology.repositories, "$/topology/repositories");
    const surfaceValues = array(topology.supportSurfaces, "$/topology/supportSurfaces");
    const windowValues = array(topology.windows, "$/topology/windows");
    if (repositoryValues.length + surfaceValues.length + windowValues.length
        > WAKEFLOW_FRESH_SELECTION_MAXIMUM_ENTITIES) {
        fail("capacity", "$/topology");
    }
    const seenKeys = new Set();
    const repositorySelections = repositoryValues.map((entry, index) => {
        const path = `$/topology/repositories/${index}`;
        const value = record(entry, path);
        assertFields(value, ["selectionKey", "path", "displayName", "instructionManagement"], ["description"], path);
        return Object.freeze({
            key: selectionKey(value.selectionKey, `${path}/selectionKey`, seenKeys),
            value,
        });
    });
    const surfaceSelections = surfaceValues.map((entry, index) => {
        const path = `$/topology/supportSurfaces/${index}`;
        const value = record(entry, path);
        assertFields(value, ["selectionKey", "capability", "path", "displayName", "ownership"], ["description", "instructionManagement"], path);
        return Object.freeze({
            key: selectionKey(value.selectionKey, `${path}/selectionKey`, seenKeys),
            value,
        });
    });
    const windowSelections = windowValues.map((entry, index) => {
        const path = `$/topology/windows/${index}`;
        const value = record(entry, path);
        assertFields(value, ["selectionKey", "role", "displayName", "root"], ["description"], path);
        const key = selectionKey(value.selectionKey, `${path}/selectionKey`, seenKeys);
        const root = record(value.root, `${path}/root`);
        if (root.kind === "program") {
            assertFields(root, ["kind"], [], `${path}/root`);
        }
        else {
            assertFields(root, ["kind", "selectionKey"], [], `${path}/root`);
            if ((root.kind !== "repository" && root.kind !== "support-surface")
                || typeof root.selectionKey !== "string"
                || !WAKEFLOW_FRESH_SELECTION_KEY_PATTERN.test(root.selectionKey)) {
                fail("reference", `${path}/root`);
            }
        }
        return Object.freeze({ key, path, root, value });
    });
    const repositoryKeys = new Set(repositorySelections.map((entry) => entry.key));
    const surfaceKeys = new Set(surfaceSelections.map((entry) => entry.key));
    for (const selectionEntry of windowSelections) {
        if (selectionEntry.root.kind === "program")
            continue;
        const reference = selectionEntry.root.selectionKey;
        const found = selectionEntry.root.kind === "repository"
            ? repositoryKeys.has(reference)
            : surfaceKeys.has(reference);
        if (!found)
            fail("reference", `${selectionEntry.path}/root/selectionKey`);
    }
    const seenUuid = new Set();
    const seed = computeCanonicalJsonSha256Digest(selection);
    const programId = allocateId("program", options, seenUuid, seed, "program");
    const repositoryByKey = new Map();
    const repositoryAllocations = [];
    const repositories = repositorySelections.map(({ key, value }) => {
        const repositoryId = allocateId("repository", options, seenUuid, seed, key);
        repositoryByKey.set(key, repositoryId);
        repositoryAllocations.push(Object.freeze({
            selectionKey: key,
            id: repositoryId,
        }));
        return {
            repositoryId,
            path: value.path,
            displayName: value.displayName,
            ...optionalProperty(value, "description"),
            instructionManagement: value.instructionManagement,
        };
    });
    const surfaceByKey = new Map();
    const surfaceAllocations = [];
    const supportSurfaces = surfaceSelections.map(({ key, value }) => {
        const surfaceId = allocateId("surface", options, seenUuid, seed, key);
        surfaceByKey.set(key, surfaceId);
        surfaceAllocations.push(Object.freeze({ selectionKey: key, id: surfaceId }));
        return {
            surfaceId,
            capability: value.capability,
            path: value.path,
            displayName: value.displayName,
            ...optionalProperty(value, "description"),
            ownership: value.ownership,
            ...optionalProperty(value, "instructionManagement"),
        };
    });
    const windowAllocations = [];
    const windowDrafts = windowSelections.map(({ key, path, root, value }) => {
        const windowId = allocateId("window", options, seenUuid, seed, key);
        windowAllocations.push(Object.freeze({ selectionKey: key, id: windowId }));
        let resolvedRoot;
        if (root.kind === "program") {
            resolvedRoot = Object.freeze({ kind: "program" });
        }
        else {
            if (root.kind === "repository") {
                const repositoryId = repositoryByKey.get(root.selectionKey);
                if (repositoryId === undefined)
                    fail("reference", `${path}/root`);
                resolvedRoot = Object.freeze({ kind: "repository", repositoryId });
            }
            else {
                const surfaceId = surfaceByKey.get(root.selectionKey);
                if (surfaceId === undefined)
                    fail("reference", `${path}/root`);
                resolvedRoot = Object.freeze({ kind: "support-surface", surfaceId });
            }
        }
        return {
            windowId,
            role: value.role,
            displayName: value.displayName,
            ...optionalProperty(value, "description"),
            root: resolvedRoot,
        };
    });
    const mainPodId = allocateId("pod", options, seenUuid, seed, WAKEFLOW_PRIMARY_POD_NAME);
    const windows = windowDrafts.map(({ windowId, role, displayName, root, ...rest }) => ({
        windowId,
        podId: mainPodId,
        role,
        displayName,
        ...rest,
        root,
    }));
    const pods = [
        {
            podId: mainPodId,
            name: WAKEFLOW_PRIMARY_POD_NAME,
            placement: "primary",
            lifecycle: "open",
            worktrees: [],
            closing: null,
        },
    ];
    const normalizedSelection = Object.freeze({
        program,
        presentation: Object.freeze({
            language: presentation.language ?? WAKEFLOW_DEFAULT_PRESENTATION_LANGUAGE,
        }),
        topology: Object.freeze({
            repositories: repositoryValues,
            supportSurfaces: surfaceValues,
            windows: windowValues,
        }),
        storage,
        governance,
        hosts,
    });
    let config;
    try {
        config = parseWakeflowConfig({
            $schema: WAKEFLOW_CONFIG_SCHEMA_ID,
            kind: WAKEFLOW_CONFIG_KIND,
            schemaVersion: WAKEFLOW_CONFIG_SCHEMA_VERSION,
            program: {
                programId,
                displayName: program.displayName,
                ...optionalProperty(program, "description"),
            },
            presentation: normalizedSelection.presentation,
            topology: { repositories, supportSurfaces, windows },
            pods,
            storage,
            governance,
            hosts,
        });
    }
    catch (error) {
        if (error instanceof WakeflowConfigError)
            fail("config", error.path);
        throw error;
    }
    return Object.freeze({
        selectionDigest: computeCanonicalJsonSha256Digest(normalizedSelection),
        config,
        configDigest: computeWakeflowConfigDigest(config),
        allocations: Object.freeze({
            programId,
            repositories: sortedAllocations(repositoryAllocations),
            supportSurfaces: sortedAllocations(surfaceAllocations),
            windows: sortedAllocations(windowAllocations),
            pods: Object.freeze([
                Object.freeze({ selectionKey: WAKEFLOW_PRIMARY_POD_NAME, id: mainPodId }),
            ]),
        }),
    });
}
