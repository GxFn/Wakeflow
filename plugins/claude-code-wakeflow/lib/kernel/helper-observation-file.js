import { parseJsonValue } from "../foundation/data/json-value.js";
import { parsePortableResourcePath } from "../foundation/filesystem/portable-resource-path.js";
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
