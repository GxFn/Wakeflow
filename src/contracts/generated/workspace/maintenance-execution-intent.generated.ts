/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/workspace/maintenance-execution-intent.schema.json
 */

/**
 * Wakeflow portable records 使用的完整 lowercase SHA-256 digest 文本；算法前缀和 256-bit hexadecimal payload 都属于词法合同。
 */
export type WakeflowSha256DigestText = string

/**
 * Private immutable recovery intent for one exact Wakeflow maintenance execution.
 */
export interface WakeflowMaintenanceExecutionIntent {
artifactKind: "wakeflow-maintenance-execution-intent"
schemaVersion: 1
operationId: string
desiredConfig: WakeflowConfigV3
currentHostProfile: {
[k: string]: unknown | undefined
}
/**
 * @minItems 2
 * @maxItems 2
 */
hostProfiles: [{
[k: string]: unknown | undefined
}, {
[k: string]: unknown | undefined
}]
sharedPreview: {
[k: string]: unknown | undefined
}
hostContribution: ({
[k: string]: unknown | undefined
} | null)
planDigest: WakeflowSha256DigestText
}
/**
 * Strict public schema for Wakeflow durable program intent. Runtime facts, host handles, fixed protocol roots, derived paths, and migration history are intentionally excluded.
 */
export interface WakeflowConfigV3 {
/**
 * Canonical public schema URL for the tracked durable configuration.
 */
$schema: "https://raw.githubusercontent.com/GxFn/Wakeflow/main/core/schemas/wakeflow-config.schema.json"
/**
 * Discriminator for a Wakeflow durable configuration.
 */
kind: "WakeflowConfig"
/**
 * Durable configuration schema version.
 */
schemaVersion: 3
program: Program
presentation: Presentation
topology: Topology
storage: Storage
governance: Governance
hosts: Hosts
}
/**
 * Tracked durable program identity and display metadata; it contains no presentation policy, paths, runtime state, or host handles.
 */
export interface Program {
/**
 * Stable program identity generated once; never derived from display text or paths.
 */
programId: string
/**
 * Human-facing program title; it is not identity or a foreign key.
 */
displayName: string
/**
 * Optional human explanation; it does not affect identity or state.
 */
description?: string
}
/**
 * Tracked durable policy for Wakeflow-generated human-facing text. It is shared by the program and is not an inferred host or machine-local preference.
 */
export interface Presentation {
/**
 * BCP 47 language tag for Wakeflow-generated human-facing text. Fresh initialization explicitly persists en when no language is selected; readers never infer a value from the host environment.
 */
language: ("en" | "zh-Hans")
}
/**
 * Durable product repositories, Design/Test support surfaces, and stable logical windows connected only through typed references.
 */
export interface Topology {
/**
 * At least one durable product-repository entity; array order is presentation order, not identity.
 *
 * @minItems 1
 */
repositories: [Repository, ...(Repository)[]]
/**
 * Exactly one Design surface and one Test surface. The strict loader also requires each singleton role window to reference its matching capability.
 *
 * @minItems 2
 * @maxItems 2
 */
supportSurfaces: ({
[k: string]: unknown | undefined
} & [(WakeflowManagedSurface | ExternalOwnedSurface), (WakeflowManagedSurface | ExternalOwnedSurface)])
/**
 * Stable logical windows with exactly one controller, one Design, one Test, and at least one product window; dynamic Pod windows are excluded.
 *
 * @minItems 4
 */
windows: ({
[k: string]: unknown | undefined
} & [(ControllerWindow | DesignWindow | TestWindow | ProductWindow), (ControllerWindow | DesignWindow | TestWindow | ProductWindow), (ControllerWindow | DesignWindow | TestWindow | ProductWindow), (ControllerWindow | DesignWindow | TestWindow | ProductWindow), ...((ControllerWindow | DesignWindow | TestWindow | ProductWindow))[]])
}
/**
 * A stable product-source responsibility root; path and display text may change without changing repositoryId.
 */
export interface Repository {
/**
 * Stable product-repository identity: the repository_ prefix followed by a lowercase UUID v4.
 */
repositoryId: string
/**
 * Canonical relative placement from the program root.
 */
path: (string & string)
/**
 * Human-facing repository title; never an identity key.
 */
displayName: string
/**
 * Optional human explanation of the repository responsibility.
 */
description?: string
/**
 * owner-managed leaves instructions entirely to the repository owner; managed-block permits only Wakeflow's bounded managed block.
 */
instructionManagement: ("owner-managed" | "managed-block")
validation?: RepositoryValidation
}
/**
 * Repository-scoped validation exceptions with explicit owner reasons.
 */
export interface RepositoryValidation {
/**
 * Exact repository-child paths allowed as intentional residue; duplicate paths are rejected by the shared loader.
 */
residueExceptions: ResidueException[]
}
/**
 * One exact repository-child residue exception and its non-empty owner justification.
 */
export interface ResidueException {
/**
 * Canonical repository-relative child path.
 */
path: (string & string)
/**
 * Human-readable repository-owner justification; it grants only the exact path above.
 */
reason: string
}
/**
 * A built-in Design/Test surface whose generated memory and scaffold are wholly owned by Wakeflow; instructionManagement is forbidden.
 */
export interface WakeflowManagedSurface {
/**
 * Stable Design or Test support-surface identity: the surface_ prefix followed by a lowercase UUID v4.
 */
surfaceId: string
/**
 * Protocol capability provided by this support surface: requirements design or independent testing.
 */
capability: ("design" | "test")
/**
 * Canonical portable relative placement. A leading ../ chain may address a named sibling root; absolute paths, drive-relative paths, backslashes, empty or dot-only paths, empty segments, and embedded dot traversal are rejected.
 */
path: (string & string & string)
/**
 * Human-facing support-surface title; never an identity key.
 */
displayName: string
/**
 * Optional human explanation of the support-surface responsibility.
 */
description?: string
/**
 * Wakeflow owns the entire generated support surface and memory file.
 */
ownership: "wakeflow-managed"
}
/**
 * An externally owned Design/Test surface; Wakeflow creates no scaffold and manages instructions only under the explicit policy.
 */
export interface ExternalOwnedSurface {
/**
 * Stable Design or Test support-surface identity: the surface_ prefix followed by a lowercase UUID v4.
 */
surfaceId: string
/**
 * Protocol capability supplied by the external surface: requirements design or independent testing.
 */
capability: ("design" | "test")
/**
 * Canonical portable relative placement. A leading ../ chain may address a named sibling root; absolute paths, drive-relative paths, backslashes, empty or dot-only paths, empty segments, and embedded dot traversal are rejected.
 */
path: (string & string & string)
/**
 * Human-facing external support-surface title; never an identity key.
 */
displayName: string
/**
 * Optional human explanation of the external support responsibility.
 */
description?: string
/**
 * The external owner controls the surface; Wakeflow must not create its normal scaffold.
 */
ownership: "external-owned"
/**
 * owner-managed forbids Wakeflow instruction writes; managed-block permits only the bounded Wakeflow block.
 */
instructionManagement: ("owner-managed" | "managed-block")
}
/**
 * The single durable Controller window rooted at the program boundary.
 */
export interface ControllerWindow {
/**
 * Stable logical-window identity: the window_ prefix followed by a lowercase UUID v4.
 */
windowId: string
/**
 * Protocol role for the unique Controller window.
 */
role: "controller"
/**
 * Human-facing Controller title; never an identity key.
 */
displayName: string
/**
 * Optional human explanation of the Controller responsibility.
 */
description?: string
root: ProgramRoot
}
/**
 * Discriminated root reference for the Controller: the program boundary itself, with no duplicated path or programId.
 */
export interface ProgramRoot {
/**
 * Selects the fixed program root for the Controller window.
 */
kind: "program"
}
/**
 * The single durable Design window, referencing a design-capable support surface by surfaceId.
 */
export interface DesignWindow {
/**
 * Stable logical-window identity: the window_ prefix followed by a lowercase UUID v4.
 */
windowId: string
/**
 * Protocol role for the unique Design window.
 */
role: "design"
/**
 * Human-facing Design title; never an identity key.
 */
displayName: string
/**
 * Optional human explanation of the Design responsibility.
 */
description?: string
root: SupportRoot
}
/**
 * Typed root reference from a Design/Test window to one declared support surface.
 */
export interface SupportRoot {
/**
 * Selects a support-surface root resolved through surfaceId.
 */
kind: "support-surface"
/**
 * Stable Design or Test support-surface identity: the surface_ prefix followed by a lowercase UUID v4.
 */
surfaceId: string
}
/**
 * The single durable Test window, referencing a test-capable support surface by surfaceId.
 */
export interface TestWindow {
/**
 * Stable logical-window identity: the window_ prefix followed by a lowercase UUID v4.
 */
windowId: string
/**
 * Protocol role for the unique independent Test window.
 */
role: "test"
/**
 * Human-facing Test title; never an identity key.
 */
displayName: string
/**
 * Optional human explanation of the independent Test responsibility.
 */
description?: string
root: SupportRoot
}
/**
 * A durable product-responsibility window referencing one stable repository; multiple product windows may share that repository.
 */
export interface ProductWindow {
/**
 * Stable logical-window identity: the window_ prefix followed by a lowercase UUID v4.
 */
windowId: string
/**
 * Protocol role for a product implementation window.
 */
role: "product"
/**
 * Human-facing product-window title; never an identity key.
 */
displayName: string
/**
 * Optional human explanation of this product-window responsibility.
 */
description?: string
root: RepositoryRoot
}
/**
 * Typed root reference from a product window to one declared product repository.
 */
export interface RepositoryRoot {
/**
 * Selects a product-repository root resolved through repositoryId.
 */
kind: "repository"
/**
 * Stable product-repository identity: the repository_ prefix followed by a lowercase UUID v4.
 */
repositoryId: string
}
/**
 * Durable user-selectable storage placement. Active and local roots and every leaf path remain fixed protocol constants outside config.
 */
export interface Storage {
/**
 * Canonical portable relative placement. A leading ../ chain may address a named sibling root; absolute paths, drive-relative paths, backslashes, empty or dot-only paths, empty segments, and embedded dot traversal are rejected.
 */
ledgerRoot: string
}
/**
 * Optional cross-run audit and validation intent; it contains no current process, lease, delivery, or demand observations. Omitting audit configures no preservation-review policy, so preservation planning fails closed instead of inventing a default.
 */
export interface Governance {
audit?: AuditGovernance
validation?: ValidationGovernance
}
/**
 * Audit-review policy. Review age never grants automatic deletion authority.
 */
export interface AuditGovernance {
/**
 * Whole-day age from 1 through 36500 for review eligibility only; never deletion authority.
 */
preservedReviewAfterDays: number
}
/**
 * Persistent user validation intent for runtime residue; observations and PIDs remain outside config.
 */
export interface ValidationGovernance {
runtimeResidue: RuntimeResidue
}
/**
 * Named collection of one or more typed process-command matchers used only by validation.
 */
export interface RuntimeResidue {
/**
 * Human-facing label used when reporting matched runtime residue.
 */
label: string
/**
 * One or more typed substring/regex matchers; each regex is compiled during strict loading.
 *
 * @minItems 1
 */
matchers: [(SubstringRuntimeMatcher | RegexRuntimeMatcher), ...((SubstringRuntimeMatcher | RegexRuntimeMatcher))[]]
}
/**
 * Strict literal substring matcher for runtime-residue validation.
 */
export interface SubstringRuntimeMatcher {
/**
 * Selects literal substring matching without regular-expression interpretation.
 */
kind: "substring"
/**
 * A non-empty string whose first and last characters are not whitespace; this mirrors the strict loader's trim check.
 */
value: string
}
/**
 * Strict regular-expression matcher for runtime-residue validation.
 */
export interface RegexRuntimeMatcher {
/**
 * Selects a validated ECMAScript regular-expression source.
 */
kind: "regex"
/**
 * Validated Unicode ECMAScript regular-expression source.
 */
value: (string & string)
}
/**
 * Optional durable launch/container preferences for the two supported hosts. Omission inherits the tested host profile and never means disabled, registered, or live.
 */
export interface Hosts {
codex?: CodexHost
"claude-code"?: ClaudeHost
}
/**
 * Codex-specific durable launch preferences; real thread handles and live model observations are forbidden.
 */
export interface CodexHost {
launch?: CodexLaunch
}
/**
 * Optional Codex model and reasoning-effort pins by protocol role; missing keys inherit the current tested profile.
 */
export interface CodexLaunch {
modelByRole?: ModelByRole
reasoningEffortByRole?: ReasoningEffortByRole
}
/**
 * Optional non-empty host model identifiers keyed only by supported protocol roles or default.
 */
export interface ModelByRole {
/**
 * Optional host model identifier for Controller launches.
 */
controller?: string
/**
 * Optional host model identifier for Design launches.
 */
design?: string
/**
 * Optional host model identifier for Test launches.
 */
test?: string
/**
 * Optional host model identifier for product-window launches.
 */
product?: string
/**
 * Optional fallback host model identifier when a role-specific value is absent.
 */
default?: string
}
/**
 * Optional tested reasoning-effort preferences keyed only by supported protocol roles or default.
 */
export interface ReasoningEffortByRole {
/**
 * Optional tested reasoning effort for Controller launches.
 */
controller?: ("medium" | "high" | "xhigh" | "max")
/**
 * Optional tested reasoning effort for Design launches.
 */
design?: ("medium" | "high" | "xhigh" | "max")
/**
 * Optional tested reasoning effort for Test launches.
 */
test?: ("medium" | "high" | "xhigh" | "max")
/**
 * Optional tested reasoning effort for product-window launches.
 */
product?: ("medium" | "high" | "xhigh" | "max")
/**
 * Optional fallback reasoning effort when a role-specific value is absent.
 */
default?: ("medium" | "high" | "xhigh" | "max")
}
/**
 * Claude Code durable launch and desired tmux-container preferences; actual socket/session/window/pane locators remain host-local runtime facts.
 */
export interface ClaudeHost {
launch?: ClaudeLaunch
tmux?: ClaudeTmux
}
/**
 * Optional Claude model, reasoning-effort, and permission-mode preferences by protocol role; missing values inherit the tested profile.
 */
export interface ClaudeLaunch {
modelByRole?: ModelByRole
reasoningEffortByRole?: ReasoningEffortByRole
/**
 * Persistent Claude permission preference. acceptEdits is the safe mode; bypassPermissions requires an explicit durable user choice.
 */
permissionMode?: ("acceptEdits" | "bypassPermissions")
}
/**
 * Desired Claude tmux container names only; actual live locator identity is intentionally excluded from durable config.
 */
export interface ClaudeTmux {
/**
 * Desired bounded, control-free tmux session name; omission inherits the Claude host profile.
 */
sessionName?: string
/**
 * Optional safe tmux -L socket name; omission uses the adapter's tested default container.
 */
socketName?: string
}

/** 递归冻结生成的 Schema，阻止校验器首次使用前发生嵌套漂移。 */
function freezeGeneratedSchema<Value>(value: Value): Readonly<Value> {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeGeneratedSchema(child);
    Object.freeze(value);
  }
  return value;
}

/** 从 JSON 文本恢复 Schema，保留 `__proto__` 等普通 JSON 自有键。 */
function restoreGeneratedSchema(
  serialized: string,
): Readonly<Record<string, unknown>> {
  const value: unknown = JSON.parse(serialized);
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    throw new TypeError("Generated Schema must be an object.");
  }
  return freezeGeneratedSchema(value as Record<string, unknown>);
}

/** Ajv 严格校验器使用的 Schema 派生运行时权威；不得手工修改。 */
export const WAKEFLOW_MAINTENANCE_EXECUTION_INTENT_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:workspace:maintenance:execution-intent:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_MAINTENANCE_EXECUTION_INTENT_SCHEMA\",\"title\":\"WakeflowMaintenanceExecutionIntent\",\"description\":\"Private immutable recovery intent for one exact Wakeflow maintenance execution.\",\"$comment\":\"The intent stores normalized desired Config, exact host profiles and the compact plan sources required to reconstruct the execution plan after restart. It excludes source file bodies, absolute paths, credentials, process identity, lock tokens and mutable checkpoints.\",\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"artifactKind\",\"schemaVersion\",\"operationId\",\"desiredConfig\",\"currentHostProfile\",\"hostProfiles\",\"sharedPreview\",\"hostContribution\",\"planDigest\"],\"properties\":{\"artifactKind\":{\"const\":\"wakeflow-maintenance-execution-intent\"},\"schemaVersion\":{\"const\":1},\"operationId\":{\"type\":\"string\",\"pattern\":\"^maintenance_operation_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"desiredConfig\":{\"$ref\":\"https://raw.githubusercontent.com/GxFn/Wakeflow/main/core/schemas/wakeflow-config.schema.json\"},\"currentHostProfile\":{\"type\":\"object\"},\"hostProfiles\":{\"type\":\"array\",\"minItems\":2,\"maxItems\":2,\"items\":{\"type\":\"object\"}},\"sharedPreview\":{\"type\":\"object\"},\"hostContribution\":{\"anyOf\":[{\"type\":\"object\"},{\"type\":\"null\"}]},\"planDigest\":{\"$ref\":\"urn:wakeflow:foundation:crypto:sha256-digest:v1\"}}}");
