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
import { truncateToCodePoints } from "../foundation/text/bounded-text.js";
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
/** 错误自己的位置记号：`$` 开头的结构路径（`$stage/after-sync`、`$/anchorEvidence/0`）。 */
const ERROR_PATH_PATTERN = /^\$[A-Za-z0-9_.:/[\]-]{0,127}$/u;
const MESSAGE_MAXIMUM_CODE_POINTS = 240;
const FRAMES_MAXIMUM = 12;
/** 引号里像标识符的内容留下（`reading 'steps'`）；别的——路径、文件片段、用户文本——换掉。 */
const QUOTED_IDENTIFIER_PATTERN = /^[A-Za-z_$][\w$.-]{0,63}$/u;
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
/**
 * 一段自由文本进记录之前的脱敏（open-items G1）：控制字符与换行压成空格；双引号与反引号之间的内容整段
 * 换成 `<text>`，单引号里的内容除非像一个标识符也换掉（Node 的系统错误把路径放在单引号里，JSON 解析错误
 * 把文件片段放在双引号里）；不带引号的
 * 绝对路径连同它后面直到下一个逗号、分号或引号的内容换成 `<path>`（路径里可以有空格）；`file://`、邮箱
 * 与不带类型前缀的 UUID（会话句柄是这种形状）各换成占位记号；最后截到 240 个码点。结果为空时是 null。
 */
export function redactIncidentText(text) {
    let cleaned = "";
    for (const character of text) {
        const codePoint = character.codePointAt(0) ?? 0;
        cleaned += codePoint < 0x20 || (codePoint >= 0x7f && codePoint <= 0x9f) ? " " : character;
    }
    const redacted = cleaned
        // 双引号与反引号里是别处来的内容，而且会嵌套（JSON 解析错误把带引号的文件片段再包一层引号）：
        // 从第一个到最后一个整段换掉。单引号逐对看，像标识符的留下。
        .replace(/".*"/su, '"<text>"')
        .replace(/`.*`/su, "`<text>`")
        .replace(/'([^']*)'/gu, (whole, inner) => QUOTED_IDENTIFIER_PATTERN.test(inner) ? whole : "'<text>'")
        .replace(/\bfile:\/\/\S+/giu, "<path>")
        .replace(/(?<![\w.<-])~?\/[^,;'"`]*/gu, "<path>")
        .replace(/[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+/gu, "<email>")
        .replace(/(?<![a-z]_)\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/giu, "<uuid>")
        .replace(/\s+/gu, " ")
        .trim();
    return redacted.length === 0 ? null : truncateToCodePoints(redacted, MESSAGE_MAXIMUM_CODE_POINTS);
}
function ownText(value, key) {
    try {
        const text = value[key];
        return typeof text === "string" ? text : undefined;
    }
    catch {
        return undefined;
    }
}
const FRAME_PATTERN = /^\s*at (?:(?:async )?(.+?) \()?(.+?):(\d+):(\d+)\)?$/u;
const FRAME_FUNCTION_PATTERN = /^[\w$.<>[\] -]{1,80}$/u;
const FRAME_LOCATION_PATTERN = /^[\w.@/:-]{1,160}$/u;
/** 栈帧的位置只留相对制品的部分：`lib/…`、`.build/…`、`node:` 内部模块；别的只留文件名。 */
function frameLocation(location) {
    const plain = location.replace(/^file:\/\//u, "");
    if (plain.startsWith("node:"))
        return plain;
    for (const marker of ["/lib/", "/.build/"]) {
        const at = plain.lastIndexOf(marker);
        if (at >= 0)
            return plain.slice(at + 1);
    }
    return plain.slice(plain.lastIndexOf("/") + 1);
}
/** 一段 V8 栈文本里读得出的前几帧：`函数名 位置:行:列`；读不出的行（含消息行）跳过。 */
export function describeIncidentFrames(stack) {
    const frames = [];
    for (const line of stack.split("\n")) {
        if (frames.length >= FRAMES_MAXIMUM)
            break;
        const match = FRAME_PATTERN.exec(line);
        if (match === null)
            continue;
        const location = frameLocation(match[2] ?? "");
        if (!FRAME_LOCATION_PATTERN.test(location))
            continue;
        const name = match[1] ?? "";
        frames.push(`${FRAME_FUNCTION_PATTERN.test(name) ? name : "<anonymous>"} ${location}:${match[3]}:${match[4]}`);
    }
    return Object.freeze(frames);
}
/** cause 链上最里层带栈的错误的栈帧。 */
function innermostFrames(error) {
    let frames = [];
    let current = error;
    for (let depth = 0; depth < CHAIN_MAXIMUM_DEPTH && typeof current === "object" && current !== null; depth += 1) {
        const stack = ownText(current, "stack");
        if (stack !== undefined) {
            const described = describeIncidentFrames(stack);
            if (described.length > 0)
                frames = described;
        }
        current = causeOf(current);
    }
    return frames;
}
/** 值不是 undefined 时才带上这个键：记录里没有空位。 */
function present(key, value) {
    return value === undefined || value === null ? {} : { [key]: value };
}
/** 链上一层的事实：错误名、短记号形式的 code 与 reason、errno、错误自己说出的位置，以及脱敏后的消息。 */
function describeLink(current) {
    const name = ownToken(current, "name") ?? (current instanceof Error ? current.name : "object");
    const path = ownText(current, "path");
    return Object.freeze({
        name: TOKEN_PATTERN.test(name) ? name : "object",
        ...present("code", ownToken(current, "code")),
        ...present("reason", ownToken(current, "reason")),
        ...present("errno", readNodeSystemErrorCode(current)),
        ...present("path", path !== undefined && ERROR_PATH_PATTERN.test(path) ? path : undefined),
        ...present("message", redactIncidentText(ownText(current, "message") ?? "")),
    });
}
/** 下一层 cause；读不出（getter 抛错）时到此为止。 */
function causeOf(current) {
    try {
        return current.cause;
    }
    catch {
        return undefined;
    }
}
/** cause 链上每一层的事实（至多八层）；原始消息与栈从不进入。 */
export function describeIncidentChain(error) {
    const chain = [];
    let current = error;
    while (chain.length < CHAIN_MAXIMUM_DEPTH && typeof current === "object" && current !== null) {
        chain.push(describeLink(current));
        current = causeOf(current);
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
    const frames = innermostFrames(input.error);
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
        ...(frames.length === 0 ? {} : { frames }),
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
const RECORDED_AT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
/** 匹配来源、宿主与时间下限的记录的时间；不匹配为 null。同一写法的 UTC 时间按字典序即时间序。 */
function matchedRecordedAt(record, filter) {
    if (typeof record !== "object" || record === null || Array.isArray(record))
        return null;
    const fields = record;
    if (fields.kind !== "WakeflowIncident" || fields.source !== filter.source)
        return null;
    if (filter.hostId !== undefined && fields.hostId !== filter.hostId)
        return null;
    const recordedAt = fields.recordedAt;
    if (typeof recordedAt !== "string" || !RECORDED_AT_PATTERN.test(recordedAt))
        return null;
    return filter.since !== undefined && recordedAt < filter.since ? null : recordedAt;
}
/**
 * 数目录里匹配来源、宿主与时间下限的记录，并给出其中最近一条的时间（open-items G8：一条旧事故不该永远挂在
 * 门上，按时间淡出；还在计数里的要说出最近一次是什么时候）。目录不存在或读不出一律是零条，坏文件跳过。只读。
 */
export async function summarizeIncidents(root, filter, options = {}) {
    let entries;
    try {
        entries = (await readStableResourceDirectory(root, WAKEFLOW_INCIDENTS_ROOT_REF, {
            maximumEntries: LISTING_MAXIMUM_ENTRIES,
            ...(options.signal === undefined ? {} : { signal: options.signal }),
        })).entries;
    }
    catch {
        return Object.freeze({ count: 0, latestRecordedAt: null });
    }
    let count = 0;
    let latestRecordedAt = null;
    for (const entry of entries) {
        if (entry.node.kind !== "file" || !entry.name.endsWith(".json"))
            continue;
        try {
            const read = await readStableFile(root, parsePortableResourcePath(entry.resourcePath), {
                maximumBytes: parseByteCount(RECORD_MAXIMUM_BYTES),
                ...(options.signal === undefined ? {} : { signal: options.signal }),
            });
            const recordedAt = matchedRecordedAt(parseJsonValue(JSON.parse(decodeUtf8(read.bytes, "$incident")), "$incident"), filter);
            if (recordedAt === null)
                continue;
            count += 1;
            if (latestRecordedAt === null || recordedAt > latestRecordedAt)
                latestRecordedAt = recordedAt;
        }
        catch {
            // 坏记录不算数，也不让计数失败。
        }
    }
    return Object.freeze({ count, latestRecordedAt });
}
