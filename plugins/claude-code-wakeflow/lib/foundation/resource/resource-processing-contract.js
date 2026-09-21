import { parseDenseArray, parsePlainRecord, PassiveOwnDataError, } from "../data/passive-own-data.js";
/**
 * Wakeflow Foundation / Resource：资源处理角色与机械操作合同。
 *
 * 本模块只描述一个资源允许采用哪些操作方案及其恢复策略。
 * 它不登记路径、职责所有者、宿主、Config 或当前 Workspace，也不执行文件系统操作。
 * 上层 Workspace 资源目录负责把本合同与具体资源身份组合；领域职责所有者仍负责
 * 准入一次真实操作所需的权威事实、互斥锁、源资源预期和恢复证据。
 *
 * 目录容器不属于资源角色。它使用独立的判别联合分支，只声明安全的目录创建策略，
 * 不能因此取得后代资源的管理权。
 */
export const WAKEFLOW_RESOURCE_ROLES = Object.freeze([
    "external-reference",
    "immutable-fact",
    "mutable-snapshot",
    "derived-projection",
    "derived-checkpoint",
    "managed-integration-text",
    "manifested-tree",
    "transaction-artifact",
]);
export const WAKEFLOW_RESOURCE_MUTATION_RECIPES = Object.freeze([
    "no-write",
    "exclusive-create",
    "exact-source-replace",
    "deterministic-rewrite",
    "exact-source-recompose",
    "tree-publish-or-move",
    "exact-retire",
]);
export const WAKEFLOW_RESOURCE_RECOVERY_STRATEGIES = Object.freeze([
    "report-only",
    "exact-idempotent-retry",
    "owner-forward-recovery",
    "rebuild-from-authority",
    "recompose-owned-content",
    "manifest-closure",
    "owner-transaction-recovery",
]);
export const WAKEFLOW_DIRECTORY_CONTAINER_RECIPES = Object.freeze([
    "materialize-directory",
    "exact-directory-publish",
]);
const ERROR_MESSAGES = {
    input: "Wakeflow resource processing input is not passive data.",
    shape: "Wakeflow resource processing input has an invalid shape.",
    kind: "Wakeflow resource processing kind is invalid.",
    role: "Wakeflow resource processing role is invalid.",
    recipe: "Wakeflow resource mutation recipe is invalid.",
    recovery: "Wakeflow resource recovery strategy is invalid.",
    operation: "Wakeflow resource operation is not admitted by its contract.",
};
/** 资源处理合同准入失败的稳定、脱敏错误。 */
export class WakeflowResourceProcessingContractError extends Error {
    name = "WakeflowResourceProcessingContractError";
    code = "wakeflow-resource-processing-contract";
    reason;
    path;
    constructor(reason, path) {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
        this.path = path;
    }
}
const ROLE_POLICIES = Object.freeze({
    "external-reference": Object.freeze({
        recoveryStrategy: "report-only",
        allowedRecipes: Object.freeze(["no-write"]),
        requiredRecipes: Object.freeze(["no-write"]),
    }),
    "immutable-fact": Object.freeze({
        recoveryStrategy: "exact-idempotent-retry",
        allowedRecipes: Object.freeze(["exclusive-create"]),
        requiredRecipes: Object.freeze(["exclusive-create"]),
    }),
    "mutable-snapshot": Object.freeze({
        recoveryStrategy: "owner-forward-recovery",
        allowedRecipes: Object.freeze([
            "exclusive-create",
            "exact-source-replace",
        ]),
        requiredRecipes: Object.freeze(["exact-source-replace"]),
    }),
    "derived-projection": Object.freeze({
        recoveryStrategy: "rebuild-from-authority",
        allowedRecipes: Object.freeze([
            "exclusive-create",
            "deterministic-rewrite",
        ]),
        requiredRecipes: Object.freeze([]),
    }),
    "derived-checkpoint": Object.freeze({
        recoveryStrategy: "rebuild-from-authority",
        allowedRecipes: Object.freeze(["exclusive-create", "exact-retire"]),
        requiredRecipes: Object.freeze(["exclusive-create"]),
    }),
    "managed-integration-text": Object.freeze({
        recoveryStrategy: "recompose-owned-content",
        allowedRecipes: Object.freeze(["exact-source-recompose"]),
        requiredRecipes: Object.freeze(["exact-source-recompose"]),
    }),
    "manifested-tree": Object.freeze({
        recoveryStrategy: "manifest-closure",
        allowedRecipes: Object.freeze(["tree-publish-or-move"]),
        requiredRecipes: Object.freeze(["tree-publish-or-move"]),
    }),
    "transaction-artifact": Object.freeze({
        recoveryStrategy: "owner-transaction-recovery",
        allowedRecipes: Object.freeze([
            "exclusive-create",
            "exact-source-replace",
            "tree-publish-or-move",
            "exact-retire",
        ]),
        requiredRecipes: Object.freeze([]),
    }),
});
const ROLE_SET = new Set(WAKEFLOW_RESOURCE_ROLES);
const RECIPE_INDEX = new Map(WAKEFLOW_RESOURCE_MUTATION_RECIPES.map((recipe, index) => [recipe, index]));
const RESOURCE_FIELDS = new Set([
    "kind",
    "role",
    "allowedMutationRecipes",
    "recoveryStrategy",
]);
const DIRECTORY_CONTAINER_FIELDS = new Set([
    "kind",
    "materializationRecipe",
    "existingDirectoryPolicy",
    "collisionPolicy",
    "descendantAuthority",
    "recoveryStrategy",
]);
function fail(reason, path) {
    throw new WakeflowResourceProcessingContractError(reason, path);
}
function propertyPath(key) {
    return `$/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`;
}
function assertExactFields(record, allowed) {
    const unknown = Object.keys(record).sort().find((key) => !allowed.has(key));
    if (unknown !== undefined)
        fail("shape", propertyPath(unknown));
}
function plainRecord(value, path) {
    try {
        return parsePlainRecord(value, path);
    }
    catch (error) {
        if (error instanceof PassiveOwnDataError)
            fail("input", error.path);
        throw error;
    }
}
function denseArray(value, path) {
    try {
        return parseDenseArray(value, WAKEFLOW_RESOURCE_MUTATION_RECIPES.length, path);
    }
    catch (error) {
        if (error instanceof PassiveOwnDataError)
            fail("input", error.path);
        throw error;
    }
}
function resourceRole(value) {
    if (typeof value !== "string" || !ROLE_SET.has(value)) {
        fail("role", "$/role");
    }
    return value;
}
function resourceRecipes(value, role) {
    const values = denseArray(value, "$/allowedMutationRecipes");
    if (values.length === 0)
        fail("recipe", "$/allowedMutationRecipes");
    const policy = ROLE_POLICIES[role];
    const allowed = new Set(policy.allowedRecipes);
    const recipes = [];
    let previousIndex = -1;
    for (const [index, candidate] of values.entries()) {
        if (typeof candidate !== "string" || !allowed.has(candidate)) {
            fail("recipe", `$/allowedMutationRecipes/${index}`);
        }
        const order = RECIPE_INDEX.get(candidate);
        if (order === undefined || order <= previousIndex) {
            fail("recipe", `$/allowedMutationRecipes/${index}`);
        }
        previousIndex = order;
        recipes.push(candidate);
    }
    if (policy.requiredRecipes.some((recipe) => !recipes.includes(recipe))) {
        fail("recipe", "$/allowedMutationRecipes");
    }
    return Object.freeze(recipes);
}
function parseResource(record) {
    assertExactFields(record, RESOURCE_FIELDS);
    const role = resourceRole(record.role);
    const policy = ROLE_POLICIES[role];
    const recipes = resourceRecipes(record.allowedMutationRecipes, role);
    if (record.recoveryStrategy !== policy.recoveryStrategy) {
        fail("recovery", "$/recoveryStrategy");
    }
    return Object.freeze({
        kind: "resource",
        role,
        allowedMutationRecipes: recipes,
        recoveryStrategy: policy.recoveryStrategy,
    });
}
function parseDirectoryContainer(record) {
    assertExactFields(record, DIRECTORY_CONTAINER_FIELDS);
    if (record.descendantAuthority !== "separate-declaration-required") {
        fail("shape", "$/descendantAuthority");
    }
    if (record.materializationRecipe === "materialize-directory") {
        if (record.existingDirectoryPolicy !== "observe-without-mode-change") {
            fail("shape", "$/existingDirectoryPolicy");
        }
        if (record.collisionPolicy !== "reject-non-directory") {
            fail("shape", "$/collisionPolicy");
        }
        if (record.recoveryStrategy !== "report-only") {
            fail("shape", "$/recoveryStrategy");
        }
        return Object.freeze({
            kind: "directory-container",
            materializationRecipe: "materialize-directory",
            existingDirectoryPolicy: "observe-without-mode-change",
            collisionPolicy: "reject-non-directory",
            descendantAuthority: "separate-declaration-required",
            recoveryStrategy: "report-only",
        });
    }
    if (record.materializationRecipe === "exact-directory-publish") {
        if (record.existingDirectoryPolicy !== "owner-validate-existing-target") {
            fail("shape", "$/existingDirectoryPolicy");
        }
        if (record.collisionPolicy !== "reject-unowned-target") {
            fail("shape", "$/collisionPolicy");
        }
        if (record.recoveryStrategy !== "owner-forward-recovery") {
            fail("shape", "$/recoveryStrategy");
        }
        return Object.freeze({
            kind: "directory-container",
            materializationRecipe: "exact-directory-publish",
            existingDirectoryPolicy: "owner-validate-existing-target",
            collisionPolicy: "reject-unowned-target",
            descendantAuthority: "separate-declaration-required",
            recoveryStrategy: "owner-forward-recovery",
        });
    }
    fail("recipe", "$/materializationRecipe");
}
/** 把任意值准入为冻结的资源处理合同；本入口不选择或执行具体操作。 */
export function parseWakeflowResourceProcessingContract(value) {
    const record = plainRecord(value, "$");
    if (record.kind === "resource")
        return parseResource(record);
    if (record.kind === "directory-container") {
        return parseDirectoryContainer(record);
    }
    fail("kind", "$/kind");
}
/**
 * 准入调用方已经明确选择的一项机械操作方案。
 *
 * 本函数不会替调用方选择操作方案，也不执行副作用。数组、复合字符串和资源合同
 * 未声明的方案都会被拒绝，从而保证一次操作只采用一种机械处理方式。
 */
export function admitWakeflowResourceOperation(contractValue, recipeValue) {
    const contract = parseWakeflowResourceProcessingContract(contractValue);
    if (contract.kind === "directory-container") {
        if (recipeValue !== contract.materializationRecipe) {
            fail("operation", "$/recipe");
        }
        if (contract.materializationRecipe === "exact-directory-publish") {
            return Object.freeze({
                kind: "directory-publication",
                recipe: "exact-directory-publish",
            });
        }
        return Object.freeze({
            kind: "directory-materialization",
            recipe: "materialize-directory",
        });
    }
    const allowedRecipes = contract.allowedMutationRecipes;
    if (typeof recipeValue !== "string"
        || !allowedRecipes.includes(recipeValue)) {
        fail("operation", "$/recipe");
    }
    return Object.freeze({
        kind: "resource-mutation",
        role: contract.role,
        recipe: recipeValue,
    });
}
