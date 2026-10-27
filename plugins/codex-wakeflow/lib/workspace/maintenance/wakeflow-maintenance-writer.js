import { parseSha256Digest, Sha256Error, } from "../../foundation/crypto/sha256.js";
import { PassiveOwnDataError, parsePlainRecord } from "../../foundation/data/passive-own-data.js";
/** 写者戳准入失败的稳定、脱敏错误；消费者映射成自己的 `input`。 */
export class WakeflowMaintenanceWriterError extends Error {
    name = "WakeflowMaintenanceWriterError";
    code = "wakeflow-maintenance-writer";
    reason = "input";
    path;
    constructor(path) {
        super("Wakeflow maintenance writer stamp is invalid.");
        this.path = path;
    }
}
const VERSION_PATTERN = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z][0-9A-Za-z.-]*)?$/u;
const VERSION_MAXIMUM_LENGTH = 64;
/** `undefined` 与 `null` 都表示没有戳，返回 `null`；其余必须恰好是 `{version, manifestDigest}`。 */
export function parseWakeflowMaintenanceWriter(value, path = "$writer") {
    if (value === undefined || value === null)
        return null;
    let record;
    try {
        record = parsePlainRecord(value, path);
    }
    catch (error) {
        if (error instanceof PassiveOwnDataError)
            throw new WakeflowMaintenanceWriterError(path);
        throw error;
    }
    const keys = Object.keys(record).sort();
    if (keys.length !== 2 ||
        keys[0] !== "manifestDigest" ||
        keys[1] !== "version" ||
        typeof record.version !== "string" ||
        record.version.length > VERSION_MAXIMUM_LENGTH ||
        !VERSION_PATTERN.test(record.version)) {
        throw new WakeflowMaintenanceWriterError(path);
    }
    let manifestDigest;
    try {
        manifestDigest = parseSha256Digest(record.manifestDigest, `${path}.manifestDigest`);
    }
    catch (error) {
        if (error instanceof Sha256Error) {
            throw new WakeflowMaintenanceWriterError(`${path}.manifestDigest`);
        }
        throw error;
    }
    return Object.freeze({ version: record.version, manifestDigest });
}
