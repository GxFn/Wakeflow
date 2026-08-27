import {
  parseDenseArray,
  parsePlainRecord,
  PassiveOwnDataError,
} from "../data/passive-own-data.js";

/**
 * Wakeflow Foundation / Resource：资源处理角色与机械操作合同。
 *
 * 本模块只描述一个资源允许采用哪些操作方案及其恢复策略。
 * 它不登记路径、职责所有者、宿主、Config 或当前 Workspace，也不执行文件系统操作。
 * 上层 Workspace 资源目录负责把本合同与具体资源身份组合；领域职责所有者仍负责
 * 准入一次真实操作所需的权威事实、互斥锁、源资源预期和恢复证据。
 *
 * 目录容器不是第八种资源角色。它使用独立的判别联合分支，只声明安全的目录创建
 * 策略，不能因此取得后代资源的管理权。
 */

export const WAKEFLOW_RESOURCE_ROLES = Object.freeze([
  "external-reference",
  "immutable-fact",
  "mutable-snapshot",
  "derived-projection",
  "managed-integration-text",
  "manifested-tree",
  "transaction-artifact",
] as const);

export type WakeflowResourceRole =
  (typeof WAKEFLOW_RESOURCE_ROLES)[number];

export const WAKEFLOW_RESOURCE_MUTATION_RECIPES = Object.freeze([
  "no-write",
  "exclusive-create",
  "exact-source-replace",
  "deterministic-rewrite",
  "exact-source-recompose",
  "tree-publish-or-move",
  "exact-retire",
] as const);

export type WakeflowResourceMutationRecipe =
  (typeof WAKEFLOW_RESOURCE_MUTATION_RECIPES)[number];

export const WAKEFLOW_RESOURCE_RECOVERY_STRATEGIES = Object.freeze([
  "report-only",
  "exact-idempotent-retry",
  "owner-forward-recovery",
  "rebuild-from-authority",
  "recompose-owned-content",
  "manifest-closure",
  "owner-transaction-recovery",
] as const);

export type WakeflowResourceRecoveryStrategy =
  (typeof WAKEFLOW_RESOURCE_RECOVERY_STRATEGIES)[number];

export const WAKEFLOW_DIRECTORY_CONTAINER_RECIPES = Object.freeze([
  "materialize-directory",
  "exact-directory-publish",
] as const);

export type WakeflowDirectoryContainerRecipe =
  (typeof WAKEFLOW_DIRECTORY_CONTAINER_RECIPES)[number];

interface ResourceProcessingContract<
  Role extends WakeflowResourceRole,
  Recipes extends readonly WakeflowResourceMutationRecipe[],
  Recovery extends WakeflowResourceRecoveryStrategy,
> {
  readonly kind: "resource";
  readonly role: Role;
  readonly allowedMutationRecipes: Recipes;
  readonly recoveryStrategy: Recovery;
}

export type WakeflowExternalReferenceProcessingContract =
  ResourceProcessingContract<
    "external-reference",
    readonly ["no-write"],
    "report-only"
  >;

export type WakeflowImmutableFactProcessingContract =
  ResourceProcessingContract<
    "immutable-fact",
    readonly ["exclusive-create"],
    "exact-idempotent-retry"
  >;

export type WakeflowMutableSnapshotProcessingContract =
  ResourceProcessingContract<
    "mutable-snapshot",
    | readonly ["exact-source-replace"]
    | readonly ["exclusive-create", "exact-source-replace"],
    "owner-forward-recovery"
  >;

export type WakeflowDerivedProjectionProcessingContract =
  ResourceProcessingContract<
    "derived-projection",
    readonly ["deterministic-rewrite"],
    "rebuild-from-authority"
  >;

export type WakeflowManagedIntegrationTextProcessingContract =
  ResourceProcessingContract<
    "managed-integration-text",
    readonly ["exact-source-recompose"],
    "recompose-owned-content"
  >;

export type WakeflowManifestedTreeProcessingContract =
  ResourceProcessingContract<
    "manifested-tree",
    readonly ["tree-publish-or-move"],
    "manifest-closure"
  >;

export type WakeflowTransactionArtifactMutationRecipe =
  | "exclusive-create"
  | "exact-source-replace"
  | "tree-publish-or-move"
  | "exact-retire";

export type WakeflowTransactionArtifactProcessingContract =
  ResourceProcessingContract<
    "transaction-artifact",
    readonly [
      WakeflowTransactionArtifactMutationRecipe,
      ...WakeflowTransactionArtifactMutationRecipe[],
    ],
    "owner-transaction-recovery"
  >;

/** 逐段创建的静态结构目录。 */
export interface WakeflowMaterializedDirectoryContainerProcessingContract {
  readonly kind: "directory-container";
  readonly materializationRecipe: "materialize-directory";
  readonly existingDirectoryPolicy: "observe-without-mode-change";
  readonly collisionPolicy: "reject-non-directory";
  readonly descendantAuthority: "separate-declaration-required";
  readonly recoveryStrategy: "report-only";
}

/**
 * 职责所有者验证暂存目录达到清单闭合状态后，在同一 `RootedDirectory` 内整体发布
 * 聚合目录。本合同不声明清单语义、跨文件系统回退方案或通用暂存目录恢复能力。
 */
export interface WakeflowExactDirectoryPublicationProcessingContract {
  readonly kind: "directory-container";
  readonly materializationRecipe: "exact-directory-publish";
  readonly existingDirectoryPolicy: "owner-validate-existing-target";
  readonly collisionPolicy: "reject-unowned-target";
  readonly descendantAuthority: "separate-declaration-required";
  readonly recoveryStrategy: "owner-forward-recovery";
}

/** Wakeflow 结构目录；每个子资源必须拥有独立的资源声明。 */
export type WakeflowDirectoryContainerProcessingContract =
  | WakeflowMaterializedDirectoryContainerProcessingContract
  | WakeflowExactDirectoryPublicationProcessingContract;

export type WakeflowResourceRoleProcessingContract =
  | WakeflowExternalReferenceProcessingContract
  | WakeflowImmutableFactProcessingContract
  | WakeflowMutableSnapshotProcessingContract
  | WakeflowDerivedProjectionProcessingContract
  | WakeflowManagedIntegrationTextProcessingContract
  | WakeflowManifestedTreeProcessingContract
  | WakeflowTransactionArtifactProcessingContract;

export type WakeflowResourceProcessingContract =
  | WakeflowResourceRoleProcessingContract
  | WakeflowDirectoryContainerProcessingContract;

export type WakeflowResourceProcessingContractErrorReason =
  | "input"
  | "shape"
  | "kind"
  | "role"
  | "recipe"
  | "recovery"
  | "operation";

const ERROR_MESSAGES = {
  input: "Wakeflow resource processing input is not passive data.",
  shape: "Wakeflow resource processing input has an invalid shape.",
  kind: "Wakeflow resource processing kind is invalid.",
  role: "Wakeflow resource processing role is invalid.",
  recipe: "Wakeflow resource mutation recipe is invalid.",
  recovery: "Wakeflow resource recovery strategy is invalid.",
  operation: "Wakeflow resource operation is not admitted by its contract.",
} as const satisfies Readonly<Record<
  WakeflowResourceProcessingContractErrorReason,
  string
>>;

/** 资源处理合同准入失败的稳定、脱敏错误。 */
export class WakeflowResourceProcessingContractError extends Error {
  override readonly name = "WakeflowResourceProcessingContractError";
  readonly code = "wakeflow-resource-processing-contract" as const;
  readonly reason: WakeflowResourceProcessingContractErrorReason;
  readonly path: string;

  constructor(
    reason: WakeflowResourceProcessingContractErrorReason,
    path: string,
  ) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

interface RolePolicy {
  readonly recoveryStrategy: WakeflowResourceRecoveryStrategy;
  readonly allowedRecipes: readonly WakeflowResourceMutationRecipe[];
  readonly requiredRecipes: readonly WakeflowResourceMutationRecipe[];
}

const ROLE_POLICIES = Object.freeze({
  "external-reference": Object.freeze({
    recoveryStrategy: "report-only",
    allowedRecipes: Object.freeze(["no-write"] as const),
    requiredRecipes: Object.freeze(["no-write"] as const),
  }),
  "immutable-fact": Object.freeze({
    recoveryStrategy: "exact-idempotent-retry",
    allowedRecipes: Object.freeze(["exclusive-create"] as const),
    requiredRecipes: Object.freeze(["exclusive-create"] as const),
  }),
  "mutable-snapshot": Object.freeze({
    recoveryStrategy: "owner-forward-recovery",
    allowedRecipes: Object.freeze([
      "exclusive-create",
      "exact-source-replace",
    ] as const),
    requiredRecipes: Object.freeze(["exact-source-replace"] as const),
  }),
  "derived-projection": Object.freeze({
    recoveryStrategy: "rebuild-from-authority",
    allowedRecipes: Object.freeze(["deterministic-rewrite"] as const),
    requiredRecipes: Object.freeze(["deterministic-rewrite"] as const),
  }),
  "managed-integration-text": Object.freeze({
    recoveryStrategy: "recompose-owned-content",
    allowedRecipes: Object.freeze(["exact-source-recompose"] as const),
    requiredRecipes: Object.freeze(["exact-source-recompose"] as const),
  }),
  "manifested-tree": Object.freeze({
    recoveryStrategy: "manifest-closure",
    allowedRecipes: Object.freeze(["tree-publish-or-move"] as const),
    requiredRecipes: Object.freeze(["tree-publish-or-move"] as const),
  }),
  "transaction-artifact": Object.freeze({
    recoveryStrategy: "owner-transaction-recovery",
    allowedRecipes: Object.freeze([
      "exclusive-create",
      "exact-source-replace",
      "tree-publish-or-move",
      "exact-retire",
    ] as const),
    requiredRecipes: Object.freeze([] as const),
  }),
} as const satisfies Readonly<Record<WakeflowResourceRole, RolePolicy>>);

const ROLE_SET = new Set<string>(WAKEFLOW_RESOURCE_ROLES);
const RECIPE_INDEX = new Map<string, number>(
  WAKEFLOW_RESOURCE_MUTATION_RECIPES.map((recipe, index) => [recipe, index]),
);
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

function fail(
  reason: WakeflowResourceProcessingContractErrorReason,
  path: string,
): never {
  throw new WakeflowResourceProcessingContractError(reason, path);
}

function propertyPath(key: string): string {
  return `$/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`;
}

function assertExactFields(
  record: Readonly<Record<string, unknown>>,
  allowed: ReadonlySet<string>,
): void {
  const unknown = Object.keys(record).sort().find((key) => !allowed.has(key));
  if (unknown !== undefined) fail("shape", propertyPath(unknown));
}

function plainRecord(
  value: unknown,
  path: string,
): Readonly<Record<string, unknown>> {
  try {
    return parsePlainRecord(value, path);
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", error.path);
    throw error;
  }
}

function denseArray(value: unknown, path: string): readonly unknown[] {
  try {
    return parseDenseArray(
      value,
      WAKEFLOW_RESOURCE_MUTATION_RECIPES.length,
      path,
    );
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", error.path);
    throw error;
  }
}

function resourceRole(value: unknown): WakeflowResourceRole {
  if (typeof value !== "string" || !ROLE_SET.has(value)) {
    fail("role", "$/role");
  }
  return value as WakeflowResourceRole;
}

function resourceRecipes(
  value: unknown,
  role: WakeflowResourceRole,
): readonly WakeflowResourceMutationRecipe[] {
  const values = denseArray(value, "$/allowedMutationRecipes");
  if (values.length === 0) fail("recipe", "$/allowedMutationRecipes");
  const policy: RolePolicy = ROLE_POLICIES[role];
  const allowed = new Set<string>(policy.allowedRecipes);
  const recipes: WakeflowResourceMutationRecipe[] = [];
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
    recipes.push(candidate as WakeflowResourceMutationRecipe);
  }
  if (policy.requiredRecipes.some((recipe) => !recipes.includes(recipe))) {
    fail("recipe", "$/allowedMutationRecipes");
  }
  return Object.freeze(recipes);
}

function parseResource(
  record: Readonly<Record<string, unknown>>,
): Readonly<WakeflowResourceRoleProcessingContract> {
  assertExactFields(record, RESOURCE_FIELDS);
  const role = resourceRole(record.role);
  const policy: RolePolicy = ROLE_POLICIES[role];
  const recipes = resourceRecipes(record.allowedMutationRecipes, role);
  if (record.recoveryStrategy !== policy.recoveryStrategy) {
    fail("recovery", "$/recoveryStrategy");
  }
  return Object.freeze({
    kind: "resource",
    role,
    allowedMutationRecipes: recipes,
    recoveryStrategy: policy.recoveryStrategy,
  }) as Readonly<WakeflowResourceRoleProcessingContract>;
}

function parseDirectoryContainer(
  record: Readonly<Record<string, unknown>>,
): Readonly<WakeflowDirectoryContainerProcessingContract> {
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
export function parseWakeflowResourceProcessingContract(
  value: unknown,
): Readonly<WakeflowResourceProcessingContract> {
  const record = plainRecord(value, "$");
  if (record.kind === "resource") return parseResource(record);
  if (record.kind === "directory-container") {
    return parseDirectoryContainer(record);
  }
  fail("kind", "$/kind");
}

interface ResourceMutationOperation<
  Role extends WakeflowResourceRole,
  Recipe extends WakeflowResourceMutationRecipe,
> {
  readonly kind: "resource-mutation";
  readonly role: Role;
  readonly recipe: Recipe;
}

export type WakeflowResourceOperation =
  | ResourceMutationOperation<"external-reference", "no-write">
  | ResourceMutationOperation<"immutable-fact", "exclusive-create">
  | ResourceMutationOperation<
      "mutable-snapshot",
      "exclusive-create" | "exact-source-replace"
    >
  | ResourceMutationOperation<"derived-projection", "deterministic-rewrite">
  | ResourceMutationOperation<
      "managed-integration-text",
      "exact-source-recompose"
    >
  | ResourceMutationOperation<"manifested-tree", "tree-publish-or-move">
  | ResourceMutationOperation<
      "transaction-artifact",
      WakeflowTransactionArtifactMutationRecipe
    >
  | {
      readonly kind: "directory-materialization";
      readonly recipe: "materialize-directory";
    }
  | {
      readonly kind: "directory-publication";
      readonly recipe: "exact-directory-publish";
    };

/**
 * 准入调用方已经明确选择的一项机械操作方案。
 *
 * 本函数不会替调用方选择操作方案，也不执行副作用。数组、复合字符串和资源合同
 * 未声明的方案都会被拒绝，从而保证一次操作只采用一种机械处理方式。
 */
export function admitWakeflowResourceOperation(
  contractValue: unknown,
  recipeValue: unknown,
): Readonly<WakeflowResourceOperation> {
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
  const allowedRecipes: readonly WakeflowResourceMutationRecipe[] =
    contract.allowedMutationRecipes;
  if (
    typeof recipeValue !== "string"
    || !allowedRecipes.includes(
      recipeValue as WakeflowResourceMutationRecipe,
    )
  ) {
    fail("operation", "$/recipe");
  }
  return Object.freeze({
    kind: "resource-mutation",
    role: contract.role,
    recipe: recipeValue as WakeflowResourceMutationRecipe,
  }) as Readonly<WakeflowResourceOperation>;
}
