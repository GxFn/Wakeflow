import { parseDeterministicJsonDocument, } from "../data/deterministic-json-document.js";
import { readStrictTextFile, } from "./strict-text-file.js";
/** 稳定读取一个确定性 pretty JSON 文件。 */
export async function readDeterministicJsonFile(root, resourcePath, options) {
    const strict = await readStrictTextFile(root, resourcePath, options);
    const value = parseDeterministicJsonDocument(strict.text, "$document");
    return Object.freeze({
        resourcePath: strict.resourcePath,
        node: strict.node,
        byteCount: strict.byteCount,
        digest: strict.digest,
        text: strict.text,
        value,
    });
}
