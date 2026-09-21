import { WAKEFLOW_GIT_OBJECT_ID_SCHEMA } from "../../contracts/generated/foundation/git-object-id.generated.js";
import { JsonValueError, parseJsonValue } from "../data/json-value.js";
import { createRuntimeJsonSchemaValidator } from "../schema/runtime-json-schema.js";
const ERROR_MESSAGES = {
    input: "Git object ID is not passive JSON data.",
    schema: "Git object ID does not satisfy its complete object-format contract.",
};
export class GitObjectIdError extends Error {
    name = "GitObjectIdError";
    code = "wakeflow-git-object-id";
    reason;
    path;
    constructor(reason, path) {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
        this.path = path;
    }
}
const validateWire = createRuntimeJsonSchemaValidator(WAKEFLOW_GIT_OBJECT_ID_SCHEMA);
function fail(reason, path) {
    throw new GitObjectIdError(reason, path);
}
/** 严格解析一个带算法标签的完整Git object ID。 */
export function parseGitObjectId(value, path = "$gitObjectId") {
    let json;
    try {
        json = parseJsonValue(value, path);
    }
    catch (error) {
        if (error instanceof JsonValueError)
            fail("input", error.path);
        throw error;
    }
    const validated = validateWire(json);
    if (!validated.ok)
        fail("schema", validated.path);
    return Object.freeze({
        algorithm: validated.value.algorithm,
        value: validated.value.value,
    });
}
/** 比较两个已经重新准入的Git object ID。 */
export function sameGitObjectId(left, right) {
    const admittedLeft = parseGitObjectId(left, "$left");
    const admittedRight = parseGitObjectId(right, "$right");
    return (admittedLeft.algorithm === admittedRight.algorithm &&
        admittedLeft.value === admittedRight.value);
}
