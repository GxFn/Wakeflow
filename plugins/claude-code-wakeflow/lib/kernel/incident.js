import { WAKEFLOW_INCIDENT_ID_PREFIX } from "../contracts/identity/wakeflow-typed-id-prefixes.js";
import { encodeCanonicalJson } from "../foundation/data/canonical-json.js";
import { parseJsonValue } from "../foundation/data/json-value.js";
import { createFileAtomically } from "../foundation/filesystem/durable-atomic-file-write.js";
import { materializeDirectoryPath } from "../foundation/filesystem/durable-directory-materialization.js";
import { unlinkRegularFileExactly } from "../foundation/filesystem/exact-regular-file-unlink.js";
import { parsePortableResourcePath } from "../foundation/filesystem/portable-resource-path.js";
import { readStableResourceDirectory } from "../foundation/filesystem/stable-directory-read.js";
import { readStableFile } from "../foundation/filesystem/stable-file-read.js";
import { createUuidV4 } from "../foundation/identity/uuid-v4.js";
import { readNodeSystemErrorCode } from "../foundation/node/node-system-error.js";
import { parseByteCount } from "../foundation/numeric/byte-count.js";
import { decodeUtf8 } from "../foundation/text/utf8.js";
import { isWakeflowError } from "./error.js";
import { WAKEFLOW_INCIDENTS_ROOT_REF, WAKEFLOW_LOCAL_RUNTIME_ROOT_REF } from "./layout.js";
/** 目录里最多保留的记录数；超出时按文件名（UTC 时间前缀）退役最旧的。 */
export const WAKEFLOW_INCIDENT_RETENTION = 50;
const CHAIN_MAXIMUM_DEPTH = 8;
const RECORD_MAXIMUM_BYTES = 64 * 1024;
const LISTING_MAXIMUM_ENTRIES = 1024;
const TOKEN_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/u;
const RESOURCE_PATTERN = /^[A-Za-z0-9_.:/-]{1,256}$/u;
const INCIDENT_ID_PATTERN = /^incident_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
export function createIncidentId(uuidFactory) {
    return `${WAKEFLOW_INCIDENT_ID_PREFIX}${createUuidV4(uuidFactory)}`;
}
export function isIncidentId(value) {
    return typeof value === "string" && INCIDENT_ID_PATTERN.test(value);
}
function ownToken(value, key) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    const text = descriptor !== undefined && Object.hasOwn(descriptor, "value") ? descriptor.value : undefined;
    return typeof text === "string" && TOKEN_PATTERN.test(text) ? text : undefined;
}
/** cause 链上每一层的结构事实：错误名、短记号形式的 code 与 reason、errno；消息与栈从不进入。 */
export function describeIncidentChain(error) {
    const chain = [];
    let current = error;
    while (chain.length < CHAIN_MAXIMUM_DEPTH && typeof current === "object" && current !== null) {
        const name = ownToken(current, "name") ?? (current instanceof Error ? current.name : "object");
        const code = ownToken(current, "code");
        const reason = ownToken(current, "reason");
        const errno = readNodeSystemErrorCode(current);
        chain.push(Object.freeze({
            name: TOKEN_PATTERN.test(name) ? name : "object",
            ...(code === undefined ? {} : { code }),
            ...(reason === undefined ? {} : { reason }),
            ...(errno === undefined ? {} : { errno }),
        }));
        try {
            current = current.cause;
        }
        catch {
            break;
        }
    }
    return Object.freeze(chain);
}
function compactTimestamp(recordedAt) {
    return recordedAt.replace(/[^0-9]/gu, "").slice(0, 17);
}
function buildRecord(input, recordedAt) {
    if (!isIncidentId(input.incidentId))
        throw new TypeError("incident id must be a typed incident id");
    const keys = (input.requestKeys ?? []).filter((key) => TOKEN_PATTERN.test(key)).slice(0, 32);
    return Object.freeze({
        kind: "WakeflowIncident",
        schemaVersion: 1,
        incidentId: input.incidentId,
        recordedAt,
        source: input.source,
        tool: input.tool !== undefined && TOKEN_PATTERN.test(input.tool) ? input.tool : null,
        hostId: input.hostId !== undefined && TOKEN_PATTERN.test(input.hostId) ? input.hostId : null,
        event: input.event !== undefined && TOKEN_PATTERN.test(input.event) ? input.event : null,
        resource: input.resource !== undefined && RESOURCE_PATTERN.test(input.resource) ? input.resource : null,
        error: isWakeflowError(input.error) ? input.error.toPublicDetails() : null,
        chain: describeIncidentChain(input.error),
        requestKeys: Object.freeze([...keys].sort()),
    });
}
async function pruneIncidents(root, signal) {
    const listing = await readStableResourceDirectory(root, WAKEFLOW_INCIDENTS_ROOT_REF, {
        maximumEntries: LISTING_MAXIMUM_ENTRIES,
        ...(signal === undefined ? {} : { signal }),
    });
    const records = listing.entries
        .filter((entry) => entry.node.kind === "file" && entry.name.endsWith(".json"))
        .sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
    const excess = records.length - WAKEFLOW_INCIDENT_RETENTION;
    for (const entry of records.slice(0, Math.max(0, excess))) {
        try {
            await unlinkRegularFileExactly(root, entry.resourcePath, {
                expectedNode: entry.node,
                durability: "none",
                ...(signal === undefined ? {} : { signal }),
            });
        }
        catch {
            // 退役旧记录是尽力而为；留下的会在下一次写入时再试。
        }
    }
}
/**
 * 写一条事故记录；返回是否写成。工作区还没有 `.wakeflow-local/runtime`（未初始化或不是工作区）时不写，
 * 任何失败都吞掉：事故记录从不让失败的调用失败得更厉害。
 */
export async function recordIncident(root, input, options = {}) {
    try {
        await root.inspectExistingResource(WAKEFLOW_LOCAL_RUNTIME_ROOT_REF, "$runtime");
        const recordedAt = (options.clock ?? (() => new Date()))().toISOString();
        const record = buildRecord(input, recordedAt);
        await materializeDirectoryPath(root, WAKEFLOW_INCIDENTS_ROOT_REF, {
            mode: 0o700,
            ...(options.signal === undefined ? {} : { signal: options.signal }),
        });
        const file = parsePortableResourcePath(`${WAKEFLOW_INCIDENTS_ROOT_REF}/${compactTimestamp(recordedAt)}-${record.incidentId}.json`, "$incident");
        await createFileAtomically(root, file, encodeCanonicalJson(record, "$incident"), {
            mode: 0o600,
            durability: "none",
            ...(options.signal === undefined ? {} : { signal: options.signal }),
        });
        await pruneIncidents(root, options.signal);
        return true;
    }
    catch {
        return false;
    }
}
function matches(record, filter) {
    if (typeof record !== "object" || record === null || Array.isArray(record))
        return false;
    const fields = record;
    if (fields.kind !== "WakeflowIncident" || fields.source !== filter.source)
        return false;
    return filter.hostId === undefined || fields.hostId === filter.hostId;
}
/** 数目录里匹配来源（与宿主）的记录；目录不存在或读不出一律 0，坏文件跳过。只读。 */
export async function countIncidents(root, filter, options = {}) {
    let entries;
    try {
        entries = (await readStableResourceDirectory(root, WAKEFLOW_INCIDENTS_ROOT_REF, {
            maximumEntries: LISTING_MAXIMUM_ENTRIES,
            ...(options.signal === undefined ? {} : { signal: options.signal }),
        })).entries;
    }
    catch {
        return 0;
    }
    let count = 0;
    for (const entry of entries) {
        if (entry.node.kind !== "file" || !entry.name.endsWith(".json"))
            continue;
        try {
            const read = await readStableFile(root, parsePortableResourcePath(entry.resourcePath), {
                maximumBytes: parseByteCount(RECORD_MAXIMUM_BYTES),
                ...(options.signal === undefined ? {} : { signal: options.signal }),
            });
            if (matches(parseJsonValue(JSON.parse(decodeUtf8(read.bytes, "$incident")), "$incident"), filter)) {
                count += 1;
            }
        }
        catch {
            // 坏记录不算数，也不让计数失败。
        }
    }
    return count;
}
