import { parseJsonValue } from "../foundation/data/json-value.js";
import { parsePortableResourcePath, } from "../foundation/filesystem/portable-resource-path.js";
import { readStableResourceDirectory, StableDirectoryReadError, } from "../foundation/filesystem/stable-directory-read.js";
import { readStableFile, StableFileReadError } from "../foundation/filesystem/stable-file-read.js";
import { parseByteCount } from "../foundation/numeric/byte-count.js";
import { decodeUtf8 } from "../foundation/text/utf8.js";
import { fail } from "./error.js";
import { hostHelperObservationsRootRef } from "./layout.js";
/** 助手一次观察的上限：16 个 pane 的两份清单加 git worktree 原文远小于它。 */
const OBSERVATION_FILE_MAXIMUM_BYTES = parseByteCount(256 * 1024, "$observationFile.maximumBytes");
/** 观察文件直接放在那个目录下，名字是助手起的：不认子目录，也不认别的扩展名。 */
const OBSERVATION_FILE_NAME_PATTERN = /^[0-9A-Za-z][0-9A-Za-z._-]{0,127}\.json$/u;
export function isHelperObservationFileReference(value) {
    return (typeof value === "object" &&
        value !== null &&
        typeof value.file === "string" &&
        typeof value.digest === "string");
}
/** 读回一份观察文件的 JSON 内容；`path` 是请求里那个引用成员的路径，拒绝时点名它。 */
export async function readHelperObservationFile(root, hostId, reference, path, signal) {
    const directory = `${hostHelperObservationsRootRef(hostId)}/`;
    if (!reference.file.startsWith(directory) ||
        !OBSERVATION_FILE_NAME_PATTERN.test(reference.file.slice(directory.length))) {
        fail("invalid-request", "observation-file-host", `${path}.file`);
    }
    let read;
    try {
        read = await readStableFile(root, parsePortableResourcePath(reference.file, `${path}.file`), {
            maximumBytes: OBSERVATION_FILE_MAXIMUM_BYTES,
            ...(signal === undefined ? {} : { signal }),
        });
    }
    catch (error) {
        if (error instanceof StableFileReadError) {
            if (error.reason === "aborted")
                fail("io-failure", "aborted", "$signal", { cause: error });
            fail("precondition-failed", `observation-file-${error.reason}`, `${path}.file`, {
                cause: error,
            });
        }
        throw error;
    }
    if (read.digest !== reference.digest) {
        fail("precondition-failed", "observation-file-digest", `${path}.digest`);
    }
    try {
        return parseJsonValue(JSON.parse(decodeUtf8(read.bytes, path)), path);
    }
    catch {
        fail("precondition-failed", "observation-file-content", `${path}.file`);
    }
}
const NUDGE_FILE_NAME_PATTERN = /^[0-9A-Za-z]{1,32}-nudge-[0-9a-f-]{36}\.json$/u;
const NUDGE_FILE_MAXIMUM_BYTES = parseByteCount(4 * 1024, "$nudgeFile.maximumBytes");
const NUDGE_DIRECTORY_MAXIMUM_ENTRIES = 4096;
const NUDGE_RECORDS_MAXIMUM = 256;
const NUDGE_DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const NUDGE_WINDOW_PATTERN = /^window_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
function nudgeRecordOf(value) {
    if (typeof value !== "object" || value === null || Array.isArray(value))
        return null;
    const record = value;
    const { windowId, textDigest, sentAt } = record;
    if (record.kind !== "WakeflowWindowNudge")
        return null;
    if (typeof windowId !== "string" || !NUDGE_WINDOW_PATTERN.test(windowId))
        return null;
    if (typeof textDigest !== "string" || !NUDGE_DIGEST_PATTERN.test(textDigest))
        return null;
    if (typeof sentAt !== "string" || Number.isNaN(Date.parse(sentAt)))
        return null;
    return Object.freeze({ windowId, textDigest, sentAt });
}
/** 目录里名字是续跑记录的文件，新的在前；目录不在或读不出即没有。 */
async function nudgeFileNames(root, directory, signal) {
    try {
        const listing = await readStableResourceDirectory(root, directory, {
            maximumEntries: NUDGE_DIRECTORY_MAXIMUM_ENTRIES,
            ...(signal === undefined ? {} : { signal }),
        });
        return listing.entries
            .filter((entry) => entry.node.kind === "file" && NUDGE_FILE_NAME_PATTERN.test(entry.name))
            .map((entry) => entry.name)
            .sort()
            .reverse()
            .slice(0, NUDGE_RECORDS_MAXIMUM);
    }
    catch (error) {
        if (!(error instanceof StableDirectoryReadError))
            throw error;
        if (error.reason === "aborted")
            fail("io-failure", "aborted", "$signal", { cause: error });
        return Object.freeze([]);
    }
}
/** 一个续跑记录文件；读不出、不是 JSON 或形状不对都当作没有这一条。 */
async function readNudgeRecord(root, file, signal) {
    try {
        const read = await readStableFile(root, file, {
            maximumBytes: NUDGE_FILE_MAXIMUM_BYTES,
            ...(signal === undefined ? {} : { signal }),
        });
        return nudgeRecordOf(JSON.parse(decodeUtf8(read.bytes, "$nudgeFile")));
    }
    catch (error) {
        if (error instanceof StableFileReadError && error.reason === "aborted") {
            fail("io-failure", "aborted", "$signal", { cause: error });
        }
        return null;
    }
}
/**
 * 本宿主的助手留下的续跑短句记录，新的在前、至多 256 条。它只用来归类目标会话里的 prompt：目录不在、
 * 某个文件读不出或形状不对都当作没有那一条——少认一条的后果是那条 prompt 被算成任务包之外来的，
 * 评审者看得见并且可以追问，不会漏报。中止照常上抛。
 */
export async function listHelperNudgeRecords(root, hostId, signal) {
    const directory = hostHelperObservationsRootRef(hostId);
    const records = [];
    for (const name of await nudgeFileNames(root, directory, signal)) {
        const record = await readNudgeRecord(root, parsePortableResourcePath(`${directory}/${name}`, "$nudgeFile"), signal);
        if (record !== null)
            records.push(record);
    }
    return Object.freeze(records);
}
