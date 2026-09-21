import { types } from "node:util";
import { parsePlainRecord, PassiveOwnDataError, } from "../../foundation/data/passive-own-data.js";
const ERROR_MESSAGES = {
    input: "Wakeflow host maintenance capability input is invalid.",
    host: "Wakeflow host maintenance capability does not match the current host.",
    identity: "Wakeflow host maintenance capability identity is invalid.",
    contribution: "Wakeflow host maintenance contribution does not match its capability.",
};
/** 当前宿主 capability 准入失败的稳定、脱敏错误。 */
export class WakeflowHostMaintenanceCapabilityError extends Error {
    name = "WakeflowHostMaintenanceCapabilityError";
    code = "wakeflow-host-maintenance-capability";
    reason;
    path;
    constructor(reason, path) {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
        this.path = path;
    }
}
const CAPABILITY_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const MAXIMUM_CAPABILITY_ID_LENGTH = 256;
function fail(reason, path) {
    throw new WakeflowHostMaintenanceCapabilityError(reason, path);
}
/** 验证一次执行所提供的唯一 capability 与当前宿主精确对应。 */
export function assertWakeflowHostMaintenanceCapability(value, expectedHostId) {
    let record;
    try {
        record = parsePlainRecord(value, "$capability");
    }
    catch (error) {
        if (error instanceof PassiveOwnDataError)
            fail("input", error.path);
        throw error;
    }
    if (!Object.isFrozen(value)
        ||
            Object.keys(record).sort().join("\u0000")
                !== "capabilityId\u0000executeOperation\u0000hostId\u0000kind\u0000planContribution"
        || record.kind !== "WakeflowHostMaintenanceCapability"
        || record.hostId !== expectedHostId
        || typeof record.capabilityId !== "string"
        || record.capabilityId.length > MAXIMUM_CAPABILITY_ID_LENGTH
        || !record.capabilityId.isWellFormed()
        || !CAPABILITY_ID_PATTERN.test(record.capabilityId)
        || typeof record.planContribution !== "function"
        || types.isProxy(record.planContribution)
        || typeof record.executeOperation !== "function"
        || types.isProxy(record.executeOperation)) {
        fail(record.hostId === expectedHostId ? "identity" : "host", "$capability");
    }
}
/** 验证 contribution 确由当前 capability 的公开身份命名。 */
export function assertWakeflowHostMaintenanceContributionCapability(capability, contribution) {
    if (contribution.hostId !== capability.hostId
        || contribution.capabilityId !== capability.capabilityId) {
        fail("contribution", "$contribution");
    }
}
