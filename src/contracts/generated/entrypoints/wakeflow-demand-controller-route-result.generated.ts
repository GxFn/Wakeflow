/**
 * 此文件由 Wakeflow JSON Schema 生成，禁止手工修改。
 * Source: src/contracts/schemas/entrypoints/wakeflow-demand-controller-route-result.schema.json
 */

export type Route = ({
[k: string]: unknown | undefined
} & {
kind: "WakeflowDemandControllerRoute"
schemaVersion: 1
programId: ProgramId
demandId: DemandId
demandType: ("requirement" | "bug" | "supplement" | "research")
lifecycle: ("active" | "cancelled" | "completed")
authorityDigest: Sha256Digest
observedEventStream: ObservedEventStream
reviewSnapshotDigest: Sha256Digest
postAcceptanceRouteDigest?: Sha256Digest
disposition: ("work-available" | "blocked" | "terminal")
/**
 * @maxItems 10000
 */
frontiers: Frontier[]
/**
 * @maxItems 10000
 */
blockers: Blocker[]
routeDigest: Sha256Digest
})
export type ProgramId = string
export type DemandId = string
export type Sha256Digest = string
export type DemandEventId = string
export type Frontier = (DemandFrontier | ImplementationFrontier | TestFrontier)
export type DemandFrontier = ({
[k: string]: unknown | undefined
} & {
scope: "demand"
kind: ("implementation-task-planning" | "research-completion-required" | "demand-completion-preflight" | "test-card-planning" | "test-task-planning")
owner: ("target-task-planning" | "demand-lifecycle" | "demand-completion" | "test-card-planning" | "test-task-planning")
})
export type ImplementationFrontier = ({
[k: string]: unknown | undefined
} & {
scope: "target"
kind: ("implementation-delivery-planning" | "implementation-host-effect-claim" | "implementation-host-effect-execution" | "implementation-target-result-import" | "implementation-host-effect-rearm" | "implementation-result-review" | "implementation-review-resume" | "implementation-redesign-required")
owner: ("target-delivery-preparation" | "target-host-effect-claim" | "agent-host" | "target-result-import" | "target-host-effect-rearm" | "controller-implementation-review" | "controller-target-review-resume" | "design")
target: ImplementationTarget
})
export type TargetTaskId = string
export type TaskPackageId = string
export type RepositoryId = string
export type WindowId = string
export type TestFrontier = ({
[k: string]: unknown | undefined
} & {
scope: "target"
kind: ("test-delivery-planning" | "test-host-effect-claim" | "test-host-effect-execution" | "test-target-result-import" | "test-result-review" | "test-delivery-rerun-planning" | "product-defect-remediation-authorization" | "test-review-resume" | "test-delivery-replacement-planning")
owner: ("test-delivery-preparation" | "target-host-effect-claim" | "agent-host" | "target-result-import" | "controller-test-review" | "controller-product-defect-remediation" | "controller-target-review-resume")
target: TestTarget
})
export type TestCardId = string
export type Blocker = ({
kind: "implementation-redesign-not-implemented"
owner: "design"
targetTaskId: TargetTaskId
targetReviewDecisionId: TargetReviewDecisionId
decisionDigest: Sha256Digest
} | {
kind: "research-completion-not-implemented"
owner: "demand-lifecycle"
} | {
kind: "isolated-test-planning-not-implemented"
owner: "test-card-planning"
})
export type TargetReviewDecisionId = string

/**
 * Redacted read-only result containing one exact current Demand Controller Route.
 */
export interface WakeflowDemandControllerRouteResultV1 {
kind: "WakeflowDemandControllerRouteInspectionResult"
schemaVersion: 1
tool: "wakeflow_inspect_demand_route"
status: "current"
route: Route
}
export interface ObservedEventStream {
streamRevision: number
stateDigest: Sha256Digest
lastEventId: DemandEventId
lastEventDigest: Sha256Digest
}
export interface ImplementationTarget {
workType: "implementation"
targetTaskId: TargetTaskId
taskPackageId: TaskPackageId
taskPackageDigest: Sha256Digest
repositoryId: RepositoryId
windowId: WindowId
phase: ("planned" | "delivery-prepared" | "host-effect-claimed" | "host-effect-accepted" | "host-effect-indeterminate" | "host-effect-rejected" | "result-reported" | "product-defect-rework-requested" | "rework-requested" | "redesign-requested" | "review-blocked")
}
export interface TestTarget {
workType: "test"
targetTaskId: TargetTaskId
taskPackageId: TaskPackageId
taskPackageDigest: Sha256Digest
windowId: WindowId
phase: ("planned" | "test-delivery-prepared" | "test-host-effect-claimed" | "test-host-effect-accepted" | "test-host-effect-indeterminate" | "test-host-effect-rejected" | "test-result-reported" | "test-another-attempt-requested" | "test-product-defect" | "test-review-blocked")
testCard: {
testCardId: TestCardId
testCardDigest: Sha256Digest
}
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
export const WAKEFLOW_DEMAND_CONTROLLER_ROUTE_RESULT_SCHEMA = restoreGeneratedSchema("{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"$id\":\"urn:wakeflow:entrypoints:demand-controller-route-result:v1\",\"x-wakeflow-runtime-export\":\"WAKEFLOW_DEMAND_CONTROLLER_ROUTE_RESULT_SCHEMA\",\"title\":\"WakeflowDemandControllerRouteResultV1\",\"description\":\"Redacted read-only result containing one exact current Demand Controller Route.\",\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"schemaVersion\",\"tool\",\"status\",\"route\"],\"properties\":{\"kind\":{\"const\":\"WakeflowDemandControllerRouteInspectionResult\"},\"schemaVersion\":{\"const\":1},\"tool\":{\"const\":\"wakeflow_inspect_demand_route\"},\"status\":{\"const\":\"current\"},\"route\":{\"$ref\":\"#/$defs/route\"}},\"$defs\":{\"route\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"schemaVersion\",\"programId\",\"demandId\",\"demandType\",\"lifecycle\",\"authorityDigest\",\"observedEventStream\",\"reviewSnapshotDigest\",\"disposition\",\"frontiers\",\"blockers\",\"routeDigest\"],\"properties\":{\"kind\":{\"const\":\"WakeflowDemandControllerRoute\"},\"schemaVersion\":{\"const\":1},\"programId\":{\"$ref\":\"#/$defs/programId\"},\"demandId\":{\"$ref\":\"#/$defs/demandId\"},\"demandType\":{\"enum\":[\"requirement\",\"bug\",\"supplement\",\"research\"]},\"lifecycle\":{\"enum\":[\"active\",\"cancelled\",\"completed\"]},\"authorityDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"observedEventStream\":{\"$ref\":\"#/$defs/observedEventStream\"},\"reviewSnapshotDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"postAcceptanceRouteDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"disposition\":{\"enum\":[\"work-available\",\"blocked\",\"terminal\"]},\"frontiers\":{\"type\":\"array\",\"maxItems\":10000,\"items\":{\"$ref\":\"#/$defs/frontier\"}},\"blockers\":{\"type\":\"array\",\"maxItems\":10000,\"items\":{\"$ref\":\"#/$defs/blocker\"}},\"routeDigest\":{\"$ref\":\"#/$defs/sha256Digest\"}},\"allOf\":[{\"if\":{\"properties\":{\"disposition\":{\"const\":\"terminal\"}},\"required\":[\"disposition\"]},\"then\":{\"properties\":{\"postAcceptanceRouteDigest\":false,\"frontiers\":{\"type\":\"array\",\"maxItems\":0},\"blockers\":{\"type\":\"array\",\"maxItems\":0}}}},{\"if\":{\"properties\":{\"disposition\":{\"const\":\"blocked\"}},\"required\":[\"disposition\"]},\"then\":{\"properties\":{\"frontiers\":{\"type\":\"array\",\"minItems\":1},\"blockers\":{\"type\":\"array\",\"minItems\":1}}}},{\"if\":{\"properties\":{\"disposition\":{\"const\":\"blocked\"},\"blockers\":{\"type\":\"array\",\"contains\":{\"type\":\"object\",\"properties\":{\"kind\":{\"const\":\"isolated-test-planning-not-implemented\"}},\"required\":[\"kind\"]}}},\"required\":[\"disposition\",\"blockers\"]},\"then\":{\"required\":[\"postAcceptanceRouteDigest\"]}},{\"if\":{\"properties\":{\"disposition\":{\"const\":\"blocked\"},\"blockers\":{\"type\":\"array\",\"not\":{\"contains\":{\"type\":\"object\",\"properties\":{\"kind\":{\"const\":\"isolated-test-planning-not-implemented\"}},\"required\":[\"kind\"]}}}},\"required\":[\"disposition\",\"blockers\"]},\"then\":{\"properties\":{\"postAcceptanceRouteDigest\":false}}},{\"if\":{\"properties\":{\"disposition\":{\"const\":\"work-available\"}},\"required\":[\"disposition\"]},\"then\":{\"properties\":{\"frontiers\":{\"type\":\"array\",\"minItems\":1}}}}]},\"observedEventStream\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"streamRevision\",\"stateDigest\",\"lastEventId\",\"lastEventDigest\"],\"properties\":{\"streamRevision\":{\"type\":\"integer\",\"minimum\":1,\"maximum\":9007199254740991},\"stateDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"lastEventId\":{\"$ref\":\"#/$defs/demandEventId\"},\"lastEventDigest\":{\"$ref\":\"#/$defs/sha256Digest\"}}},\"frontier\":{\"oneOf\":[{\"$ref\":\"#/$defs/demandFrontier\"},{\"$ref\":\"#/$defs/implementationFrontier\"},{\"$ref\":\"#/$defs/testFrontier\"}]},\"demandFrontier\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"scope\",\"kind\",\"owner\"],\"properties\":{\"scope\":{\"const\":\"demand\"},\"kind\":{\"enum\":[\"implementation-task-planning\",\"research-completion-required\",\"demand-completion-preflight\",\"test-card-planning\",\"test-task-planning\"]},\"owner\":{\"enum\":[\"target-task-planning\",\"demand-lifecycle\",\"demand-completion\",\"test-card-planning\",\"test-task-planning\"]}},\"allOf\":[{\"if\":{\"properties\":{\"kind\":{\"const\":\"implementation-task-planning\"}},\"required\":[\"kind\"]},\"then\":{\"properties\":{\"owner\":{\"const\":\"target-task-planning\"}}}},{\"if\":{\"properties\":{\"kind\":{\"const\":\"research-completion-required\"}},\"required\":[\"kind\"]},\"then\":{\"properties\":{\"owner\":{\"const\":\"demand-lifecycle\"}}}},{\"if\":{\"properties\":{\"kind\":{\"const\":\"demand-completion-preflight\"}},\"required\":[\"kind\"]},\"then\":{\"properties\":{\"owner\":{\"const\":\"demand-completion\"}}}},{\"if\":{\"properties\":{\"kind\":{\"const\":\"test-card-planning\"}},\"required\":[\"kind\"]},\"then\":{\"properties\":{\"owner\":{\"const\":\"test-card-planning\"}}}},{\"if\":{\"properties\":{\"kind\":{\"const\":\"test-task-planning\"}},\"required\":[\"kind\"]},\"then\":{\"properties\":{\"owner\":{\"const\":\"test-task-planning\"}}}}]},\"implementationFrontier\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"scope\",\"kind\",\"owner\",\"target\"],\"properties\":{\"scope\":{\"const\":\"target\"},\"kind\":{\"enum\":[\"implementation-delivery-planning\",\"implementation-host-effect-claim\",\"implementation-host-effect-execution\",\"implementation-target-result-import\",\"implementation-host-effect-rearm\",\"implementation-result-review\",\"implementation-review-resume\",\"implementation-redesign-required\"]},\"owner\":{\"enum\":[\"target-delivery-preparation\",\"target-host-effect-claim\",\"agent-host\",\"target-result-import\",\"target-host-effect-rearm\",\"controller-implementation-review\",\"controller-target-review-resume\",\"design\"]},\"target\":{\"$ref\":\"#/$defs/implementationTarget\"}},\"allOf\":[{\"if\":{\"properties\":{\"kind\":{\"const\":\"implementation-delivery-planning\"}},\"required\":[\"kind\"]},\"then\":{\"properties\":{\"owner\":{\"const\":\"target-delivery-preparation\"},\"target\":{\"type\":\"object\",\"properties\":{\"phase\":{\"enum\":[\"planned\",\"rework-requested\",\"product-defect-rework-requested\"]}}}}}},{\"if\":{\"properties\":{\"kind\":{\"const\":\"implementation-host-effect-claim\"}},\"required\":[\"kind\"]},\"then\":{\"properties\":{\"owner\":{\"const\":\"target-host-effect-claim\"},\"target\":{\"type\":\"object\",\"properties\":{\"phase\":{\"const\":\"delivery-prepared\"}}}}}},{\"if\":{\"properties\":{\"kind\":{\"const\":\"implementation-host-effect-execution\"}},\"required\":[\"kind\"]},\"then\":{\"properties\":{\"owner\":{\"const\":\"agent-host\"},\"target\":{\"type\":\"object\",\"properties\":{\"phase\":{\"const\":\"host-effect-claimed\"}}}}}},{\"if\":{\"properties\":{\"kind\":{\"const\":\"implementation-target-result-import\"}},\"required\":[\"kind\"]},\"then\":{\"properties\":{\"owner\":{\"const\":\"target-result-import\"},\"target\":{\"type\":\"object\",\"properties\":{\"phase\":{\"enum\":[\"host-effect-accepted\",\"host-effect-indeterminate\"]}}}}}},{\"if\":{\"properties\":{\"kind\":{\"const\":\"implementation-host-effect-rearm\"}},\"required\":[\"kind\"]},\"then\":{\"properties\":{\"owner\":{\"const\":\"target-host-effect-rearm\"},\"target\":{\"type\":\"object\",\"properties\":{\"phase\":{\"const\":\"host-effect-rejected\"}}}}}},{\"if\":{\"properties\":{\"kind\":{\"const\":\"implementation-result-review\"}},\"required\":[\"kind\"]},\"then\":{\"properties\":{\"owner\":{\"const\":\"controller-implementation-review\"},\"target\":{\"type\":\"object\",\"properties\":{\"phase\":{\"const\":\"result-reported\"}}}}}},{\"if\":{\"properties\":{\"kind\":{\"const\":\"implementation-review-resume\"}},\"required\":[\"kind\"]},\"then\":{\"properties\":{\"owner\":{\"const\":\"controller-target-review-resume\"},\"target\":{\"type\":\"object\",\"properties\":{\"phase\":{\"const\":\"review-blocked\"}}}}}},{\"if\":{\"properties\":{\"kind\":{\"const\":\"implementation-redesign-required\"}},\"required\":[\"kind\"]},\"then\":{\"properties\":{\"owner\":{\"const\":\"design\"},\"target\":{\"type\":\"object\",\"properties\":{\"phase\":{\"const\":\"redesign-requested\"}}}}}}]},\"testFrontier\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"scope\",\"kind\",\"owner\",\"target\"],\"properties\":{\"scope\":{\"const\":\"target\"},\"kind\":{\"enum\":[\"test-delivery-planning\",\"test-host-effect-claim\",\"test-host-effect-execution\",\"test-target-result-import\",\"test-result-review\",\"test-delivery-rerun-planning\",\"product-defect-remediation-authorization\",\"test-review-resume\",\"test-delivery-replacement-planning\"]},\"owner\":{\"enum\":[\"test-delivery-preparation\",\"target-host-effect-claim\",\"agent-host\",\"target-result-import\",\"controller-test-review\",\"controller-product-defect-remediation\",\"controller-target-review-resume\"]},\"target\":{\"$ref\":\"#/$defs/testTarget\"}},\"allOf\":[{\"if\":{\"properties\":{\"kind\":{\"const\":\"test-delivery-planning\"}},\"required\":[\"kind\"]},\"then\":{\"properties\":{\"owner\":{\"const\":\"test-delivery-preparation\"},\"target\":{\"type\":\"object\",\"properties\":{\"phase\":{\"const\":\"planned\"}}}}}},{\"if\":{\"properties\":{\"kind\":{\"const\":\"test-host-effect-claim\"}},\"required\":[\"kind\"]},\"then\":{\"properties\":{\"owner\":{\"const\":\"target-host-effect-claim\"},\"target\":{\"type\":\"object\",\"properties\":{\"phase\":{\"const\":\"test-delivery-prepared\"}}}}}},{\"if\":{\"properties\":{\"kind\":{\"const\":\"test-host-effect-execution\"}},\"required\":[\"kind\"]},\"then\":{\"properties\":{\"owner\":{\"const\":\"agent-host\"},\"target\":{\"type\":\"object\",\"properties\":{\"phase\":{\"const\":\"test-host-effect-claimed\"}}}}}},{\"if\":{\"properties\":{\"kind\":{\"const\":\"test-target-result-import\"}},\"required\":[\"kind\"]},\"then\":{\"properties\":{\"owner\":{\"const\":\"target-result-import\"},\"target\":{\"type\":\"object\",\"properties\":{\"phase\":{\"enum\":[\"test-host-effect-accepted\",\"test-host-effect-indeterminate\"]}}}}}},{\"if\":{\"properties\":{\"kind\":{\"const\":\"test-result-review\"}},\"required\":[\"kind\"]},\"then\":{\"properties\":{\"owner\":{\"const\":\"controller-test-review\"},\"target\":{\"type\":\"object\",\"properties\":{\"phase\":{\"const\":\"test-result-reported\"}}}}}},{\"if\":{\"properties\":{\"kind\":{\"const\":\"test-delivery-rerun-planning\"}},\"required\":[\"kind\"]},\"then\":{\"properties\":{\"owner\":{\"const\":\"test-delivery-preparation\"},\"target\":{\"type\":\"object\",\"properties\":{\"phase\":{\"const\":\"test-another-attempt-requested\"}}}}}},{\"if\":{\"properties\":{\"kind\":{\"const\":\"product-defect-remediation-authorization\"}},\"required\":[\"kind\"]},\"then\":{\"properties\":{\"owner\":{\"const\":\"controller-product-defect-remediation\"},\"target\":{\"type\":\"object\",\"properties\":{\"phase\":{\"const\":\"test-product-defect\"}}}}}},{\"if\":{\"properties\":{\"kind\":{\"const\":\"test-review-resume\"}},\"required\":[\"kind\"]},\"then\":{\"properties\":{\"owner\":{\"const\":\"controller-target-review-resume\"},\"target\":{\"type\":\"object\",\"properties\":{\"phase\":{\"const\":\"test-review-blocked\"}}}}}},{\"if\":{\"properties\":{\"kind\":{\"const\":\"test-delivery-replacement-planning\"}},\"required\":[\"kind\"]},\"then\":{\"properties\":{\"owner\":{\"const\":\"test-delivery-preparation\"},\"target\":{\"type\":\"object\",\"properties\":{\"phase\":{\"const\":\"test-host-effect-rejected\"}}}}}}]},\"implementationTarget\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"workType\",\"targetTaskId\",\"taskPackageId\",\"taskPackageDigest\",\"repositoryId\",\"windowId\",\"phase\"],\"properties\":{\"workType\":{\"const\":\"implementation\"},\"targetTaskId\":{\"$ref\":\"#/$defs/targetTaskId\"},\"taskPackageId\":{\"$ref\":\"#/$defs/taskPackageId\"},\"taskPackageDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"repositoryId\":{\"$ref\":\"#/$defs/repositoryId\"},\"windowId\":{\"$ref\":\"#/$defs/windowId\"},\"phase\":{\"enum\":[\"planned\",\"delivery-prepared\",\"host-effect-claimed\",\"host-effect-accepted\",\"host-effect-indeterminate\",\"host-effect-rejected\",\"result-reported\",\"product-defect-rework-requested\",\"rework-requested\",\"redesign-requested\",\"review-blocked\"]}}},\"testTarget\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"workType\",\"targetTaskId\",\"taskPackageId\",\"taskPackageDigest\",\"windowId\",\"phase\",\"testCard\"],\"properties\":{\"workType\":{\"const\":\"test\"},\"targetTaskId\":{\"$ref\":\"#/$defs/targetTaskId\"},\"taskPackageId\":{\"$ref\":\"#/$defs/taskPackageId\"},\"taskPackageDigest\":{\"$ref\":\"#/$defs/sha256Digest\"},\"windowId\":{\"$ref\":\"#/$defs/windowId\"},\"phase\":{\"enum\":[\"planned\",\"test-delivery-prepared\",\"test-host-effect-claimed\",\"test-host-effect-accepted\",\"test-host-effect-indeterminate\",\"test-host-effect-rejected\",\"test-result-reported\",\"test-another-attempt-requested\",\"test-product-defect\",\"test-review-blocked\"]},\"testCard\":{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"testCardId\",\"testCardDigest\"],\"properties\":{\"testCardId\":{\"$ref\":\"#/$defs/testCardId\"},\"testCardDigest\":{\"$ref\":\"#/$defs/sha256Digest\"}}}}},\"blocker\":{\"oneOf\":[{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"owner\",\"targetTaskId\",\"targetReviewDecisionId\",\"decisionDigest\"],\"properties\":{\"kind\":{\"const\":\"implementation-redesign-not-implemented\"},\"owner\":{\"const\":\"design\"},\"targetTaskId\":{\"$ref\":\"#/$defs/targetTaskId\"},\"targetReviewDecisionId\":{\"$ref\":\"#/$defs/targetReviewDecisionId\"},\"decisionDigest\":{\"$ref\":\"#/$defs/sha256Digest\"}}},{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"owner\"],\"properties\":{\"kind\":{\"const\":\"research-completion-not-implemented\"},\"owner\":{\"const\":\"demand-lifecycle\"}}},{\"type\":\"object\",\"additionalProperties\":false,\"required\":[\"kind\",\"owner\"],\"properties\":{\"kind\":{\"const\":\"isolated-test-planning-not-implemented\"},\"owner\":{\"const\":\"test-card-planning\"}}}]},\"sha256Digest\":{\"type\":\"string\",\"pattern\":\"^sha256:[0-9a-f]{64}$\"},\"programId\":{\"type\":\"string\",\"pattern\":\"^program_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"demandId\":{\"type\":\"string\",\"pattern\":\"^demand_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"targetTaskId\":{\"type\":\"string\",\"pattern\":\"^target-task_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"taskPackageId\":{\"type\":\"string\",\"pattern\":\"^task-package_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"repositoryId\":{\"type\":\"string\",\"pattern\":\"^repository_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"windowId\":{\"type\":\"string\",\"pattern\":\"^window_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"testCardId\":{\"type\":\"string\",\"pattern\":\"^test-card_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"targetReviewDecisionId\":{\"type\":\"string\",\"pattern\":\"^target-review-decision_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"},\"demandEventId\":{\"type\":\"string\",\"pattern\":\"^demand-event_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$\"}}}");
