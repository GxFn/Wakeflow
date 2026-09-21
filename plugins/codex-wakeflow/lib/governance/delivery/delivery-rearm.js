import { parseWakeflowDurableIdOfKind, WakeflowDurableIdError, } from "../../contracts/identity/wakeflow-durable-id.js";
import { WAKEFLOW_DELIVERY_REARM_SCHEMA, } from "../../contracts/generated/governance/delivery/delivery-rearm.generated.js";
import { WAKEFLOW_SHA256_DIGEST_SCHEMA } from "../../contracts/generated/foundation/sha256-digest.generated.js";
import { WAKEFLOW_UTC_INSTANT_SCHEMA } from "../../contracts/generated/foundation/utc-instant.generated.js";
import { WAKEFLOW_TASK_PACKAGE_SCHEMA } from "../../contracts/generated/governance/tasking/task-package.generated.js";
import { WAKEFLOW_LEDGER_AUTHORITY_MEMBER_REFERENCE_SCHEMA } from "../../contracts/generated/governance/ledger/ledger-authority-member-reference.generated.js";
import { WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA } from "../../contracts/generated/foundation/portable-resource-path.generated.js";
import { computeCanonicalJsonSha256Digest } from "../../foundation/crypto/canonical-json-sha256.js";
import { parseSha256Digest, Sha256Error } from "../../foundation/crypto/sha256.js";
import { parseJsonValue, JsonValueError } from "../../foundation/data/json-value.js";
import { createRuntimeJsonSchemaValidator } from "../../foundation/schema/runtime-json-schema.js";
import { parseUtcInstant, UtcInstantError } from "../../foundation/time/utc-instant.js";
import { MAXIMUM_WORK_CLAIM_GENERATION } from "../../kernel/work-claims.js";
/**
 * Wakeflow Governance / Delivery：同一信封在 rejected-before-send 之后的新代际。
 *
 * rearm 不执行宿主效果、不改 prompt；它取得全新的工作声明与围栏，把投递放回
 * `delivery-prepared`。同一信封最多 `DELIVERY_REARM_LIMIT` 次（能力卡 6 Q4）。
 */
const REARM_KIND = "WakeflowDeliveryRearm";
const REARM_SCHEMA_VERSION = 1;
/** 同一信封允许的最多 rearm 次数；超过必须重新准备新信封。由内核的声明代际上限派生：代际 1 加三次 rearm。 */
export const DELIVERY_REARM_LIMIT = MAXIMUM_WORK_CLAIM_GENERATION - 1;
const ERROR_MESSAGES = {
    json: "Delivery Rearm is not passive JSON data.",
    schema: "Delivery Rearm does not satisfy its Schema.",
    identifier: "Delivery Rearm contains an invalid identity.",
    digest: "Delivery Rearm contains an invalid or inconsistent digest.",
    time: "Delivery Rearm contains an invalid time.",
    relation: "Delivery Rearm generations or fences are inconsistent.",
};
export class DeliveryRearmError extends Error {
    name = "DeliveryRearmError";
    code = "wakeflow-delivery-rearm";
    reason;
    path;
    constructor(reason, path) {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
        this.path = path;
    }
}
const validateWire = createRuntimeJsonSchemaValidator(WAKEFLOW_DELIVERY_REARM_SCHEMA, [
    WAKEFLOW_LEDGER_AUTHORITY_MEMBER_REFERENCE_SCHEMA,
    WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA,
    WAKEFLOW_SHA256_DIGEST_SCHEMA,
    WAKEFLOW_TASK_PACKAGE_SCHEMA,
    WAKEFLOW_UTC_INSTANT_SCHEMA,
]);
function fail(reason, path) {
    throw new DeliveryRearmError(reason, path);
}
function id(value, kind, path) {
    try {
        return parseWakeflowDurableIdOfKind(value, kind, path);
    }
    catch (error) {
        if (error instanceof WakeflowDurableIdError)
            fail("identifier", path);
        throw error;
    }
}
function digest(value, path) {
    try {
        return parseSha256Digest(value, path);
    }
    catch (error) {
        if (error instanceof Sha256Error)
            fail("digest", path);
        throw error;
    }
}
function rearmBasis(value) {
    return Object.freeze({
        kind: REARM_KIND,
        schemaVersion: REARM_SCHEMA_VERSION,
        deliveryId: value.deliveryId,
        previousGeneration: value.previousGeneration,
        generation: value.generation,
        previousFence: Object.freeze({
            claimId: value.previousFence.claimId,
            claimDigest: value.previousFence.claimDigest,
        }),
        rejectedOutcomeDigest: value.rejectedOutcomeDigest,
        fence: Object.freeze({
            claimId: value.fence.claimId,
            claimDigest: value.fence.claimDigest,
            expectedStreamRevision: value.fence.expectedStreamRevision,
        }),
        rearmedAt: value.rearmedAt,
    });
}
export function parseDeliveryRearm(value) {
    let json;
    try {
        json = parseJsonValue(value, "$rearm");
    }
    catch (error) {
        if (error instanceof JsonValueError)
            fail("json", error.path);
        throw error;
    }
    const validated = validateWire(json);
    if (!validated.ok)
        fail("schema", validated.path);
    const wire = validated.value;
    let rearmedAt;
    try {
        rearmedAt = parseUtcInstant(wire.rearmedAt, "$/rearmedAt");
    }
    catch (error) {
        if (error instanceof UtcInstantError)
            fail("time", "$/rearmedAt");
        throw error;
    }
    const basis = rearmBasis({
        kind: REARM_KIND,
        schemaVersion: REARM_SCHEMA_VERSION,
        deliveryId: id(wire.deliveryId, "target-delivery", "$/deliveryId"),
        previousGeneration: wire.previousGeneration,
        generation: wire.generation,
        previousFence: {
            claimId: id(wire.previousFence.claimId, "work-claim", "$/previousFence/claimId"),
            claimDigest: digest(wire.previousFence.claimDigest, "$/previousFence/claimDigest"),
        },
        rejectedOutcomeDigest: digest(wire.rejectedOutcomeDigest, "$/rejectedOutcomeDigest"),
        fence: {
            claimId: id(wire.fence.claimId, "work-claim", "$/fence/claimId"),
            claimDigest: digest(wire.fence.claimDigest, "$/fence/claimDigest"),
            expectedStreamRevision: wire.fence.expectedStreamRevision,
        },
        rearmedAt,
    });
    if (basis.generation !== basis.previousGeneration + 1 ||
        basis.generation > DELIVERY_REARM_LIMIT + 1 ||
        basis.fence.claimId === basis.previousFence.claimId) {
        fail("relation", "$/generation");
    }
    const rearmDigest = digest(wire.rearmDigest, "$/rearmDigest");
    if (computeCanonicalJsonSha256Digest(basis) !== rearmDigest)
        fail("digest", "$/rearmDigest");
    return Object.freeze({ ...basis, rearmDigest });
}
export function createDeliveryRearm(draft) {
    const basis = rearmBasis({ ...draft, kind: REARM_KIND, schemaVersion: REARM_SCHEMA_VERSION });
    return parseDeliveryRearm({ ...basis, rearmDigest: computeCanonicalJsonSha256Digest(basis) });
}
