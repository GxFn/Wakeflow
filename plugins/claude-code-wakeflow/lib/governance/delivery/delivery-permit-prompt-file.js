/**
 * Wakeflow Governance / Delivery：许可 prompt 的落盘文件（K6，§13.177）。
 *
 * 许可签发时 Wakeflow 把 prompt 原样写到 Demand 私有根下的可选工件目录
 * `artifacts/permits/<kind>/<id>.txt`（路径规则与清单形状在 demand-event-sourcing-paths 与
 * root-inventory 里），公共结果只回传工作区相对的 `promptRef` 与 `promptDigest`；宿主助手按引用
 * 读文件、自己核对摘要再粘贴，Agent 不再重打 prompt，也不用去读事件溯源文件。文件按 id 幂等：
 * 同字节不动，缺失创建，不同则替换；它随 Demand 根一起归档，不是第二份状态权威——权威仍是
 * 事件流里的信封与回调记录。
 */
import { createFileAtomically, DurableAtomicFileWriteError, replaceFileAtomically, } from "../../foundation/filesystem/durable-atomic-file-write.js";
import { DurableDirectoryMaterializationError, materializeDirectoryPath, } from "../../foundation/filesystem/durable-directory-materialization.js";
import { parsePortableResourcePath, } from "../../foundation/filesystem/portable-resource-path.js";
import { readStableFile, StableFileReadError, } from "../../foundation/filesystem/stable-file-read.js";
import { parseByteCount } from "../../foundation/numeric/byte-count.js";
import { encodeUtf8 } from "../../foundation/text/utf8.js";
import { fail } from "../../kernel/error.js";
import { DELIVERY_PROMPT_MAXIMUM_CHARACTERS } from "../../kernel/prompt-digest.js";
import { demandPermitPromptKindRootRef, demandPermitPromptRef, } from "../demand/event-sourcing/demand-event-sourcing-paths.js";
import { DEMAND_FILE_EVENT_STORE_DIRECTORY_MODE, DEMAND_FILE_EVENT_STORE_FILE_MODE, } from "../demand/event-sourcing/demand-file-event-store.js";
import { demandFinalRootRef } from "../demand/publication/demand-publication-paths.js";
/** prompt 以字符计数上限，UTF-8 最多四字节一字符。 */
const MAXIMUM_PERMIT_PROMPT_BYTES = parseByteCount(DELIVERY_PROMPT_MAXIMUM_CHARACTERS * 4, "$permit.maximumBytes");
/** 许可 prompt 文件相对工作区根的路径：公共结果里的 `promptRef`，宿主助手据此从工作区根读文件。 */
export function deliveryPermitPromptRef(demandId, kind, permitId) {
    return parsePortableResourcePath(`${demandFinalRootRef(demandId)}/${demandPermitPromptRef(kind, permitId)}`);
}
/** 把许可 prompt 原样写到 Demand 私有根下；同字节幂等，不同字节替换（重放与重臂都走这里）。 */
export async function materializeDeliveryPermitPrompt(demandRoot, kind, permitId, prompt, options = {}) {
    const ref = demandPermitPromptRef(kind, permitId);
    const signal = options.signal === undefined ? {} : { signal: options.signal };
    const bytes = encodeUtf8(prompt, "$permit.prompt");
    try {
        await materializeDirectoryPath(demandRoot, demandPermitPromptKindRootRef(kind), {
            mode: DEMAND_FILE_EVENT_STORE_DIRECTORY_MODE,
            ...signal,
        });
    }
    catch (error) {
        if (error instanceof DurableDirectoryMaterializationError) {
            fail("io-failure", `permit-directory-${error.reason}`, "$permit", { cause: error });
        }
        throw error;
    }
    const current = await readCurrentPermitPrompt(demandRoot, ref, signal);
    try {
        if (current === null) {
            await createFileAtomically(demandRoot, ref, bytes, {
                mode: DEMAND_FILE_EVENT_STORE_FILE_MODE,
                ...signal,
            });
            return "created";
        }
        if (sameBytes(current.bytes, bytes))
            return "unchanged";
        await replaceFileAtomically(demandRoot, ref, bytes, {
            mode: DEMAND_FILE_EVENT_STORE_FILE_MODE,
            expected: {
                resourcePath: current.resourcePath,
                node: current.node,
                byteCount: current.byteCount,
                digest: current.digest,
            },
            ...signal,
        });
        return "replaced";
    }
    catch (error) {
        if (error instanceof DurableAtomicFileWriteError) {
            fail("io-failure", `permit-write-${error.reason}`, "$permit", { cause: error });
        }
        throw error;
    }
}
async function readCurrentPermitPrompt(demandRoot, ref, signal) {
    try {
        return await readStableFile(demandRoot, ref, {
            maximumBytes: MAXIMUM_PERMIT_PROMPT_BYTES,
            ...signal,
        });
    }
    catch (error) {
        if (error instanceof StableFileReadError && error.reason === "not-found")
            return null;
        if (error instanceof StableFileReadError) {
            fail("io-failure", `permit-read-${error.reason}`, "$permit", { cause: error });
        }
        throw error;
    }
}
function sameBytes(left, right) {
    if (left.length !== right.length)
        return false;
    for (let index = 0; index < left.length; index += 1) {
        if (left[index] !== right[index])
            return false;
    }
    return true;
}
