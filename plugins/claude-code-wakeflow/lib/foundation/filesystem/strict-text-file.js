import { decodeUtf8, Utf8Error, } from "../text/utf8.js";
import { readStableFile, } from "./stable-file-read.js";
const ERROR_MESSAGES = {
    "utf8": "Strict text file must contain valid fatal UTF-8.",
    "bom": "Strict text file cannot begin with a UTF-8 BOM.",
    "line-endings": "Strict text file must use LF-only line endings.",
    "final-newline": "Strict text file must end with exactly one LF.",
    "empty": "Strict text file must contain non-empty logical content.",
    "unicode-normalization": "Strict text file source must use Unicode NFC.",
};
/** 严格文本编码或固定文本形态失败时返回的稳定、脱敏错误。 */
export class StrictTextFileError extends Error {
    name = "StrictTextFileError";
    code = "wakeflow-strict-text-file";
    reason;
    path;
    constructor(reason, path) {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
        this.path = path;
    }
}
function fail(reason, path) {
    throw new StrictTextFileError(reason, path);
}
function decodeStrictUtf8(bytes) {
    try {
        return decodeUtf8(bytes, "$text");
    }
    catch (error) {
        if (error instanceof Utf8Error)
            fail("utf8", "$text");
        throw error;
    }
}
function assertStrictText(text) {
    if (text.length === 0)
        fail("empty", "$text");
    if (text.startsWith("\ufeff"))
        fail("bom", "$text");
    if (text.includes("\r"))
        fail("line-endings", "$text");
    if (!text.endsWith("\n") || text.endsWith("\n\n")) {
        fail("final-newline", "$text");
    }
    if (text.length === 1)
        fail("empty", "$text");
    if (text.normalize("NFC") !== text) {
        fail("unicode-normalization", "$text");
    }
}
/** 稳定读取并验证一种固定的 Wakeflow 文本格式。 */
export async function readStrictTextFile(root, resourcePath, options) {
    const stable = await readStableFile(root, resourcePath, options);
    const text = decodeStrictUtf8(stable.bytes);
    assertStrictText(text);
    return Object.freeze({
        resourcePath: stable.resourcePath,
        node: stable.node,
        byteCount: stable.byteCount,
        digest: stable.digest,
        text,
    });
}
