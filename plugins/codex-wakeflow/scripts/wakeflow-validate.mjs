#!/usr/bin/env node

/**
 * Wakeflow 已发布插件产物的静态验收入口。
 *
 * 能力导航：
 * - 宿主接缝：装载当前 edition 的 artifact checks；只有 core/ 开发副本允许缺席。
 * - 产物清单：核对 required files、shared core manifest、package 与宿主 manifest/MCP 接线。
 * - 领域合同：固定 schema identity、exact exports、常量词汇及 candidate/public 依赖方向。
 * - 公共表面：核对 v3 config、31 项 MCP 工具、四个公开脚本和退役入口缺席。
 * - Skill 与文本：验证 Skill 资源可达性、复用文本边界及仅注释中文白名单。
 * - 依赖防火墙：从 normal/bootstrap roots 构造字面量模块图，阻断退役或迁移专用依赖泄漏。
 *
 * 本文件只读取待发布 artifact 并汇总静态证据；它不初始化 workspace、不执行领域 mutation，
 * 也不替代各 schema、record codec、runtime owner 或宿主 effect owner 的行为测试。
 */

import { existsSync, lstatSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { hostProfile } from "./lib/wakeflow-host-profile.mjs";
import {
  parseWakeflowConfigV3,
  WAKEFLOW_CONFIG_V3_KIND,
  WAKEFLOW_CONFIG_V3_SCHEMA_ID,
  WAKEFLOW_CONFIG_V3_VERSION,
} from "./lib/wakeflow-config-v3.mjs";
import { normalizeWakeflowHostCapabilityProfile } from "./lib/wakeflow-host-capability.mjs";
import { parseWakeflowAssetBundle } from "./lib/wakeflow-template-renderer.mjs";

// 宿主 artifact checks 是 edition-owned seam；core/ 开发源没有该文件，双宿主产物则必须真实装载。
const hostArtifactChecksRelativePath = "scripts/lib/wakeflow-host-artifact-checks.mjs";
const hostArtifactChecksUrl = new URL("./lib/wakeflow-host-artifact-checks.mjs", import.meta.url);
const hostArtifactChecksPath = fileURLToPath(hostArtifactChecksUrl);
let createHostArtifactChecks = createSkippedHostArtifactChecks;
let hostArtifactChecksLoadFailure = null;
if (existsSync(hostArtifactChecksPath)) {
  try {
    const namespace = await import(hostArtifactChecksUrl.href);
    if (typeof namespace.createHostArtifactChecks !== "function") {
      throw new TypeError("createHostArtifactChecks must be a function");
    }
    createHostArtifactChecks = namespace.createHostArtifactChecks;
  } catch (error) {
    hostArtifactChecksLoadFailure = error;
  }
} else {
  console.error(
    "wakeflow-validate: host-artifact checks skipped — the host-local module is absent beside this "
      + "validator. This is expected only for core/ development; run from a synced edition "
      + "(plugins/codex-wakeflow or plugins/claude-code-wakeflow) for full validation.",
  );
}

function createSkippedHostArtifactChecks() {
  return {
    validatePluginManifest() {},
    validateMarketplaceIfPresent() {},
    validateMcpServerWiring() {},
    validateRetiredRuntimeMetaSurface() {},
  };
}

const args = process.argv.slice(2);
const root = path.resolve(getArgValue("--root") || process.cwd());
const errors = [];

// normal artifact 只有四个直接公开脚本；validator 观察它们是否存在，不再借助退役的子进程 dispatcher。
const publicRuntimeScriptEntries = Object.freeze([
  Object.freeze({ name: "wakeflow-cli", file: "wakeflow-cli.mjs" }),
  Object.freeze({ name: "wakeflow-setup", file: "wakeflow-setup.mjs" }),
  Object.freeze({ name: "wakeflow-smoke", file: "wakeflow-smoke.mjs" }),
  Object.freeze({ name: "wakeflow-validate", file: "wakeflow-validate.mjs" }),
]);
if (hostArtifactChecksLoadFailure) {
  errors.push(
    `failed to load ${hostArtifactChecksRelativePath}: ${hostArtifactChecksLoadFailure?.message ?? String(hostArtifactChecksLoadFailure)}`,
  );
}
const placeholderToken = "[TO" + "DO:";
const oldWorkspaceToken = "codex-control" + "-workspace";
const oldLedgerToken = "workspace-" + "ledger";
const oldLedgerReferenceFile = path.join("skills", "wakeflow-governance", "references", "workspace-" + "ledgers.md");
const projectSpecificTokens = [
  "AFA" + "PI",
  "Al" + "embic" + "Workspace",
  "Al" + "embic" + "Plugin",
  "Al" + "embic" + "Core",
];

// 文本策略分为运行文本、本地化文档和“只允许完整注释行出现中文”三种，不授予运行字符串白名单。
const ignoredDirectoryNames = new Set([".git", ".wakeflow-active", ".wakeflow-local", "coverage", "dist", "node_modules"]);
const localizedRuntimeTextFiles = new Set([
  "scripts/lib/wakeflow-active-projector.mjs",
  "scripts/lib/wakeflow-demand-document-builder.mjs",
  "scripts/lib/wakeflow-language.mjs",
  "scripts/lib/wakeflow-rule-model.mjs",
]);
const localizedCommentOnlyTextFiles = new Set([
  "bin/wakeflow-bootstrap",
  "lib/wakeflow-mcp-tools.mjs",
  "lib/wakeflow-process.mjs",
  "mcp/server.cjs",
  "scripts/lib/wakeflow-active-foundation.mjs",
  "scripts/lib/wakeflow-active-identity-lock.mjs",
  "scripts/lib/wakeflow-active-projection-lock.mjs",
  "scripts/lib/wakeflow-artifact-tree-identity.mjs",
  "scripts/lib/wakeflow-atomic-write.mjs",
  "scripts/lib/wakeflow-business-archive-records.mjs",
  "scripts/lib/wakeflow-business-archive-service.mjs",
  "scripts/lib/wakeflow-canonical-json.mjs",
  "scripts/lib/wakeflow-claude-activity.mjs",
  "scripts/lib/wakeflow-claude-host.mjs",
  "scripts/lib/wakeflow-claude-migration-decommission.mjs",
  "scripts/lib/wakeflow-claude-migration-effect.mjs",
  "scripts/lib/wakeflow-codex-migration-decommission.mjs",
  "scripts/lib/wakeflow-codex-migration-effect.mjs",
  "scripts/lib/wakeflow-config-v3.mjs",
  "scripts/lib/wakeflow-config-v3-owner.mjs",
  "scripts/lib/wakeflow-config-v3-snapshot.mjs",
  "scripts/lib/wakeflow-config-v3-transition-authority.mjs",
  "scripts/lib/wakeflow-demand-artifact-records.mjs",
  "scripts/lib/wakeflow-demand-artifact-service.mjs",
  "scripts/lib/wakeflow-demand-core-records.mjs",
  "scripts/lib/wakeflow-demand-layout.mjs",
  "scripts/lib/wakeflow-demand-lifecycle-orchestration.mjs",
  "scripts/lib/wakeflow-demand-publication-service.mjs",
  "scripts/lib/wakeflow-demand-state-service.mjs",
  "scripts/lib/wakeflow-delivery-orchestration.mjs",
  "scripts/lib/wakeflow-evidence-importer.mjs",
  "scripts/lib/wakeflow-evidence-records.mjs",
  "scripts/lib/wakeflow-evidence-tree.mjs",
  "scripts/lib/wakeflow-host-activation-gate.mjs",
  "scripts/lib/wakeflow-host-activation-scope.mjs",
  "scripts/lib/wakeflow-host-capability.mjs",
  "scripts/lib/wakeflow-host-decommission-result.mjs",
  "scripts/lib/wakeflow-host-artifact-checks.mjs",
  "scripts/lib/wakeflow-host-profile.mjs",
  "scripts/lib/wakeflow-host-settings-assets-owner.mjs",
  "scripts/lib/wakeflow-identifiers.mjs",
  "scripts/lib/wakeflow-keep-live-records.mjs",
  "scripts/lib/wakeflow-keep-live-service.mjs",
  "scripts/lib/wakeflow-ledger-materialization.mjs",
  "scripts/lib/wakeflow-ledger-projector.mjs",
  "scripts/lib/wakeflow-ledger-records.mjs",
  "scripts/lib/wakeflow-legacy-archive-records.mjs",
  "scripts/lib/wakeflow-legacy-archive-transform.mjs",
  "scripts/lib/wakeflow-legacy-classifier.mjs",
  "scripts/lib/wakeflow-legacy-owner-drain.mjs",
  "scripts/lib/wakeflow-layout-descriptor.mjs",
  "scripts/lib/wakeflow-local-layout-inspection.mjs",
  "scripts/lib/wakeflow-local-layout-realization.mjs",
  "scripts/lib/wakeflow-local-layout.mjs",
  "scripts/lib/wakeflow-fresh-initialize.mjs",
  "scripts/lib/wakeflow-fs-safety.mjs",
  "scripts/lib/wakeflow-maintenance-action-composition.mjs",
  "scripts/lib/wakeflow-maintenance-action-runtime.mjs",
  "scripts/lib/wakeflow-maintenance-coordinator.mjs",
  "scripts/lib/wakeflow-maintenance-plan.mjs",
  "scripts/lib/wakeflow-managed-content.mjs",
  "scripts/lib/wakeflow-migration-apply.mjs",
  "scripts/lib/wakeflow-migration-config-owner.mjs",
  "scripts/lib/wakeflow-migration-inventory.mjs",
  "scripts/lib/wakeflow-migration-host-decommission.mjs",
  "scripts/lib/wakeflow-migration-plan.mjs",
  "scripts/lib/wakeflow-migration-production.mjs",
  "scripts/lib/wakeflow-observability-v3.mjs",
  "scripts/lib/wakeflow-pod-records.mjs",
  "scripts/lib/wakeflow-pod-service.mjs",
  "scripts/lib/wakeflow-preservation.mjs",
  "scripts/lib/wakeflow-process-identity.mjs",
  "scripts/lib/wakeflow-public-v3-runtime.mjs",
  "scripts/lib/wakeflow-reconcile.mjs",
  "scripts/lib/wakeflow-reconfigure.mjs",
  "scripts/lib/wakeflow-result-review-orchestration.mjs",
  "scripts/lib/wakeflow-state-lock.mjs",
  "scripts/lib/wakeflow-support-materialization.mjs",
  "scripts/lib/wakeflow-support-surface-owner.mjs",
  "scripts/lib/wakeflow-target-result-authority.mjs",
  "scripts/lib/wakeflow-template-renderer.mjs",
  "scripts/lib/wakeflow-todo-service.mjs",
  "scripts/lib/wakeflow-todo-table.mjs",
  "scripts/lib/wakeflow-tracked-materialization.mjs",
  "scripts/lib/wakeflow-transport-records.mjs",
  "scripts/lib/wakeflow-transport-retention.mjs",
  "scripts/lib/wakeflow-transport-store.mjs",
  "scripts/lib/wakeflow-window-binding-records.mjs",
  "scripts/lib/wakeflow-window-binding-service.mjs",
  "scripts/lib/wakeflow-window-lease-records.mjs",
  "scripts/lib/wakeflow-window-lease-service.mjs",
  "scripts/lib/wakeflow-window-runtime-projector.mjs",
  "scripts/lib/wakeflow-window-runtime-records.mjs",
  "scripts/lib/wakeflow-workspace-mutation.mjs",
  "scripts/lib/wakeflow-codex-pod-host.mjs",
  "scripts/lib/wakeflow-codex-activation-scope.mjs",
  "scripts/lib/wakeflow-codex-decommission.mjs",
  "scripts/lib/wakeflow-claude-activation-scope.mjs",
  "scripts/lib/wakeflow-claude-decommission.mjs",
  "scripts/lib/wakeflow-claude-lifecycle.mjs",
  "scripts/lib/wakeflow-claude-locator.mjs",
  "scripts/lib/wakeflow-claude-settings.mjs",
  "scripts/lib/wakeflow-claude-transport.mjs",
  "scripts/lib/wakeflow-claude-pod-host.mjs",
  "scripts/wakeflow-cli.mjs",
  "scripts/wakeflow-bootstrap.mjs",
  "scripts/wakeflow-setup.mjs",
  "scripts/wakeflow-smoke.mjs",
  "scripts/wakeflow-validate.mjs",
]);
const localizedDocumentationTextFiles = new Set([
  "README.zh-CN.md",
  "templates/wakeflow-asset-bundle.json",
]);

// schema、module 与固定词汇登记是发布期观察矩阵；真实解析、写入与状态转换仍归各领域 owner。
const EXPECTED_CONFIG_V3_SCHEMA_ID = "https://raw.githubusercontent.com/GxFn/Wakeflow/main/core/schemas/wakeflow-config.schema.json";
const EXPECTED_CONFIG_V3_SCHEMA_DRAFT = "https://json-schema.org/draft/2020-12/schema";
const EXPECTED_CONFIG_V3_KIND = "WakeflowConfig";
const EXPECTED_CONFIG_V3_VERSION = 3;
const EXPECTED_SCHEMA_DRAFT = "https://json-schema.org/draft/2020-12/schema";

// Demand、evidence、active projection 与 archive 合同。
const demandArtifactSchemas = Object.freeze([
  Object.freeze({
    file: "schemas/wakeflow-demand-artifacts/pod-design-handoff.schema.json",
    id: "urn:wakeflow:internal:demand-artifact:pod-design-handoff:v1",
    artifactKind: "wakeflow-pod-design-handoff",
  }),
  Object.freeze({
    file: "schemas/wakeflow-demand-artifacts/pod-design-request.schema.json",
    id: "urn:wakeflow:internal:demand-artifact:pod-design-request:v1",
    artifactKind: "wakeflow-pod-design-request",
  }),
  Object.freeze({
    file: "schemas/wakeflow-demand-artifacts/review-candidate.schema.json",
    id: "urn:wakeflow:internal:demand-artifacts:review-candidate:v1",
    artifactKind: "wakeflow-review-candidate",
  }),
  Object.freeze({
    file: "schemas/wakeflow-demand-artifacts/target-result.schema.json",
    id: "urn:wakeflow:internal:demand-artifacts:target-result:v1",
    artifactKind: "wakeflow-target-result",
  }),
  Object.freeze({
    file: "schemas/wakeflow-demand-artifacts/task-package.schema.json",
    id: "urn:wakeflow:internal:demand-artifacts:task-package:v1",
    artifactKind: "wakeflow-task-package",
  }),
  Object.freeze({
    file: "schemas/wakeflow-demand-artifacts/test-card.schema.json",
    id: "urn:wakeflow:internal:demand-artifacts:test-card:v1",
    artifactKind: "wakeflow-test-card",
  }),
]);
const demandArtifactModules = Object.freeze([
  Object.freeze({
    file: "scripts/lib/wakeflow-demand-artifact-records.mjs",
    exports: Object.freeze([
      "WAKEFLOW_DEMAND_ARTIFACT_KINDS",
      "WAKEFLOW_DEMAND_ARTIFACT_SCHEMA_VERSION",
      "WakeflowDemandArtifactError",
      "demandArtifactCanonicalBytes",
      "demandArtifactContractForKind",
      "demandArtifactDigest",
      "demandArtifactIdentity",
      "demandArtifactRef",
      "inspectDemandArtifactInventory",
      "loadDemandArtifactByRef",
      "validateDemandArtifactRecord",
      "validateDemandArtifactWriteIntent",
      "validatePodDesignHandoffArtifact",
      "validatePodDesignRequestArtifact",
      "validateReviewCandidateArtifact",
      "validateTargetResultArtifact",
      "validateTaskPackageArtifact",
      "validateTestCardArtifact",
    ]),
  }),
  Object.freeze({
    file: "scripts/lib/wakeflow-demand-artifact-service.mjs",
    exports: Object.freeze([
      "WakeflowDemandArtifactServiceError",
      "createReviewCandidateArtifact",
      "createTaskPackageArtifact",
      "createTestCardArtifact",
      "inventoryDemandArtifacts",
      "recordTargetResultArtifact",
      "validateDemandTaskAssignmentAgainstTopology",
    ]),
  }),
  Object.freeze({
    file: "scripts/lib/wakeflow-target-result-authority.mjs",
    exports: Object.freeze([
      "WakeflowTargetResultAuthorityError",
      "buildTargetResultAuthoritySnapshotFromLoaded",
      "loadTargetResultAuthoritySnapshot",
    ]),
  }),
]);
const demandArtifactContractFiles = Object.freeze([
  ...demandArtifactSchemas.map(({ file }) => file),
  ...demandArtifactModules.map(({ file }) => file),
]);
const demandLifecycleModule = Object.freeze({
  file: "scripts/lib/wakeflow-demand-lifecycle-orchestration.mjs",
  valueExports: Object.freeze([]),
  exports: Object.freeze([
    "WakeflowDemandLifecycleOrchestrationError",
    "applyDemandLifecycleTransitionPlan",
    "planDemandLifecycleTransition",
    "recoverDemandLifecycleTransition",
  ]),
});
const demandLifecycleIntegrationFiles = Object.freeze([
  "schemas/wakeflow-demand-core/controller-event.schema.json",
  "schemas/wakeflow-demand-core/wakeflow-state.schema.json",
  "scripts/lib/wakeflow-demand-core-records.mjs",
  "scripts/lib/wakeflow-demand-state-service.mjs",
]);
const demandLifecycleContractFiles = Object.freeze([
  ...demandLifecycleIntegrationFiles,
  demandLifecycleModule.file,
]);
const evidenceSchema = Object.freeze({
  file: "schemas/wakeflow-demand-evidence/evidence.schema.json",
  id: "urn:wakeflow:internal:demand-evidence:evidence:v1",
  artifactKind: "wakeflow-evidence",
});
const evidenceModules = Object.freeze([
  Object.freeze({
    file: "scripts/lib/wakeflow-evidence-records.mjs",
    valueExports: Object.freeze([
      "WAKEFLOW_EVIDENCE_ARTIFACT_KIND",
      "WAKEFLOW_EVIDENCE_CONTENT_CLASSES",
      "WAKEFLOW_EVIDENCE_MAX_MANIFEST_BYTES",
      "WAKEFLOW_EVIDENCE_MAX_RELATIONS",
      "WAKEFLOW_EVIDENCE_SCHEMA_VERSION",
    ]),
    exports: Object.freeze([
      "WakeflowEvidenceRecordError",
      "evidenceIdentity",
      "evidenceManifestCanonicalBytes",
      "evidenceManifestDigest",
      "evidenceManifestRef",
      "evidencePayloadTreeDigest",
      "inspectManagedEvidenceInventory",
      "loadManagedEvidenceByRef",
      "loadManagedEvidencePortableMembers",
      "validateEvidenceManifest",
      "validateEvidencePayload",
      "validateEvidenceSource",
      "validateEvidenceWriteIntent",
    ]),
  }),
  Object.freeze({
    file: "scripts/lib/wakeflow-evidence-tree.mjs",
    valueExports: Object.freeze([
      "CONTENT_CLASSES",
      "PRIVACY_SCAN_VERSION",
      "WAKEFLOW_EVIDENCE_CONTENT_CLASSES",
      "WAKEFLOW_EVIDENCE_LIMITS",
    ]),
    exports: Object.freeze([
      "WakeflowEvidenceTreeError",
      "assertNoEvidenceStageResidue",
      "evidenceRootPath",
      "evidenceStagePath",
      "inspectConfiguredEvidenceSource",
      "inspectEvidenceFinalWrite",
      "inspectEvidenceStage",
      "materializeEvidenceStage",
      "publishEvidenceStage",
    ]),
  }),
  Object.freeze({
    file: "scripts/lib/wakeflow-evidence-importer.mjs",
    valueExports: Object.freeze([]),
    exports: Object.freeze([
      "WakeflowEvidenceImporterError",
      "applyManagedEvidenceImport",
      "planManagedEvidenceImport",
      "recoverManagedEvidenceImport",
    ]),
  }),
]);
const evidenceContractFiles = Object.freeze([
  evidenceSchema.file,
  ...evidenceModules.map(({ file }) => file),
]);
const activeProjectionModules = Object.freeze([
  Object.freeze({
    file: "scripts/lib/wakeflow-config-v3-snapshot.mjs",
    invocationClass: "candidate-domain-only",
    normalRuntime: false,
    versionExport: "WAKEFLOW_CONFIG_V3_SNAPSHOT_SCHEMA_VERSION",
    exports: Object.freeze([
      "WakeflowConfigV3SnapshotError",
      "loadWakeflowConfigV3Snapshot",
    ]),
  }),
  Object.freeze({
    file: "scripts/lib/wakeflow-active-projector.mjs",
    invocationClass: "candidate-domain-only",
    normalRuntime: false,
    versionExport: "WAKEFLOW_ACTIVE_PROJECTOR_SCHEMA_VERSION",
    valueExports: Object.freeze([
      "WAKEFLOW_ACTIVE_PROJECTION_MAINTENANCE_KIND",
      "WAKEFLOW_ACTIVE_PROJECTION_MAINTENANCE_SCHEMA_ID",
      "WAKEFLOW_ACTIVE_PROJECTION_MAINTENANCE_SCHEMA_VERSION",
    ]),
    exports: Object.freeze([
      "WakeflowActiveProjectorError",
      "createWakeflowActiveProjectionMutationParticipant",
      "inspectWakeflowActiveProjection",
      "planWakeflowActiveProjectionMaintenance",
      "projectWakeflowActiveProjectionMaintenance",
      "rebuildWakeflowActiveProjection",
      "validateWakeflowActiveProjectionMaintenancePlan",
    ]),
  }),
]);
const activeProjectionContractFiles = Object.freeze(activeProjectionModules.map(({ file }) => file));
const activeCoordinationModules = Object.freeze([
  Object.freeze({
    file: "scripts/lib/wakeflow-active-projection-lock.mjs",
    valueExports: Object.freeze(["WAKEFLOW_ACTIVE_PROJECTION_LOCK_REF"]),
    exports: Object.freeze(["withWakeflowActiveProjectionLock"]),
  }),
  Object.freeze({
    file: "scripts/lib/wakeflow-active-identity-lock.mjs",
    valueExports: Object.freeze(["WAKEFLOW_ACTIVE_IDENTITY_LOCK_REF"]),
    exports: Object.freeze(["withWakeflowActiveIdentityLock"]),
  }),
]);
const activeCoordinationContractFiles = Object.freeze(activeCoordinationModules.map(({ file }) => file));
const businessArchiveSchemas = Object.freeze([
  Object.freeze({
    file: "schemas/wakeflow-business-archive/business-summary.schema.json",
    id: "urn:wakeflow:internal:business-archive:summary:v1",
    artifactKind: "wakeflow-business-archive-summary",
  }),
  Object.freeze({
    file: "schemas/wakeflow-business-archive/transport-summary.schema.json",
    id: "urn:wakeflow:internal:business-archive:transport-summary:v1",
    artifactKind: "wakeflow-business-archive-transport-summary",
  }),
  Object.freeze({
    file: "schemas/wakeflow-business-archive/todo-history.schema.json",
    id: "urn:wakeflow:internal:business-archive:todo-history:v1",
    artifactKind: "wakeflow-business-archive-todo-history",
  }),
  Object.freeze({
    file: "schemas/wakeflow-business-archive/archive-transaction.schema.json",
    id: "urn:wakeflow:internal:business-archive:transaction:v1",
    artifactKind: "wakeflow-business-archive-transaction",
  }),
]);
const businessArchiveReferenceSchemaFiles = Object.freeze([
  "schemas/wakeflow-demand-core/controller-event.schema.json",
  "schemas/wakeflow-demand-core/wakeflow-state.schema.json",
  "schemas/wakeflow-ledger/archive-manifest.schema.json",
]);
const businessArchiveModules = Object.freeze([
  Object.freeze({
    file: "scripts/lib/wakeflow-business-archive-records.mjs",
    valueExports: Object.freeze([
      "WAKEFLOW_BUSINESS_ARCHIVE_KINDS",
      "WAKEFLOW_BUSINESS_ARCHIVE_SCHEMA_VERSION",
    ]),
    exports: Object.freeze([
      "WakeflowBusinessArchiveRecordError",
      "assertBusinessArchivePortable",
      "businessArchiveByteDigest",
      "businessArchiveCanonicalBytes",
      "businessArchiveDigest",
      "validateBusinessArchivePlan",
      "validateBusinessArchiveSummary",
      "validateBusinessArchiveTodoHistory",
      "validateBusinessArchiveTransportSummary",
      "validateBusinessArchiveTransaction",
    ]),
  }),
  Object.freeze({
    file: "scripts/lib/wakeflow-business-archive-service.mjs",
    valueExports: Object.freeze([]),
    exports: Object.freeze([
      "WakeflowBusinessArchiveError",
      "commitDemandBusinessArchive",
      "inspectDemandBusinessArchive",
      "planDemandBusinessArchive",
      "recoverDemandBusinessArchive",
    ]),
  }),
]);
const businessArchiveContractFiles = Object.freeze([
  ...businessArchiveSchemas.map(({ file }) => file),
  ...businessArchiveModules.map(({ file }) => file),
]);

// Window identity、宿主关闭/激活、lease 与 Pod 合同。
const windowBindingSchema = Object.freeze({
  file: "schemas/wakeflow-window-identity/window-binding.schema.json",
  id: "urn:wakeflow:internal:window-identity:binding:v1",
  kind: "wakeflow-window-binding",
});
const windowBindingModules = Object.freeze([
  Object.freeze({
    file: "scripts/lib/wakeflow-window-binding-records.mjs",
    valueExports: Object.freeze([
      "WAKEFLOW_WINDOW_BINDING_KIND",
      "WAKEFLOW_WINDOW_BINDING_SCHEMA_VERSION",
    ]),
    exports: Object.freeze([
      "WakeflowWindowBindingRecordError",
      "assertWindowBindingId",
      "createWindowBindingRecord",
      "generateWindowBindingId",
      "validateWindowBindingRecord",
      "windowBindingCanonicalBytes",
      "windowBindingDigest",
      "windowBindingRef",
    ]),
  }),
  Object.freeze({
    file: "scripts/lib/wakeflow-window-binding-service.mjs",
    valueExports: Object.freeze([]),
    exports: Object.freeze([
      "WakeflowWindowBindingError",
      "decommissionPreauthorizedWindowBindingWithinMutation",
      "decommissionWindowBinding",
      "inspectWindowBindingInventory",
      "inspectWindowBindingInventoryForLayout",
      "inspectWindowBindingInventoryForProtocolHost",
      "registerPreauthorizedWindowBindingWithinMutation",
      "registerWindowBinding",
      "replaceWindowBinding",
      "withCurrentWindowBindingHandle",
    ]),
  }),
]);
const windowBindingContractFiles = Object.freeze([
  windowBindingSchema.file,
  ...windowBindingModules.map(({ file }) => file),
]);
const hostDecommissionResultSchema = Object.freeze({
  file: "schemas/wakeflow-window-identity/host-decommission-result.schema.json",
  id: "urn:wakeflow:internal:window-identity:host-decommission-result:v1",
  kind: "WakeflowHostDecommissionResult",
});
const hostDecommissionResultModule = Object.freeze({
  file: "scripts/lib/wakeflow-host-decommission-result.mjs",
  valueExports: Object.freeze([
    "WAKEFLOW_HOST_DECOMMISSION_RESULT_KIND",
    "WAKEFLOW_HOST_DECOMMISSION_SCHEMA_VERSION",
  ]),
  exports: Object.freeze([
    "WakeflowHostDecommissionResultError",
    "createHostDecommissionResult",
    "hostDecommissionResultCanonicalBytes",
    "hostDecommissionResultDigest",
    "hostDecommissionResultToPodCloseObservation",
    "validateHostDecommissionResult",
  ]),
});
const hostDecommissionModule = hostProfile.artifact.decommissionHostFile
  ? Object.freeze({
      file: hostProfile.artifact.decommissionHostFile,
      valueExports: Object.freeze(hostProfile.hostId === "claude-code"
        ? [
            "WAKEFLOW_CLAUDE_DECOMMISSION_HOST_ID",
            "WAKEFLOW_CLAUDE_DECOMMISSION_SCHEMA_VERSION",
          ]
        : [
            "WAKEFLOW_CODEX_DECOMMISSION_HOST_ID",
            "WAKEFLOW_CODEX_DECOMMISSION_SCHEMA_VERSION",
          ]),
      exports: Object.freeze(hostProfile.hostId === "claude-code"
        ? [
            "WakeflowClaudeDecommissionError",
            "executeClaudeWindowDecommission",
            "planClaudeWindowDecommission",
            "recoverClaudeWindowDecommission",
            "validateClaudeWindowDecommissionPlan",
          ]
        : [
            "WakeflowCodexDecommissionError",
            "planCodexWindowDecommission",
            "recordCodexWindowDecommissionObservation",
            "validateCodexWindowDecommissionPlan",
          ]),
    })
  : null;
const hostDecommissionContractFiles = Object.freeze([
  hostDecommissionResultSchema.file,
  hostDecommissionResultModule.file,
]);
const hostActivationScopeObservationModule = Object.freeze({
  file: "scripts/lib/wakeflow-host-activation-scope.mjs",
  valueExports: Object.freeze([
    "HOST_ACTIVATION_SCOPES",
    "WAKEFLOW_HOST_ACTIVATION_SCOPE_KIND",
    "WAKEFLOW_HOST_ACTIVATION_SCOPE_SCHEMA_VERSION",
  ]),
  exports: Object.freeze([
    "WakeflowHostActivationScopeError",
    "hostActivationScopeCanonicalBytes",
    "hostActivationScopeDigest",
    "validateHostActivationScopeObservation",
  ]),
});
const hostActivationGateModule = Object.freeze({
  file: "scripts/lib/wakeflow-host-activation-gate.mjs",
  valueExports: Object.freeze([
    "HOST_ACTIVATION_GATE_STATUSES",
    "WAKEFLOW_HOST_ACTIVATION_GATE_SCHEMA_VERSION",
    "WAKEFLOW_HOST_ACTIVATION_REPORT_KIND",
    "WAKEFLOW_WORKSPACE_ACTIVATION_SUBJECT_KIND",
    "WAKEFLOW_WORKSPACE_CUTOVER_OBSERVATION_KIND",
  ]),
  exports: Object.freeze([
    "WakeflowHostActivationGateError",
    "createWakeflowWorkspaceActivationSubjectDigest",
    "createWakeflowWorkspaceCutoverObservation",
    "evaluateWakeflowHostActivationGate",
    "hostActivationReportDigest",
    "validateWakeflowHostActivationReport",
  ]),
});
const hostActivationScopeAdapterModule = hostProfile.artifact.activationScopeHostFile
  ? Object.freeze({
      file: hostProfile.artifact.activationScopeHostFile,
      valueExports: Object.freeze(hostProfile.hostId === "claude-code"
        ? [
            "WAKEFLOW_CLAUDE_ACTIVATION_SCOPE_HOST_ID",
            "WAKEFLOW_CLAUDE_ACTIVATION_SCOPE_PLUGIN_ID",
            "WAKEFLOW_CLAUDE_INSTALLATION_OBSERVATION_KIND",
            "WAKEFLOW_CLAUDE_INSTALLATION_OBSERVATION_SCHEMA_VERSION",
            "wakeflowHostActivationScopeAdapter",
          ]
        : [
            "WAKEFLOW_CODEX_ACTIVATION_SCOPE_HOST_ID",
            "WAKEFLOW_CODEX_ACTIVATION_SCOPE_PLUGIN_ID",
            "wakeflowHostActivationScopeAdapter",
          ]),
      exports: Object.freeze(hostProfile.hostId === "claude-code"
        ? [
            "WakeflowClaudeActivationScopeError",
            "inspectClaudeHostActivationScope",
          ]
        : [
            "WakeflowCodexActivationScopeError",
            "inspectCodexHostActivationScope",
          ]),
    })
  : null;
const hostActivationScopeContractFiles = Object.freeze([
  hostActivationGateModule.file,
  hostActivationScopeObservationModule.file,
]);
const windowCoordinationLeaseSchema = Object.freeze({
  file: "schemas/wakeflow-coordination/window-lease.schema.json",
  id: "urn:wakeflow:internal:coordination:window-lease:v1",
  kind: "wakeflow-window-coordination-lease",
});
const windowCoordinationLeaseModules = Object.freeze([
  Object.freeze({
    file: "scripts/lib/wakeflow-window-lease-records.mjs",
    valueExports: Object.freeze([
      "WAKEFLOW_WINDOW_COORDINATION_LEASE_KIND",
      "WAKEFLOW_WINDOW_COORDINATION_LEASE_SCHEMA_VERSION",
    ]),
    exports: Object.freeze([
      "WakeflowWindowCoordinationLeaseRecordError",
      "assertWindowCoordinationLeaseId",
      "createWindowCoordinationLeaseRecord",
      "generateWindowCoordinationLeaseId",
      "sameWindowCoordinationLeaseOwner",
      "validateWindowCoordinationLeaseRecord",
      "windowCoordinationLeaseCanonicalBytes",
      "windowCoordinationLeaseDigest",
      "windowCoordinationLeaseRef",
    ]),
  }),
  Object.freeze({
    file: "scripts/lib/wakeflow-window-lease-service.mjs",
    valueExports: Object.freeze([]),
    exports: Object.freeze([
      "WakeflowWindowCoordinationLeaseError",
      "acquireWindowCoordinationLease",
      "acquireWindowCoordinationLeaseAdmitted",
      "inspectWindowCoordinationLeaseInventory",
      "inspectWindowCoordinationLeaseInventoryForLayout",
      "releaseWindowCoordinationLease",
      "releaseWindowCoordinationLeaseAdmitted",
    ]),
  }),
]);
const windowCoordinationLeaseContractFiles = Object.freeze([
  windowCoordinationLeaseSchema.file,
  ...windowCoordinationLeaseModules.map(({ file }) => file),
]);
const podSchemas = Object.freeze([
  Object.freeze({
    file: "schemas/wakeflow-pod/pod-scope.schema.json",
    id: "urn:wakeflow:internal:pod:scope:v1",
    kind: "WakeflowPodEvidenceScope",
    kindExport: "WAKEFLOW_POD_SCOPE_KIND",
  }),
  Object.freeze({
    file: "schemas/wakeflow-pod/launch-intent.schema.json",
    id: "urn:wakeflow:internal:pod:launch-intent:v1",
    kind: "WakeflowPodLaunchIntent",
    kindExport: "WAKEFLOW_POD_LAUNCH_INTENT_KIND",
  }),
  Object.freeze({
    file: "schemas/wakeflow-pod/materialization-event.schema.json",
    id: "urn:wakeflow:internal:pod:materialization-event:v1",
    kind: "WakeflowPodMaterializationEvent",
    kindExport: "WAKEFLOW_POD_MATERIALIZATION_EVENT_KIND",
  }),
  Object.freeze({
    file: "schemas/wakeflow-pod/creation-receipt.schema.json",
    id: "urn:wakeflow:internal:pod:creation-receipt:v1",
    kind: "WakeflowPodCreationReceipt",
    kindExport: "WAKEFLOW_POD_CREATION_RECEIPT_KIND",
  }),
  Object.freeze({
    file: "schemas/wakeflow-pod/resume-observation.schema.json",
    id: "urn:wakeflow:internal:pod:resume-observation:v1",
    kind: "WakeflowPodResumeObservation",
    kindExport: "WAKEFLOW_POD_RESUME_OBSERVATION_KIND",
  }),
  Object.freeze({
    file: "schemas/wakeflow-pod/test-access-plan.schema.json",
    id: "urn:wakeflow:internal:pod:test-access-plan:v1",
    kind: "WakeflowPodTestAccessPlan",
    kindExport: "WAKEFLOW_POD_TEST_ACCESS_PLAN_KIND",
  }),
  Object.freeze({
    file: "schemas/wakeflow-pod/test-access-receipt.schema.json",
    id: "urn:wakeflow:internal:pod:test-access-receipt:v1",
    kind: "WakeflowPodTestAccessReceipt",
    kindExport: "WAKEFLOW_POD_TEST_ACCESS_RECEIPT_KIND",
  }),
  Object.freeze({
    file: "schemas/wakeflow-pod/close-intent.schema.json",
    id: "urn:wakeflow:internal:pod:close-intent:v1",
    kind: "WakeflowPodCloseIntent",
    kindExport: "WAKEFLOW_POD_CLOSE_INTENT_KIND",
  }),
  Object.freeze({
    file: "schemas/wakeflow-pod/close-receipt.schema.json",
    id: "urn:wakeflow:internal:pod:close-receipt:v1",
    kind: "WakeflowPodCloseReceipt",
    kindExport: "WAKEFLOW_POD_CLOSE_RECEIPT_KIND",
  }),
]);
const podModules = Object.freeze([
  Object.freeze({
    file: "scripts/lib/wakeflow-pod-records.mjs",
    valueExports: Object.freeze([
      "WAKEFLOW_POD_CLOSE_INTENT_KIND",
      "WAKEFLOW_POD_CLOSE_RECEIPT_KIND",
      "WAKEFLOW_POD_CREATION_RECEIPT_KIND",
      "WAKEFLOW_POD_LAUNCH_INTENT_KIND",
      "WAKEFLOW_POD_MATERIALIZATION_EVENT_KIND",
      "WAKEFLOW_POD_RECORD_KINDS",
      "WAKEFLOW_POD_RESUME_OBSERVATION_KIND",
      "WAKEFLOW_POD_SCHEMA_VERSION",
      "WAKEFLOW_POD_SCOPE_KIND",
      "WAKEFLOW_POD_TEST_ACCESS_PLAN_KIND",
      "WAKEFLOW_POD_TEST_ACCESS_RECEIPT_KIND",
    ]),
    exports: Object.freeze([
      "WakeflowPodRecordError",
      "createPodCloseIntentRecord",
      "createPodCloseReceiptRecord",
      "createPodCreationReceiptRecord",
      "createPodLaunchIntentRecord",
      "createPodMaterializationEventRecord",
      "createPodResumeObservationRecord",
      "createPodScopeRecord",
      "createPodTestAccessPlanRecord",
      "createPodTestAccessReceiptRecord",
      "podRecordCanonicalBytes",
      "podRecordDigest",
      "podRecordRef",
      "podTestAccessBindingSetDigest",
      "validatePodRecord",
    ]),
  }),
  Object.freeze({
    file: "scripts/lib/wakeflow-pod-service.mjs",
    valueExports: Object.freeze([]),
    exports: Object.freeze([
      "WakeflowPodServiceError",
      "applyPodLaunchInitializationPlan",
      "applyPodProductLaunchAppendPlan",
      "decommissionClosedPodWindowBinding",
      "inspectPodClose",
      "inspectPodCloseFromLoadedWhileLocked",
      "inspectPodEvidenceInventory",
      "inspectPodEvidenceInventoryForLayout",
      "inspectPodTestAccess",
      "inspectPodWindowMaterialization",
      "observePodCloseIntent",
      "observePodTestAccessPlan",
      "planPodLaunchInitialization",
      "planPodProductLaunchAppend",
      "planPodWindowMaterialization",
      "recordPodCloseIntent",
      "recordPodCloseReceipt",
      "recordPodCreationReceipt",
      "recordPodDesignHandoffArtifact",
      "recordPodDesignRequestArtifact",
      "recordPodMaterializationEvent",
      "recordPodTestAccessPlan",
      "recordPodTestAccessReceipt",
    ]),
  }),
]);
const podStateIntegrationFiles = Object.freeze([
  "schemas/wakeflow-demand-core/controller-event.schema.json",
  "schemas/wakeflow-demand-core/wakeflow-state.schema.json",
  "scripts/lib/wakeflow-demand-core-records.mjs",
  "scripts/lib/wakeflow-demand-state-service.mjs",
]);
const podContractFiles = Object.freeze([
  ...podSchemas.map(({ file }) => file),
  ...podModules.map(({ file }) => file),
  ...podStateIntegrationFiles,
]);

// normal runtime 退役清单与 bootstrap-only migration closure 共同形成 M7A 依赖防火墙。
const retiredNormalDependencyBasenames = Object.freeze([
  "verify-workspace-docs.mjs",
  "wakeflow-active-demands.mjs",
  "wakeflow-archive-docs.mjs",
  "wakeflow-archive-summaries.mjs",
  "wakeflow-archive-todo.mjs",
  "wakeflow-artifact-identity.mjs",
  "wakeflow-check-boundary.mjs",
  "wakeflow-check-layout.mjs",
  "wakeflow-check-repository-residue.mjs",
  "wakeflow-check-runtime.mjs",
  "wakeflow-check-scripts.mjs",
  "wakeflow-config.mjs",
  "wakeflow-controller-events.mjs",
  "wakeflow-controller-return.mjs",
  "wakeflow-delivery-evidence.mjs",
  "wakeflow-delivery-run-recording-command.mjs",
  "wakeflow-delivery-status-command.mjs",
  "wakeflow-delivery-store.mjs",
  "wakeflow-delivery.mjs",
  "wakeflow-demand-authority.mjs",
  "wakeflow-demand-sequence.mjs",
  "wakeflow-dispatch-commands.mjs",
  "wakeflow-dispatch-group-review.mjs",
  "wakeflow-document-placement.mjs",
  "wakeflow-idempotency.mjs",
  "wakeflow-intake.mjs",
  "wakeflow-keep-live.mjs",
  "wakeflow-language.mjs",
  "wakeflow-legacy-local-result-recording-command.mjs",
  "wakeflow-mainline-health.mjs",
  "wakeflow-next-work.mjs",
  "wakeflow-pod-runtime.mjs",
  "wakeflow-pod-reservations.mjs",
  "wakeflow-pod.mjs",
  "wakeflow-progress-appends.mjs",
  "wakeflow-redaction.mjs",
  "wakeflow-render-progress.mjs",
  "wakeflow-repo-status.mjs",
  "wakeflow-result-contract.mjs",
  "wakeflow-result-recording-commands.mjs",
  "wakeflow-return-policy.mjs",
  "wakeflow-review-commands.mjs",
  "wakeflow-review-pack.mjs",
  "wakeflow-review-scope.mjs",
  "wakeflow-runtime-summary.mjs",
  "wakeflow-runtime.mjs",
  "wakeflow-state-paths.mjs",
  "wakeflow-state-results.mjs",
  "wakeflow-state-transition.mjs",
  "wakeflow-state.mjs",
  "wakeflow-status-machine.mjs",
  "wakeflow-storage-map.mjs",
  "wakeflow-storage.mjs",
  "wakeflow-stream-overlay.mjs",
  "wakeflow-task-package.mjs",
  "wakeflow-thread-registry.mjs",
  "wakeflow-todo.mjs",
  "wakeflow-trace.mjs",
  "wakeflow-trace-spine-command.mjs",
  "wakeflow-verify.mjs",
  "wakeflow-window-runtime.mjs",
  "wakeflow-workspace-projection.mjs",
]);
const retiredNormalRuntimePaths = Object.freeze([
  "lib/wakeflow-runtime.mjs",
  "lib/wakeflow-trace.mjs",
  "scripts/lib/wakeflow-active-demands.mjs",
  "scripts/lib/wakeflow-artifact-identity.mjs",
  "scripts/lib/wakeflow-config.mjs",
  "scripts/lib/wakeflow-controller-events.mjs",
  "scripts/lib/wakeflow-controller-return.mjs",
  "scripts/lib/wakeflow-delivery-evidence.mjs",
  "scripts/lib/wakeflow-delivery-run-recording-command.mjs",
  "scripts/lib/wakeflow-delivery-status-command.mjs",
  "scripts/lib/wakeflow-delivery-store.mjs",
  "scripts/lib/wakeflow-demand-authority.mjs",
  "scripts/lib/wakeflow-dispatch-commands.mjs",
  "scripts/lib/wakeflow-dispatch-group-review.mjs",
  "scripts/lib/wakeflow-document-placement.mjs",
  "scripts/lib/wakeflow-idempotency.mjs",
  "scripts/lib/wakeflow-keep-live.mjs",
  "scripts/lib/wakeflow-language.mjs",
  "scripts/lib/wakeflow-legacy-local-result-recording-command.mjs",
  "scripts/lib/wakeflow-mainline-health.mjs",
  "scripts/lib/wakeflow-pod-reservations.mjs",
  "scripts/lib/wakeflow-pod-runtime.mjs",
  "scripts/lib/wakeflow-progress-appends.mjs",
  "scripts/lib/wakeflow-redaction.mjs",
  "scripts/lib/wakeflow-result-contract.mjs",
  "scripts/lib/wakeflow-result-recording-commands.mjs",
  "scripts/lib/wakeflow-return-policy.mjs",
  "scripts/lib/wakeflow-review-commands.mjs",
  "scripts/lib/wakeflow-review-pack.mjs",
  "scripts/lib/wakeflow-review-scope.mjs",
  "scripts/lib/wakeflow-runtime-summary.mjs",
  "scripts/lib/wakeflow-state-paths.mjs",
  "scripts/lib/wakeflow-state-results.mjs",
  "scripts/lib/wakeflow-state-transition.mjs",
  "scripts/lib/wakeflow-status-machine.mjs",
  "scripts/lib/wakeflow-storage-map.mjs",
  "scripts/lib/wakeflow-stream-overlay.mjs",
  "scripts/lib/wakeflow-task-package.mjs",
  "scripts/lib/wakeflow-thread-registry.mjs",
  "scripts/lib/wakeflow-trace-spine-command.mjs",
  "scripts/lib/wakeflow-window-runtime.mjs",
  "scripts/lib/wakeflow-workspace-projection.mjs",
  "scripts/verify-workspace-docs.mjs",
  "scripts/wakeflow-archive-docs.mjs",
  "scripts/wakeflow-archive-summaries.mjs",
  "scripts/wakeflow-archive-todo.mjs",
  "scripts/wakeflow-check-boundary.mjs",
  "scripts/wakeflow-check-layout.mjs",
  "scripts/wakeflow-check-repository-residue.mjs",
  "scripts/wakeflow-check-runtime.mjs",
  "scripts/wakeflow-check-scripts.mjs",
  "scripts/wakeflow-delivery.mjs",
  "scripts/wakeflow-demand-sequence.mjs",
  "scripts/wakeflow-intake.mjs",
  "scripts/wakeflow-next-work.mjs",
  "scripts/wakeflow-pod.mjs",
  "scripts/wakeflow-render-progress.mjs",
  "scripts/wakeflow-repo-status.mjs",
  "scripts/wakeflow-runtime.mjs",
  "scripts/wakeflow-state.mjs",
  "scripts/wakeflow-storage.mjs",
  "scripts/wakeflow-todo.mjs",
  "scripts/wakeflow-verify.mjs",
]);
const retiredHostRuntimePaths = Object.freeze([
  "scripts/lib/wakeflow-host-send-adapter.mjs",
]);
const migrationParserPaths = Object.freeze([
  "scripts/lib/wakeflow-legacy-archive-transform.mjs",
  "scripts/lib/wakeflow-legacy-classifier.mjs",
  "scripts/lib/wakeflow-legacy-owner-drain.mjs",
  "scripts/lib/wakeflow-migration-apply.mjs",
  "scripts/lib/wakeflow-migration-config-owner.mjs",
  "scripts/lib/wakeflow-migration-host-decommission.mjs",
  "scripts/lib/wakeflow-migration-inventory.mjs",
  "scripts/lib/wakeflow-migration-plan.mjs",
  "scripts/lib/wakeflow-migration-production.mjs",
]);
const bootstrapRequiredMigrationClosure = Object.freeze(
  migrationParserPaths.filter((relativePath) => (
    relativePath !== "scripts/lib/wakeflow-legacy-archive-transform.mjs"
  )),
);
const normalRuntimeRoots = Object.freeze([
  "lib/wakeflow-mcp-tools.mjs",
  "scripts/wakeflow-cli.mjs",
  "scripts/wakeflow-setup.mjs",
  "scripts/wakeflow-smoke.mjs",
  "scripts/wakeflow-validate.mjs",
  "scripts/lib/wakeflow-host-profile.mjs",
]);
const podFrozenPublicFiles = Object.freeze([]);
const podForbiddenCandidateDependencies = retiredNormalDependencyBasenames;
const keepLiveSchemas = Object.freeze([
  Object.freeze({
    file: "schemas/wakeflow-keep-live/lease.schema.json",
    id: "urn:wakeflow:internal:keep-live:lease:v1",
    artifactKind: "wakeflow-keep-live-lease",
    kindExport: "WAKEFLOW_KEEP_LIVE_LEASE_KIND",
  }),
  Object.freeze({
    file: "schemas/wakeflow-keep-live/process.schema.json",
    id: "urn:wakeflow:internal:keep-live:process:v1",
    artifactKind: "wakeflow-keep-live-process",
    kindExport: "WAKEFLOW_KEEP_LIVE_PROCESS_KIND",
  }),
  Object.freeze({
    file: "schemas/wakeflow-keep-live/control.schema.json",
    id: "urn:wakeflow:internal:keep-live:control:v1",
    artifactKind: "wakeflow-keep-live-control",
    kindExport: "WAKEFLOW_KEEP_LIVE_CONTROL_KIND",
  }),
  Object.freeze({
    file: "schemas/wakeflow-keep-live/manager-lock.schema.json",
    id: "urn:wakeflow:internal:keep-live:manager-lock:v1",
    artifactKind: "wakeflow-keep-live-manager-lock",
    kindExport: "WAKEFLOW_KEEP_LIVE_MANAGER_LOCK_KIND",
  }),
]);
const keepLiveModules = Object.freeze([
  Object.freeze({
    file: "scripts/lib/wakeflow-keep-live-records.mjs",
    valueExports: Object.freeze([
      "WAKEFLOW_KEEP_LIVE_CONTROL_KIND",
      "WAKEFLOW_KEEP_LIVE_LEASE_KIND",
      "WAKEFLOW_KEEP_LIVE_MANAGER_LOCK_KIND",
      "WAKEFLOW_KEEP_LIVE_PROCESS_KIND",
    ]),
    exports: Object.freeze([
      "createKeepLiveControlRecord",
      "createKeepLiveLeaseRecord",
      "createKeepLiveManagerLockRecord",
      "createKeepLiveProcessRecord",
      "generateKeepLiveGenerationId",
      "generateKeepLiveRequestId",
      "keepLiveControlCanonicalBytes",
      "keepLiveControlRef",
      "keepLiveLeaseCanonicalBytes",
      "keepLiveLeaseRef",
      "keepLiveManagerLockCanonicalBytes",
      "keepLiveManagerLockRef",
      "keepLiveProcessCanonicalBytes",
      "keepLiveProcessRef",
      "validateKeepLiveControlRecord",
      "validateKeepLiveLeaseRecord",
      "validateKeepLiveManagerLockRecord",
      "validateKeepLiveProcessRecord",
    ]),
  }),
  Object.freeze({
    file: "scripts/lib/wakeflow-keep-live-service.mjs",
    valueExports: Object.freeze([]),
    exports: Object.freeze([
      "WakeflowKeepLiveError",
      "ensureKeepLive",
      "inspectKeepLive",
      "inspectKeepLiveInventoryForLayout",
      "reconcileKeepLive",
      "recordKeepLiveStartOutcome",
      "recordKeepLiveStopOutcome",
      "releaseKeepLive",
      "rollbackKeepLiveEnsure",
    ]),
  }),
  Object.freeze({
    file: "scripts/lib/wakeflow-process-identity.mjs",
    valueExports: Object.freeze([]),
    exports: Object.freeze([
      "WakeflowProcessIdentityError",
      "captureWakeflowProcessIdentity",
      "inspectWakeflowProcessSnapshot",
      "probeWakeflowProcessIdentity",
      "probeWakeflowProcessSubject",
    ]),
  }),
]);
const keepLiveContractFiles = Object.freeze([
  ...keepLiveSchemas.map(({ file }) => file),
  ...keepLiveModules.map(({ file }) => file),
]);
const keepLiveFrozenPublicFiles = Object.freeze([]);
const keepLiveForbiddenPublicDependencies = retiredNormalDependencyBasenames;

// 宿主 profile 只提供静态 capability 和 owner 文件名；具体 host effect 不在本 validator 中实现。
const hostLocatorSchema = hostProfile.artifact.locatorSchemaFile
  ? Object.freeze({
      file: hostProfile.artifact.locatorSchemaFile,
      id: "urn:wakeflow:internal:claude-window-locator:v1",
      kind: "WakeflowClaudeWindowLocator",
    })
  : null;
const hostLocatorModule = hostProfile.artifact.locatorHostFile
  ? Object.freeze({
      file: hostProfile.artifact.locatorHostFile,
      valueExports: Object.freeze([
        "WAKEFLOW_CLAUDE_WINDOW_LOCATOR_KIND",
        "WAKEFLOW_CLAUDE_WINDOW_LOCATOR_SCHEMA_VERSION",
      ]),
      exports: Object.freeze([
        "WakeflowClaudeLocatorError",
        "claudeWindowLocatorCanonicalBytes",
        "claudeWindowLocatorDigest",
        "claudeWindowLocatorRef",
        "commitClaudeWindowLocator",
        "createClaudeWindowLocatorRecord",
        "generateClaudeWindowLocatorId",
        "inspectClaudeWindowLocatorInventory",
        "inspectClaudeWindowLocatorInventoryForLayout",
        "inspectClaudeWindowLocatorObservation",
        "recoverClaudeWindowOperationMutex",
        "removeClaudeWindowLocator",
        "resolveClaudeWindowOperationEndpoint",
        "validateClaudeWindowLocatorRecord",
        "withClaudeWindowOperationMutex",
      ]),
    })
  : null;
const hostLifecycleModule = hostProfile.artifact.lifecycleHostFile
  ? Object.freeze({
      file: hostProfile.artifact.lifecycleHostFile,
      valueExports: Object.freeze([
        "WAKEFLOW_CLAUDE_LIFECYCLE_HOST_ID",
        "WAKEFLOW_CLAUDE_LIFECYCLE_SCHEMA_VERSION",
        "defaultClaudeLifecycleHostAdapter",
      ]),
      exports: Object.freeze([
        "WakeflowClaudeLifecycleError",
        "arrangeClaudeWindows",
        "inspectClaudeHostPreflight",
        "inspectClaudeWindowFleet",
        "launchClaudeWindow",
        "resumeClaudeWindow",
        "retitleClaudeWindow",
      ]),
    })
  : null;
const hostFacadeModule = hostProfile.artifact.facadeHostFile
  ? Object.freeze({
      file: hostProfile.artifact.facadeHostFile,
      valueExports: Object.freeze(["WAKEFLOW_CLAUDE_HOST_COMMANDS"]),
      exports: Object.freeze(["routeClaudeHostCommand"]),
    })
  : null;
const hostTransportModule = hostProfile.artifact.transportHostFile
  ? Object.freeze({
      file: hostProfile.artifact.transportHostFile,
      valueExports: Object.freeze([
        "WAKEFLOW_CLAUDE_TRANSPORT_HOST_ID",
        "WAKEFLOW_CLAUDE_TRANSPORT_SCHEMA_VERSION",
      ]),
      exports: Object.freeze([
        "WakeflowClaudeTransportError",
        "executeClaudeControllerReturn",
        "executeClaudeTargetDelivery",
        "recoverClaudeTransportOperation",
      ]),
    })
  : null;
const hostSettingsAssetsModule = hostProfile.artifact.settingsAssetsHostFile
  ? Object.freeze({
      file: hostProfile.artifact.settingsAssetsHostFile,
      valueExports: Object.freeze([
        "WAKEFLOW_CLAUDE_PORTABLE_ALLOW_RULES",
        "WAKEFLOW_CLAUDE_SETTINGS_HOST_ID",
        "WAKEFLOW_CLAUDE_SETTINGS_MAINTENANCE_KIND",
        "WAKEFLOW_CLAUDE_SETTINGS_MAINTENANCE_SCHEMA_ID",
        "WAKEFLOW_CLAUDE_SETTINGS_MAINTENANCE_SCHEMA_VERSION",
        "WAKEFLOW_CLAUDE_SETTINGS_SCHEMA_VERSION",
        "wakeflowHostSettingsAssetsAdapter",
      ]),
      exports: Object.freeze([
        "WakeflowClaudeSettingsError",
        "claudeStatuslineAssetContent",
        "claudeStatuslineAssetRef",
        "claudeStatuslineCommand",
        "createClaudeSettingsAssetsMutationParticipant",
        "inspectClaudeSettingsAssets",
        "inspectClaudeStatuslineAssetRuntime",
        "planClaudeSettingsAssets",
        "planClaudeSettingsAssetsMaintenance",
        "validateClaudeSettingsAssetsMaintenancePlan",
        "validateClaudeSettingsAssetsPlan",
      ]),
    })
  : null;
const hostActivitySchemas = Object.freeze([
  ...(hostProfile.artifact.activityProcessSchemaFile
    ? [Object.freeze({
        file: hostProfile.artifact.activityProcessSchemaFile,
        id: "urn:wakeflow:internal:claude-activity-monitor-process:v1",
        kind: "WakeflowClaudeActivityMonitorProcess",
      })]
    : []),
  ...(hostProfile.artifact.activityManagerLockSchemaFile
    ? [Object.freeze({
        file: hostProfile.artifact.activityManagerLockSchemaFile,
        id: "urn:wakeflow:internal:claude-activity-monitor-manager-lock:v1",
        kind: "WakeflowClaudeActivityMonitorManagerLock",
      })]
    : []),
]);
const hostActivityModule = hostProfile.artifact.activityHostFile
  ? Object.freeze({
      file: hostProfile.artifact.activityHostFile,
      valueExports: Object.freeze([
        "WAKEFLOW_CLAUDE_ACTIVITY_HOST_ID",
        "WAKEFLOW_CLAUDE_ACTIVITY_MANAGER_LOCK_KIND",
        "WAKEFLOW_CLAUDE_ACTIVITY_PROCESS_KIND",
        "WAKEFLOW_CLAUDE_ACTIVITY_SCHEMA_VERSION",
      ]),
      exports: Object.freeze([
        "WakeflowClaudeActivityError",
        "deriveClaudeActivityServerContext",
        "ensureClaudeActivityMonitor",
        "inspectClaudeActivity",
        "inspectClaudeActivityForLayout",
        "inspectClaudePromptTemp",
        "runClaudeActivityMonitorCycle",
        "stopClaudeActivityMonitor",
        "sweepClaudePromptTemp",
        "withClaudePromptTransfer",
      ]),
    })
  : null;

// Transport、window runtime 与 preservation 合同。
const transportSchemas = Object.freeze([
  Object.freeze({
    file: "schemas/wakeflow-delivery/dispatch-group.schema.json",
    id: "urn:wakeflow:internal:delivery:dispatch-group:v1",
    artifactKinds: Object.freeze(["wakeflow-dispatch-group"]),
    kindExports: Object.freeze(["WAKEFLOW_DISPATCH_GROUP_KIND"]),
    required: Object.freeze([
      "schemaVersion",
      "artifactKind",
      "programId",
      "demandId",
      "groupId",
      "stateRevision",
      "controllerWindowId",
      "members",
      "returnPolicy",
      "createdAt",
      "groupDigest",
    ]),
  }),
  Object.freeze({
    file: "schemas/wakeflow-delivery/dispatch-packet.schema.json",
    id: "urn:wakeflow:internal:delivery:dispatch-packet:v1",
    artifactKinds: Object.freeze(["wakeflow-controller-dispatch-packet"]),
    kindExports: Object.freeze(["WAKEFLOW_DISPATCH_PACKET_KIND"]),
    required: Object.freeze([
      "schemaVersion",
      "artifactKind",
      "programId",
      "demandId",
      "groupId",
      "groupRef",
      "groupDigest",
      "packetId",
      "windowId",
      "targetTaskId",
      "taskPackageId",
      "taskPackageRef",
      "taskPackageDigest",
      "objective",
      "taskBriefing",
      "boundaries",
      "acceptanceAnchors",
      "reviewInputContract",
      "resultContract",
      "contextPolicy",
      "prompt",
      "createdAt",
      "packetDigest",
    ]),
  }),
  Object.freeze({
    file: "schemas/wakeflow-delivery/delivery-envelope.schema.json",
    id: "urn:wakeflow:internal:delivery:delivery-envelope:v1",
    artifactKinds: Object.freeze([
      "wakeflow-controller-return-envelope",
      "wakeflow-target-delivery-envelope",
    ]),
    kindExports: Object.freeze([
      "WAKEFLOW_CONTROLLER_RETURN_ENVELOPE_KIND",
      "WAKEFLOW_TARGET_DELIVERY_ENVELOPE_KIND",
    ]),
    required: Object.freeze([
      "schemaVersion",
      "artifactKind",
      "programId",
      "demandId",
      "deliveryId",
      "groupId",
      "groupRef",
      "groupDigest",
      "preparedByHostId",
      "windowId",
      "identityRef",
      "bindingId",
      "identityBindingDigest",
      "prompt",
      "oneShot",
      "transportPolicy",
      "readbackPolicy",
      "automationRequested",
      "correlationId",
      "createdAt",
      "envelopeDigest",
    ]),
  }),
  Object.freeze({
    file: "schemas/wakeflow-delivery/delivery-run.schema.json",
    id: "urn:wakeflow:internal:delivery:delivery-run:v1",
    artifactKinds: Object.freeze(["wakeflow-direct-thread-delivery-run"]),
    kindExports: Object.freeze(["WAKEFLOW_DIRECT_THREAD_DELIVERY_RUN_KIND"]),
    required: Object.freeze([
      "schemaVersion",
      "artifactKind",
      "programId",
      "demandId",
      "runId",
      "deliveryId",
      "envelopeRef",
      "envelopeDigest",
      "hostId",
      "windowId",
      "attemptOrdinal",
      "hostMethod",
      "hostMode",
      "transportStatus",
      "readback",
      "createdAt",
      "runDigest",
    ]),
  }),
]);
const transportModules = Object.freeze([
  Object.freeze({
    file: "scripts/lib/wakeflow-transport-records.mjs",
    valueExports: Object.freeze([
      "WAKEFLOW_CONTROLLER_RETURN_ENVELOPE_KIND",
      "WAKEFLOW_DIRECT_THREAD_DELIVERY_RUN_KIND",
      "WAKEFLOW_DISPATCH_GROUP_KIND",
      "WAKEFLOW_DISPATCH_PACKET_KIND",
      "WAKEFLOW_TARGET_DELIVERY_ENVELOPE_KIND",
      "WAKEFLOW_TRANSPORT_SCHEMA_VERSION",
    ]),
    exports: Object.freeze([
      "WakeflowTransportRecordError",
      "createControllerReturnEnvelopeRecord",
      "createDeliveryRunRecord",
      "createDispatchGroupRecord",
      "createDispatchPacketRecord",
      "createTargetDeliveryEnvelopeRecord",
      "deliveryEnvelopeCanonicalBytes",
      "deliveryEnvelopeDigest",
      "deliveryEnvelopeRef",
      "deliveryRunCanonicalBytes",
      "deliveryRunDigest",
      "deliveryRunRef",
      "dispatchGroupCanonicalBytes",
      "dispatchGroupDigest",
      "dispatchGroupRef",
      "dispatchPacketCanonicalBytes",
      "dispatchPacketDigest",
      "dispatchPacketRef",
      "validateControllerReturnEnvelopeAgainstGroup",
      "validateDeliveryEnvelopeRecord",
      "validateDeliveryRunAgainstSources",
      "validateDeliveryRunChain",
      "validateDeliveryRunRecord",
      "validateDispatchGroupRecord",
      "validateDispatchPacketAgainstGroup",
      "validateDispatchPacketRecord",
      "validateTargetDeliveryEnvelopeAgainstSources",
    ]),
  }),
  Object.freeze({
    file: "scripts/lib/wakeflow-transport-store.mjs",
    valueExports: Object.freeze([]),
    exports: Object.freeze([
      "WakeflowTransportStoreError",
      "appendDeliveryRun",
      "appendDeliveryRunAdmitted",
      "createTransportDemandReleaseParticipant",
      "inspectTransportDemandAuthority",
      "inspectTransportDemandForLayout",
      "publishDeliveryEnvelope",
      "publishDeliveryEnvelopeAdmitted",
      "publishDispatchGroup",
      "publishDispatchGroupAdmitted",
      "publishDispatchPacket",
      "publishDispatchPacketAdmitted",
    ]),
  }),
  Object.freeze({
    file: "scripts/lib/wakeflow-delivery-orchestration.mjs",
    valueExports: Object.freeze([]),
    exports: Object.freeze([
      "WakeflowDeliveryOrchestrationError",
      "applyTargetDeliveryPlan",
      "claimTargetDelivery",
      "planTargetDelivery",
      "rearmTargetDelivery",
      "recordTargetDeliveryOutcome",
    ]),
  }),
  Object.freeze({
    file: "scripts/lib/wakeflow-result-review-orchestration.mjs",
    valueExports: Object.freeze([]),
    exports: Object.freeze([
      "WakeflowResultReviewOrchestrationError",
      "applyControllerReturnDeliveryPlan",
      "createDispatchGroupReviewCandidate",
      "decideDispatchGroupReviewCandidate",
      "inspectControllerReturnPreSend",
      "inspectDemandResultReviewTrace",
      "inspectDispatchGroupReview",
      "planControllerReturnDelivery",
      "recordControllerReturnOutcome",
      "recordTargetResultFromTransport",
    ]),
  }),
  Object.freeze({
    file: "scripts/lib/wakeflow-transport-retention.mjs",
    valueExports: Object.freeze([]),
    exports: Object.freeze([
      "WakeflowTransportRetentionError",
      "applyTransportDemandPrunePlan",
      "planTransportDemandPrune",
      "recoverTransportDemandPrune",
    ]),
  }),
]);
const transportRetentionSchema = Object.freeze({
  file: "schemas/wakeflow-maintenance/transport-retention-plan.schema.json",
  id: "urn:wakeflow:internal:maintenance:transport-retention-plan:v1",
  artifactKind: "wakeflow-transport-retention-plan",
});
const transportContractFiles = Object.freeze([
  ...transportSchemas.map(({ file }) => file),
  transportRetentionSchema.file,
  ...transportModules.map(({ file }) => file),
]);
const windowRuntimeSchema = Object.freeze({
  file: "schemas/wakeflow-window-runtime/window-runtime.schema.json",
  id: "urn:wakeflow:internal:window-runtime:projection:v1",
  kind: "wakeflow-window-runtime-projection",
});
const windowRuntimeModules = Object.freeze([
  Object.freeze({
    file: "scripts/lib/wakeflow-window-runtime-records.mjs",
    valueExports: Object.freeze([
      "WAKEFLOW_WINDOW_RUNTIME_KIND",
      "WAKEFLOW_WINDOW_RUNTIME_SCHEMA_VERSION",
    ]),
    exports: Object.freeze([
      "WakeflowWindowRuntimeRecordError",
      "createWindowRuntimeProjection",
      "validateWindowRuntimeProjection",
      "windowRuntimeProjectionCanonicalBytes",
      "windowRuntimeProjectionDigest",
      "windowRuntimeProjectionRef",
    ]),
  }),
  Object.freeze({
    file: "scripts/lib/wakeflow-window-runtime-projector.mjs",
    valueExports: Object.freeze([
      "WAKEFLOW_WINDOW_RUNTIME_MAINTENANCE_KIND",
      "WAKEFLOW_WINDOW_RUNTIME_MAINTENANCE_SCHEMA_ID",
      "WAKEFLOW_WINDOW_RUNTIME_MAINTENANCE_SCHEMA_VERSION",
    ]),
    exports: Object.freeze([
      "WakeflowWindowRuntimeProjectionError",
      "createWindowRuntimeProjectionMutationParticipant",
      "inspectWindowRuntimeProjections",
      "inspectWindowRuntimeProjectionsForLayout",
      "planWindowRuntimeProjectionMaintenance",
      "projectWindowRuntimeProjectionMaintenance",
      "rebuildWindowRuntimeProjections",
      "validateWindowRuntimeProjectionMaintenancePlan",
    ]),
  }),
]);
const windowRuntimeContractFiles = Object.freeze([
  windowRuntimeSchema.file,
  ...windowRuntimeModules.map(({ file }) => file),
]);
const preservationManifestSchema = Object.freeze({
  file: "schemas/wakeflow-maintenance/local-preservation.schema.json",
  id: "urn:wakeflow:internal:audit:local-preservation:v1",
  kind: "WakeflowLocalPreservation",
  required: Object.freeze([
    "kind",
    "schemaVersion",
    "programId",
    "preservationId",
    "producer",
    "createdAt",
    "source",
    "reason",
    "payload",
    "retention",
    "links",
  ]),
});
const preservationPlanSchema = Object.freeze({
  file: "schemas/wakeflow-maintenance/local-preservation-plan.schema.json",
  id: "urn:wakeflow:internal:maintenance:local-preservation-plan:v1",
  artifactKind: "wakeflow-local-preservation-plan",
});
const preservationModules = Object.freeze([
  Object.freeze({
    file: "scripts/lib/wakeflow-preservation.mjs",
    valueExports: Object.freeze([]),
    exports: Object.freeze([
      "WakeflowPreservationError",
      "applyLocalPreservationPlan",
      "createMigrationSourceRetainedPreservationParticipant",
      "inspectLocalPreservationInventory",
      "inspectLocalPreservationInventoryForLayout",
      "localPreservationCanonicalBytes",
      "planLocalPreservation",
      "planLocalPreservationRelease",
      "planMigrationSourceRetainedPreservation",
      "recoverLocalPreservationMutation",
      "validateLocalPreservationManifest",
    ]),
  }),
]);
const preservationContractFiles = Object.freeze([
  preservationManifestSchema.file,
  preservationPlanSchema.file,
  ...preservationModules.map(({ file }) => file),
]);

// 显式 migration/bootstrap 合同；这些文件可打包，但不得进入 normal runtime 图。
const legacyArchiveSchemas = Object.freeze([
  Object.freeze({
    file: "schemas/wakeflow-business-archive/legacy-evidence-summary.schema.json",
    id: "urn:wakeflow:internal:business-archive:legacy-evidence-summary:v1",
  }),
  Object.freeze({
    file: "schemas/wakeflow-business-archive/legacy-source-descriptor.schema.json",
    id: "urn:wakeflow:internal:business-archive:legacy-source-descriptor:v1",
    artifactKind: "wakeflow-legacy-demand-archive-source",
  }),
  Object.freeze({
    file: "schemas/wakeflow-business-archive/legacy-transport-summary.schema.json",
    id: "urn:wakeflow:internal:business-archive:legacy-transport-summary:v1",
    artifactKind: "wakeflow-legacy-archive-transport-summary",
  }),
  Object.freeze({
    file: "schemas/wakeflow-maintenance/legacy-archive-transform-plan.schema.json",
    id: "urn:wakeflow:internal:migration:legacy-archive-transform-plan:v1",
    planKind: "WakeflowLegacyArchiveTransformPlan",
  }),
]);
const legacyArchiveReferenceSchemaFiles = Object.freeze([
  "schemas/wakeflow-ledger/archive-manifest.schema.json",
  preservationManifestSchema.file,
  preservationPlanSchema.file,
]);
const legacyArchiveModules = Object.freeze([
  Object.freeze({
    file: "scripts/lib/wakeflow-legacy-archive-records.mjs",
    valueExports: Object.freeze([
      "WAKEFLOW_LEGACY_ARCHIVE_RECORD_SCHEMA_VERSION",
      "WAKEFLOW_LEGACY_ARCHIVE_TRANSPORT_SUMMARY_KIND",
      "WAKEFLOW_LEGACY_EVIDENCE_SOURCE_KINDS",
    ]),
    exports: Object.freeze([
      "WakeflowLegacyArchiveRecordError",
      "validateWakeflowLegacyEvidenceFact",
      "validateWakeflowLegacyEvidenceFacts",
      "validateWakeflowLegacyEvidenceSummaries",
      "validateWakeflowLegacyEvidenceSummary",
      "validateWakeflowLegacyTransportSummary",
      "wakeflowLegacyArchiveCanonicalBytes",
      "wakeflowLegacyArchiveDigest",
    ]),
  }),
  Object.freeze({
    file: "scripts/lib/wakeflow-legacy-archive-transform.mjs",
    valueExports: Object.freeze([
      "WAKEFLOW_LEGACY_ARCHIVE_TRANSFORM_PLAN_KIND",
      "WAKEFLOW_LEGACY_ARCHIVE_TRANSFORM_PLAN_SCHEMA_ID",
      "WAKEFLOW_LEGACY_ARCHIVE_TRANSFORM_PLAN_SCHEMA_VERSION",
    ]),
    exports: Object.freeze([
      "WakeflowLegacyArchiveTransformError",
      "createWakeflowLegacyArchiveTransformOwnerResolution",
      "createWakeflowLegacyArchiveTransformParticipant",
      "planWakeflowLegacyArchiveTransform",
      "validateWakeflowLegacyArchiveTransformPlan",
      "wakeflowLegacyArchiveTransformPlanDigest",
    ]),
  }),
]);
const legacyArchiveSupportFiles = Object.freeze([
  "schemas/wakeflow-ledger/archive-manifest.schema.json",
  "scripts/lib/wakeflow-ledger-records.mjs",
]);
const legacyArchiveContractFiles = Object.freeze([
  ...legacyArchiveSchemas.map(({ file }) => file),
  ...legacyArchiveSupportFiles,
  ...legacyArchiveModules.map(({ file }) => file),
]);
const artifactTreeIdentityModules = Object.freeze([
  Object.freeze({
    file: "scripts/lib/wakeflow-artifact-tree-identity.mjs",
    valueExports: Object.freeze([
      "WAKEFLOW_ARTIFACT_TREE_IDENTITY_LIMITS",
      "WAKEFLOW_ARTIFACT_TREE_MANIFEST_KIND",
      "WAKEFLOW_ARTIFACT_TREE_MANIFEST_VERSION",
    ]),
    exports: Object.freeze([
      "WakeflowArtifactTreeIdentityError",
      "inspectWakeflowArtifactTree",
      "validateWakeflowArtifactTreeManifest",
    ]),
  }),
]);
const artifactTreeIdentityContractFiles = Object.freeze(
  artifactTreeIdentityModules.map(({ file }) => file),
);
const legacyClassifierCatalogFile = "scripts/data/wakeflow-legacy-classifier-catalog.json";
const legacyClassifierModules = Object.freeze([
  Object.freeze({
    file: "scripts/lib/wakeflow-legacy-classifier.mjs",
    valueExports: Object.freeze([
      "WAKEFLOW_LEGACY_CLASSIFIER_ACTIONS",
      "WAKEFLOW_LEGACY_CLASSIFIER_CATALOG_KIND",
      "WAKEFLOW_LEGACY_CLASSIFIER_CATALOG_VERSION",
      "WAKEFLOW_LEGACY_CLASSIFIER_CONFIDENCE",
    ]),
    exports: Object.freeze([
      "WakeflowLegacyClassifierError",
      "classifyWakeflowLegacySource",
      "readWakeflowLegacyClassifierCatalog",
      "validateWakeflowLegacyClassifierCatalog",
    ]),
  }),
]);
const legacyClassifierContractFiles = Object.freeze([
  legacyClassifierCatalogFile,
  ...legacyClassifierModules.map(({ file }) => file),
]);
const migrationInventoryModules = Object.freeze([
  Object.freeze({
    file: "scripts/lib/wakeflow-migration-inventory.mjs",
    valueExports: Object.freeze([
      "WAKEFLOW_MIGRATION_INVENTORY_KIND",
      "WAKEFLOW_MIGRATION_INVENTORY_SCHEMA_VERSION",
    ]),
    exports: Object.freeze([
      "WakeflowMigrationInventoryError",
      "inspectWakeflowMigrationInventory",
    ]),
  }),
]);
const migrationInventoryContractFiles = Object.freeze(
  migrationInventoryModules.map(({ file }) => file),
);
const legacyOwnerDrainModules = Object.freeze([
  Object.freeze({
    file: "scripts/lib/wakeflow-legacy-owner-drain.mjs",
    valueExports: Object.freeze([
      "WAKEFLOW_LEGACY_ARCHIVE_IMPORT_INVENTORY_KIND",
      "WAKEFLOW_LEGACY_ARCHIVE_IMPORT_INVENTORY_SCHEMA_VERSION",
      "WAKEFLOW_LEGACY_OWNER_DRAIN_KIND",
      "WAKEFLOW_LEGACY_OWNER_DRAIN_SCHEMA_VERSION",
      "WAKEFLOW_LEGACY_OWNER_DRAIN_STATUSES",
    ]),
    exports: Object.freeze([
      "WakeflowLegacyOwnerDrainError",
      "inspectWakeflowLegacyArchiveImportInventory",
      "inspectWakeflowLegacyOwnerDrain",
      "validateWakeflowLegacyArchiveImportInventory",
      "validateWakeflowLegacyOwnerDrainAssessment",
      "wakeflowLegacyArchiveImportInventoryDigest",
      "wakeflowLegacyOwnerDrainAssessmentDigest",
    ]),
  }),
]);
const legacyOwnerDrainContractFiles = Object.freeze(
  legacyOwnerDrainModules.map(({ file }) => file),
);
const migrationPlanModules = Object.freeze([
  Object.freeze({
    file: "scripts/lib/wakeflow-migration-plan.mjs",
    valueExports: Object.freeze([
      "WAKEFLOW_LEGACY_ARCHIVE_TRANSFORM_OWNER_RESOLUTION_KIND",
      "WAKEFLOW_LEGACY_ARCHIVE_TRANSFORM_OWNER_RESOLUTION_SCHEMA_VERSION",
      "WAKEFLOW_MIGRATION_PLAN_ACTIONS",
      "WAKEFLOW_MIGRATION_PLAN_KIND",
      "WAKEFLOW_MIGRATION_PLAN_SCHEMA_VERSION",
    ]),
    exports: Object.freeze([
      "WakeflowMigrationPlanError",
      "isWakeflowMigrationPlanApplicable",
      "planWakeflowMigrationPreview",
      "validateWakeflowLegacyArchiveTransformOwnerResolution",
      "validateWakeflowMigrationPlan",
      "wakeflowMigrationPlanDigest",
    ]),
  }),
]);
const migrationPlanContractFiles = Object.freeze(
  migrationPlanModules.map(({ file }) => file),
);
const migrationHostDecommissionModule = Object.freeze({
  file: "scripts/lib/wakeflow-migration-host-decommission.mjs",
  valueExports: Object.freeze([
    "WAKEFLOW_MIGRATION_HOST_DECOMMISSION_ASSESSMENT_KIND",
    "WAKEFLOW_MIGRATION_HOST_DECOMMISSION_OUTCOME_KIND",
    "WAKEFLOW_MIGRATION_HOST_DECOMMISSION_PLAN_KIND",
    "WAKEFLOW_MIGRATION_HOST_DECOMMISSION_SCHEMA_VERSION",
  ]),
  exports: Object.freeze([
    "WakeflowMigrationHostDecommissionError",
    "assertMigrationHostDecommissionOutcomeAgainstPlan",
    "assertMigrationHostDecommissionPlanAgainstMigrationPlan",
    "assessMigrationHostDecommission",
    "createMigrationHostDecommissionOutcome",
    "createMigrationHostDecommissionPlan",
    "migrationHostDecommissionCanonicalBytes",
    "validateMigrationHostDecommissionAssessment",
    "validateMigrationHostDecommissionOutcome",
    "validateMigrationHostDecommissionPlan",
  ]),
});
const migrationHostDecommissionHostModule = hostProfile.artifact.migrationDecommissionHostFile
  ? Object.freeze({
      file: hostProfile.artifact.migrationDecommissionHostFile,
      valueExports: Object.freeze(hostProfile.hostId === "claude-code"
        ? [
            "WAKEFLOW_CLAUDE_MIGRATION_DECOMMISSION_HOST_ID",
            "WAKEFLOW_CLAUDE_MIGRATION_DECOMMISSION_SCHEMA_VERSION",
            "wakeflowMigrationDecommissionHostAdapter",
          ]
        : [
            "WAKEFLOW_CODEX_MIGRATION_DECOMMISSION_HOST_ID",
            "WAKEFLOW_CODEX_MIGRATION_DECOMMISSION_SCHEMA_VERSION",
            "wakeflowMigrationDecommissionHostAdapter",
          ]),
      exports: Object.freeze(hostProfile.hostId === "claude-code"
        ? [
            "WakeflowClaudeMigrationDecommissionError",
            "inspectClaudeMigrationDecommissionPlan",
            "recordClaudeMigrationDecommissionOutcome",
            "recordClaudeMigrationDecommissionRecoveryOutcome",
          ]
        : [
            "WakeflowCodexMigrationDecommissionError",
            "inspectCodexMigrationDecommissionPlan",
            "inspectCodexMigrationDecommissionRecovery",
            "recordCodexMigrationDecommissionOutcome",
          ]),
    })
  : null;
const migrationHostDecommissionContractFiles = Object.freeze([
  migrationHostDecommissionModule.file,
]);
const migrationHostEffectHostModule = hostProfile.artifact.migrationEffectHostFile
  ? Object.freeze({
      file: hostProfile.artifact.migrationEffectHostFile,
      valueExports: Object.freeze(hostProfile.hostId === "claude-code"
        ? [
            "WAKEFLOW_CLAUDE_MIGRATION_EFFECT_HOST_ID",
            "WAKEFLOW_CLAUDE_MIGRATION_EFFECT_PLAN_SCHEMA_ID",
            "WAKEFLOW_CLAUDE_MIGRATION_EFFECT_SCHEMA_VERSION",
          ]
        : [
            "WAKEFLOW_CODEX_MIGRATION_EFFECT_HOST_ID",
            "WAKEFLOW_CODEX_MIGRATION_EFFECT_PLAN_SCHEMA_ID",
            "WAKEFLOW_CODEX_MIGRATION_EFFECT_SCHEMA_VERSION",
          ]),
      exports: Object.freeze(hostProfile.hostId === "claude-code"
        ? [
            "WakeflowClaudeMigrationEffectError",
            "createClaudeMigrationHostEffectParticipant",
            "planClaudeMigrationHostEffects",
          ]
        : [
            "WakeflowCodexMigrationEffectError",
            "createCodexMigrationHostEffectParticipant",
            "planCodexMigrationHostEffects",
          ]),
    })
  : null;
const migrationApplyModules = Object.freeze([
  Object.freeze({
    file: "scripts/lib/wakeflow-migration-apply.mjs",
    valueExports: Object.freeze([
      "WAKEFLOW_MIGRATION_APPLY_PHASES",
      "WAKEFLOW_MIGRATION_APPLY_PLAN_KIND",
      "WAKEFLOW_MIGRATION_APPLY_PLAN_SCHEMA_ID",
      "WAKEFLOW_MIGRATION_APPLY_PLAN_SCHEMA_VERSION",
    ]),
    exports: Object.freeze([
      "WakeflowMigrationApplyError",
      "createWakeflowMigrationManualAcknowledgement",
      "createWakeflowMigrationMutationParticipant",
      "planWakeflowMigrationApply",
      "runWakeflowMigrationApply",
      "validateWakeflowMigrationApplyPlan",
      "wakeflowMigrationApplyPlanDigest",
    ]),
  }),
  Object.freeze({
    file: "scripts/lib/wakeflow-migration-config-owner.mjs",
    valueExports: Object.freeze([
      "WAKEFLOW_MIGRATION_CONFIG_OWNER_KIND",
      "WAKEFLOW_MIGRATION_CONFIG_OWNER_SCHEMA_ID",
      "WAKEFLOW_MIGRATION_CONFIG_OWNER_SCHEMA_VERSION",
    ]),
    exports: Object.freeze([
      "WakeflowMigrationConfigOwnerError",
      "assertWakeflowMigrationConfigOwnerPlanAgainstMigrationPlan",
      "createWakeflowMigrationConfigOwnerParticipant",
      "planWakeflowMigrationConfigOwner",
      "validateWakeflowMigrationConfigOwnerPlan",
    ]),
  }),
  Object.freeze({
    file: "scripts/lib/wakeflow-migration-production.mjs",
    valueExports: Object.freeze([
      "WAKEFLOW_PRODUCTION_MIGRATION_KIND",
      "WAKEFLOW_PRODUCTION_MIGRATION_PHASE_SCHEMA_ID",
      "WAKEFLOW_PRODUCTION_MIGRATION_SCHEMA_VERSION",
    ]),
    exports: Object.freeze([
      "WakeflowProductionMigrationError",
      "createWakeflowProductionMigrationParticipant",
      "planWakeflowProductionMigration",
      "recoverWakeflowProductionMigration",
      "restoreWakeflowProductionMigrationComposition",
      "runWakeflowProductionMigrationApply",
    ]),
  }),
  Object.freeze({
    file: "scripts/wakeflow-bootstrap.mjs",
    valueExports: Object.freeze([
      "WAKEFLOW_BOOTSTRAP_ACTION",
      "WAKEFLOW_BOOTSTRAP_MODES",
      "WAKEFLOW_BOOTSTRAP_SCHEMA_VERSION",
      "WAKEFLOW_BOOTSTRAP_STDIN_LIMIT",
    ]),
    exports: Object.freeze([
      "WakeflowBootstrapError",
      "parseWakeflowBootstrapArgv",
      "parseWakeflowBootstrapRequest",
      "runWakeflowBootstrap",
      "runWakeflowBootstrapStdin",
    ]),
  }),
]);
const migrationApplyContractFiles = Object.freeze([
  "bin/wakeflow-bootstrap",
  ...migrationApplyModules.map(({ file }) => file),
]);

// Workspace maintenance 与最终公共 v3 facade 合同。
const workspaceMaintenancePlanSchema = Object.freeze({
  file: "schemas/wakeflow-maintenance/workspace-maintenance-plan.schema.json",
  id: "urn:wakeflow:internal:workspace-maintenance-plan:v1",
  kind: "WakeflowWorkspaceMaintenancePlan",
});
const workspaceMaintenancePlanModules = Object.freeze([
  Object.freeze({
    file: "scripts/lib/wakeflow-maintenance-plan.mjs",
    valueExports: Object.freeze([
      "WAKEFLOW_MAINTENANCE_PLAN_ACTIONS",
      "WAKEFLOW_MAINTENANCE_PLAN_KIND",
      "WAKEFLOW_MAINTENANCE_PLAN_SCHEMA_ID",
      "WAKEFLOW_MAINTENANCE_PLAN_SCHEMA_VERSION",
    ]),
    exports: Object.freeze([
      "WakeflowMaintenancePlanError",
      "createWakeflowMaintenancePlan",
      "isWakeflowMaintenancePlanApplicable",
      "validateWakeflowMaintenancePlan",
      "wakeflowMaintenancePlanDigest",
    ]),
  }),
]);
const workspaceMaintenancePlanContractFiles = Object.freeze([
  workspaceMaintenancePlanSchema.file,
  ...workspaceMaintenancePlanModules.map(({ file }) => file),
]);
const freshInitializeModules = Object.freeze([
  Object.freeze({
    file: "scripts/lib/wakeflow-config-v3-owner.mjs",
    valueExports: Object.freeze([
      "WAKEFLOW_CONFIG_V3_OWNER_PLAN_KIND",
      "WAKEFLOW_CONFIG_V3_OWNER_PLAN_SCHEMA_ID",
      "WAKEFLOW_CONFIG_V3_OWNER_PLAN_SCHEMA_VERSION",
      "WAKEFLOW_CONFIG_V3_RECONFIGURE_OWNER_PLAN_KIND",
      "WAKEFLOW_CONFIG_V3_RECONFIGURE_OWNER_PLAN_SCHEMA_ID",
      "WAKEFLOW_CONFIG_V3_RECONFIGURE_OWNER_PLAN_SCHEMA_VERSION",
    ]),
    exports: Object.freeze([
      "WakeflowConfigV3OwnerError",
      "createWakeflowConfigV3OwnerMutationParticipant",
      "createWakeflowConfigV3ReconfigureMutationParticipant",
      "inspectWakeflowConfigV3FreshSource",
      "inspectWakeflowConfigV3ReconfigureSource",
      "planWakeflowConfigV3FreshOwner",
      "planWakeflowConfigV3ReconfigureOwner",
      "validateWakeflowConfigV3OwnerPlan",
      "validateWakeflowConfigV3ReconfigureOwnerPlan",
    ]),
  }),
  Object.freeze({
    file: "scripts/lib/wakeflow-fresh-initialize.mjs",
    valueExports: Object.freeze([
      "WAKEFLOW_FRESH_INITIALIZE_KIND",
      "WAKEFLOW_FRESH_INITIALIZE_SCHEMA_VERSION",
    ]),
    exports: Object.freeze([
      "WakeflowFreshInitializeError",
      "createWakeflowFreshDesiredModel",
      "inspectWakeflowFreshLocalEligibility",
      "planWakeflowFreshInitializeBackbone",
      "planWakeflowMigrationMaterializationBackbone",
    ]),
  }),
  Object.freeze({
    file: "scripts/lib/wakeflow-reconfigure.mjs",
    valueExports: Object.freeze([
      "WAKEFLOW_RECONFIGURE_KIND",
      "WAKEFLOW_RECONFIGURE_SCHEMA_VERSION",
    ]),
    exports: Object.freeze([
      "WakeflowReconfigureError",
      "diffWakeflowConfigV3Topology",
      "planWakeflowReconfigureBackbone",
    ]),
  }),
  Object.freeze({
    file: "scripts/lib/wakeflow-reconcile.mjs",
    valueExports: Object.freeze([
      "WAKEFLOW_RECONCILE_KIND",
      "WAKEFLOW_RECONCILE_SCHEMA_VERSION",
    ]),
    exports: Object.freeze([
      "WakeflowReconcileError",
      "planWakeflowReconcileBackbone",
    ]),
  }),
  Object.freeze({
    file: "scripts/lib/wakeflow-managed-content.mjs",
    valueExports: Object.freeze([
      "WAKEFLOW_MANAGED_CONTENT_KIND",
      "WAKEFLOW_MANAGED_CONTENT_SCHEMA_ID",
      "WAKEFLOW_MANAGED_CONTENT_SCHEMA_VERSION",
    ]),
    exports: Object.freeze([
      "WakeflowManagedContentError",
      "createWakeflowManagedContentMutationParticipant",
      "planWakeflowManagedContent",
      "projectWakeflowManagedContentMaintenance",
      "validateWakeflowManagedContentPlan",
    ]),
  }),
  Object.freeze({
    file: "scripts/lib/wakeflow-tracked-materialization.mjs",
    valueExports: Object.freeze([]),
    exports: Object.freeze([
      "WakeflowTrackedMaterializationError",
      "createWakeflowTrackedMaterializationParticipant",
    ]),
  }),
  Object.freeze({
    file: "scripts/lib/wakeflow-support-materialization.mjs",
    valueExports: Object.freeze([]),
    exports: Object.freeze([
      "WakeflowSupportMaterializationError",
      "planWakeflowSupportMaterialization",
    ]),
  }),
  Object.freeze({
    file: "scripts/lib/wakeflow-support-surface-owner.mjs",
    valueExports: Object.freeze([
      "WAKEFLOW_SUPPORT_SURFACE_OWNER_KIND",
      "WAKEFLOW_SUPPORT_SURFACE_OWNER_SCHEMA_ID",
      "WAKEFLOW_SUPPORT_SURFACE_OWNER_SCHEMA_VERSION",
    ]),
    exports: Object.freeze([
      "WakeflowSupportSurfaceOwnerError",
      "createWakeflowSupportSurfaceMutationParticipant",
      "planWakeflowSupportSurfaceOwner",
      "projectWakeflowSupportSurfaceMaintenance",
      "validateWakeflowSupportSurfaceOwnerPlan",
    ]),
  }),
  Object.freeze({
    file: "scripts/lib/wakeflow-ledger-projector.mjs",
    valueExports: Object.freeze(["LEDGER_PROJECTION_PATHS"]),
    exports: Object.freeze([
      "WakeflowLedgerProjectionError",
      "buildEmptyLedgerProjection",
      "buildLedgerProjection",
      "commitLedgerRecordAndProject",
      "inspectLedgerProjectionSource",
      "writeLedgerProjection",
    ]),
  }),
  Object.freeze({
    file: "scripts/lib/wakeflow-ledger-materialization.mjs",
    valueExports: Object.freeze([
      "WAKEFLOW_LEDGER_MATERIALIZATION_KIND",
      "WAKEFLOW_LEDGER_MATERIALIZATION_SCHEMA_ID",
      "WAKEFLOW_LEDGER_MATERIALIZATION_SCHEMA_VERSION",
    ]),
    exports: Object.freeze([
      "WakeflowLedgerMaterializationError",
      "createWakeflowLedgerMaterializationMutationParticipant",
      "planWakeflowLedgerMaterialization",
      "projectWakeflowLedgerMaterializationMaintenance",
      "validateWakeflowLedgerMaterializationPlan",
    ]),
  }),
  Object.freeze({
    file: "scripts/lib/wakeflow-config-v3-transition-authority.mjs",
    valueExports: Object.freeze([]),
    exports: Object.freeze([
      "WakeflowConfigV3TransitionAuthorityError",
      "assertWakeflowConfigV3TransitionAuthority",
      "createWakeflowMigrationConfigTransitionScope",
      "withWakeflowMigrationConfigTransitionScope",
    ]),
  }),
  Object.freeze({
    file: "scripts/lib/wakeflow-local-layout-inspection.mjs",
    valueExports: Object.freeze([]),
    exports: Object.freeze([
      "WakeflowLocalLayoutInspectionError",
      "assertWakeflowLocalLayoutInspection",
      "inspectWakeflowLocalLayout",
    ]),
  }),
  Object.freeze({
    file: "scripts/lib/wakeflow-local-layout-realization.mjs",
    valueExports: Object.freeze([]),
    exports: Object.freeze([
      "WakeflowLocalLayoutRealizationError",
      "createWakeflowLocalLayoutMutationParticipant",
      "inspectWakeflowLocalLayout",
      "planWakeflowLocalLayoutRealization",
      "projectWakeflowLocalLayoutStorage",
      "verifyWakeflowLocalLayoutInspection",
    ]),
  }),
  Object.freeze({
    file: "scripts/lib/wakeflow-active-foundation.mjs",
    valueExports: Object.freeze([
      "WAKEFLOW_ACTIVE_FOUNDATION_KIND",
      "WAKEFLOW_ACTIVE_FOUNDATION_SCHEMA_ID",
      "WAKEFLOW_ACTIVE_FOUNDATION_SCHEMA_VERSION",
    ]),
    exports: Object.freeze([
      "WakeflowActiveFoundationError",
      "createWakeflowActiveFoundationMutationParticipant",
      "inspectWakeflowFreshTodoTransitionAuthority",
      "planWakeflowActiveFoundation",
      "projectWakeflowActiveFoundationMaintenance",
      "validateWakeflowActiveFoundationPlan",
    ]),
  }),
  Object.freeze({
    file: "scripts/lib/wakeflow-maintenance-action-composition.mjs",
    valueExports: Object.freeze([
      "WAKEFLOW_CONFIRMED_ACTION_PLAN_KIND",
      "WAKEFLOW_CONFIRMED_ACTION_PLAN_SCHEMA_ID",
      "WAKEFLOW_CONFIRMED_ACTION_PLAN_SCHEMA_VERSION",
    ]),
    exports: Object.freeze([
      "WakeflowMaintenanceActionCompositionError",
      "assertWakeflowMaintenanceLocalTransitionScope",
      "createWakeflowConfirmedActionPlan",
      "createWakeflowMaintenanceActionMutationParticipant",
      "validateWakeflowConfirmedActionPlan",
    ]),
  }),
  Object.freeze({
    file: "scripts/lib/wakeflow-host-settings-assets-owner.mjs",
    valueExports: Object.freeze([
      "WAKEFLOW_HOST_SETTINGS_ASSETS_COMPONENT_ID",
      "WAKEFLOW_HOST_SETTINGS_ASSETS_OWNER",
    ]),
    exports: Object.freeze([
      "WakeflowHostSettingsAssetsOwnerError",
      "createWakeflowHostSettingsAssetsOwnerMutationParticipant",
      "loadWakeflowHostSettingsAssetsAdapter",
      "planWakeflowHostSettingsAssetsOwner",
    ]),
  }),
  Object.freeze({
    file: "scripts/lib/wakeflow-observability-v3.mjs",
    valueExports: Object.freeze([
      "WAKEFLOW_OBSERVATION_V3_KIND",
      "WAKEFLOW_OBSERVATION_V3_SCHEMA_VERSION",
    ]),
    exports: Object.freeze([
      "WakeflowObservabilityV3Error",
      "inspectWakeflowObservabilityV3",
      "projectWakeflowConfigView",
      "projectWakeflowStatus",
      "projectWakeflowStorageView",
      "verifyWakeflowWorkspaceV3",
    ]),
  }),
]);
const freshInitializeContractFiles = Object.freeze(
  freshInitializeModules.map(({ file }) => file),
);
const maintenancePublicSurfaceModules = Object.freeze([
  Object.freeze({
    file: "lib/wakeflow-mcp-tools.mjs",
    valueExports: Object.freeze(["handlers", "tools"]),
    exports: Object.freeze([]),
  }),
  Object.freeze({
    file: "scripts/lib/wakeflow-public-v3-runtime.mjs",
    valueExports: Object.freeze([]),
    exports: Object.freeze([
      "WakeflowPublicV3RuntimeError",
      "createWakeflowPublicV3DomainHandlers",
      "refreshWakeflowActiveProjectionAfterPublicMutation",
    ]),
  }),
  Object.freeze({
    file: "scripts/lib/wakeflow-maintenance-coordinator.mjs",
    valueExports: Object.freeze([
      "WAKEFLOW_MAINTENANCE_ACTIONS",
      "WAKEFLOW_MAINTENANCE_CONTRACT_VERSION",
      "WAKEFLOW_MAINTENANCE_MODES",
      "WAKEFLOW_MAINTENANCE_TOOL_NAME",
    ]),
    exports: Object.freeze([
      "WakeflowMaintenanceCoordinatorError",
      "createWakeflowMaintenanceCoordinator",
      "validateWakeflowMaintenanceRequest",
    ]),
  }),
  Object.freeze({
    file: "scripts/lib/wakeflow-maintenance-action-runtime.mjs",
    valueExports: Object.freeze(["WAKEFLOW_MAINTENANCE_ACTION_RUNTIME_VERSION"]),
    exports: Object.freeze([
      "WakeflowMaintenanceActionRuntimeError",
      "createWakeflowMaintenanceActionHandlers",
      "loadWakeflowMaintenanceActionHandlers",
    ]),
  }),
  Object.freeze({
    file: "scripts/wakeflow-setup.mjs",
    valueExports: Object.freeze(["WAKEFLOW_SETUP_STDIN_LIMIT"]),
    exports: Object.freeze([
      "WakeflowSetupError",
      "parseWakeflowSetupArgv",
      "parseWakeflowSetupRequest",
      "runWakeflowSetup",
      "runWakeflowSetupStdin",
    ]),
  }),
  Object.freeze({
    file: "scripts/wakeflow-cli.mjs",
    valueExports: Object.freeze(["WAKEFLOW_CLI_STDIN_LIMIT"]),
    exports: Object.freeze([
      "WakeflowCliError",
      "parseWakeflowCliArgv",
      "parseWakeflowCliRequest",
      "runWakeflowCli",
      "runWakeflowCliStdin",
    ]),
  }),
]);
const maintenancePublicSurfaceContractFiles = Object.freeze(
  maintenancePublicSurfaceModules.map(({ file }) => file),
);
const forbiddenPublicCutoverFiles = Object.freeze([
  "lib/wakeflow-mcp-tools-v3-candidate.mjs",
  "schemas/wakeflow-config-v3.schema.json",
  "scripts/wakeflow-setup-v3-candidate.mjs",
  "scripts/wakeflow-validate-v3-candidate.mjs",
  "scripts/wakeflow-smoke-v3-candidate.mjs",
  "templates/wakeflow-template-bundle.json",
]);
// 旧 runtime/trace facade 已退役；公共入口的依赖方向统一由 normal module graph 约束。
const workspaceMaintenancePlanFrozenPublicFiles = Object.freeze([]);
const freshInitializeFrozenPublicFiles = workspaceMaintenancePlanFrozenPublicFiles;
const freshInitializeForbiddenPublicDependencies = retiredNormalDependencyBasenames;
const legacyClassifierFrozenPublicFiles = workspaceMaintenancePlanFrozenPublicFiles;
const legacyClassifierForbiddenPublicDependencies = retiredNormalDependencyBasenames;
const migrationInventoryFrozenPublicFiles = legacyClassifierFrozenPublicFiles;
const migrationInventoryForbiddenPublicDependencies = legacyClassifierForbiddenPublicDependencies;
const legacyOwnerDrainFrozenPublicFiles = legacyClassifierFrozenPublicFiles;
const legacyOwnerDrainForbiddenPublicDependencies = legacyClassifierForbiddenPublicDependencies;
const migrationPlanFrozenPublicFiles = legacyClassifierFrozenPublicFiles;
const migrationPlanForbiddenPublicDependencies = legacyClassifierForbiddenPublicDependencies;
const migrationHostDecommissionFrozenPublicFiles = legacyClassifierFrozenPublicFiles;
const migrationHostDecommissionForbiddenPublicDependencies = legacyClassifierForbiddenPublicDependencies;
const migrationApplyFrozenPublicFiles = legacyClassifierFrozenPublicFiles;
const migrationApplyForbiddenPublicDependencies = legacyClassifierForbiddenPublicDependencies;
const legacyArchiveFrozenPublicFiles = legacyClassifierFrozenPublicFiles;
const legacyArchiveForbiddenPublicDependencies = legacyClassifierForbiddenPublicDependencies;
const workspaceMaintenancePlanForbiddenDependencies = Object.freeze([
  "wakeflow-workspace-mutation.mjs",
  "wakeflow-atomic-write.mjs",
]);
const preservationFrozenPublicFiles = Object.freeze([]);
const preservationForbiddenPublicDependencies = retiredNormalDependencyBasenames;
const windowRuntimeFrozenPublicFiles = Object.freeze([]);
const windowRuntimeForbiddenCandidateDependencies = Object.freeze([
  "wakeflow-setup.mjs",
  ...retiredNormalDependencyBasenames,
]);
const transportFrozenPublicFiles = Object.freeze([]);
const transportForbiddenPublicDependencies = retiredNormalDependencyBasenames;
const PUBLIC_CONFIG_SCHEMA_VERSION = 3;
const publicV3BoundaryFiles = [
  "schemas/wakeflow-config.schema.json",
  "wakeflow.config.json",
  "wakeflow.config.example.json",
  "scripts/lib/wakeflow-config-v3.mjs",
  "scripts/lib/wakeflow-config-v3-snapshot.mjs",
  "scripts/wakeflow-setup.mjs",
  "scripts/wakeflow-cli.mjs",
  "lib/wakeflow-mcp-tools.mjs",
  "scripts/lib/wakeflow-public-v3-runtime.mjs",
];

// 该清单是本 validator 直接消费的唯一文件集合，不等同于 shared core manifest 的完整文件数。
const requiredFiles = Object.freeze([
  hostProfile.memoryFile,
  "README.md",
  "README.zh-CN.md",
  "LICENSE",
  "package.json",
  hostProfile.pluginManifestPath,
  ".mcp.json",
  "bin/wakeflow-mcp",
  "mcp/server.cjs",
  "lib/wakeflow-process.mjs",
  "scripts/wakeflow-validate.mjs",
  "scripts/wakeflow-smoke.mjs",
  "scripts/wakeflow-core-manifest.json",
  hostArtifactChecksRelativePath,
  "scripts/lib/wakeflow-template-renderer.mjs",
  ...(hostProfile.artifact.podMaterializationHostFile
    ? [hostProfile.artifact.podMaterializationHostFile]
    : []),
  ...(hostProfile.artifact.decommissionHostFile
    ? [hostProfile.artifact.decommissionHostFile]
    : []),
  ...(hostProfile.artifact.migrationDecommissionHostFile
    ? [hostProfile.artifact.migrationDecommissionHostFile]
    : []),
  ...(hostProfile.artifact.migrationEffectHostFile
    ? [hostProfile.artifact.migrationEffectHostFile]
    : []),
  ...(hostProfile.artifact.activationScopeHostFile
    ? [hostProfile.artifact.activationScopeHostFile]
    : []),
  ...(hostProfile.artifact.locatorHostFile
    ? [hostProfile.artifact.locatorHostFile]
    : []),
  ...(hostProfile.artifact.locatorSchemaFile
    ? [hostProfile.artifact.locatorSchemaFile]
    : []),
  ...(hostProfile.artifact.lifecycleHostFile
    ? [hostProfile.artifact.lifecycleHostFile]
    : []),
  ...(hostProfile.artifact.facadeHostFile
    ? [hostProfile.artifact.facadeHostFile]
    : []),
  ...(hostProfile.artifact.transportHostFile
    ? [hostProfile.artifact.transportHostFile]
    : []),
  ...(hostProfile.artifact.settingsAssetsHostFile
    ? [hostProfile.artifact.settingsAssetsHostFile]
    : []),
  ...(hostProfile.artifact.activityHostFile
    ? [hostProfile.artifact.activityHostFile]
    : []),
  ...(hostProfile.artifact.activityProcessSchemaFile
    ? [hostProfile.artifact.activityProcessSchemaFile]
    : []),
  ...(hostProfile.artifact.activityManagerLockSchemaFile
    ? [hostProfile.artifact.activityManagerLockSchemaFile]
    : []),
  ...demandArtifactModules.map(({ file }) => file),
  ...demandLifecycleContractFiles,
  ...evidenceModules.map(({ file }) => file),
  ...activeProjectionContractFiles,
  ...activeCoordinationContractFiles,
  ...businessArchiveContractFiles,
  ...windowBindingModules.map(({ file }) => file),
  ...hostDecommissionContractFiles,
  ...hostActivationScopeContractFiles,
  ...windowCoordinationLeaseModules.map(({ file }) => file),
  ...podModules.map(({ file }) => file),
  ...keepLiveModules.map(({ file }) => file),
  ...transportModules.map(({ file }) => file),
  ...windowRuntimeModules.map(({ file }) => file),
  ...preservationModules.map(({ file }) => file),
  ...artifactTreeIdentityContractFiles,
  ...legacyClassifierContractFiles,
  ...migrationInventoryContractFiles,
  ...legacyOwnerDrainContractFiles,
  ...migrationPlanContractFiles,
  ...legacyArchiveContractFiles,
  ...migrationHostDecommissionContractFiles,
  ...migrationApplyContractFiles,
  ...workspaceMaintenancePlanModules.map(({ file }) => file),
  ...freshInitializeModules.map(({ file }) => file),
  ...maintenancePublicSurfaceContractFiles,
  "templates/wakeflow-asset-bundle.json",
  "wakeflow.config.json",
  "wakeflow.config.example.json",
  "schemas/wakeflow-config.schema.json",
  ...demandArtifactSchemas.map(({ file }) => file),
  evidenceSchema.file,
  windowBindingSchema.file,
  windowCoordinationLeaseSchema.file,
  ...podSchemas.map(({ file }) => file),
  ...keepLiveSchemas.map(({ file }) => file),
  ...transportSchemas.map(({ file }) => file),
  transportRetentionSchema.file,
  windowRuntimeSchema.file,
  preservationManifestSchema.file,
  preservationPlanSchema.file,
  workspaceMaintenancePlanSchema.file,
  "schemas/wakeflow-state-machine/wakeflow-state.schema.json",
  "schemas/wakeflow-state-machine/demand-authority.schema.json",
  "schemas/wakeflow-state-machine/task-package.schema.json",
  "schemas/wakeflow-state-machine/target-result.schema.json",
  "schemas/wakeflow-state-machine/transition-candidate.schema.json",
  "schemas/wakeflow-state-machine/automation-dispatch.schema.json",
  "skills/wakeflow-controller/SKILL.md",
  "skills/wakeflow-target/SKILL.md",
  "skills/wakeflow-target-craft/SKILL.md",
  "skills/wakeflow-governance/SKILL.md",
  "skills/wakeflow-design/SKILL.md",
  "skills/wakeflow-test/SKILL.md",
  "skills/wakeflow-governance/references/agents-rule-map.md",
  "skills/wakeflow-governance/references/wakeflow-ledgers.md",
  "assets/wakeflow-mark.svg",
  "assets/wakeflow-logo.svg",
]);

const hostArtifactChecks = createHostArtifactChecks({
  root,
  errors,
  readJson,
  requireFile,
  requirePath,
  stripDotSlash,
});

// 顶层顺序先闭合产物存在性，再检查各领域合同；后续 gate 不得把缺文件误判成业务漂移。
validateRequiredFileInventory();
validateCoreManifestContract();
for (const file of forbiddenPublicCutoverFiles) {
  if (existsSync(path.join(root, file))) errors.push(`retired public candidate file remains: ${file}`);
}

if (existsSync(path.join(root, oldLedgerReferenceFile))) {
  errors.push(`old ledger reference file remains: ${oldLedgerReferenceFile}`);
}

validateM7ANormalRuntimeBoundary();
validatePackage();
validatePluginManifest();
validateMarketplaceIfPresent();
validateRetiredRuntimeMetaSurface();
validateMcpConfig();
validatePublicV3ConfigContract();
await validateDemandArtifactCandidateContract();
await validateDemandLifecycleCandidateContract();
await validateEvidenceCandidateContract();
await validateActiveProjectionCandidateContract();
await validateActiveCoordinationCandidateContract();
await validateBusinessArchiveCandidateContract();
await validateWindowBindingCandidateContract();
await validateHostDecommissionCandidateContract();
await validateHostActivationScopeCandidateContract();
await validateWindowCoordinationLeaseCandidateContract();
await validatePodCandidateContract();
await validateKeepLiveCandidateContract();
await validateHostLocatorCandidateContract();
await validateHostLifecycleContract();
await validateHostFacadeContract();
await validateHostSettingsAssetsCandidateContract();
await validateHostActivityCandidateContract();
await validateHostTransportCandidateContract();
await validateTransportCandidateContract();
await validateWindowRuntimeCandidateContract();
await validatePreservationCandidateContract();
await validateArtifactTreeIdentityContract();
await validateLegacyClassifierContract();
await validateMigrationInventoryContract();
await validateLegacyOwnerDrainContract();
await validateMigrationPlanContract();
await validateLegacyArchiveContract();
await validateMigrationHostDecommissionContract();
await validateMigrationApplyContract();
await validateMigrationHostEffectContract();
await validateWorkspaceMaintenancePlanCandidateContract();
await validateFreshInitializeCandidateContract();
await validateMaintenancePublicSurfaceContract();
validateHostCapabilityContract();
validatePublicV3Boundary();
validateWorkspaceConfigs();
await validateMcpToolDeclarations();
validatePublicRuntimeScripts();
validateSkillSurface();
validateAssetBundle();
validateTextSurface();

const payload = {
  ok: errors.length === 0,
  root,
  checked: {
    requiredFiles: requiredFiles.length,
    runtimeScripts: publicRuntimeScriptEntries.length,
    skills: countSkillFiles(),
  },
  errors,
};

if (errors.length) {
  console.error(JSON.stringify(payload, null, 2));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify(payload, null, 2));
}

// 验证 validator 自己直接依赖的文件集合没有重复计数，并逐项要求真实文件。
function validateRequiredFileInventory() {
  const seen = new Set();
  for (const file of requiredFiles) {
    if (seen.has(file)) errors.push(`required file inventory contains duplicate entry: ${file}`);
    else seen.add(file);
    requireFile(file);
  }
}

/**
 * 验证 sync-core 生成的 shared manifest 是规范、无重复、排序稳定且指向 artifact 内真实普通文件。
 * 这里只确认发布清单事实，不推断某个领域 module 是否拥有运行 authority。
 */
function validateCoreManifestContract() {
  const manifest = readJson("scripts/wakeflow-core-manifest.json");
  if (!manifest) return;
  if (manifest.schemaVersion !== 1 || manifest.source !== "core" || !Array.isArray(manifest.files)) {
    errors.push("core manifest must be a schemaVersion 1 core file inventory");
    return;
  }

  let hasInvalidPath = false;
  for (const file of manifest.files) {
    const canonical = (
      typeof file === "string"
      && file.length > 0
      && !file.includes("\\")
      && !path.posix.isAbsolute(file)
      && path.posix.normalize(file) === file
      && !file.split("/").some((segment) => segment === "." || segment === "..")
    );
    if (!canonical) {
      hasInvalidPath = true;
      continue;
    }
    const absolute = path.join(root, file);
    if (!existsSync(absolute)) {
      errors.push(`core manifest entry must be a real packaged file: ${file}`);
      continue;
    }
    const node = lstatSync(absolute);
    if (node.isSymbolicLink() || !node.isFile()) {
      errors.push(`core manifest entry must be a real packaged file: ${file}`);
    }
  }
  if (hasInvalidPath) errors.push("core manifest files must be canonical portable paths");
  if (new Set(manifest.files).size !== manifest.files.length) {
    errors.push("core manifest files must not contain duplicates");
  }
  if (JSON.stringify(manifest.files) !== JSON.stringify([...manifest.files].sort())) {
    errors.push("core manifest files must use canonical lexical order");
  }
}

// Package、宿主 manifest 与 MCP launcher 只描述发布 wiring；host-specific 差异委托给 edition seam。
function validatePackage() {
  const manifest = readJson("package.json");
  if (!manifest) return;
  if (manifest.name !== hostProfile.artifact.packageName) errors.push(`package name must be ${hostProfile.artifact.packageName}`);
  if (manifest.private === true) errors.push("package.json must not be private for release packaging");
  if (manifest.type !== "module") errors.push("package type must be module");
  if (manifest.license !== "MIT") errors.push("package license must be MIT");
  if (manifest.homepage !== "https://github.com/GxFn/Wakeflow#readme") {
    errors.push("package homepage must point at the public Wakeflow README");
  }
  if (manifest.repository?.url !== "https://github.com/GxFn/Wakeflow.git") {
    errors.push("package repository URL must point at the public Wakeflow source");
  }
  if (!Array.isArray(manifest.keywords) || !manifest.keywords.includes("unattended")) {
    errors.push("package keywords must include unattended");
  }
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    errors.push("package files must declare the plugin release surface");
  } else {
    for (const expected of hostProfile.artifact.packagedEntries) {
      if (!manifest.files.includes(expected)) errors.push(`package files must include ${expected}`);
    }
  }
  if (manifest.scripts?.validate !== "node scripts/wakeflow-validate.mjs") {
    errors.push("package validate script must run scripts/wakeflow-validate.mjs");
  }
  if (manifest.scripts?.smoke !== "node scripts/wakeflow-smoke.mjs") {
    errors.push("package smoke script must run scripts/wakeflow-smoke.mjs");
  }
  for (const retired of ["validate:v3-candidate", "smoke:v3-candidate"]) {
    if (Object.hasOwn(manifest.scripts ?? {}, retired)) {
      errors.push(`package script ${retired} must be removed after public v3 promotion`);
    }
  }
  for (const name of ["validate", "smoke"]) {
    if (!manifest.scripts?.test?.includes(`npm run ${name}`)) {
      errors.push(`package test script must include npm run ${name}`);
    }
  }
}

// 下列薄包装保持 shared validator 不感知 Codex/Claude manifest 结构差异。
function validatePluginManifest() {
  hostArtifactChecks.validatePluginManifest();
}

function validateMarketplaceIfPresent() {
  hostArtifactChecks.validateMarketplaceIfPresent();
}

function validateRetiredRuntimeMetaSurface() {
  hostArtifactChecks.validateRetiredRuntimeMetaSurface();
}

// MCP wiring 同时验证公共 launcher、stdio server 最小协议面和 v3 facade 依赖方向。
function validateMcpConfig() {
  const packageJson = readJson("package.json");
  if (packageJson?.bin?.["wakeflow-mcp"] !== "./mcp/server.cjs") {
    errors.push("package.json must expose wakeflow-mcp bin at ./mcp/server.cjs");
  }
  if (packageJson?.scripts?.mcp !== "node ./mcp/server.cjs") {
    errors.push("package.json must expose an mcp script for the Wakeflow MCP entrypoint");
  }
  if (packageJson?.dependencies?.["@modelcontextprotocol/sdk"] || packageJson?.devDependencies?.["@modelcontextprotocol/sdk"]) {
    errors.push("package.json must not depend on @modelcontextprotocol/sdk; Wakeflow MCP is a standalone stdio server");
  }

  const config = readJson(".mcp.json");
  if (!config) return;
  const server = config.mcpServers?.wakeflow;
  if (!server) {
    errors.push(".mcp.json must expose mcpServers.wakeflow");
    return;
  }
  hostArtifactChecks.validateMcpServerWiring(server);

  const serverText = readText("mcp/server.cjs");
  for (const required of [
    "initialize",
    "notifications/initialized",
    "tools/list",
    "tools/call",
    "process.stdin",
    "process.stdout",
  ]) {
    if (!serverText.includes(required)) errors.push(`standalone MCP server is missing: ${required}`);
  }
  for (const required of [
    "@modelcontextprotocol/sdk",
    "node_modules",
  ]) {
    if (serverText.includes(required)) errors.push(`standalone MCP server must not depend on ${required}`);
  }
  const mcpText = readText("lib/wakeflow-mcp-tools.mjs");
  for (const required of [
    "wakeflow-public-v3-runtime.mjs",
    "wakeflow-maintenance-coordinator.mjs",
    "wakeflow-evidence-importer.mjs",
  ]) {
    if (!mcpText.includes(required)) errors.push(`public v3 MCP facade must consume ${required}`);
  }
  for (const forbidden of [
    "wakeflow_initialize_workspace",
    "wakeflow_adopt_demand_host",
    "wakeflow-mcp-tools-v3-candidate.mjs",
    "wakeflow-runtime.mjs",
    "wakeflow-config.mjs",
    "runWakeflowRuntime",
    "threadId",
    "promptFile",
    "prompt-file",
  ]) {
    if (mcpText.includes(forbidden)) errors.push(`public v3 MCP facade must not expose or import ${forbidden}`);
  }
}

function validateWorkspaceConfigs() {
  for (const file of ["wakeflow.config.json", "wakeflow.config.example.json"]) {
    const config = readJson(file);
    if (!config) continue;
    if (config.$schema !== WAKEFLOW_CONFIG_V3_SCHEMA_ID) {
      errors.push(`${file} must reference ${WAKEFLOW_CONFIG_V3_SCHEMA_ID}`);
    }
    if (config.schemaVersion !== WAKEFLOW_CONFIG_V3_VERSION) {
      errors.push(`${file} must use schemaVersion ${WAKEFLOW_CONFIG_V3_VERSION}`);
      continue;
    }
    try {
      parseWakeflowConfigV3(config);
    } catch (error) {
      errors.push(`${file} does not satisfy the public v3 contract: ${error.message}`);
    }
  }
}

// 公共 config schema 的 discriminator 与根闭包必须和 runtime parser 常量逐项一致。
function validatePublicV3ConfigContract() {
  if (WAKEFLOW_CONFIG_V3_SCHEMA_ID !== EXPECTED_CONFIG_V3_SCHEMA_ID) {
    errors.push(`public schema identifier constant must remain ${EXPECTED_CONFIG_V3_SCHEMA_ID}`);
  }
  if (WAKEFLOW_CONFIG_V3_KIND !== EXPECTED_CONFIG_V3_KIND) {
    errors.push(`public config kind constant must remain ${EXPECTED_CONFIG_V3_KIND}`);
  }
  if (WAKEFLOW_CONFIG_V3_VERSION !== EXPECTED_CONFIG_V3_VERSION) {
    errors.push(`public config schema version must remain ${EXPECTED_CONFIG_V3_VERSION}`);
  }
  const schema = readJson("schemas/wakeflow-config.schema.json");
  if (!schema) return;
  if (schema.$id !== EXPECTED_CONFIG_V3_SCHEMA_ID) {
    errors.push(`public schema $id must be ${EXPECTED_CONFIG_V3_SCHEMA_ID}`);
  }
  if (schema.$schema !== EXPECTED_CONFIG_V3_SCHEMA_DRAFT) {
    errors.push(`public schema must use ${EXPECTED_CONFIG_V3_SCHEMA_DRAFT}`);
  }
  if (schema.type !== "object" || schema.additionalProperties !== false) {
    errors.push("public schema root must be a strict object with additionalProperties=false");
  }
  if (schema.properties?.$schema?.const !== EXPECTED_CONFIG_V3_SCHEMA_ID) {
    errors.push(`public schema $schema property must require ${EXPECTED_CONFIG_V3_SCHEMA_ID}`);
  }
  if (schema.properties?.kind?.const !== EXPECTED_CONFIG_V3_KIND) {
    errors.push(`public schema kind property must require ${EXPECTED_CONFIG_V3_KIND}`);
  }
  if (schema.properties?.schemaVersion?.const !== EXPECTED_CONFIG_V3_VERSION) {
    errors.push(`public schema schemaVersion property must require ${EXPECTED_CONFIG_V3_VERSION}`);
  }
  for (const required of ["$schema", "kind", "schemaVersion"]) {
    if (!Array.isArray(schema.required) || !schema.required.includes(required)) {
      errors.push(`public schema root must require ${required}`);
    }
  }
}

// Demand artifact：检查共享清单 membership、六份 schema closure 与三模块 exact exports。
async function validateDemandArtifactCandidateContract() {
  const manifest = readJson("scripts/wakeflow-core-manifest.json");
  if (Array.isArray(manifest?.files)) {
    for (const file of demandArtifactContractFiles) {
      if (!manifest.files.includes(file)) errors.push(`core manifest must include ${file}`);
    }
  }

  const registry = new Map();
  const loadedSchemas = [];
  for (const contract of demandArtifactSchemas) {
    const schema = readJson(contract.file);
    if (!schema) continue;
    loadedSchemas.push({ contract, schema });
    if (schema.$schema !== EXPECTED_SCHEMA_DRAFT) {
      errors.push(`${contract.file} must use ${EXPECTED_SCHEMA_DRAFT}`);
    }
    if (schema.$id !== contract.id) {
      errors.push(`${contract.file} $id must be ${contract.id}`);
    } else if (registry.has(schema.$id)) {
      errors.push(`${contract.file} duplicates schema $id ${schema.$id}`);
    } else {
      registry.set(schema.$id, schema);
    }
    if (schema.type !== "object" || schema.additionalProperties !== false) {
      errors.push(`${contract.file} root must be a strict object with additionalProperties=false`);
    }
    if (schema.properties?.schemaVersion?.const !== 1) {
      errors.push(`${contract.file} schemaVersion property must require 1`);
    }
    if (schema.properties?.artifactKind?.const !== contract.artifactKind) {
      errors.push(`${contract.file} artifactKind property must require ${contract.artifactKind}`);
    }
    for (const required of ["schemaVersion", "artifactKind"]) {
      if (!Array.isArray(schema.required) || !schema.required.includes(required)) {
        errors.push(`${contract.file} root must require ${required}`);
      }
    }
  }
  for (const { contract, schema } of loadedSchemas) {
    validateSchemaReferences({ schema, contract, registry });
  }

  for (const contract of demandArtifactModules) {
    const modulePath = path.join(root, contract.file);
    if (!existsSync(modulePath)) continue;
    let moduleNamespace;
    try {
      moduleNamespace = await import(pathToFileURL(modulePath).href);
    } catch (error) {
      errors.push(`failed to load ${contract.file}: ${error.message}`);
      continue;
    }
    const expectedExports = [...contract.exports].sort();
    const actualExports = Object.keys(moduleNamespace).sort();
    if (JSON.stringify(actualExports) !== JSON.stringify(expectedExports)) {
      errors.push(`${contract.file} exports must be exactly: ${expectedExports.join(", ")}`);
    }
    for (const exportName of contract.exports) {
      if (!(exportName in moduleNamespace)) {
        errors.push(`${contract.file} must export ${exportName}`);
      } else if (
        exportName !== "WAKEFLOW_DEMAND_ARTIFACT_KINDS"
        && exportName !== "WAKEFLOW_DEMAND_ARTIFACT_SCHEMA_VERSION"
        && typeof moduleNamespace[exportName] !== "function"
      ) {
        errors.push(`${contract.file} export ${exportName} must be a function or class`);
      }
    }
    if (contract.file.endsWith("wakeflow-demand-artifact-records.mjs")) {
      const expectedKinds = demandArtifactSchemas.map(({ artifactKind }) => artifactKind);
      if (moduleNamespace.WAKEFLOW_DEMAND_ARTIFACT_SCHEMA_VERSION !== 1) {
        errors.push(`${contract.file} artifact schema version must remain 1`);
      }
      if (JSON.stringify(moduleNamespace.WAKEFLOW_DEMAND_ARTIFACT_KINDS) !== JSON.stringify(expectedKinds)) {
        errors.push(`${contract.file} artifact kinds must match the candidate schema registry`);
      }
    }
  }
}

// Demand lifecycle 只确认 orchestration seam 和依赖方向，不重复执行状态转换行为测试。
async function validateDemandLifecycleCandidateContract() {
  const manifest = readJson("scripts/wakeflow-core-manifest.json");
  if (Array.isArray(manifest?.files)) {
    for (const file of demandLifecycleContractFiles) {
      if (!manifest.files.includes(file)) errors.push(`core manifest must include ${file}`);
    }
  }

  await validateExactCandidateModules([demandLifecycleModule]);

  for (const [file, requiredExports] of [
    ["scripts/lib/wakeflow-demand-core-records.mjs", [
      "validateControllerEventRecord",
      "validateDemandStateRecord",
      "validateStateTransitionRecord",
    ]],
    ["scripts/lib/wakeflow-demand-state-service.mjs", [
      "commitDemandLifecycleTransitionWhileLocked",
      "recoverDemandLifecycleTransitionWhileLocked",
    ]],
  ]) {
    const modulePath = path.join(root, file);
    if (!existsSync(modulePath)) continue;
    try {
      const moduleNamespace = await import(pathToFileURL(modulePath).href);
      for (const exportName of requiredExports) {
        if (typeof moduleNamespace[exportName] !== "function") {
          errors.push(`${file} must export the demand lifecycle integration seam ${exportName}`);
        }
      }
    } catch (error) {
      errors.push(`failed to load ${file}: ${error.message}`);
    }
  }

  const lifecycleBasename = path.posix.basename(demandLifecycleModule.file);
  for (const file of transportFrozenPublicFiles) {
    const imports = moduleImportSpecifiers(readText(file));
    if (imports.some((specifier) => path.posix.basename(specifier) === lifecycleBasename)) {
      errors.push(`${file} must not import the internal demand lifecycle candidate ${lifecycleBasename}`);
    }
  }
  const imports = moduleImportSpecifiers(readText(demandLifecycleModule.file));
  for (const dependency of transportForbiddenPublicDependencies) {
    if (imports.some((specifier) => path.posix.basename(specifier) === dependency)) {
      errors.push(`${demandLifecycleModule.file} must not import frozen public-v2 dependency ${dependency}`);
    }
  }
}

// Managed evidence：固定 schema/ref、记录词汇和 importer/tree/records 的精确模块表面。
async function validateEvidenceCandidateContract() {
  const manifest = readJson("scripts/wakeflow-core-manifest.json");
  if (Array.isArray(manifest?.files)) {
    for (const file of evidenceContractFiles) {
      if (!manifest.files.includes(file)) errors.push(`core manifest must include ${file}`);
    }
  }

  const schema = readJson(evidenceSchema.file);
  if (schema) {
    if (schema.$schema !== EXPECTED_SCHEMA_DRAFT) {
      errors.push(`${evidenceSchema.file} must use ${EXPECTED_SCHEMA_DRAFT}`);
    }
    if (schema.$id !== evidenceSchema.id) {
      errors.push(`${evidenceSchema.file} $id must be ${evidenceSchema.id}`);
    }
    if (schema.type !== "object" || schema.additionalProperties !== false) {
      errors.push(`${evidenceSchema.file} root must be a strict object with additionalProperties=false`);
    }
    if (schema.properties?.schemaVersion?.const !== 1) {
      errors.push(`${evidenceSchema.file} schemaVersion property must require 1`);
    }
    if (schema.properties?.artifactKind?.const !== evidenceSchema.artifactKind) {
      errors.push(`${evidenceSchema.file} artifactKind property must require ${evidenceSchema.artifactKind}`);
    }
    for (const required of ["schemaVersion", "artifactKind"]) {
      if (!Array.isArray(schema.required) || !schema.required.includes(required)) {
        errors.push(`${evidenceSchema.file} root must require ${required}`);
      }
    }
    const registry = new Map(schema.$id === evidenceSchema.id ? [[schema.$id, schema]] : []);
    validateSchemaReferences({ schema, contract: evidenceSchema, registry });
  }

  for (const contract of evidenceModules) {
    const modulePath = path.join(root, contract.file);
    if (!existsSync(modulePath)) continue;
    let moduleNamespace;
    try {
      moduleNamespace = await import(pathToFileURL(modulePath).href);
    } catch (error) {
      errors.push(`failed to load ${contract.file}: ${error.message}`);
      continue;
    }
    const expectedExports = [...contract.valueExports, ...contract.exports].sort();
    const actualExports = Object.keys(moduleNamespace).sort();
    if (JSON.stringify(actualExports) !== JSON.stringify(expectedExports)) {
      errors.push(`${contract.file} exports must be exactly: ${expectedExports.join(", ")}`);
    }
    for (const exportName of [...contract.valueExports, ...contract.exports]) {
      if (!(exportName in moduleNamespace)) {
        errors.push(`${contract.file} must export ${exportName}`);
      } else if (!contract.valueExports.includes(exportName) && typeof moduleNamespace[exportName] !== "function") {
        errors.push(`${contract.file} export ${exportName} must be a function or class`);
      }
    }
    if (contract.file.endsWith("wakeflow-evidence-records.mjs")) {
      if (moduleNamespace.WAKEFLOW_EVIDENCE_SCHEMA_VERSION !== 1) {
        errors.push(`${contract.file} evidence schema version must remain 1`);
      }
      if (moduleNamespace.WAKEFLOW_EVIDENCE_ARTIFACT_KIND !== evidenceSchema.artifactKind) {
        errors.push(`${contract.file} evidence artifact kind must remain ${evidenceSchema.artifactKind}`);
      }
    }
  }
}

// Active projection 同时固定 candidate-only 元数据与每个模块的完整 export namespace。
async function validateActiveProjectionCandidateContract() {
  const manifest = readJson("scripts/wakeflow-core-manifest.json");
  if (Array.isArray(manifest?.files)) {
    for (const file of activeProjectionContractFiles) {
      if (!manifest.files.includes(file)) errors.push(`core manifest must include ${file}`);
    }
  }

  for (const contract of activeProjectionModules) {
    if (contract.invocationClass !== "candidate-domain-only" || contract.normalRuntime !== false) {
      errors.push(`${contract.file} must remain candidate-domain-only with normalRuntime=false`);
    }
    const modulePath = path.join(root, contract.file);
    if (!existsSync(modulePath)) continue;
    let moduleNamespace;
    try {
      moduleNamespace = await import(pathToFileURL(modulePath).href);
    } catch (error) {
      errors.push(`failed to load ${contract.file}: ${error.message}`);
      continue;
    }
    const expectedExports = [
      contract.versionExport,
      ...(contract.valueExports ?? []),
      ...contract.exports,
    ].sort();
    const actualExports = Object.keys(moduleNamespace).sort();
    if (JSON.stringify(actualExports) !== JSON.stringify(expectedExports)) {
      errors.push(`${contract.file} exports must be exactly: ${expectedExports.join(", ")}`);
    }
    if (!(contract.versionExport in moduleNamespace)) {
      errors.push(`${contract.file} must export ${contract.versionExport}`);
    } else if (moduleNamespace[contract.versionExport] !== 1) {
      errors.push(`${contract.file} ${contract.versionExport} must remain 1`);
    }
    for (const exportName of contract.exports) {
      if (!(exportName in moduleNamespace)) {
        errors.push(`${contract.file} must export ${exportName}`);
      } else if (typeof moduleNamespace[exportName] !== "function") {
        errors.push(`${contract.file} export ${exportName} must be a function or class`);
      }
    }
  }
}

/**
 * 装载已登记模块并比较完整 namespace；额外 export 与缺失 export 同样视为发布合同漂移。
 * 该 helper 只检查静态模块表面，不调用领域方法或据此判断运行状态。
 */
async function validateExactCandidateModules(contracts) {
  for (const contract of contracts) {
    const modulePath = path.join(root, contract.file);
    if (!existsSync(modulePath)) continue;
    let moduleNamespace;
    try {
      moduleNamespace = await import(pathToFileURL(modulePath).href);
    } catch (error) {
      errors.push(`failed to load ${contract.file}: ${error.message}`);
      continue;
    }
    const expectedExports = [...contract.valueExports, ...contract.exports].sort();
    const actualExports = Object.keys(moduleNamespace).sort();
    if (JSON.stringify(actualExports) !== JSON.stringify(expectedExports)) {
      errors.push(`${contract.file} exports must be exactly: ${expectedExports.join(", ")}`);
    }
    for (const exportName of expectedExports) {
      if (!(exportName in moduleNamespace)) {
        errors.push(`${contract.file} must export ${exportName}`);
      } else if (!contract.valueExports.includes(exportName) && typeof moduleNamespace[exportName] !== "function") {
        errors.push(`${contract.file} export ${exportName} must be a function or class`);
      }
    }
  }
}

// 下列 migration gates 固定 offline/bootstrap 闭包，并持续阻止它们反向进入 normal runtime。
async function validateArtifactTreeIdentityContract() {
  const manifest = readJson("scripts/wakeflow-core-manifest.json");
  if (Array.isArray(manifest?.files)) {
    for (const file of artifactTreeIdentityContractFiles) {
      if (!manifest.files.includes(file)) errors.push(`core manifest must include ${file}`);
    }
  }
  await validateExactCandidateModules(artifactTreeIdentityModules);
  const contract = artifactTreeIdentityModules[0];
  const modulePath = path.join(root, contract.file);
  if (!existsSync(modulePath)) return;
  try {
    const moduleNamespace = await import(pathToFileURL(modulePath).href);
    if (moduleNamespace.WAKEFLOW_ARTIFACT_TREE_MANIFEST_VERSION !== 1) {
      errors.push(`${contract.file} artifact tree manifest version must remain 1`);
    }
    if (moduleNamespace.WAKEFLOW_ARTIFACT_TREE_MANIFEST_KIND !== "wakeflow-loaded-artifact-tree") {
      errors.push(`${contract.file} artifact tree manifest kind must remain wakeflow-loaded-artifact-tree`);
    }
    const limits = moduleNamespace.WAKEFLOW_ARTIFACT_TREE_IDENTITY_LIMITS;
    if (
      !limits
      || !Object.isFrozen(limits)
      || !Number.isSafeInteger(limits.maxEntries)
      || !Number.isSafeInteger(limits.maxFiles)
      || !Number.isSafeInteger(limits.maxTotalBytes)
      || limits.maxEntries <= 0
      || limits.maxFiles <= 0
      || limits.maxTotalBytes <= 0
    ) {
      errors.push(`${contract.file} artifact tree identity limits must be positive and frozen`);
    }
  } catch (error) {
    errors.push(`failed to inspect ${contract.file} identity constants: ${error.message}`);
  }
}

async function validateLegacyClassifierContract() {
  const manifest = readJson("scripts/wakeflow-core-manifest.json");
  if (Array.isArray(manifest?.files)) {
    for (const file of legacyClassifierContractFiles) {
      if (!manifest.files.includes(file)) errors.push(`core manifest must include ${file}`);
    }
  }
  await validateExactCandidateModules(legacyClassifierModules);
  const contract = legacyClassifierModules[0];
  const modulePath = path.join(root, contract.file);
  if (existsSync(modulePath)) {
    try {
      const moduleNamespace = await import(pathToFileURL(modulePath).href);
      if (moduleNamespace.WAKEFLOW_LEGACY_CLASSIFIER_CATALOG_VERSION !== 1) {
        errors.push(`${contract.file} catalog version must remain 1`);
      }
      if (moduleNamespace.WAKEFLOW_LEGACY_CLASSIFIER_CATALOG_KIND !== "wakeflow-legacy-classifier-catalog") {
        errors.push(`${contract.file} catalog kind must remain wakeflow-legacy-classifier-catalog`);
      }
      if (
        !Object.isFrozen(moduleNamespace.WAKEFLOW_LEGACY_CLASSIFIER_ACTIONS)
        || JSON.stringify(moduleNamespace.WAKEFLOW_LEGACY_CLASSIFIER_ACTIONS)
          !== JSON.stringify(["keep", "manual", "remove", "transform"])
      ) {
        errors.push(`${contract.file} actions must remain the exact frozen D39 classifier actions`);
      }
      if (
        !Object.isFrozen(moduleNamespace.WAKEFLOW_LEGACY_CLASSIFIER_CONFIDENCE)
        || JSON.stringify(moduleNamespace.WAKEFLOW_LEGACY_CLASSIFIER_CONFIDENCE)
          !== JSON.stringify(["component-known", "exact-known", "typed-known", "unknown"])
      ) {
        errors.push(`${contract.file} confidence values must remain the exact frozen classifier scale`);
      }
      const catalog = readJson(legacyClassifierCatalogFile);
      if (catalog) {
        const validated = moduleNamespace.validateWakeflowLegacyClassifierCatalog(catalog);
        if (
          validated.coverage.originCount !== 97
          || validated.coverage.pendingOriginCount !== 0
          || validated.coverage.templateCount !== validated.entries.length
          || validated.entries.length <= 100
        ) {
          errors.push(`${legacyClassifierCatalogFile} must retain complete admitted legacy-origin coverage`);
        }
        const catalogText = readText(legacyClassifierCatalogFile);
        if (catalogText !== `${JSON.stringify(validated, null, 2)}\n`) {
          errors.push(`${legacyClassifierCatalogFile} must use its deterministic reviewable pretty form`);
        }
        if (
          catalogText.includes("test/fixtures/legacy-origins")
          || /\/(?:Users|home)\//u.test(catalogText)
          || /\/(?:private\/)?var\/folders\//u.test(catalogText)
        ) {
          errors.push(`${legacyClassifierCatalogFile} must not package fixture paths or machine-private paths`);
        }
      }
    } catch (error) {
      errors.push(`failed to inspect ${contract.file} classifier contract: ${error.message}`);
    }
  }

  const candidateBasenames = legacyClassifierModules.map(({ file }) => path.posix.basename(file));
  for (const file of legacyClassifierFrozenPublicFiles) {
    const imports = moduleImportSpecifiers(readText(file));
    for (const basename of candidateBasenames) {
      if (imports.some((specifier) => path.posix.basename(specifier) === basename)) {
        errors.push(`${file} must not import the internal legacy classifier candidate ${basename}`);
      }
    }
  }
  for (const { file } of legacyClassifierModules) {
    const imports = moduleImportSpecifiers(readText(file));
    for (const dependency of legacyClassifierForbiddenPublicDependencies) {
      if (imports.some((specifier) => path.posix.basename(specifier) === dependency)) {
        errors.push(`${file} must not import frozen public-v2 dependency ${dependency}`);
      }
    }
  }
}

async function validateMigrationInventoryContract() {
  const manifest = readJson("scripts/wakeflow-core-manifest.json");
  if (Array.isArray(manifest?.files)) {
    for (const file of migrationInventoryContractFiles) {
      if (!manifest.files.includes(file)) errors.push(`core manifest must include ${file}`);
    }
  }
  await validateExactCandidateModules(migrationInventoryModules);
  const contract = migrationInventoryModules[0];
  const modulePath = path.join(root, contract.file);
  if (existsSync(modulePath)) {
    try {
      const moduleNamespace = await import(pathToFileURL(modulePath).href);
      if (moduleNamespace.WAKEFLOW_MIGRATION_INVENTORY_KIND !== "WakeflowMigrationInventory") {
        errors.push(`${contract.file} kind must remain WakeflowMigrationInventory`);
      }
      if (moduleNamespace.WAKEFLOW_MIGRATION_INVENTORY_SCHEMA_VERSION !== 1) {
        errors.push(`${contract.file} schema version must remain 1`);
      }
      if (typeof moduleNamespace.inspectWakeflowMigrationInventory !== "function") {
        errors.push(`${contract.file} must expose inspectWakeflowMigrationInventory`);
      }
    } catch (error) {
      errors.push(`failed to inspect ${contract.file} migration inventory contract: ${error.message}`);
    }
  }

  const candidateBasenames = migrationInventoryModules.map(({ file }) => path.posix.basename(file));
  for (const file of migrationInventoryFrozenPublicFiles) {
    const imports = moduleImportSpecifiers(readText(file));
    for (const basename of candidateBasenames) {
      if (imports.some((specifier) => path.posix.basename(specifier) === basename)) {
        errors.push(`${file} must not import the internal migration inventory candidate ${basename}`);
      }
    }
  }
  for (const { file } of migrationInventoryModules) {
    const imports = moduleImportSpecifiers(readText(file));
    if (!imports.some((specifier) => path.posix.basename(specifier) === "wakeflow-legacy-classifier.mjs")) {
      errors.push(`${file} must consume the strict legacy classifier`);
    }
    for (const dependency of migrationInventoryForbiddenPublicDependencies) {
      if (imports.some((specifier) => path.posix.basename(specifier) === dependency)) {
        errors.push(`${file} must not import frozen public-v2 dependency ${dependency}`);
      }
    }
  }
}

async function validateLegacyOwnerDrainContract() {
  const manifest = readJson("scripts/wakeflow-core-manifest.json");
  if (Array.isArray(manifest?.files)) {
    for (const file of legacyOwnerDrainContractFiles) {
      if (!manifest.files.includes(file)) errors.push(`core manifest must include ${file}`);
    }
  }
  await validateExactCandidateModules(legacyOwnerDrainModules);
  const contract = legacyOwnerDrainModules[0];
  const modulePath = path.join(root, contract.file);
  if (existsSync(modulePath)) {
    try {
      const moduleNamespace = await import(pathToFileURL(modulePath).href);
      if (moduleNamespace.WAKEFLOW_LEGACY_OWNER_DRAIN_KIND !== "WakeflowLegacyOwnerDrainAssessment") {
        errors.push(`${contract.file} kind must remain WakeflowLegacyOwnerDrainAssessment`);
      }
      if (moduleNamespace.WAKEFLOW_LEGACY_OWNER_DRAIN_SCHEMA_VERSION !== 1) {
        errors.push(`${contract.file} schema version must remain 1`);
      }
      if (
        moduleNamespace.WAKEFLOW_LEGACY_ARCHIVE_IMPORT_INVENTORY_KIND
          !== "WakeflowLegacyArchiveImportInventory"
        || moduleNamespace.WAKEFLOW_LEGACY_ARCHIVE_IMPORT_INVENTORY_SCHEMA_VERSION !== 1
      ) {
        errors.push(`${contract.file} archive import inventory identity must remain v1`);
      }
      if (JSON.stringify(moduleNamespace.WAKEFLOW_LEGACY_OWNER_DRAIN_STATUSES) !== JSON.stringify([
        "absent",
        "drain-required",
        "drained",
        "drained-with-host-followup",
        "manual-recovery",
      ])) {
        errors.push(`${contract.file} statuses must remain the closed owner-drain vocabulary`);
      }
      if (typeof moduleNamespace.inspectWakeflowLegacyOwnerDrain !== "function") {
        errors.push(`${contract.file} must expose inspectWakeflowLegacyOwnerDrain`);
      }
    } catch (error) {
      errors.push(`failed to inspect ${contract.file} owner-drain contract: ${error.message}`);
    }
  }

  const candidateBasenames = legacyOwnerDrainModules.map(({ file }) => path.posix.basename(file));
  for (const file of legacyOwnerDrainFrozenPublicFiles) {
    const imports = moduleImportSpecifiers(readText(file));
    for (const basename of candidateBasenames) {
      if (imports.some((specifier) => path.posix.basename(specifier) === basename)) {
        errors.push(`${file} must not import the internal legacy owner-drain candidate ${basename}`);
      }
    }
  }
  for (const { file } of legacyOwnerDrainModules) {
    const imports = moduleImportSpecifiers(readText(file));
    for (const required of [
      "wakeflow-artifact-tree-identity.mjs",
      "wakeflow-legacy-archive-records.mjs",
      "wakeflow-migration-inventory.mjs",
    ]) {
      if (!imports.some((specifier) => path.posix.basename(specifier) === required)) {
        errors.push(`${file} must consume ${required}`);
      }
    }
    if (imports.some((specifier) => path.posix.basename(specifier) === "wakeflow-migration-plan.mjs")) {
      errors.push(`${file} must remain owner-drain evidence and not import wakeflow-migration-plan.mjs`);
    }
    for (const dependency of legacyOwnerDrainForbiddenPublicDependencies) {
      if (imports.some((specifier) => path.posix.basename(specifier) === dependency)) {
        errors.push(`${file} must not import frozen public-v2 dependency ${dependency}`);
      }
    }
  }
  for (const { file } of [...legacyClassifierModules, ...migrationInventoryModules]) {
    const imports = moduleImportSpecifiers(readText(file));
    for (const basename of candidateBasenames) {
      if (imports.some((specifier) => path.posix.basename(specifier) === basename)) {
        errors.push(`${file} must remain an upstream evidence producer and not import ${basename}`);
      }
    }
  }
}

async function validateMigrationPlanContract() {
  const manifest = readJson("scripts/wakeflow-core-manifest.json");
  if (Array.isArray(manifest?.files)) {
    for (const file of migrationPlanContractFiles) {
      if (!manifest.files.includes(file)) errors.push(`core manifest must include ${file}`);
    }
  }
  await validateExactCandidateModules(migrationPlanModules);
  const contract = migrationPlanModules[0];
  const modulePath = path.join(root, contract.file);
  if (existsSync(modulePath)) {
    try {
      const moduleNamespace = await import(pathToFileURL(modulePath).href);
      if (moduleNamespace.WAKEFLOW_MIGRATION_PLAN_KIND !== "WakeflowExplicitMigrationPlan") {
        errors.push(`${contract.file} kind must remain WakeflowExplicitMigrationPlan`);
      }
      if (moduleNamespace.WAKEFLOW_MIGRATION_PLAN_SCHEMA_VERSION !== 3) {
        errors.push(`${contract.file} schema version must remain 3`);
      }
      if (
        moduleNamespace.WAKEFLOW_LEGACY_ARCHIVE_TRANSFORM_OWNER_RESOLUTION_KIND
          !== "WakeflowLegacyArchiveTransformOwnerResolution"
        || moduleNamespace.WAKEFLOW_LEGACY_ARCHIVE_TRANSFORM_OWNER_RESOLUTION_SCHEMA_VERSION !== 1
      ) {
        errors.push(`${contract.file} legacy archive transform owner resolution must remain v1`);
      }
      if (JSON.stringify(moduleNamespace.WAKEFLOW_MIGRATION_PLAN_ACTIONS) !== JSON.stringify(["keep", "manual", "remove", "transform"])) {
        errors.push(`${contract.file} actions must remain the closed four-action migration vocabulary`);
      }
      if (typeof moduleNamespace.planWakeflowMigrationPreview !== "function") {
        errors.push(`${contract.file} must expose planWakeflowMigrationPreview`);
      }
    } catch (error) {
      errors.push(`failed to inspect ${contract.file} migration plan contract: ${error.message}`);
    }
  }

  const candidateBasenames = migrationPlanModules.map(({ file }) => path.posix.basename(file));
  for (const file of migrationPlanFrozenPublicFiles) {
    const imports = moduleImportSpecifiers(readText(file));
    for (const basename of candidateBasenames) {
      if (imports.some((specifier) => path.posix.basename(specifier) === basename)) {
        errors.push(`${file} must not import the internal migration plan candidate ${basename}`);
      }
    }
  }
  for (const { file } of migrationPlanModules) {
    const imports = moduleImportSpecifiers(readText(file));
    for (const required of [
      "wakeflow-artifact-tree-identity.mjs",
      "wakeflow-legacy-owner-drain.mjs",
      "wakeflow-migration-inventory.mjs",
    ]) {
      if (!imports.some((specifier) => path.posix.basename(specifier) === required)) {
        errors.push(`${file} must consume ${required}`);
      }
    }
    for (const dependency of migrationPlanForbiddenPublicDependencies) {
      if (imports.some((specifier) => path.posix.basename(specifier) === dependency)) {
        errors.push(`${file} must not import frozen public-v2 dependency ${dependency}`);
      }
    }
  }
  for (const { file } of migrationInventoryModules) {
    const imports = moduleImportSpecifiers(readText(file));
    for (const basename of candidateBasenames) {
      if (imports.some((specifier) => path.posix.basename(specifier) === basename)) {
        errors.push(`${file} must remain an inventory producer and not import ${basename}`);
      }
    }
  }
}

async function validateLegacyArchiveContract() {
  const manifest = readJson("scripts/wakeflow-core-manifest.json");
  if (Array.isArray(manifest?.files)) {
    for (const file of legacyArchiveContractFiles) {
      if (!manifest.files.includes(file)) errors.push(`core manifest must include ${file}`);
    }
  }

  const registry = new Map();
  const loadedSchemas = [];
  for (const contract of legacyArchiveSchemas) {
    const schema = readJson(contract.file);
    if (!schema) continue;
    loadedSchemas.push({ contract, schema });
    if (schema.$schema !== EXPECTED_SCHEMA_DRAFT) {
      errors.push(`${contract.file} must use ${EXPECTED_SCHEMA_DRAFT}`);
    }
    if (schema.$id !== contract.id) {
      errors.push(`${contract.file} $id must be ${contract.id}`);
    } else {
      registry.set(schema.$id, schema);
    }
    if (schema.type !== "object" || schema.additionalProperties !== false) {
      errors.push(`${contract.file} root must be a strict object with additionalProperties=false`);
    }
    if (!/migration-only/iu.test(schema.$comment ?? "")) {
      errors.push(`${contract.file} must identify itself as migration-only`);
    }
    validateStrictSchemaObjectNodes({ schema, contract });
  }
  const loadedReferences = [];
  for (const file of legacyArchiveReferenceSchemaFiles) {
    const schema = readJson(file);
    if (!schema) continue;
    loadedReferences.push({ contract: { file }, schema });
    if (schema.$id) registry.set(schema.$id, schema);
  }
  for (const entry of [...loadedSchemas, ...loadedReferences]) {
    validateSchemaReferences({ ...entry, registry });
  }

  const evidenceSchema = loadedSchemas.find(({ contract }) => (
    contract.id === "urn:wakeflow:internal:business-archive:legacy-evidence-summary:v1"
  ))?.schema;
  const descriptorSchema = loadedSchemas.find(({ contract }) => (
    contract.id === "urn:wakeflow:internal:business-archive:legacy-source-descriptor:v1"
  ))?.schema;
  const transportSchema = loadedSchemas.find(({ contract }) => (
    contract.id === "urn:wakeflow:internal:business-archive:legacy-transport-summary:v1"
  ))?.schema;
  const planSchema = loadedSchemas.find(({ contract }) => (
    contract.id === "urn:wakeflow:internal:migration:legacy-archive-transform-plan:v1"
  ))?.schema;
  if (JSON.stringify(evidenceSchema?.properties?.sourceKind?.enum) !== JSON.stringify([
    "pod-close",
    "pod-materialization",
    "pod-test-access",
  ])) errors.push("legacy evidence schema source kinds must remain the closed T06 vocabulary");
  if (
    descriptorSchema?.properties?.schemaVersion?.const !== 1
    || descriptorSchema?.properties?.artifactKind?.const !== "wakeflow-legacy-demand-archive-source"
  ) errors.push("legacy source descriptor identity must remain v1");
  if (
    transportSchema?.properties?.schemaVersion?.const !== 1
    || transportSchema?.properties?.artifactKind?.const !== "wakeflow-legacy-archive-transport-summary"
  ) errors.push("legacy transport summary identity must remain v1");
  if (
    planSchema?.properties?.schemaId?.const
      !== "urn:wakeflow:internal:migration:legacy-archive-transform-plan:v1"
    || planSchema?.$defs?.payload?.properties?.kind?.const
      !== "WakeflowLegacyArchiveTransformPlan"
    || planSchema?.$defs?.payload?.properties?.schemaVersion?.const !== 1
  ) errors.push("legacy archive transform plan identity must remain v1");
  const sourceAuthority = planSchema?.$defs?.sourceAuthority;
  if (
    !Array.isArray(sourceAuthority?.required)
    || !sourceAuthority.required.includes("sourceIds")
    || sourceAuthority?.properties?.sourceIds?.minItems !== 1
  ) errors.push("legacy archive transform source authority must require exact T06 sourceIds");

  await validateExactCandidateModules(legacyArchiveModules);
  const recordsContract = legacyArchiveModules[0];
  const transformContract = legacyArchiveModules[1];
  const recordsPath = path.join(root, recordsContract.file);
  const transformPath = path.join(root, transformContract.file);
  if (existsSync(recordsPath)) {
    try {
      const namespace = await import(pathToFileURL(recordsPath).href);
      if (
        namespace.WAKEFLOW_LEGACY_ARCHIVE_RECORD_SCHEMA_VERSION !== 1
        || namespace.WAKEFLOW_LEGACY_ARCHIVE_TRANSPORT_SUMMARY_KIND
          !== "wakeflow-legacy-archive-transport-summary"
        || JSON.stringify(namespace.WAKEFLOW_LEGACY_EVIDENCE_SOURCE_KINDS)
          !== JSON.stringify(["pod-close", "pod-materialization", "pod-test-access"])
      ) errors.push(`${recordsContract.file} identity must remain the closed v1 archive codec`);
    } catch {
      // The exact module loader above reports bounded load failures.
    }
  }
  if (existsSync(transformPath)) {
    try {
      const namespace = await import(pathToFileURL(transformPath).href);
      if (
        namespace.WAKEFLOW_LEGACY_ARCHIVE_TRANSFORM_PLAN_SCHEMA_ID
          !== "urn:wakeflow:internal:migration:legacy-archive-transform-plan:v1"
        || namespace.WAKEFLOW_LEGACY_ARCHIVE_TRANSFORM_PLAN_KIND
          !== "WakeflowLegacyArchiveTransformPlan"
        || namespace.WAKEFLOW_LEGACY_ARCHIVE_TRANSFORM_PLAN_SCHEMA_VERSION !== 1
      ) errors.push(`${transformContract.file} plan identity must remain v1`);
    } catch {
      // The exact module loader above reports bounded load failures.
    }
  }

  const candidateBasenames = legacyArchiveModules.map(({ file }) => path.posix.basename(file));
  for (const file of legacyArchiveFrozenPublicFiles) {
    const imports = moduleImportSpecifiers(readText(file));
    for (const basename of candidateBasenames) {
      if (imports.some((specifier) => path.posix.basename(specifier) === basename)) {
        errors.push(`${file} must not import migration-only legacy archive candidate ${basename}`);
      }
    }
  }
  for (const { file } of legacyArchiveModules) {
    const imports = moduleImportSpecifiers(readText(file));
    for (const dependency of legacyArchiveForbiddenPublicDependencies) {
      if (imports.some((specifier) => path.posix.basename(specifier) === dependency)) {
        errors.push(`${file} must not import frozen public-v2 dependency ${dependency}`);
      }
    }
  }
  const recordImports = moduleImportSpecifiers(readText(recordsContract.file))
    .map((specifier) => path.posix.basename(specifier));
  for (const required of ["wakeflow-canonical-json.mjs", "wakeflow-identifiers.mjs"]) {
    if (!recordImports.includes(required)) errors.push(`${recordsContract.file} must consume ${required}`);
  }
  const transformImports = moduleImportSpecifiers(readText(transformContract.file))
    .map((specifier) => path.posix.basename(specifier));
  for (const required of [
    "wakeflow-business-archive-records.mjs",
    "wakeflow-ledger-records.mjs",
    "wakeflow-legacy-archive-records.mjs",
    "wakeflow-legacy-owner-drain.mjs",
    "wakeflow-migration-inventory.mjs",
    "wakeflow-migration-plan.mjs",
    "wakeflow-preservation.mjs",
  ]) {
    if (!transformImports.includes(required)) errors.push(`${transformContract.file} must consume ${required}`);
  }
  for (const upstream of [
    ...legacyClassifierModules,
    ...migrationInventoryModules,
    ...legacyOwnerDrainModules,
    ...migrationPlanModules,
    ...preservationModules,
  ]) {
    const imports = moduleImportSpecifiers(readText(upstream.file));
    if (imports.some((specifier) => path.posix.basename(specifier) === path.posix.basename(transformContract.file))) {
      errors.push(`${upstream.file} must remain upstream of legacy archive transform and not import ${path.posix.basename(transformContract.file)}`);
    }
  }
}

async function validateMigrationHostDecommissionContract() {
  const manifest = readJson("scripts/wakeflow-core-manifest.json");
  if (Array.isArray(manifest?.files)) {
    for (const file of migrationHostDecommissionContractFiles) {
      if (!manifest.files.includes(file)) errors.push(`core manifest must include ${file}`);
    }
  }
  if (!migrationHostDecommissionHostModule) {
    errors.push("host profile must declare one migrationDecommissionHostFile");
    return;
  }
  await validateExactCandidateModules([
    migrationHostDecommissionModule,
    migrationHostDecommissionHostModule,
  ]);
  const hostPath = path.join(root, migrationHostDecommissionHostModule.file);
  if (existsSync(hostPath)) {
    try {
      const namespace = await import(pathToFileURL(hostPath).href);
      const adapter = namespace.wakeflowMigrationDecommissionHostAdapter;
      if (
        adapter === null
        || typeof adapter !== "object"
        || !Object.isFrozen(adapter)
        || JSON.stringify(Object.keys(adapter).sort()) !== JSON.stringify(["hostId", "inspect"])
        || adapter.hostId !== hostProfile.hostId
        || typeof adapter.inspect !== "function"
      ) {
        errors.push(`${migrationHostDecommissionHostModule.file} must expose one frozen host-neutral migration decommission adapter`);
      }
    } catch (error) {
      errors.push(`failed to inspect ${migrationHostDecommissionHostModule.file} host adapter: ${error.message}`);
    }
  }
  const sharedPath = path.join(root, migrationHostDecommissionModule.file);
  if (existsSync(sharedPath)) {
    try {
      const namespace = await import(pathToFileURL(sharedPath).href);
      if (namespace.WAKEFLOW_MIGRATION_HOST_DECOMMISSION_PLAN_KIND !== "WakeflowMigrationHostDecommissionPlan") {
        errors.push(`${migrationHostDecommissionModule.file} plan kind is invalid`);
      }
      if (namespace.WAKEFLOW_MIGRATION_HOST_DECOMMISSION_OUTCOME_KIND !== "WakeflowMigrationHostDecommissionOutcome") {
        errors.push(`${migrationHostDecommissionModule.file} outcome kind is invalid`);
      }
      if (namespace.WAKEFLOW_MIGRATION_HOST_DECOMMISSION_ASSESSMENT_KIND !== "WakeflowMigrationHostDecommissionAssessment") {
        errors.push(`${migrationHostDecommissionModule.file} assessment kind is invalid`);
      }
      if (namespace.WAKEFLOW_MIGRATION_HOST_DECOMMISSION_SCHEMA_VERSION !== 1) {
        errors.push(`${migrationHostDecommissionModule.file} schema version must remain 1`);
      }
    } catch (error) {
      errors.push(`failed to inspect ${migrationHostDecommissionModule.file}: ${error.message}`);
    }
  }

  const candidateBasenames = [
    path.posix.basename(migrationHostDecommissionModule.file),
    path.posix.basename(migrationHostDecommissionHostModule.file),
  ];
  for (const file of migrationHostDecommissionFrozenPublicFiles) {
    const imports = moduleImportSpecifiers(readText(file));
    for (const basename of candidateBasenames) {
      if (imports.some((specifier) => path.posix.basename(specifier) === basename)) {
        errors.push(`${file} must not import the migration-only host decommission candidate ${basename}`);
      }
    }
  }
  const sharedImports = moduleImportSpecifiers(readText(migrationHostDecommissionModule.file))
    .map((specifier) => path.posix.basename(specifier));
  if (!sharedImports.includes("wakeflow-migration-plan.mjs")) {
    errors.push(`${migrationHostDecommissionModule.file} must bind the exact migration plan`);
  }
  for (const dependency of migrationHostDecommissionForbiddenPublicDependencies) {
    if (sharedImports.includes(dependency)) {
      errors.push(`${migrationHostDecommissionModule.file} must not import frozen public-v2 dependency ${dependency}`);
    }
  }
  const hostImports = moduleImportSpecifiers(readText(migrationHostDecommissionHostModule.file))
    .map((specifier) => path.posix.basename(specifier));
  for (const required of [
    "wakeflow-migration-host-decommission.mjs",
    "wakeflow-migration-inventory.mjs",
    "wakeflow-migration-plan.mjs",
  ]) {
    if (!hostImports.includes(required)) {
      errors.push(`${migrationHostDecommissionHostModule.file} must consume ${required}`);
    }
  }
  for (const forbidden of [
    "wakeflow-host-decommission-result.mjs",
    "wakeflow-codex-decommission.mjs",
    "wakeflow-claude-decommission.mjs",
    "wakeflow-claude-locator.mjs",
    "wakeflow-workspace-mutation.mjs",
    ...migrationHostDecommissionForbiddenPublicDependencies,
  ]) {
    if (hostImports.includes(forbidden)) {
      errors.push(`${migrationHostDecommissionHostModule.file} must not import ${forbidden}`);
    }
  }
  for (const upstream of [
    ...migrationInventoryModules,
    ...legacyOwnerDrainModules,
    ...migrationPlanModules,
  ]) {
    const imports = moduleImportSpecifiers(readText(upstream.file));
    for (const basename of candidateBasenames) {
      if (imports.some((specifier) => path.posix.basename(specifier) === basename)) {
        errors.push(`${upstream.file} must remain upstream of migration host decommission and not import ${basename}`);
      }
    }
  }
}

async function validateMigrationApplyContract() {
  const manifest = readJson("scripts/wakeflow-core-manifest.json");
  if (Array.isArray(manifest?.files)) {
    for (const file of migrationApplyContractFiles) {
      if (!manifest.files.includes(file)) errors.push(`core manifest must include ${file}`);
    }
  }
  await validateExactCandidateModules(migrationApplyModules);
  const applyModule = migrationApplyModules.find((entry) => entry.file.endsWith("wakeflow-migration-apply.mjs"));
  const configOwnerModule = migrationApplyModules.find((entry) => entry.file.endsWith("wakeflow-migration-config-owner.mjs"));
  const productionModule = migrationApplyModules.find((entry) => entry.file.endsWith("wakeflow-migration-production.mjs"));
  const bootstrapModule = migrationApplyModules.find((entry) => entry.file.endsWith("wakeflow-bootstrap.mjs"));
  const applyPath = path.join(root, applyModule.file);
  const configOwnerPath = path.join(root, configOwnerModule.file);
  const productionPath = path.join(root, productionModule.file);
  const bootstrapPath = path.join(root, bootstrapModule.file);
  if (existsSync(applyPath)) {
    try {
      const namespace = await import(pathToFileURL(applyPath).href);
      if (namespace.WAKEFLOW_MIGRATION_APPLY_PLAN_KIND !== "WakeflowMigrationApplyPlan") {
        errors.push(`${applyModule.file} plan kind is invalid`);
      }
      if (
        namespace.WAKEFLOW_MIGRATION_APPLY_PLAN_SCHEMA_ID
          !== "urn:wakeflow:internal:migration-apply-plan:v1"
        || namespace.WAKEFLOW_MIGRATION_APPLY_PLAN_SCHEMA_VERSION !== 1
      ) errors.push(`${applyModule.file} schema identity must remain v1`);
      if (JSON.stringify(namespace.WAKEFLOW_MIGRATION_APPLY_PHASES) !== JSON.stringify([
        "target-authority",
        "archive-or-preservation",
        "managed-surfaces",
        "derived-projections",
        "exact-source-release",
      ])) errors.push(`${applyModule.file} phases must remain the exact D38 commit order`);
    } catch {
      // The exact module loader above already reports the bounded import error.
    }
  }
  if (existsSync(configOwnerPath)) {
    try {
      const namespace = await import(pathToFileURL(configOwnerPath).href);
      if (
        namespace.WAKEFLOW_MIGRATION_CONFIG_OWNER_KIND !== "WakeflowMigrationConfigOwnerPlan"
        || namespace.WAKEFLOW_MIGRATION_CONFIG_OWNER_SCHEMA_ID
          !== "urn:wakeflow:internal:migration-config-owner-plan:v1"
        || namespace.WAKEFLOW_MIGRATION_CONFIG_OWNER_SCHEMA_VERSION !== 1
      ) errors.push(`${configOwnerModule.file} config migration owner identity must remain v1`);
    } catch {
      // The exact module loader above already reports the bounded import error.
    }
  }
  if (existsSync(productionPath)) {
    try {
      const namespace = await import(pathToFileURL(productionPath).href);
      if (
        namespace.WAKEFLOW_PRODUCTION_MIGRATION_KIND !== "WakeflowProductionMigrationComposition"
        || namespace.WAKEFLOW_PRODUCTION_MIGRATION_PHASE_SCHEMA_ID
          !== "urn:wakeflow:internal:migration-production-phase-plan:v1"
        || namespace.WAKEFLOW_PRODUCTION_MIGRATION_SCHEMA_VERSION !== 1
      ) errors.push(`${productionModule.file} production migration identity must remain v1`);
    } catch {
      // The exact module loader above already reports the bounded import error.
    }
  }
  if (existsSync(bootstrapPath)) {
    try {
      const namespace = await import(pathToFileURL(bootstrapPath).href);
      if (
        namespace.WAKEFLOW_BOOTSTRAP_SCHEMA_VERSION !== 1
        || namespace.WAKEFLOW_BOOTSTRAP_ACTION !== "explicit-migration"
        || JSON.stringify(namespace.WAKEFLOW_BOOTSTRAP_MODES) !== JSON.stringify(["preview", "apply", "recover"])
        || namespace.WAKEFLOW_BOOTSTRAP_STDIN_LIMIT !== 8 * 1024 * 1024
      ) errors.push(`${bootstrapModule.file} must remain the exact I2 stdin action contract`);
    } catch {
      // The exact module loader above already reports the bounded import error.
    }
  }

  const launcher = "bin/wakeflow-bootstrap";
  const launcherPath = path.join(root, launcher);
  if (existsSync(launcherPath)) {
    const launcherStat = statSync(launcherPath);
    if (!launcherStat.isFile() || (launcherStat.mode & 0o111) === 0) {
      errors.push(`${launcher} must be one executable regular file`);
    }
    const launcherText = readText(launcher);
    if (!launcherText.includes("scripts/wakeflow-bootstrap.mjs")) {
      errors.push(`${launcher} must execute only its fixed sibling backend`);
    }
    if (launcherText.includes('"$@"') || !launcherText.includes('exec "$candidate" "$BACKEND"')) {
      errors.push(`${launcher} must not forward argv or accept a caller-selected backend`);
    }
  }

  const packageJson = readJson("package.json");
  if (JSON.stringify(packageJson?.bin) !== JSON.stringify({ "wakeflow-mcp": "./mcp/server.cjs" })) {
    errors.push("package.json bin must not register wakeflow-bootstrap");
  }
  for (const file of [".mcp.json", hostProfile.pluginManifestPath]) {
    if (readText(file).includes("wakeflow-bootstrap")) {
      errors.push(`${file} must not register wakeflow-bootstrap`);
    }
  }

  const candidateBasenames = migrationApplyModules.map(({ file }) => path.posix.basename(file));
  for (const file of migrationApplyFrozenPublicFiles) {
    const imports = moduleImportSpecifiers(readText(file));
    for (const basename of candidateBasenames) {
      if (imports.some((specifier) => path.posix.basename(specifier) === basename)) {
        errors.push(`${file} must not import migration-only ${basename}`);
      }
    }
  }
  for (const { file } of migrationApplyModules) {
    const imports = moduleImportSpecifiers(readText(file));
    for (const dependency of migrationApplyForbiddenPublicDependencies) {
      if (imports.some((specifier) => path.posix.basename(specifier) === dependency)) {
        errors.push(`${file} must not import frozen public-v2 dependency ${dependency}`);
      }
    }
  }
  const expectedImports = new Map([
    [applyModule.file, [
      "wakeflow-migration-host-decommission.mjs",
      "wakeflow-migration-plan.mjs",
      "wakeflow-workspace-mutation.mjs",
    ]],
    [configOwnerModule.file, [
      "wakeflow-migration-plan.mjs",
      "wakeflow-workspace-mutation.mjs",
    ]],
    [productionModule.file, [
      "wakeflow-fresh-initialize.mjs",
      "wakeflow-maintenance-action-composition.mjs",
      "wakeflow-migration-apply.mjs",
      "wakeflow-migration-config-owner.mjs",
      "wakeflow-workspace-mutation.mjs",
    ]],
    [bootstrapModule.file, [
      "wakeflow-artifact-tree-identity.mjs",
      "wakeflow-host-activation-gate.mjs",
      "wakeflow-host-profile.mjs",
      "wakeflow-host-settings-assets-owner.mjs",
      "wakeflow-migration-apply.mjs",
      "wakeflow-migration-inventory.mjs",
      "wakeflow-migration-plan.mjs",
      "wakeflow-migration-production.mjs",
      "wakeflow-template-renderer.mjs",
    ]],
  ]);
  for (const [file, required] of expectedImports) {
    const imports = moduleImportSpecifiers(readText(file)).map((specifier) => path.posix.basename(specifier));
    for (const dependency of required) {
      if (!imports.includes(dependency)) errors.push(`${file} must consume ${dependency}`);
    }
  }
  for (const upstream of [
    ...artifactTreeIdentityModules,
    ...legacyClassifierModules,
    ...migrationInventoryModules,
    ...legacyOwnerDrainModules,
    ...migrationPlanModules,
    migrationHostDecommissionModule,
    migrationHostDecommissionHostModule,
  ].filter(Boolean)) {
    const imports = moduleImportSpecifiers(readText(upstream.file));
    for (const basename of candidateBasenames) {
      if (imports.some((specifier) => path.posix.basename(specifier) === basename)) {
        errors.push(`${upstream.file} must remain upstream of migration apply and not import ${basename}`);
      }
    }
  }
}

async function validateMigrationHostEffectContract() {
  if (!migrationHostEffectHostModule || !migrationHostDecommissionHostModule) {
    if (!migrationHostEffectHostModule) {
      errors.push("host profile must declare one migrationEffectHostFile");
    }
    if (!migrationHostDecommissionHostModule) {
      errors.push("host effect composition requires one migrationDecommissionHostFile");
    }
    return;
  }
  await validateExactCandidateModules([migrationHostEffectHostModule]);
  const imports = moduleImportSpecifiers(readText(migrationHostEffectHostModule.file))
    .map((specifier) => path.posix.basename(specifier));
  for (const required of [
    "wakeflow-migration-host-decommission.mjs",
    "wakeflow-migration-plan.mjs",
    path.posix.basename(migrationHostDecommissionHostModule.file),
  ]) {
    if (!imports.includes(required)) {
      errors.push(`${migrationHostEffectHostModule.file} must consume ${required}`);
    }
  }
  if (
    hostProfile.hostId === "codex"
    && !imports.includes("wakeflow-migration-apply.mjs")
  ) {
    errors.push(`${migrationHostEffectHostModule.file} must bind exact Codex manual acknowledgements`);
  }
  for (const forbidden of [
    "wakeflow-workspace-mutation.mjs",
    "wakeflow-codex-decommission.mjs",
    "wakeflow-claude-decommission.mjs",
    "wakeflow-claude-locator.mjs",
    ...migrationApplyForbiddenPublicDependencies,
  ]) {
    if (imports.includes(forbidden)) {
      errors.push(`${migrationHostEffectHostModule.file} must not import ${forbidden}`);
    }
  }
  const bootstrapImports = moduleImportSpecifiers(readText("scripts/wakeflow-bootstrap.mjs"))
    .map((specifier) => path.posix.basename(specifier));
  if (bootstrapImports.includes(path.posix.basename(migrationHostEffectHostModule.file))) {
    errors.push("the isolated bootstrap must not load an injectable host effect participant");
  }
  const hostEffectBasename = path.posix.basename(migrationHostEffectHostModule.file);
  for (const file of migrationApplyFrozenPublicFiles) {
    const publicImports = moduleImportSpecifiers(readText(file));
    if (publicImports.some((specifier) => path.posix.basename(specifier) === hostEffectBasename)) {
      errors.push(`${file} must not import migration-only ${hostEffectBasename}`);
    }
  }
  for (const upstream of [
    ...migrationInventoryModules,
    ...legacyOwnerDrainModules,
    ...migrationPlanModules,
    migrationHostDecommissionModule,
    migrationHostDecommissionHostModule,
    ...migrationApplyModules,
  ].filter(Boolean)) {
    const upstreamImports = moduleImportSpecifiers(readText(upstream.file));
    if (upstreamImports.some((specifier) => path.posix.basename(specifier) === hostEffectBasename)) {
      errors.push(`${upstream.file} must remain upstream of host effect composition and not import ${hostEffectBasename}`);
    }
  }
}

// Current coordination/host owners：按 capability 检查适用文件、常量、adapter shape 与依赖方向。
async function validateActiveCoordinationCandidateContract() {
  const manifest = readJson("scripts/wakeflow-core-manifest.json");
  if (Array.isArray(manifest?.files)) {
    for (const file of activeCoordinationContractFiles) {
      if (!manifest.files.includes(file)) errors.push(`core manifest must include ${file}`);
    }
  }
  await validateExactCandidateModules(activeCoordinationModules);
}

async function validateBusinessArchiveCandidateContract() {
  const manifest = readJson("scripts/wakeflow-core-manifest.json");
  if (Array.isArray(manifest?.files)) {
    for (const file of businessArchiveContractFiles) {
      if (!manifest.files.includes(file)) errors.push(`core manifest must include ${file}`);
    }
  }

  const loadedSchemas = [];
  const registry = new Map();
  for (const contract of businessArchiveSchemas) {
    const schema = readJson(contract.file);
    if (!schema) continue;
    loadedSchemas.push({ contract, schema });
    if (schema.$schema !== EXPECTED_SCHEMA_DRAFT) {
      errors.push(`${contract.file} must use ${EXPECTED_SCHEMA_DRAFT}`);
    }
    if (schema.$id !== contract.id) {
      errors.push(`${contract.file} $id must be ${contract.id}`);
    } else {
      registry.set(schema.$id, schema);
    }
    if (schema.type !== "object" || schema.additionalProperties !== false) {
      errors.push(`${contract.file} root must be a strict object with additionalProperties=false`);
    }
    if (schema.properties?.schemaVersion?.const !== 1) {
      errors.push(`${contract.file} schemaVersion property must require 1`);
    }
    if (schema.properties?.artifactKind?.const !== contract.artifactKind) {
      errors.push(`${contract.file} artifactKind property must require ${contract.artifactKind}`);
    }
    for (const required of ["schemaVersion", "artifactKind"]) {
      if (!Array.isArray(schema.required) || !schema.required.includes(required)) {
        errors.push(`${contract.file} root must require ${required}`);
      }
    }
  }
  for (const file of businessArchiveReferenceSchemaFiles) {
    const schema = readJson(file);
    if (schema?.$id) registry.set(schema.$id, schema);
  }
  for (const entry of loadedSchemas) validateSchemaReferences({ ...entry, registry });

  await validateExactCandidateModules(businessArchiveModules);
  const recordsPath = path.join(root, "scripts/lib/wakeflow-business-archive-records.mjs");
  if (existsSync(recordsPath)) {
    try {
      const records = await import(pathToFileURL(recordsPath).href);
      if (records.WAKEFLOW_BUSINESS_ARCHIVE_SCHEMA_VERSION !== 1) {
        errors.push("scripts/lib/wakeflow-business-archive-records.mjs schema version must remain 1");
      }
      const expectedKinds = businessArchiveSchemas.map(({ artifactKind }) => artifactKind);
      if (JSON.stringify(records.WAKEFLOW_BUSINESS_ARCHIVE_KINDS) !== JSON.stringify(expectedKinds)) {
        errors.push("scripts/lib/wakeflow-business-archive-records.mjs kinds must match the schema registry");
      }
    } catch {
      // The exact module loader above already reports the bounded import error.
    }
  }
}

async function validateWindowBindingCandidateContract() {
  const manifest = readJson("scripts/wakeflow-core-manifest.json");
  if (Array.isArray(manifest?.files)) {
    for (const file of windowBindingContractFiles) {
      if (!manifest.files.includes(file)) errors.push(`core manifest must include ${file}`);
    }
  }

  const schema = readJson(windowBindingSchema.file);
  if (schema) {
    if (schema.$schema !== EXPECTED_SCHEMA_DRAFT) {
      errors.push(`${windowBindingSchema.file} must use ${EXPECTED_SCHEMA_DRAFT}`);
    }
    if (schema.$id !== windowBindingSchema.id) {
      errors.push(`${windowBindingSchema.file} $id must be ${windowBindingSchema.id}`);
    }
    if (schema.type !== "object" || schema.additionalProperties !== false) {
      errors.push(`${windowBindingSchema.file} root must be a strict object with additionalProperties=false`);
    }
    if (schema.properties?.schemaVersion?.const !== 1) {
      errors.push(`${windowBindingSchema.file} schemaVersion property must require 1`);
    }
    if (schema.properties?.kind?.const !== windowBindingSchema.kind) {
      errors.push(`${windowBindingSchema.file} kind property must require ${windowBindingSchema.kind}`);
    }
    for (const required of ["schemaVersion", "kind"]) {
      if (!Array.isArray(schema.required) || !schema.required.includes(required)) {
        errors.push(`${windowBindingSchema.file} root must require ${required}`);
      }
    }
    const registry = new Map(schema.$id === windowBindingSchema.id ? [[schema.$id, schema]] : []);
    validateSchemaReferences({ schema, contract: windowBindingSchema, registry });
  }

  await validateExactCandidateModules(windowBindingModules);
  const recordsPath = path.join(root, "scripts/lib/wakeflow-window-binding-records.mjs");
  if (existsSync(recordsPath)) {
    try {
      const records = await import(pathToFileURL(recordsPath).href);
      if (records.WAKEFLOW_WINDOW_BINDING_SCHEMA_VERSION !== 1) {
        errors.push("scripts/lib/wakeflow-window-binding-records.mjs schema version must remain 1");
      }
      if (records.WAKEFLOW_WINDOW_BINDING_KIND !== windowBindingSchema.kind) {
        errors.push(`scripts/lib/wakeflow-window-binding-records.mjs kind must remain ${windowBindingSchema.kind}`);
      }
    } catch {
      // The exact module loader above already reports the bounded import error.
    }
  }
}

async function validateHostDecommissionCandidateContract() {
  const manifest = readJson("scripts/wakeflow-core-manifest.json");
  if (Array.isArray(manifest?.files)) {
    for (const file of hostDecommissionContractFiles) {
      if (!manifest.files.includes(file)) errors.push(`core manifest must include ${file}`);
    }
  }

  if (!hostDecommissionModule) {
    errors.push("host profile must declare one decommissionHostFile");
    return;
  }
  const expectedCapabilityRealization = hostProfile.hostId === "claude-code"
    ? "current"
    : "manual-gate";
  for (const capability of ["close", "revoke"]) {
    const declared = hostProfile.capabilities?.[capability];
    if (declared?.applicable !== true || declared.realization !== expectedCapabilityRealization) {
      errors.push(
        `${hostProfile.hostId} decommission contract requires ${capability} realization=${expectedCapabilityRealization}`,
      );
    }
  }

  const schema = readJson(hostDecommissionResultSchema.file);
  if (schema) {
    if (schema.$schema !== EXPECTED_SCHEMA_DRAFT) {
      errors.push(`${hostDecommissionResultSchema.file} must use ${EXPECTED_SCHEMA_DRAFT}`);
    }
    if (schema.$id !== hostDecommissionResultSchema.id) {
      errors.push(`${hostDecommissionResultSchema.file} $id must be ${hostDecommissionResultSchema.id}`);
    }
    if (schema.type !== "object" || schema.additionalProperties !== false) {
      errors.push(`${hostDecommissionResultSchema.file} root must be a strict object with additionalProperties=false`);
    }
    if (schema.properties?.kind?.const !== hostDecommissionResultSchema.kind) {
      errors.push(
        `${hostDecommissionResultSchema.file} kind property must require ${hostDecommissionResultSchema.kind}`,
      );
    }
    if (schema.properties?.schemaVersion?.const !== 1) {
      errors.push(`${hostDecommissionResultSchema.file} schemaVersion property must require 1`);
    }
    for (const required of [
      "kind",
      "schemaVersion",
      "programId",
      "hostId",
      "windowId",
      "binding",
      "subjectDigest",
      "status",
      "hostAction",
      "session",
      "routingRevocation",
      "observedAt",
    ]) {
      if (!Array.isArray(schema.required) || !schema.required.includes(required)) {
        errors.push(`${hostDecommissionResultSchema.file} root must require ${required}`);
      }
    }
    validateStrictSchemaObjectNodes({ schema, contract: hostDecommissionResultSchema });
    validateSchemaReferences({
      schema,
      contract: hostDecommissionResultSchema,
      registry: new Map(schema.$id === hostDecommissionResultSchema.id ? [[schema.$id, schema]] : []),
    });
  }

  await validateExactCandidateModules([
    hostDecommissionResultModule,
    hostDecommissionModule,
  ]);
  const resultModulePath = path.join(root, hostDecommissionResultModule.file);
  if (existsSync(resultModulePath)) {
    try {
      const resultModule = await import(pathToFileURL(resultModulePath).href);
      if (resultModule.WAKEFLOW_HOST_DECOMMISSION_RESULT_KIND !== hostDecommissionResultSchema.kind) {
        errors.push(
          `${hostDecommissionResultModule.file} WAKEFLOW_HOST_DECOMMISSION_RESULT_KIND must remain ${hostDecommissionResultSchema.kind}`,
        );
      }
      if (resultModule.WAKEFLOW_HOST_DECOMMISSION_SCHEMA_VERSION !== 1) {
        errors.push(`${hostDecommissionResultModule.file} schema version must remain 1`);
      }
    } catch {
      // The exact module loader above already reports the bounded import error.
    }
  }

  const hostImports = moduleImportSpecifiers(readText(hostDecommissionModule.file))
    .map((specifier) => path.posix.basename(specifier));
  if (!hostImports.includes(path.posix.basename(hostDecommissionResultModule.file))) {
    errors.push(`${hostDecommissionModule.file} must consume the shared host decommission result owner`);
  }
  const locatorBasename = path.posix.basename(hostProfile.artifact.locatorHostFile ?? "");
  if (hostProfile.hostId === "claude-code" && !hostImports.includes(locatorBasename)) {
    errors.push(`${hostDecommissionModule.file} must use the exact Claude locator operation fence`);
  }
  if (hostProfile.hostId === "codex" && locatorBasename && hostImports.includes(locatorBasename)) {
    errors.push(`${hostDecommissionModule.file} must not invent a Claude locator dependency for Codex`);
  }
  const podServiceImports = moduleImportSpecifiers(readText("scripts/lib/wakeflow-pod-service.mjs"))
    .map((specifier) => path.posix.basename(specifier));
  if (!podServiceImports.includes(path.posix.basename(hostDecommissionResultModule.file))) {
    errors.push("scripts/lib/wakeflow-pod-service.mjs must admit close receipts through the shared host result");
  }

  const frozenFiles = [...new Set([
    ...podFrozenPublicFiles,
    ...transportFrozenPublicFiles,
    ...(Array.isArray(hostProfile.artifact.locatorFrozenPublicFiles)
      ? hostProfile.artifact.locatorFrozenPublicFiles
      : []),
  ])];
  const candidateBasenames = [
    path.posix.basename(hostDecommissionResultModule.file),
    path.posix.basename(hostDecommissionModule.file),
  ];
  for (const file of frozenFiles) {
    const imports = moduleImportSpecifiers(readText(file));
    for (const basename of candidateBasenames) {
      if (imports.some((specifier) => path.posix.basename(specifier) === basename)) {
        errors.push(`${file} must not import the internal host decommission candidate ${basename}`);
      }
    }
  }
  const frozenBasenames = frozenFiles.map((file) => path.posix.basename(file));
  for (const contract of [hostDecommissionResultModule, hostDecommissionModule]) {
    const imports = moduleImportSpecifiers(readText(contract.file));
    for (const dependency of frozenBasenames) {
      if (imports.some((specifier) => path.posix.basename(specifier) === dependency)) {
        errors.push(`${contract.file} must not import frozen public-v2 dependency ${dependency}`);
      }
    }
  }
}

async function validateHostActivationScopeCandidateContract() {
  const manifest = readJson("scripts/wakeflow-core-manifest.json");
  if (Array.isArray(manifest?.files)) {
    for (const file of hostActivationScopeContractFiles) {
      if (!manifest.files.includes(file)) errors.push(`core manifest must include ${file}`);
    }
  }

  if (!hostActivationScopeAdapterModule) {
    errors.push("host profile must declare one activationScopeHostFile");
    return;
  }
  const activationCapability = hostProfile.capabilities?.activation;
  if (activationCapability?.applicable !== true || activationCapability.realization !== "runtime-probed") {
    errors.push(`${hostProfile.hostId} activation scope contract requires activation realization=runtime-probed`);
  }

  await validateExactCandidateModules([
    hostActivationGateModule,
    hostActivationScopeObservationModule,
    hostActivationScopeAdapterModule,
  ]);
  const hostAdapterPath = path.join(root, hostActivationScopeAdapterModule.file);
  if (existsSync(hostAdapterPath)) {
    try {
      const namespace = await import(pathToFileURL(hostAdapterPath).href);
      const adapter = namespace.wakeflowHostActivationScopeAdapter;
      if (
        adapter === null
        || typeof adapter !== "object"
        || !Object.isFrozen(adapter)
        || JSON.stringify(Object.keys(adapter).sort()) !== JSON.stringify(["hostId", "inspect", "pluginId"])
        || adapter.hostId !== hostProfile.hostId
        || adapter.pluginId !== "wakeflow@gxfn"
        || typeof adapter.inspect !== "function"
      ) {
        errors.push(`${hostActivationScopeAdapterModule.file} must expose one frozen host-neutral activation scope adapter`);
      }
    } catch (error) {
      errors.push(`failed to inspect ${hostActivationScopeAdapterModule.file} host adapter: ${error.message}`);
    }
  }
  const observationPath = path.join(root, hostActivationScopeObservationModule.file);
  if (existsSync(observationPath)) {
    try {
      const observationModule = await import(pathToFileURL(observationPath).href);
      if (
        JSON.stringify(observationModule.HOST_ACTIVATION_SCOPES)
        !== JSON.stringify(["per-workspace", "host-wide", "unknown"])
      ) {
        errors.push(
          `${hostActivationScopeObservationModule.file} HOST_ACTIVATION_SCOPES must remain per-workspace/host-wide/unknown`,
        );
      }
      if (observationModule.WAKEFLOW_HOST_ACTIVATION_SCOPE_KIND !== "WakeflowHostActivationScopeObservation") {
        errors.push(
          `${hostActivationScopeObservationModule.file} WAKEFLOW_HOST_ACTIVATION_SCOPE_KIND is invalid`,
        );
      }
      if (observationModule.WAKEFLOW_HOST_ACTIVATION_SCOPE_SCHEMA_VERSION !== 1) {
        errors.push(`${hostActivationScopeObservationModule.file} schema version must remain 1`);
      }
    } catch {
      // The exact module loader above already reports the bounded import error.
    }
  }

  const gatePath = path.join(root, hostActivationGateModule.file);
  if (existsSync(gatePath)) {
    try {
      const gateModule = await import(pathToFileURL(gatePath).href);
      if (
        JSON.stringify(gateModule.HOST_ACTIVATION_GATE_STATUSES)
        !== JSON.stringify(["blocked", "manual-host-gate", "ready"])
      ) {
        errors.push(
          `${hostActivationGateModule.file} statuses must remain blocked/manual-host-gate/ready`,
        );
      }
      if (
        gateModule.WAKEFLOW_HOST_ACTIVATION_GATE_SCHEMA_VERSION !== 1
        || gateModule.WAKEFLOW_HOST_ACTIVATION_REPORT_KIND !== "WakeflowHostActivationReport"
        || gateModule.WAKEFLOW_WORKSPACE_ACTIVATION_SUBJECT_KIND
          !== "WakeflowWorkspaceActivationSubject"
        || gateModule.WAKEFLOW_WORKSPACE_CUTOVER_OBSERVATION_KIND
          !== "WakeflowWorkspaceCutoverObservation"
      ) {
        errors.push(`${hostActivationGateModule.file} activation identity must remain v1`);
      }
    } catch {
      // The exact module loader above already reports the bounded import error.
    }
  }

  const adapterPath = path.join(root, hostActivationScopeAdapterModule.file);
  if (existsSync(adapterPath)) {
    try {
      const adapter = await import(pathToFileURL(adapterPath).href);
      const hostId = hostProfile.hostId === "claude-code"
        ? adapter.WAKEFLOW_CLAUDE_ACTIVATION_SCOPE_HOST_ID
        : adapter.WAKEFLOW_CODEX_ACTIVATION_SCOPE_HOST_ID;
      const pluginId = hostProfile.hostId === "claude-code"
        ? adapter.WAKEFLOW_CLAUDE_ACTIVATION_SCOPE_PLUGIN_ID
        : adapter.WAKEFLOW_CODEX_ACTIVATION_SCOPE_PLUGIN_ID;
      if (hostId !== hostProfile.hostId) {
        errors.push(`${hostActivationScopeAdapterModule.file} host ID must remain ${hostProfile.hostId}`);
      }
      if (pluginId !== "wakeflow@gxfn") {
        errors.push(`${hostActivationScopeAdapterModule.file} plugin identity must remain wakeflow@gxfn`);
      }
      if (
        hostProfile.hostId === "claude-code"
        && (
          adapter.WAKEFLOW_CLAUDE_INSTALLATION_OBSERVATION_KIND
            !== "ClaudePluginInstallationScopeObservation"
          || adapter.WAKEFLOW_CLAUDE_INSTALLATION_OBSERVATION_SCHEMA_VERSION !== 1
        )
      ) {
        errors.push(`${hostActivationScopeAdapterModule.file} Claude host observation contract is invalid`);
      }
    } catch {
      // The exact module loader above already reports the bounded import error.
    }
  }

  const sharedBasename = path.posix.basename(hostActivationScopeObservationModule.file);
  const gateBasename = path.posix.basename(hostActivationGateModule.file);
  const adapterImports = moduleImportSpecifiers(readText(hostActivationScopeAdapterModule.file))
    .map((specifier) => path.posix.basename(specifier));
  if (!adapterImports.includes(sharedBasename)) {
    errors.push(`${hostActivationScopeAdapterModule.file} must consume the shared activation scope owner`);
  }
  const gateImports = moduleImportSpecifiers(readText(hostActivationGateModule.file))
    .map((specifier) => path.posix.basename(specifier));
  if (!gateImports.includes(sharedBasename)) {
    errors.push(`${hostActivationGateModule.file} must consume the shared activation scope observation`);
  }
  const bootstrapImports = moduleImportSpecifiers(readText("scripts/wakeflow-bootstrap.mjs"))
    .map((specifier) => path.posix.basename(specifier));
  if (!bootstrapImports.includes(gateBasename)) {
    errors.push("scripts/wakeflow-bootstrap.mjs must consume the host activation gate");
  }
  const wrongHostFile = hostProfile.hostId === "claude-code"
    ? "scripts/lib/wakeflow-codex-activation-scope.mjs"
    : "scripts/lib/wakeflow-claude-activation-scope.mjs";
  if (existsSync(path.join(root, wrongHostFile))) {
    errors.push(`${wrongHostFile} must not be packaged in the ${hostProfile.hostId} artifact`);
  }

  const frozenFiles = [...new Set([
    ...podFrozenPublicFiles,
    ...transportFrozenPublicFiles,
    ...(Array.isArray(hostProfile.artifact.locatorFrozenPublicFiles)
      ? hostProfile.artifact.locatorFrozenPublicFiles
      : []),
  ])];
  const candidateBasenames = [
    sharedBasename,
    gateBasename,
    path.posix.basename(hostActivationScopeAdapterModule.file),
  ];
  for (const file of frozenFiles) {
    const imports = moduleImportSpecifiers(readText(file));
    for (const basename of candidateBasenames) {
      if (imports.some((specifier) => path.posix.basename(specifier) === basename)) {
        errors.push(`${file} must not import the internal activation scope candidate ${basename}`);
      }
    }
  }
  const frozenBasenames = frozenFiles.map((file) => path.posix.basename(file));
  for (const contract of [
    hostActivationScopeObservationModule,
    hostActivationGateModule,
    hostActivationScopeAdapterModule,
  ]) {
    const imports = moduleImportSpecifiers(readText(contract.file));
    for (const dependency of frozenBasenames) {
      if (imports.some((specifier) => path.posix.basename(specifier) === dependency)) {
        errors.push(`${contract.file} must not import frozen public-v2 dependency ${dependency}`);
      }
    }
  }
}

async function validateWindowCoordinationLeaseCandidateContract() {
  const manifest = readJson("scripts/wakeflow-core-manifest.json");
  if (Array.isArray(manifest?.files)) {
    for (const file of windowCoordinationLeaseContractFiles) {
      if (!manifest.files.includes(file)) errors.push(`core manifest must include ${file}`);
    }
  }

  const schema = readJson(windowCoordinationLeaseSchema.file);
  if (schema) {
    if (schema.$schema !== EXPECTED_SCHEMA_DRAFT) {
      errors.push(`${windowCoordinationLeaseSchema.file} must use ${EXPECTED_SCHEMA_DRAFT}`);
    }
    if (schema.$id !== windowCoordinationLeaseSchema.id) {
      errors.push(`${windowCoordinationLeaseSchema.file} $id must be ${windowCoordinationLeaseSchema.id}`);
    }
    if (schema.type !== "object" || schema.additionalProperties !== false) {
      errors.push(`${windowCoordinationLeaseSchema.file} root must be a strict object with additionalProperties=false`);
    }
    if (schema.properties?.schemaVersion?.const !== 1) {
      errors.push(`${windowCoordinationLeaseSchema.file} schemaVersion property must require 1`);
    }
    if (schema.properties?.kind?.const !== windowCoordinationLeaseSchema.kind) {
      errors.push(`${windowCoordinationLeaseSchema.file} kind property must require ${windowCoordinationLeaseSchema.kind}`);
    }
    for (const required of ["schemaVersion", "kind"]) {
      if (!Array.isArray(schema.required) || !schema.required.includes(required)) {
        errors.push(`${windowCoordinationLeaseSchema.file} root must require ${required}`);
      }
    }
    const registry = new Map(
      schema.$id === windowCoordinationLeaseSchema.id ? [[schema.$id, schema]] : [],
    );
    validateSchemaReferences({ schema, contract: windowCoordinationLeaseSchema, registry });
  }

  await validateExactCandidateModules(windowCoordinationLeaseModules);
  const recordsPath = path.join(root, "scripts/lib/wakeflow-window-lease-records.mjs");
  if (existsSync(recordsPath)) {
    try {
      const records = await import(pathToFileURL(recordsPath).href);
      if (records.WAKEFLOW_WINDOW_COORDINATION_LEASE_SCHEMA_VERSION !== 1) {
        errors.push("scripts/lib/wakeflow-window-lease-records.mjs schema version must remain 1");
      }
      if (records.WAKEFLOW_WINDOW_COORDINATION_LEASE_KIND !== windowCoordinationLeaseSchema.kind) {
        errors.push(`scripts/lib/wakeflow-window-lease-records.mjs kind must remain ${windowCoordinationLeaseSchema.kind}`);
      }
    } catch {
      // The exact module loader above already reports the bounded import error.
    }
  }

  const candidateBasenames = windowCoordinationLeaseModules
    .map(({ file }) => path.posix.basename(file));
  for (const file of windowRuntimeFrozenPublicFiles) {
    const source = readText(file);
    for (const basename of candidateBasenames) {
      if (moduleImportSpecifiers(source).some((specifier) => path.posix.basename(specifier) === basename)) {
        errors.push(`${file} must not import the internal window coordination lease candidate ${basename}`);
      }
    }
  }
  for (const { file } of windowCoordinationLeaseModules) {
    const source = readText(file);
    for (const dependency of windowRuntimeForbiddenCandidateDependencies) {
      if (moduleImportSpecifiers(source).some((specifier) => path.posix.basename(specifier) === dependency)) {
        errors.push(`${file} must not import frozen public-v2 dependency ${dependency}`);
      }
    }
  }
}

async function validatePodCandidateContract() {
  const manifest = readJson("scripts/wakeflow-core-manifest.json");
  if (Array.isArray(manifest?.files)) {
    for (const file of podContractFiles) {
      if (!manifest.files.includes(file)) errors.push(`core manifest must include ${file}`);
    }
  }

  const loadedSchemas = [];
  const registry = new Map();
  for (const contract of podSchemas) {
    const schema = readJson(contract.file);
    if (!schema) continue;
    loadedSchemas.push({ contract, schema });
    if (schema.$schema !== EXPECTED_SCHEMA_DRAFT) {
      errors.push(`${contract.file} must use ${EXPECTED_SCHEMA_DRAFT}`);
    }
    if (schema.$id !== contract.id) {
      errors.push(`${contract.file} $id must be ${contract.id}`);
    } else if (registry.has(schema.$id)) {
      errors.push(`${contract.file} duplicates schema $id ${schema.$id}`);
    } else {
      registry.set(schema.$id, schema);
    }
    if (schema.type !== "object" || schema.additionalProperties !== false) {
      errors.push(`${contract.file} root must be a strict object with additionalProperties=false`);
    }
    if (schema.properties?.schemaVersion?.const !== 1) {
      errors.push(`${contract.file} schemaVersion property must require 1`);
    }
    if (schema.properties?.kind?.const !== contract.kind) {
      errors.push(`${contract.file} kind property must require ${contract.kind}`);
    }
    for (const required of ["kind", "schemaVersion"]) {
      if (!Array.isArray(schema.required) || !schema.required.includes(required)) {
        errors.push(`${contract.file} root must require ${required}`);
      }
    }
    validateStrictSchemaObjectNodes({ schema, contract });
  }
  for (const { contract, schema } of loadedSchemas) {
    validateSchemaReferences({ schema, contract, registry });
  }

  await validateExactCandidateModules(podModules);
  const recordsPath = path.join(root, "scripts/lib/wakeflow-pod-records.mjs");
  if (existsSync(recordsPath)) {
    try {
      const records = await import(pathToFileURL(recordsPath).href);
      if (records.WAKEFLOW_POD_SCHEMA_VERSION !== 1) {
        errors.push("scripts/lib/wakeflow-pod-records.mjs schema version must remain 1");
      }
      const expectedKinds = podSchemas.map(({ kind }) => kind);
      if (JSON.stringify(records.WAKEFLOW_POD_RECORD_KINDS) !== JSON.stringify(expectedKinds)) {
        errors.push("scripts/lib/wakeflow-pod-records.mjs kinds must match the exact Pod schema registry");
      }
      for (const contract of podSchemas) {
        if (records[contract.kindExport] !== contract.kind) {
          errors.push(
            `scripts/lib/wakeflow-pod-records.mjs ${contract.kindExport} must remain ${contract.kind}`,
          );
        }
      }
    } catch {
      // The exact module loader above already reports the bounded import error.
    }
  }

  for (const [file, requiredExports] of [
    ["scripts/lib/wakeflow-demand-core-records.mjs", [
      "validateControllerEventRecord",
      "validateDemandStateRecord",
      "validateStateTransitionRecord",
    ]],
    ["scripts/lib/wakeflow-demand-state-service.mjs", [
      "commitDemandPodTransitionWhileLocked",
      "recoverDemandPodTransitionWhileLocked",
    ]],
  ]) {
    const modulePath = path.join(root, file);
    if (!existsSync(modulePath)) continue;
    try {
      const moduleNamespace = await import(pathToFileURL(modulePath).href);
      for (const exportName of requiredExports) {
        if (typeof moduleNamespace[exportName] !== "function") {
          errors.push(`${file} must export the Pod integration seam ${exportName}`);
        }
      }
    } catch (error) {
      errors.push(`failed to load ${file}: ${error.message}`);
    }
  }

  const candidateBasenames = podModules.map(({ file }) => path.posix.basename(file));
  for (const file of podFrozenPublicFiles) {
    const imports = moduleImportSpecifiers(readText(file));
    for (const basename of candidateBasenames) {
      if (imports.some((specifier) => path.posix.basename(specifier) === basename)) {
        errors.push(`${file} must not import the internal Pod candidate ${basename}`);
      }
    }
  }
  for (const { file } of podModules) {
    const imports = moduleImportSpecifiers(readText(file));
    for (const dependency of podForbiddenCandidateDependencies) {
      if (imports.some((specifier) => path.posix.basename(specifier) === dependency)) {
        errors.push(`${file} must not import frozen public-v2 dependency ${dependency}`);
      }
    }
  }
}

async function validateKeepLiveCandidateContract() {
  const manifest = readJson("scripts/wakeflow-core-manifest.json");
  if (Array.isArray(manifest?.files)) {
    for (const file of keepLiveContractFiles) {
      if (!manifest.files.includes(file)) errors.push(`core manifest must include ${file}`);
    }
  }

  const loadedSchemas = [];
  const registry = new Map();
  for (const contract of keepLiveSchemas) {
    const schema = readJson(contract.file);
    if (!schema) continue;
    loadedSchemas.push({ contract, schema });
    if (schema.$schema !== EXPECTED_SCHEMA_DRAFT) {
      errors.push(`${contract.file} must use ${EXPECTED_SCHEMA_DRAFT}`);
    }
    if (schema.$id !== contract.id) {
      errors.push(`${contract.file} $id must be ${contract.id}`);
    } else if (registry.has(schema.$id)) {
      errors.push(`${contract.file} duplicates schema $id ${schema.$id}`);
    } else {
      registry.set(schema.$id, schema);
    }
    if (schema.type !== "object" || schema.additionalProperties !== false) {
      errors.push(`${contract.file} root must be a strict object with additionalProperties=false`);
    }
    if (schema.properties?.schemaVersion?.const !== 1) {
      errors.push(`${contract.file} schemaVersion property must require 1`);
    }
    if (schema.properties?.artifactKind?.const !== contract.artifactKind) {
      errors.push(`${contract.file} artifactKind property must require ${contract.artifactKind}`);
    }
    for (const required of ["schemaVersion", "artifactKind"]) {
      if (!Array.isArray(schema.required) || !schema.required.includes(required)) {
        errors.push(`${contract.file} root must require ${required}`);
      }
    }
    validateStrictSchemaObjectNodes({ schema, contract });
  }
  for (const { contract, schema } of loadedSchemas) {
    validateSchemaReferences({ schema, contract, registry });
  }

  await validateExactCandidateModules(keepLiveModules);
  const recordsPath = path.join(root, "scripts/lib/wakeflow-keep-live-records.mjs");
  if (existsSync(recordsPath)) {
    try {
      const records = await import(pathToFileURL(recordsPath).href);
      for (const contract of keepLiveSchemas) {
        if (records[contract.kindExport] !== contract.artifactKind) {
          errors.push(
            `scripts/lib/wakeflow-keep-live-records.mjs ${contract.kindExport} must remain ${contract.artifactKind}`,
          );
        }
      }
    } catch {
      // The exact module loader above already reports the bounded import error.
    }
  }

  const candidateBasenames = keepLiveModules.map(({ file }) => path.posix.basename(file));
  for (const file of keepLiveFrozenPublicFiles) {
    const imports = moduleImportSpecifiers(readText(file));
    for (const basename of candidateBasenames) {
      if (imports.some((specifier) => path.posix.basename(specifier) === basename)) {
        errors.push(`${file} must not import the internal keep-live candidate ${basename}`);
      }
    }
  }
  for (const { file } of keepLiveModules) {
    const imports = moduleImportSpecifiers(readText(file));
    for (const dependency of keepLiveForbiddenPublicDependencies) {
      if (imports.some((specifier) => path.posix.basename(specifier) === dependency)) {
        errors.push(`${file} must not import frozen public-v2 dependency ${dependency}`);
      }
    }
  }
}

async function validateHostLocatorCandidateContract() {
  const locatorCapability = hostProfile.capabilities?.locator;
  const hasModule = Boolean(hostLocatorModule);
  const hasSchema = Boolean(hostLocatorSchema);
  if (hasModule !== hasSchema) {
    errors.push("host profile must declare locatorHostFile and locatorSchemaFile together");
    return;
  }
  if (!hasModule) {
    if (locatorCapability?.applicable !== false || locatorCapability?.realization !== "not-applicable") {
      errors.push("a host without a locator contract must declare locator as not-applicable");
    }
    return;
  }
  if (locatorCapability?.applicable !== true || locatorCapability?.realization !== "current") {
    errors.push("a host locator contract requires locator capability realization=current");
  }
  if (typeof hostProfile.localEventInspectors?.locator !== "function") {
    errors.push("a host locator contract must provide localEventInspectors.locator");
  }

  const schema = readJson(hostLocatorSchema.file);
  if (schema) {
    if (schema.$schema !== EXPECTED_SCHEMA_DRAFT) {
      errors.push(`${hostLocatorSchema.file} must use ${EXPECTED_SCHEMA_DRAFT}`);
    }
    if (schema.$id !== hostLocatorSchema.id) {
      errors.push(`${hostLocatorSchema.file} $id must be ${hostLocatorSchema.id}`);
    }
    if (schema.type !== "object" || schema.additionalProperties !== false) {
      errors.push(`${hostLocatorSchema.file} root must be a strict object with additionalProperties=false`);
    }
    if (schema.properties?.kind?.const !== hostLocatorSchema.kind) {
      errors.push(`${hostLocatorSchema.file} kind property must require ${hostLocatorSchema.kind}`);
    }
    if (schema.properties?.schemaVersion?.const !== 1) {
      errors.push(`${hostLocatorSchema.file} schemaVersion property must require 1`);
    }
    if (schema.properties?.hostId?.const !== "claude-code") {
      errors.push(`${hostLocatorSchema.file} hostId property must require claude-code`);
    }
    if (schema.properties?.provider?.const !== "tmux") {
      errors.push(`${hostLocatorSchema.file} provider property must require tmux`);
    }
    for (const required of ["kind", "schemaVersion", "programId", "hostId", "windowId", "bindingId", "locatorId", "provider", "tmux", "locatedAt"]) {
      if (!Array.isArray(schema.required) || !schema.required.includes(required)) {
        errors.push(`${hostLocatorSchema.file} root must require ${required}`);
      }
    }
    validateStrictSchemaObjectNodes({ schema, contract: hostLocatorSchema });
    validateSchemaReferences({
      schema,
      contract: hostLocatorSchema,
      registry: new Map(schema.$id === hostLocatorSchema.id ? [[schema.$id, schema]] : []),
    });
  }

  await validateExactCandidateModules([hostLocatorModule]);
  const modulePath = path.join(root, hostLocatorModule.file);
  if (existsSync(modulePath)) {
    try {
      const locator = await import(pathToFileURL(modulePath).href);
      if (locator.WAKEFLOW_CLAUDE_WINDOW_LOCATOR_KIND !== hostLocatorSchema.kind) {
        errors.push(
          `${hostLocatorModule.file} WAKEFLOW_CLAUDE_WINDOW_LOCATOR_KIND must remain ${hostLocatorSchema.kind}`,
        );
      }
      if (locator.WAKEFLOW_CLAUDE_WINDOW_LOCATOR_SCHEMA_VERSION !== 1) {
        errors.push(`${hostLocatorModule.file} WAKEFLOW_CLAUDE_WINDOW_LOCATOR_SCHEMA_VERSION must remain 1`);
      }
    } catch {
      // The exact module loader above already reports the bounded import error.
    }
  }

  const frozenFiles = Array.isArray(hostProfile.artifact.locatorFrozenPublicFiles)
    ? hostProfile.artifact.locatorFrozenPublicFiles
    : [];
  if (frozenFiles.length === 0) {
    errors.push("a host locator contract must declare locatorFrozenPublicFiles");
    return;
  }
  const locatorBasename = path.posix.basename(hostLocatorModule.file);
  for (const file of frozenFiles) {
    const imports = moduleImportSpecifiers(readText(file));
    if (imports.some((specifier) => path.posix.basename(specifier) === locatorBasename)) {
      errors.push(`${file} must not import the internal Claude locator candidate ${locatorBasename}`);
    }
  }
  const locatorImports = moduleImportSpecifiers(readText(hostLocatorModule.file));
  for (const dependency of frozenFiles.map((file) => path.posix.basename(file))) {
    if (locatorImports.some((specifier) => path.posix.basename(specifier) === dependency)) {
      errors.push(`${hostLocatorModule.file} must not import frozen public-v2 dependency ${dependency}`);
    }
  }
}

async function validateHostLifecycleContract() {
  if (hostProfile.hostId !== "claude-code") {
    if (hostLifecycleModule || hostFacadeModule) {
      errors.push("Claude lifecycle and facade files must remain Claude-only host owners");
    }
    return;
  }
  if (!hostLifecycleModule) {
    errors.push("the Claude host profile must declare one lifecycleHostFile");
    return;
  }
  if (!hostLocatorModule) {
    errors.push("the Claude lifecycle owner requires one current locatorHostFile");
  }
  await validateExactCandidateModules([hostLifecycleModule]);
  const modulePath = path.join(root, hostLifecycleModule.file);
  if (existsSync(modulePath)) {
    try {
      const lifecycle = await import(pathToFileURL(modulePath).href);
      if (lifecycle.WAKEFLOW_CLAUDE_LIFECYCLE_HOST_ID !== hostProfile.hostId) {
        errors.push(`${hostLifecycleModule.file} host id must match the host profile`);
      }
      if (lifecycle.WAKEFLOW_CLAUDE_LIFECYCLE_SCHEMA_VERSION !== 1) {
        errors.push(`${hostLifecycleModule.file} schema version must remain 1`);
      }
      const adapter = lifecycle.defaultClaudeLifecycleHostAdapter;
      const expectedAdapterKeys = [
        "arrangeWindows",
        "closeWindow",
        "createWindow",
        "listPanes",
        "probe",
        "renameWindow",
        "writeMetadata",
      ];
      if (
        !adapter
        || !Object.isFrozen(adapter)
        || JSON.stringify(Object.keys(adapter).sort()) !== JSON.stringify(expectedAdapterKeys)
        || Object.values(adapter).some((value) => typeof value !== "function")
      ) {
        errors.push(`${hostLifecycleModule.file} must expose the exact current physical adapter seam`);
      }
    } catch {
      // The exact module loader above already reports the bounded import error.
    }
  }

  const lifecycleImports = moduleImportSpecifiers(readText(hostLifecycleModule.file))
    .map((specifier) => path.posix.basename(specifier));
  for (const required of [
    "wakeflow-config-v3-snapshot.mjs",
    "wakeflow-host-profile.mjs",
    "wakeflow-claude-locator.mjs",
    "wakeflow-window-binding-service.mjs",
  ]) {
    if (!lifecycleImports.includes(required)) {
      errors.push(`${hostLifecycleModule.file} must consume current owner ${required}`);
    }
  }
  for (const forbidden of [
    "wakeflow-artifact-identity.mjs",
    "wakeflow-config.mjs",
    "wakeflow-delivery-store.mjs",
    "wakeflow-host-send-adapter.mjs",
    "wakeflow-pod-runtime.mjs",
    "wakeflow-stream-overlay.mjs",
    "wakeflow-thread-registry.mjs",
    "wakeflow-window-runtime.mjs",
  ]) {
    if (lifecycleImports.includes(forbidden)) {
      errors.push(`${hostLifecycleModule.file} must not import retired normal dependency ${forbidden}`);
    }
  }
}

async function validateHostFacadeContract() {
  if (hostProfile.hostId !== "claude-code") {
    if (hostFacadeModule) errors.push("facadeHostFile is a Claude-only host entrypoint");
    return;
  }
  if (!hostFacadeModule) {
    errors.push("the Claude host profile must declare one facadeHostFile");
    return;
  }
  await validateExactCandidateModules([hostFacadeModule]);
  const expectedCommands = [
    "activation-scope",
    "activity-ensure",
    "activity-inspect",
    "activity-stop",
    "arrange-windows",
    "controller-return",
    "decommission-execute",
    "decommission-plan",
    "decommission-recover",
    "launch-window",
    "pod-materialize",
    "pod-normalize-observation",
    "pod-plan",
    "preflight",
    "prompt-temp-inspect",
    "prompt-temp-sweep",
    "resume-window",
    "retitle-window",
    "settings-inspect",
    "settings-plan",
    "target-delivery",
    "transport-recover",
    "window-status",
  ];
  const modulePath = path.join(root, hostFacadeModule.file);
  if (existsSync(modulePath)) {
    try {
      const facade = await import(pathToFileURL(modulePath).href);
      if (
        !Object.isFrozen(facade.WAKEFLOW_CLAUDE_HOST_COMMANDS)
        || JSON.stringify(facade.WAKEFLOW_CLAUDE_HOST_COMMANDS) !== JSON.stringify(expectedCommands)
      ) {
        errors.push(`${hostFacadeModule.file} must expose the exact closed current command set`);
      }
    } catch {
      // The exact module loader above already reports the bounded import error.
    }
  }

  const facadeImports = moduleImportSpecifiers(readText(hostFacadeModule.file))
    .map((specifier) => path.posix.basename(specifier));
  for (const required of [
    "wakeflow-claude-activation-scope.mjs",
    "wakeflow-claude-activity.mjs",
    "wakeflow-claude-decommission.mjs",
    "wakeflow-claude-lifecycle.mjs",
    "wakeflow-claude-pod-host.mjs",
    "wakeflow-claude-settings.mjs",
    "wakeflow-claude-transport.mjs",
  ]) {
    if (!facadeImports.includes(required)) {
      errors.push(`${hostFacadeModule.file} must route through current owner ${required}`);
    }
  }
  if (facadeImports.includes("wakeflow-claude-locator.mjs")) {
    errors.push(`${hostFacadeModule.file} must reach the Claude locator only through current lifecycle/transport owners`);
  }
  for (const forbidden of [
    "wakeflow-artifact-identity.mjs",
    "wakeflow-config.mjs",
    "wakeflow-delivery-store.mjs",
    "wakeflow-host-send-adapter.mjs",
    "wakeflow-pod-runtime.mjs",
    "wakeflow-stream-overlay.mjs",
    "wakeflow-thread-registry.mjs",
    "wakeflow-window-runtime.mjs",
  ]) {
    if (facadeImports.includes(forbidden)) {
      errors.push(`${hostFacadeModule.file} must not import retired normal dependency ${forbidden}`);
    }
  }
}

async function validateHostSettingsAssetsCandidateContract() {
  const settingsCapability = hostProfile.capabilities?.settings;
  const assetsCapability = hostProfile.capabilities?.assets;
  if (!hostSettingsAssetsModule) {
    if (
      settingsCapability?.applicable !== false
      || settingsCapability?.realization !== "not-applicable"
      || assetsCapability?.applicable !== false
      || assetsCapability?.realization !== "not-applicable"
    ) {
      errors.push("a host without settingsAssetsHostFile must declare settings and assets as not-applicable");
    }
    return;
  }
  if (hostProfile.hostId !== "claude-code") {
    errors.push("settingsAssetsHostFile is a Claude-only host owner");
  }
  if (settingsCapability?.applicable !== true || settingsCapability?.realization !== "current") {
    errors.push("settingsAssetsHostFile requires settings capability realization=current");
  }
  if (assetsCapability?.applicable !== true || assetsCapability?.realization !== "current") {
    errors.push("settingsAssetsHostFile requires assets capability realization=current");
  }

  await validateExactCandidateModules([hostSettingsAssetsModule]);
  const modulePath = path.join(root, hostSettingsAssetsModule.file);
  if (existsSync(modulePath)) {
    try {
      const settings = await import(pathToFileURL(modulePath).href);
      if (settings.WAKEFLOW_CLAUDE_SETTINGS_HOST_ID !== hostProfile.hostId) {
        errors.push(
          `${hostSettingsAssetsModule.file} WAKEFLOW_CLAUDE_SETTINGS_HOST_ID must match the host profile`,
        );
      }
      if (settings.WAKEFLOW_CLAUDE_SETTINGS_SCHEMA_VERSION !== 1) {
        errors.push(`${hostSettingsAssetsModule.file} WAKEFLOW_CLAUDE_SETTINGS_SCHEMA_VERSION must remain 1`);
      }
      const adapter = settings.wakeflowHostSettingsAssetsAdapter;
      if (
        !adapter
        || !Object.isFrozen(adapter)
        || JSON.stringify(Object.keys(adapter).sort())
          !== JSON.stringify(["createMutationParticipant", "hostId", "planMaintenance"])
        || adapter.hostId !== hostProfile.hostId
        || adapter.planMaintenance !== settings.planClaudeSettingsAssetsMaintenance
        || adapter.createMutationParticipant !== settings.createClaudeSettingsAssetsMutationParticipant
      ) {
        errors.push(
          `${hostSettingsAssetsModule.file} must expose the exact generic settings/assets maintenance adapter`,
        );
      }
      const expectedRules = [
        "mcp__plugin_wakeflow_wakeflow",
        "Bash(node *)",
        "Bash(tmux *)",
        "Bash(git *)",
      ];
      if (JSON.stringify(settings.WAKEFLOW_CLAUDE_PORTABLE_ALLOW_RULES) !== JSON.stringify(expectedRules)) {
        errors.push(`${hostSettingsAssetsModule.file} portable allow rules must remain the exact four-rule set`);
      }
      if (
        settings.claudeStatuslineAssetRef?.()
        !== ".wakeflow-local/runtime/hosts/claude-code/operations/assets/statusline.mjs"
      ) {
        errors.push(`${hostSettingsAssetsModule.file} must target the v3 Claude statusline asset ref`);
      }
      const assetContent = settings.claudeStatuslineAssetContent?.();
      if (
        typeof assetContent !== "string"
        || !assetContent.includes("wakeflow-statusline-schema: 1")
        || !assetContent.includes("wakeflow-statusline-template: 1")
        || assetContent.includes("import.meta.url")
        || assetContent.includes("trackedConfigFile")
      ) {
        errors.push(`${hostSettingsAssetsModule.file} must expose the deterministic explicit-root statusline asset`);
      }
      const command = settings.claudeStatuslineCommand?.({
        workspaceRoot: path.join(root, ".wakeflow-validator-settings-root"),
      });
      if (
        typeof command !== "string"
        || !command.includes("--wakeflow-statusline-v1")
        || !command.includes("--workspace-root-base64")
      ) {
        errors.push(`${hostSettingsAssetsModule.file} must expose the explicit-root statusline command signature`);
      }
    } catch {
      // The exact module loader above already reports the bounded import error.
    }
  }

  const frozenFiles = Array.isArray(hostProfile.artifact.settingsAssetsFrozenPublicFiles)
    ? hostProfile.artifact.settingsAssetsFrozenPublicFiles
    : [];
  if (frozenFiles.length === 0) {
    errors.push("a host settings/assets contract must declare settingsAssetsFrozenPublicFiles");
    return;
  }
  const settingsBasename = path.posix.basename(hostSettingsAssetsModule.file);
  for (const file of frozenFiles) {
    const imports = moduleImportSpecifiers(readText(file));
    if (imports.some((specifier) => path.posix.basename(specifier) === settingsBasename)) {
      errors.push(`${file} must not import the internal Claude settings/assets candidate ${settingsBasename}`);
    }
  }
  const settingsImports = moduleImportSpecifiers(readText(hostSettingsAssetsModule.file));
  for (const dependency of frozenFiles.map((file) => path.posix.basename(file))) {
    if (settingsImports.some((specifier) => path.posix.basename(specifier) === dependency)) {
      errors.push(`${hostSettingsAssetsModule.file} must not import frozen public-v2 dependency ${dependency}`);
    }
  }
}

async function validateHostActivityCandidateContract() {
  const activityCapability = hostProfile.capabilities?.activity;
  const tempCapability = hostProfile.capabilities?.temp;
  const hasModule = Boolean(hostActivityModule);
  const hasProcessSchema = Boolean(hostProfile.artifact.activityProcessSchemaFile);
  const hasManagerLockSchema = Boolean(hostProfile.artifact.activityManagerLockSchemaFile);
  if (!(hasModule === hasProcessSchema && hasModule === hasManagerLockSchema)) {
    errors.push(
      "host profile must declare activityHostFile, activityProcessSchemaFile, and activityManagerLockSchemaFile together",
    );
    return;
  }
  if (!hasModule) {
    if (
      activityCapability?.applicable !== false
      || activityCapability?.realization !== "not-applicable"
      || tempCapability?.applicable !== false
      || tempCapability?.realization !== "not-applicable"
    ) {
      errors.push("a host without an activity contract must declare activity and temp as not-applicable");
    }
    return;
  }
  if (hostProfile.hostId !== "claude-code") {
    errors.push("activityHostFile is a Claude-only host owner");
  }
  if (activityCapability?.applicable !== true || activityCapability?.realization !== "current") {
    errors.push("activityHostFile requires activity capability realization=current");
  }
  if (tempCapability?.applicable !== true || tempCapability?.realization !== "current") {
    errors.push("activityHostFile requires temp capability realization=current");
  }
  if (typeof hostProfile.localEventInspectors?.activityTemp !== "function") {
    errors.push("an activity host contract must provide localEventInspectors.activityTemp");
  }

  for (const contract of hostActivitySchemas) {
    const schema = readJson(contract.file);
    if (!schema) continue;
    if (schema.$schema !== EXPECTED_SCHEMA_DRAFT) {
      errors.push(`${contract.file} must use ${EXPECTED_SCHEMA_DRAFT}`);
    }
    if (schema.$id !== contract.id) {
      errors.push(`${contract.file} $id must be ${contract.id}`);
    }
    if (schema.type !== "object" || schema.additionalProperties !== false) {
      errors.push(`${contract.file} root must be a strict object with additionalProperties=false`);
    }
    if (schema.properties?.kind?.const !== contract.kind) {
      errors.push(`${contract.file} kind property must require ${contract.kind}`);
    }
    if (schema.properties?.schemaVersion?.const !== 1) {
      errors.push(`${contract.file} schemaVersion property must require 1`);
    }
    if (schema.properties?.hostId?.const !== "claude-code") {
      errors.push(`${contract.file} hostId property must require claude-code`);
    }
    for (const required of [
      "kind",
      "schemaVersion",
      "programId",
      "hostId",
      "serverContextId",
      "serverContextDigest",
    ]) {
      if (!Array.isArray(schema.required) || !schema.required.includes(required)) {
        errors.push(`${contract.file} root must require ${required}`);
      }
    }
    validateStrictSchemaObjectNodes({ schema, contract });
    validateSchemaReferences({
      schema,
      contract,
      registry: new Map(schema.$id === contract.id ? [[schema.$id, schema]] : []),
    });
  }

  await validateExactCandidateModules([hostActivityModule]);
  const modulePath = path.join(root, hostActivityModule.file);
  if (existsSync(modulePath)) {
    try {
      const activity = await import(pathToFileURL(modulePath).href);
      if (activity.WAKEFLOW_CLAUDE_ACTIVITY_HOST_ID !== hostProfile.hostId) {
        errors.push(
          `${hostActivityModule.file} WAKEFLOW_CLAUDE_ACTIVITY_HOST_ID must match the host profile`,
        );
      }
      if (activity.WAKEFLOW_CLAUDE_ACTIVITY_SCHEMA_VERSION !== 1) {
        errors.push(`${hostActivityModule.file} WAKEFLOW_CLAUDE_ACTIVITY_SCHEMA_VERSION must remain 1`);
      }
      if (
        activity.WAKEFLOW_CLAUDE_ACTIVITY_PROCESS_KIND
        !== "WakeflowClaudeActivityMonitorProcess"
      ) {
        errors.push(`${hostActivityModule.file} process kind must remain closed`);
      }
      if (
        activity.WAKEFLOW_CLAUDE_ACTIVITY_MANAGER_LOCK_KIND
        !== "WakeflowClaudeActivityMonitorManagerLock"
      ) {
        errors.push(`${hostActivityModule.file} manager lock kind must remain closed`);
      }
    } catch {
      // The exact module loader above already reports the bounded import error.
    }
  }

  const frozenFiles = Array.isArray(hostProfile.artifact.activityFrozenPublicFiles)
    ? hostProfile.artifact.activityFrozenPublicFiles
    : [];
  if (frozenFiles.length === 0) {
    errors.push("a host activity contract must declare activityFrozenPublicFiles");
    return;
  }
  const activityBasename = path.posix.basename(hostActivityModule.file);
  for (const file of frozenFiles) {
    const imports = moduleImportSpecifiers(readText(file));
    if (imports.some((specifier) => path.posix.basename(specifier) === activityBasename)) {
      errors.push(`${file} must not import the internal Claude activity candidate ${activityBasename}`);
    }
  }
  const activityImports = moduleImportSpecifiers(readText(hostActivityModule.file));
  for (const dependency of frozenFiles.map((file) => path.posix.basename(file))) {
    if (activityImports.some((specifier) => path.posix.basename(specifier) === dependency)) {
      errors.push(`${hostActivityModule.file} must not import frozen public-v2 dependency ${dependency}`);
    }
  }
}

async function validateHostTransportCandidateContract() {
  const expectsHostTransport = hostProfile.fleet?.transport === "host-helper";
  if (!hostTransportModule) {
    if (expectsHostTransport) {
      errors.push("a host-helper profile must declare transportHostFile");
    }
    return;
  }
  if (!expectsHostTransport) {
    errors.push("transportHostFile requires fleet.transport=host-helper");
  }
  if (!hostLocatorModule) {
    errors.push("a host transport contract requires one current locatorHostFile");
  }

  await validateExactCandidateModules([hostTransportModule]);
  const modulePath = path.join(root, hostTransportModule.file);
  if (existsSync(modulePath)) {
    try {
      const transport = await import(pathToFileURL(modulePath).href);
      if (transport.WAKEFLOW_CLAUDE_TRANSPORT_HOST_ID !== hostProfile.hostId) {
        errors.push(
          `${hostTransportModule.file} WAKEFLOW_CLAUDE_TRANSPORT_HOST_ID must match the host profile`,
        );
      }
      if (transport.WAKEFLOW_CLAUDE_TRANSPORT_SCHEMA_VERSION !== 1) {
        errors.push(`${hostTransportModule.file} WAKEFLOW_CLAUDE_TRANSPORT_SCHEMA_VERSION must remain 1`);
      }
    } catch {
      // The exact module loader above already reports the bounded import error.
    }
  }

  const frozenFiles = [...new Set([
    ...transportFrozenPublicFiles,
    ...(Array.isArray(hostProfile.artifact.locatorFrozenPublicFiles)
      ? hostProfile.artifact.locatorFrozenPublicFiles
      : []),
  ])];
  const transportBasename = path.posix.basename(hostTransportModule.file);
  for (const file of frozenFiles) {
    const imports = moduleImportSpecifiers(readText(file));
    if (imports.some((specifier) => path.posix.basename(specifier) === transportBasename)) {
      errors.push(`${file} must not import the internal host transport candidate ${transportBasename}`);
    }
  }
  const hostTransportImports = moduleImportSpecifiers(readText(hostTransportModule.file));
  for (const dependency of frozenFiles.map((file) => path.posix.basename(file))) {
    if (hostTransportImports.some((specifier) => path.posix.basename(specifier) === dependency)) {
      errors.push(`${hostTransportModule.file} must not import frozen public-v2 dependency ${dependency}`);
    }
  }
}

// Transport、window runtime 与 preservation 只固定 durable codec/owner 的发布表面和 schema closure。
async function validateTransportCandidateContract() {
  const manifest = readJson("scripts/wakeflow-core-manifest.json");
  if (Array.isArray(manifest?.files)) {
    for (const file of transportContractFiles) {
      if (!manifest.files.includes(file)) errors.push(`core manifest must include ${file}`);
    }
  }

  const loadedSchemas = [];
  const registry = new Map();
  for (const contract of transportSchemas) {
    const schema = readJson(contract.file);
    if (!schema) continue;
    loadedSchemas.push({ contract, schema });
    if (schema.$schema !== EXPECTED_SCHEMA_DRAFT) {
      errors.push(`${contract.file} must use ${EXPECTED_SCHEMA_DRAFT}`);
    }
    if (schema.$id !== contract.id) {
      errors.push(`${contract.file} $id must be ${contract.id}`);
    } else {
      registry.set(schema.$id, schema);
    }
    if (schema.type !== "object" || schema.additionalProperties !== false) {
      errors.push(`${contract.file} root must be a strict object with additionalProperties=false`);
    }
    if (schema.properties?.schemaVersion?.const !== 1) {
      errors.push(`${contract.file} schemaVersion property must require 1`);
    }
    const actualKinds = typeof schema.properties?.artifactKind?.const === "string"
      ? [schema.properties.artifactKind.const]
      : schema.properties?.artifactKind?.enum;
    if (JSON.stringify(actualKinds) !== JSON.stringify(contract.artifactKinds)) {
      errors.push(
        `${contract.file} artifactKind contract must be exactly: ${contract.artifactKinds.join(", ")}`,
      );
    }
    if (JSON.stringify(schema.required) !== JSON.stringify(contract.required)) {
      errors.push(
        `${contract.file} root required contract must be exactly: ${contract.required.join(", ")}`,
      );
    }
    validateStrictSchemaObjectNodes({ schema, contract });
  }
  for (const { contract, schema } of loadedSchemas) {
    validateSchemaReferences({ schema, contract, registry });
  }

  const retentionSchema = readJson(transportRetentionSchema.file);
  if (retentionSchema) {
    if (retentionSchema.$schema !== EXPECTED_SCHEMA_DRAFT) {
      errors.push(`${transportRetentionSchema.file} must use ${EXPECTED_SCHEMA_DRAFT}`);
    }
    if (retentionSchema.$id !== transportRetentionSchema.id) {
      errors.push(`${transportRetentionSchema.file} $id must be ${transportRetentionSchema.id}`);
    }
    if (
      retentionSchema.type !== "object"
      || retentionSchema.additionalProperties !== false
      || JSON.stringify(retentionSchema.required) !== JSON.stringify(["schemaId", "payload"])
    ) {
      errors.push(
        `${transportRetentionSchema.file} root must be the exact closed schemaId/payload plan wrapper`,
      );
    }
    if (retentionSchema.properties?.schemaId?.const !== transportRetentionSchema.id) {
      errors.push(`${transportRetentionSchema.file} schemaId property must require its exact $id`);
    }
    if (retentionSchema.$defs?.payload?.properties?.schemaVersion?.const !== 1) {
      errors.push(`${transportRetentionSchema.file} payload schemaVersion must require 1`);
    }
    if (
      retentionSchema.$defs?.payload?.properties?.artifactKind?.const
      !== transportRetentionSchema.artifactKind
    ) {
      errors.push(
        `${transportRetentionSchema.file} payload artifactKind must require ${transportRetentionSchema.artifactKind}`,
      );
    }
    validateStrictSchemaObjectNodes({ schema: retentionSchema, contract: transportRetentionSchema });
    const retentionRegistry = new Map(
      retentionSchema.$id === transportRetentionSchema.id
        ? [[retentionSchema.$id, retentionSchema]]
        : [],
    );
    validateSchemaReferences({
      schema: retentionSchema,
      contract: transportRetentionSchema,
      registry: retentionRegistry,
    });
  }

  await validateExactCandidateModules(transportModules);
  const recordsPath = path.join(root, "scripts/lib/wakeflow-transport-records.mjs");
  if (existsSync(recordsPath)) {
    try {
      const records = await import(pathToFileURL(recordsPath).href);
      if (records.WAKEFLOW_TRANSPORT_SCHEMA_VERSION !== 1) {
        errors.push("scripts/lib/wakeflow-transport-records.mjs schema version must remain 1");
      }
      for (const contract of transportSchemas) {
        const actualKinds = contract.kindExports.map((exportName) => records[exportName]);
        if (JSON.stringify(actualKinds) !== JSON.stringify(contract.artifactKinds)) {
          errors.push(
            `scripts/lib/wakeflow-transport-records.mjs kinds for ${contract.file} must match its exact schema contract`,
          );
        }
      }
    } catch {
      // The exact module loader above already reports the bounded import error.
    }
  }

  const candidateBasenames = transportModules.map(({ file }) => path.posix.basename(file));
  for (const file of transportFrozenPublicFiles) {
    const imports = moduleImportSpecifiers(readText(file));
    for (const basename of candidateBasenames) {
      if (imports.some((specifier) => path.posix.basename(specifier) === basename)) {
        errors.push(`${file} must not import the internal transport candidate ${basename}`);
      }
    }
  }
  for (const { file } of transportModules) {
    const imports = moduleImportSpecifiers(readText(file));
    for (const dependency of transportForbiddenPublicDependencies) {
      if (imports.some((specifier) => path.posix.basename(specifier) === dependency)) {
        errors.push(`${file} must not import frozen public-v2 dependency ${dependency}`);
      }
    }
  }
}

async function validateWindowRuntimeCandidateContract() {
  const manifest = readJson("scripts/wakeflow-core-manifest.json");
  if (Array.isArray(manifest?.files)) {
    for (const file of windowRuntimeContractFiles) {
      if (!manifest.files.includes(file)) errors.push(`core manifest must include ${file}`);
    }
  }

  const schema = readJson(windowRuntimeSchema.file);
  if (schema) {
    if (schema.$schema !== EXPECTED_SCHEMA_DRAFT) {
      errors.push(`${windowRuntimeSchema.file} must use ${EXPECTED_SCHEMA_DRAFT}`);
    }
    if (schema.$id !== windowRuntimeSchema.id) {
      errors.push(`${windowRuntimeSchema.file} $id must be ${windowRuntimeSchema.id}`);
    }
    if (schema.type !== "object" || schema.additionalProperties !== false) {
      errors.push(`${windowRuntimeSchema.file} root must be a strict object with additionalProperties=false`);
    }
    if (schema.properties?.schemaVersion?.const !== 1) {
      errors.push(`${windowRuntimeSchema.file} schemaVersion property must require 1`);
    }
    if (schema.properties?.kind?.const !== windowRuntimeSchema.kind) {
      errors.push(`${windowRuntimeSchema.file} kind property must require ${windowRuntimeSchema.kind}`);
    }
    for (const required of ["schemaVersion", "kind"]) {
      if (!Array.isArray(schema.required) || !schema.required.includes(required)) {
        errors.push(`${windowRuntimeSchema.file} root must require ${required}`);
      }
    }
    const registry = new Map(schema.$id === windowRuntimeSchema.id ? [[schema.$id, schema]] : []);
    validateSchemaReferences({ schema, contract: windowRuntimeSchema, registry });
  }

  await validateExactCandidateModules(windowRuntimeModules);
  const recordsPath = path.join(root, "scripts/lib/wakeflow-window-runtime-records.mjs");
  if (existsSync(recordsPath)) {
    try {
      const records = await import(pathToFileURL(recordsPath).href);
      if (records.WAKEFLOW_WINDOW_RUNTIME_SCHEMA_VERSION !== 1) {
        errors.push("scripts/lib/wakeflow-window-runtime-records.mjs schema version must remain 1");
      }
      if (records.WAKEFLOW_WINDOW_RUNTIME_KIND !== windowRuntimeSchema.kind) {
        errors.push(`scripts/lib/wakeflow-window-runtime-records.mjs kind must remain ${windowRuntimeSchema.kind}`);
      }
    } catch {
      // The exact module loader above already reports the bounded import error.
    }
  }

  const candidateBasenames = windowRuntimeModules.map(({ file }) => path.posix.basename(file));
  for (const file of windowRuntimeFrozenPublicFiles) {
    const source = readText(file);
    for (const basename of candidateBasenames) {
      if (source.includes(basename)) {
        errors.push(`${file} must not import the internal window-runtime candidate ${basename}`);
      }
    }
  }
  for (const { file } of windowRuntimeModules) {
    const source = readText(file);
    for (const dependency of windowRuntimeForbiddenCandidateDependencies) {
      if (moduleImportSpecifiers(source).some((specifier) => path.posix.basename(specifier) === dependency)) {
        errors.push(`${file} must not import frozen public-v2 dependency ${dependency}`);
      }
    }
  }
}

async function validatePreservationCandidateContract() {
  const manifest = readJson("scripts/wakeflow-core-manifest.json");
  if (Array.isArray(manifest?.files)) {
    for (const file of preservationContractFiles) {
      if (!manifest.files.includes(file)) errors.push(`core manifest must include ${file}`);
    }
  }

  const manifestSchema = readJson(preservationManifestSchema.file);
  const planSchema = readJson(preservationPlanSchema.file);
  const registry = new Map();
  if (manifestSchema) {
    if (manifestSchema.$schema !== EXPECTED_SCHEMA_DRAFT) {
      errors.push(`${preservationManifestSchema.file} must use ${EXPECTED_SCHEMA_DRAFT}`);
    }
    if (manifestSchema.$id !== preservationManifestSchema.id) {
      errors.push(`${preservationManifestSchema.file} $id must be ${preservationManifestSchema.id}`);
    } else {
      registry.set(manifestSchema.$id, manifestSchema);
    }
    if (manifestSchema.type !== "object" || manifestSchema.additionalProperties !== false) {
      errors.push(
        `${preservationManifestSchema.file} root must be a strict object with additionalProperties=false`,
      );
    }
    if (manifestSchema.properties?.kind?.const !== preservationManifestSchema.kind) {
      errors.push(
        `${preservationManifestSchema.file} kind property must require ${preservationManifestSchema.kind}`,
      );
    }
    if (manifestSchema.properties?.schemaVersion?.const !== 1) {
      errors.push(`${preservationManifestSchema.file} schemaVersion property must require 1`);
    }
    if (JSON.stringify(manifestSchema.required) !== JSON.stringify(preservationManifestSchema.required)) {
      errors.push(
        `${preservationManifestSchema.file} root required contract must be exactly: ${preservationManifestSchema.required.join(", ")}`,
      );
    }
    validateStrictSchemaObjectNodes({
      schema: manifestSchema,
      contract: preservationManifestSchema,
    });
  }

  if (planSchema) {
    if (planSchema.$schema !== EXPECTED_SCHEMA_DRAFT) {
      errors.push(`${preservationPlanSchema.file} must use ${EXPECTED_SCHEMA_DRAFT}`);
    }
    if (planSchema.$id !== preservationPlanSchema.id) {
      errors.push(`${preservationPlanSchema.file} $id must be ${preservationPlanSchema.id}`);
    } else {
      registry.set(planSchema.$id, planSchema);
    }
    if (
      planSchema.type !== "object"
      || planSchema.additionalProperties !== false
      || JSON.stringify(planSchema.required) !== JSON.stringify(["schemaId", "payload"])
    ) {
      errors.push(
        `${preservationPlanSchema.file} root must be the exact closed schemaId/payload plan wrapper`,
      );
    }
    if (planSchema.properties?.schemaId?.const !== preservationPlanSchema.id) {
      errors.push(`${preservationPlanSchema.file} schemaId property must require its exact $id`);
    }
    if (planSchema.$defs?.payload?.properties?.schemaVersion?.const !== 1) {
      errors.push(`${preservationPlanSchema.file} payload schemaVersion must require 1`);
    }
    if (
      planSchema.$defs?.payload?.properties?.artifactKind?.const
      !== preservationPlanSchema.artifactKind
    ) {
      errors.push(
        `${preservationPlanSchema.file} payload artifactKind must require ${preservationPlanSchema.artifactKind}`,
      );
    }
    validateStrictSchemaObjectNodes({ schema: planSchema, contract: preservationPlanSchema });
  }

  if (manifestSchema) {
    validateSchemaReferences({
      schema: manifestSchema,
      contract: preservationManifestSchema,
      registry,
    });
  }
  if (planSchema) {
    validateSchemaReferences({ schema: planSchema, contract: preservationPlanSchema, registry });
  }

  await validateExactCandidateModules(preservationModules);
  const candidateBasenames = preservationModules.map(({ file }) => path.posix.basename(file));
  for (const file of preservationFrozenPublicFiles) {
    const imports = moduleImportSpecifiers(readText(file));
    for (const basename of candidateBasenames) {
      if (imports.some((specifier) => path.posix.basename(specifier) === basename)) {
        errors.push(`${file} must not import the internal preservation candidate ${basename}`);
      }
    }
  }
  for (const { file } of preservationModules) {
    const imports = moduleImportSpecifiers(readText(file));
    for (const dependency of preservationForbiddenPublicDependencies) {
      if (imports.some((specifier) => path.posix.basename(specifier) === dependency)) {
        errors.push(`${file} must not import frozen public-v2 dependency ${dependency}`);
      }
    }
  }
}

// Maintenance gates 覆盖 plan、fresh/reconfigure/reconcile owners 及最终 MCP/CLI/setup 组合表面。
async function validateWorkspaceMaintenancePlanCandidateContract() {
  const manifest = readJson("scripts/wakeflow-core-manifest.json");
  if (Array.isArray(manifest?.files)) {
    for (const file of workspaceMaintenancePlanContractFiles) {
      if (!manifest.files.includes(file)) errors.push(`core manifest must include ${file}`);
    }
  }

  const schema = readJson(workspaceMaintenancePlanSchema.file);
  const configSchema = readJson("schemas/wakeflow-config.schema.json");
  if (schema) {
    if (schema.$schema !== EXPECTED_SCHEMA_DRAFT) {
      errors.push(`${workspaceMaintenancePlanSchema.file} must use ${EXPECTED_SCHEMA_DRAFT}`);
    }
    if (schema.$id !== workspaceMaintenancePlanSchema.id) {
      errors.push(`${workspaceMaintenancePlanSchema.file} $id must be ${workspaceMaintenancePlanSchema.id}`);
    }
    if (
      schema.type !== "object"
      || schema.additionalProperties !== false
      || JSON.stringify(schema.required) !== JSON.stringify(["schemaId", "payload"])
    ) {
      errors.push(
        `${workspaceMaintenancePlanSchema.file} root must be the exact closed schemaId/payload plan wrapper`,
      );
    }
    if (schema.properties?.schemaId?.const !== workspaceMaintenancePlanSchema.id) {
      errors.push(`${workspaceMaintenancePlanSchema.file} schemaId property must require its exact $id`);
    }
    if (schema.$defs?.payload?.properties?.kind?.const !== workspaceMaintenancePlanSchema.kind) {
      errors.push(
        `${workspaceMaintenancePlanSchema.file} payload kind must require ${workspaceMaintenancePlanSchema.kind}`,
      );
    }
    if (schema.$defs?.payload?.properties?.schemaVersion?.const !== 1) {
      errors.push(`${workspaceMaintenancePlanSchema.file} payload schemaVersion must require 1`);
    }
    if (
      JSON.stringify(schema.$defs?.payload?.properties?.action?.enum)
      !== JSON.stringify(["fresh-initialize", "reconfigure", "reconcile"])
    ) {
      errors.push(
        `${workspaceMaintenancePlanSchema.file} action contract must remain fresh-initialize, reconfigure, reconcile`,
      );
    }
    validateStrictSchemaObjectNodes({ schema, contract: workspaceMaintenancePlanSchema });
    const registry = new Map();
    if (schema.$id === workspaceMaintenancePlanSchema.id) registry.set(schema.$id, schema);
    if (configSchema?.$id === EXPECTED_CONFIG_V3_SCHEMA_ID) {
      registry.set(configSchema.$id, configSchema);
    }
    validateSchemaReferences({ schema, contract: workspaceMaintenancePlanSchema, registry });
  }

  await validateExactCandidateModules(workspaceMaintenancePlanModules);
  const modulePath = path.join(root, workspaceMaintenancePlanModules[0].file);
  if (existsSync(modulePath)) {
    try {
      const moduleNamespace = await import(pathToFileURL(modulePath).href);
      if (moduleNamespace.WAKEFLOW_MAINTENANCE_PLAN_SCHEMA_ID !== workspaceMaintenancePlanSchema.id) {
        errors.push(`${workspaceMaintenancePlanModules[0].file} schema ID must match its schema`);
      }
      if (moduleNamespace.WAKEFLOW_MAINTENANCE_PLAN_KIND !== workspaceMaintenancePlanSchema.kind) {
        errors.push(`${workspaceMaintenancePlanModules[0].file} kind must match its schema`);
      }
      if (moduleNamespace.WAKEFLOW_MAINTENANCE_PLAN_SCHEMA_VERSION !== 1) {
        errors.push(`${workspaceMaintenancePlanModules[0].file} schema version must remain 1`);
      }
      if (
        JSON.stringify(moduleNamespace.WAKEFLOW_MAINTENANCE_PLAN_ACTIONS)
        !== JSON.stringify(["fresh-initialize", "reconfigure", "reconcile"])
      ) {
        errors.push(`${workspaceMaintenancePlanModules[0].file} actions must match its schema`);
      }
    } catch {
      // The exact module loader above already reports the bounded import error.
    }
  }

  const candidateBasename = path.posix.basename(workspaceMaintenancePlanModules[0].file);
  for (const file of workspaceMaintenancePlanFrozenPublicFiles) {
    const imports = moduleImportSpecifiers(readText(file));
    if (imports.some((specifier) => path.posix.basename(specifier) === candidateBasename)) {
      errors.push(`${file} must not import the internal workspace maintenance plan candidate`);
    }
  }
  for (const { file } of workspaceMaintenancePlanModules) {
    const imports = moduleImportSpecifiers(readText(file));
    for (const dependency of workspaceMaintenancePlanForbiddenDependencies) {
      if (imports.some((specifier) => path.posix.basename(specifier) === dependency)) {
        errors.push(`${file} pure plan codec must not import ${dependency}`);
      }
    }
  }
}

async function validateFreshInitializeCandidateContract() {
  const manifest = readJson("scripts/wakeflow-core-manifest.json");
  if (Array.isArray(manifest?.files)) {
    for (const file of freshInitializeContractFiles) {
      if (!manifest.files.includes(file)) errors.push(`core manifest must include ${file}`);
    }
  }

  await validateExactCandidateModules(freshInitializeModules);
  const configOwnerPath = path.join(root, freshInitializeModules[0].file);
  if (existsSync(configOwnerPath)) {
    try {
      const owner = await import(pathToFileURL(configOwnerPath).href);
      if (owner.WAKEFLOW_CONFIG_V3_OWNER_PLAN_SCHEMA_ID !== "urn:wakeflow:internal:config-v3-owner-plan:v1") {
        errors.push(`${freshInitializeModules[0].file} schema ID is invalid`);
      }
      if (owner.WAKEFLOW_CONFIG_V3_OWNER_PLAN_KIND !== "WakeflowConfigV3OwnerPlan") {
        errors.push(`${freshInitializeModules[0].file} plan kind is invalid`);
      }
      if (owner.WAKEFLOW_CONFIG_V3_OWNER_PLAN_SCHEMA_VERSION !== 1) {
        errors.push(`${freshInitializeModules[0].file} schema version must remain 1`);
      }
      if (
        owner.WAKEFLOW_CONFIG_V3_RECONFIGURE_OWNER_PLAN_SCHEMA_ID
        !== "urn:wakeflow:internal:config-v3-reconfigure-owner-plan:v1"
      ) {
        errors.push(`${freshInitializeModules[0].file} reconfigure schema ID is invalid`);
      }
      if (
        owner.WAKEFLOW_CONFIG_V3_RECONFIGURE_OWNER_PLAN_KIND
        !== "WakeflowConfigV3ReconfigureOwnerPlan"
      ) {
        errors.push(`${freshInitializeModules[0].file} reconfigure plan kind is invalid`);
      }
      if (owner.WAKEFLOW_CONFIG_V3_RECONFIGURE_OWNER_PLAN_SCHEMA_VERSION !== 1) {
        errors.push(`${freshInitializeModules[0].file} reconfigure schema version must remain 1`);
      }
    } catch {
      // The exact module loader above already reports the bounded import error.
    }
  }
  const reconfigurePath = path.join(root, freshInitializeModules[2].file);
  if (existsSync(reconfigurePath)) {
    try {
      const reconfigure = await import(pathToFileURL(reconfigurePath).href);
      if (reconfigure.WAKEFLOW_RECONFIGURE_KIND !== "WakeflowReconfigureBackbonePlan") {
        errors.push(`${freshInitializeModules[2].file} plan kind is invalid`);
      }
      if (reconfigure.WAKEFLOW_RECONFIGURE_SCHEMA_VERSION !== 1) {
        errors.push(`${freshInitializeModules[2].file} schema version must remain 1`);
      }
    } catch {
      // The exact module loader above already reports the bounded import error.
    }
  }
  const reconcilePath = path.join(root, freshInitializeModules[3].file);
  if (existsSync(reconcilePath)) {
    try {
      const reconcile = await import(pathToFileURL(reconcilePath).href);
      if (reconcile.WAKEFLOW_RECONCILE_KIND !== "WakeflowReconcileBackbonePlan") {
        errors.push(`${freshInitializeModules[3].file} plan kind is invalid`);
      }
      if (reconcile.WAKEFLOW_RECONCILE_SCHEMA_VERSION !== 1) {
        errors.push(`${freshInitializeModules[3].file} schema version must remain 1`);
      }
    } catch {
      // The exact module loader above already reports the bounded import error.
    }
  }
  const freshPath = path.join(root, freshInitializeModules[1].file);
  if (existsSync(freshPath)) {
    try {
      const fresh = await import(pathToFileURL(freshPath).href);
      if (fresh.WAKEFLOW_FRESH_INITIALIZE_KIND !== "WakeflowFreshInitializeBackbonePlan") {
        errors.push(`${freshInitializeModules[1].file} plan kind is invalid`);
      }
      if (fresh.WAKEFLOW_FRESH_INITIALIZE_SCHEMA_VERSION !== 1) {
        errors.push(`${freshInitializeModules[1].file} schema version must remain 1`);
      }
    } catch {
      // The exact module loader above already reports the bounded import error.
    }
  }
  for (const contract of [
    {
      file: "scripts/lib/wakeflow-support-surface-owner.mjs",
      schemaId: "urn:wakeflow:internal:support-surface-owner-plan:v1",
      kind: "WakeflowSupportSurfaceOwnerPlan",
      schemaIdExport: "WAKEFLOW_SUPPORT_SURFACE_OWNER_SCHEMA_ID",
      kindExport: "WAKEFLOW_SUPPORT_SURFACE_OWNER_KIND",
      versionExport: "WAKEFLOW_SUPPORT_SURFACE_OWNER_SCHEMA_VERSION",
    },
    {
      file: "scripts/lib/wakeflow-ledger-materialization.mjs",
      schemaId: "urn:wakeflow:internal:ledger-materialization-plan:v1",
      kind: "WakeflowLedgerMaterializationPlan",
      schemaIdExport: "WAKEFLOW_LEDGER_MATERIALIZATION_SCHEMA_ID",
      kindExport: "WAKEFLOW_LEDGER_MATERIALIZATION_KIND",
      versionExport: "WAKEFLOW_LEDGER_MATERIALIZATION_SCHEMA_VERSION",
    },
  ]) {
    const contractPath = path.join(root, contract.file);
    if (!existsSync(contractPath)) continue;
    try {
      const owner = await import(pathToFileURL(contractPath).href);
      if (owner[contract.schemaIdExport] !== contract.schemaId) {
        errors.push(`${contract.file} schema ID is invalid`);
      }
      if (owner[contract.kindExport] !== contract.kind) {
        errors.push(`${contract.file} plan kind is invalid`);
      }
      if (owner[contract.versionExport] !== 1) {
        errors.push(`${contract.file} schema version must remain 1`);
      }
    } catch {
      // The exact module loader above already reports the bounded import error.
    }
  }

  const candidateBasenames = freshInitializeModules.map(({ file }) => path.posix.basename(file));
  for (const file of freshInitializeFrozenPublicFiles) {
    const imports = moduleImportSpecifiers(readText(file));
    for (const basename of candidateBasenames) {
      if (imports.some((specifier) => path.posix.basename(specifier) === basename)) {
        errors.push(`${file} must not import the internal fresh initialize candidate ${basename}`);
      }
    }
  }
  for (const { file } of freshInitializeModules) {
    const imports = moduleImportSpecifiers(readText(file));
    for (const dependency of freshInitializeForbiddenPublicDependencies) {
      if (imports.some((specifier) => path.posix.basename(specifier) === dependency)) {
        errors.push(`${file} must not import frozen public-v2 dependency ${dependency}`);
      }
    }
  }

  const configOwnerBasename = path.posix.basename(freshInitializeModules[0].file);
  const freshImports = moduleImportSpecifiers(readText(freshInitializeModules[1].file))
    .map((specifier) => path.posix.basename(specifier));
  if (!freshImports.includes(configOwnerBasename)) {
    errors.push(`${freshInitializeModules[1].file} must consume the exact config v3 owner`);
  }
  const reconfigureImports = moduleImportSpecifiers(readText(freshInitializeModules[2].file))
    .map((specifier) => path.posix.basename(specifier));
  if (!reconfigureImports.includes(configOwnerBasename)) {
    errors.push(`${freshInitializeModules[2].file} must consume the exact config v3 owner`);
  }
  if (!reconfigureImports.includes("wakeflow-maintenance-plan.mjs")) {
    errors.push(`${freshInitializeModules[2].file} must compose the exact workspace maintenance plan`);
  }
  const ownerImports = moduleImportSpecifiers(readText(freshInitializeModules[0].file))
    .map((specifier) => path.posix.basename(specifier));
  if (!ownerImports.includes("wakeflow-workspace-mutation.mjs")) {
    errors.push(`${freshInitializeModules[0].file} must require the M3 branded mutation context`);
  }
  const maintenancePlanImports = moduleImportSpecifiers(readText(workspaceMaintenancePlanModules[0].file));
  for (const basename of candidateBasenames) {
    if (maintenancePlanImports.some((specifier) => path.posix.basename(specifier) === basename)) {
      errors.push(`${workspaceMaintenancePlanModules[0].file} pure codec must not import ${basename}`);
    }
  }
}

async function validateMaintenancePublicSurfaceContract() {
  const manifest = readJson("scripts/wakeflow-core-manifest.json");
  if (Array.isArray(manifest?.files)) {
    for (const file of maintenancePublicSurfaceContractFiles) {
      if (!manifest.files.includes(file)) errors.push(`core manifest must include ${file}`);
    }
    for (const file of forbiddenPublicCutoverFiles.filter((entry) => entry !== "templates/wakeflow-template-bundle.json")) {
      if (manifest.files.includes(file)) errors.push(`core manifest must not include retired candidate file ${file}`);
    }
  }

  await validateExactCandidateModules(maintenancePublicSurfaceModules);

  const namespaces = new Map();
  for (const contract of maintenancePublicSurfaceModules) {
    const modulePath = path.join(root, contract.file);
    if (!existsSync(modulePath)) continue;
    try {
      namespaces.set(contract.file, await import(pathToFileURL(modulePath).href));
    } catch {
      // The exact module loader above already reports the bounded import error.
    }
  }

  const publicMcp = namespaces.get("lib/wakeflow-mcp-tools.mjs");
  if (publicMcp) {
    const expectedToolNames = [
      "wakeflow_status",
      "wakeflow_maintain_workspace",
      "wakeflow_replace_windows",
      "wakeflow_register_window",
      "wakeflow_create_demand",
      "wakeflow_add_task",
      "wakeflow_prepare_delivery",
      "wakeflow_record_delivery",
      "wakeflow_record_target_result",
      "wakeflow_review_pack",
      "wakeflow_reduce_results",
      "wakeflow_decide_review",
      "wakeflow_complete_demand",
      "wakeflow_continue_demand",
      "wakeflow_record_evidence",
      "wakeflow_recover_state_transition",
      "wakeflow_release_window_lock",
      "wakeflow_view",
      "wakeflow_storage_preserve",
      "wakeflow_archive",
      "wakeflow_intake_test_card",
      "wakeflow_deliver",
      "wakeflow_next_work",
      "wakeflow_claim_next",
      "wakeflow_cancel_demand",
      "wakeflow_pod_open",
      "wakeflow_pod_record",
      "wakeflow_pod_bind",
      "wakeflow_pod_plan",
      "wakeflow_prune_runtime",
      "wakeflow_verify",
    ];
    const actualToolNames = Array.isArray(publicMcp.tools)
      ? publicMcp.tools.map((tool) => tool?.name)
      : null;
    if (JSON.stringify(actualToolNames) !== JSON.stringify(expectedToolNames)) {
      errors.push("lib/wakeflow-mcp-tools.mjs tools must be the exact ordered 31-tool public v3 surface");
    }
    const actualHandlerNames = publicMcp.handlers && typeof publicMcp.handlers === "object"
      ? Object.keys(publicMcp.handlers)
      : null;
    if (JSON.stringify(actualHandlerNames) !== JSON.stringify(expectedToolNames)) {
      errors.push("lib/wakeflow-mcp-tools.mjs handlers must match the exact ordered public tool names");
    }
    for (const toolName of expectedToolNames) {
      if (typeof publicMcp.handlers?.[toolName] !== "function") {
        errors.push(`lib/wakeflow-mcp-tools.mjs handler ${toolName} must be a function`);
      }
    }
    if (
      !Object.isFrozen(publicMcp.tools)
      || !Object.isFrozen(publicMcp.handlers)
      || publicMcp.tools?.some((tool) => (
        !Object.isFrozen(tool)
        || !Object.isFrozen(tool.inputSchema)
        || tool.inputSchema?.type !== "object"
        || tool.inputSchema?.additionalProperties !== false
      ))
    ) {
      errors.push("lib/wakeflow-mcp-tools.mjs must expose frozen tools, handlers, and closed root schemas");
    }
    if (
      publicMcp.tools?.[1]?.inputSchema?.oneOf?.length !== 5
      || publicMcp.tools?.[14]?.inputSchema?.oneOf?.length !== 3
    ) {
      errors.push("public MCP must keep five maintenance and three evidence mode branches");
    }
  }

  const coordinator = namespaces.get("scripts/lib/wakeflow-maintenance-coordinator.mjs");
  if (coordinator) {
    if (coordinator.WAKEFLOW_MAINTENANCE_CONTRACT_VERSION !== 1) {
      errors.push("scripts/lib/wakeflow-maintenance-coordinator.mjs contract version must remain 1");
    }
    if (
      JSON.stringify(coordinator.WAKEFLOW_MAINTENANCE_ACTIONS)
      !== JSON.stringify(["fresh-initialize", "reconfigure", "reconcile"])
    ) {
      errors.push("scripts/lib/wakeflow-maintenance-coordinator.mjs actions must remain the exact M5 set");
    }
    if (
      JSON.stringify(coordinator.WAKEFLOW_MAINTENANCE_MODES)
      !== JSON.stringify(["preview", "apply", "recover"])
    ) {
      errors.push("scripts/lib/wakeflow-maintenance-coordinator.mjs modes must remain preview, apply, recover");
    }
    if (coordinator.WAKEFLOW_MAINTENANCE_TOOL_NAME !== "wakeflow_maintain_workspace") {
      errors.push("scripts/lib/wakeflow-maintenance-coordinator.mjs tool name must remain final");
    }
  }

  const actionRuntime = namespaces.get("scripts/lib/wakeflow-maintenance-action-runtime.mjs");
  if (actionRuntime?.WAKEFLOW_MAINTENANCE_ACTION_RUNTIME_VERSION !== 1) {
    errors.push("scripts/lib/wakeflow-maintenance-action-runtime.mjs runtime version must remain 1");
  }

  for (const { file } of maintenancePublicSurfaceModules) {
    const imports = moduleImportSpecifiers(readText(file));
    for (const dependency of ["wakeflow-config.mjs", "wakeflow-mcp-tools-v3-candidate.mjs"]) {
      if (imports.some((specifier) => path.posix.basename(specifier) === dependency)) {
        errors.push(`${file} must not import retired normal dependency ${dependency}`);
      }
    }
  }

  const expectedDependencies = new Map([
    ["lib/wakeflow-mcp-tools.mjs", [
      "wakeflow-evidence-importer.mjs",
      "wakeflow-maintenance-action-runtime.mjs",
      "wakeflow-maintenance-coordinator.mjs",
      "wakeflow-public-v3-runtime.mjs",
      "wakeflow-template-renderer.mjs",
    ]],
    ["scripts/lib/wakeflow-public-v3-runtime.mjs", [
      "wakeflow-active-projector.mjs",
      "wakeflow-config-v3-snapshot.mjs",
      "wakeflow-demand-lifecycle-orchestration.mjs",
      "wakeflow-delivery-orchestration.mjs",
      "wakeflow-result-review-orchestration.mjs",
      "wakeflow-pod-service.mjs",
      "wakeflow-todo-service.mjs",
    ]],
    ["scripts/lib/wakeflow-maintenance-coordinator.mjs", ["wakeflow-maintenance-plan.mjs"]],
    ["scripts/lib/wakeflow-maintenance-action-runtime.mjs", [
      "wakeflow-maintenance-action-composition.mjs",
      "wakeflow-workspace-mutation.mjs",
    ]],
    ["scripts/wakeflow-setup.mjs", [
      "wakeflow-host-profile.mjs",
      "wakeflow-maintenance-action-runtime.mjs",
      "wakeflow-maintenance-coordinator.mjs",
    ]],
    ["scripts/wakeflow-cli.mjs", ["wakeflow-mcp-tools.mjs"]],
  ]);
  for (const [file, requiredDependencies] of expectedDependencies) {
    const imports = moduleImportSpecifiers(readText(file)).map((specifier) => path.posix.basename(specifier));
    for (const dependency of requiredDependencies) {
      if (!imports.includes(dependency)) {
        errors.push(`${file} must consume the exact public v3 dependency ${dependency}`);
      }
    }
  }
  const coordinatorImports = moduleImportSpecifiers(
    readText("scripts/lib/wakeflow-maintenance-coordinator.mjs"),
  ).map((specifier) => path.posix.basename(specifier));
  if (coordinatorImports.includes("wakeflow-workspace-mutation.mjs")) {
    errors.push(
      "scripts/lib/wakeflow-maintenance-coordinator.mjs must remain a host-neutral dispatcher without mutation ownership",
    );
  }
}

// 递归解析当前 registry 内的 JSON Pointer；不访问网络或自动加载未登记 schema。
function validateSchemaReferences({ schema, contract, registry }) {
  const visit = (value, location) => {
    if (!value || typeof value !== "object") return;
    if (Object.hasOwn(value, "$ref")) {
      if (typeof value.$ref !== "string" || !value.$ref) {
        errors.push(`${contract.file} has a non-string or empty $ref at ${location}`);
      } else {
        try {
          resolveSchemaReference({ ref: value.$ref, schema, registry });
        } catch (error) {
          errors.push(`${contract.file} has unresolved $ref ${value.$ref} at ${location}: ${error.message}`);
        }
      }
    }
    if (Array.isArray(value)) {
      value.forEach((entry, index) => visit(entry, `${location}/${index}`));
      return;
    }
    for (const [key, entry] of Object.entries(value)) {
      visit(entry, `${location}/${escapeJsonPointerToken(key)}`);
    }
  };
  visit(schema, "#");
}

// 对所有声明 properties 的 object node 强制 additionalProperties=false。
function validateStrictSchemaObjectNodes({ schema, contract }) {
  const visit = (value, location) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach((entry, index) => visit(entry, `${location}/${index}`));
      return;
    }
    if (
      value.type === "object"
      && value.properties
      && typeof value.properties === "object"
      && !Array.isArray(value.properties)
      && value.additionalProperties !== false
    ) {
      errors.push(
        `${contract.file} object schema at ${location} must set additionalProperties=false`,
      );
    }
    for (const [key, entry] of Object.entries(value)) {
      visit(entry, `${location}/${escapeJsonPointerToken(key)}`);
    }
  };
  visit(schema, "#");
}

function resolveSchemaReference({ ref, schema, registry }) {
  const hashIndex = ref.indexOf("#");
  const identifier = hashIndex === -1 ? ref : ref.slice(0, hashIndex);
  const fragment = hashIndex === -1 ? "" : ref.slice(hashIndex + 1);
  const target = identifier === "" ? schema : registry.get(identifier);
  if (!target) throw new Error(`schema identifier ${identifier || "(current)"} is not registered`);
  if (fragment === "") return target;
  if (!fragment.startsWith("/")) throw new Error("only JSON Pointer fragments are supported");
  let cursor = target;
  for (const rawToken of fragment.slice(1).split("/")) {
    const token = decodeJsonPointerToken(rawToken);
    if (!cursor || typeof cursor !== "object" || !Object.hasOwn(cursor, token)) {
      throw new Error(`JSON Pointer fragment #${fragment} does not exist`);
    }
    cursor = cursor[token];
  }
  return cursor;
}

function decodeJsonPointerToken(value) {
  if (/~(?:[^01]|$)/u.test(value)) throw new Error("JSON Pointer contains an invalid escape");
  return value.replaceAll("~1", "/").replaceAll("~0", "~");
}

function escapeJsonPointerToken(value) {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

// 宿主画像是进程级静态事实；验证器同时约束其不可变性和已经确认的最小字段面。
function hostProfileDataTreeIsDeepFrozen(value, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return true;
  if (!Object.isFrozen(value)) return false;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, "value")) return false;
    if (!hostProfileDataTreeIsDeepFrozen(descriptor.value, seen)) return false;
  }
  return true;
}

function validateHostCapabilityContract() {
  try {
    normalizeWakeflowHostCapabilityProfile(hostProfile);
  } catch (error) {
    errors.push(`host profile does not satisfy the capability contract: ${error.message}`);
  }
  if (!hostProfileDataTreeIsDeepFrozen(hostProfile)) {
    errors.push("host profile and every data subtree must be frozen");
  }
  for (const [label, value, expected] of [
    ["runtime", hostProfile.runtime, ["hostDirName"]],
    ["hostTools", hostProfile.hostTools, ["createWindow"]],
    ["handleId", hostProfile.handleId, ["idShape", "kind", "placeholders"]],
  ]) {
    const actual = value && typeof value === "object"
      ? Object.keys(value).sort()
      : [];
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      errors.push(`host profile ${label} must expose only ${expected.join(", ")}`);
    }
  }
  for (const retired of [
    "decisionOwner",
    "memoryFileLabel",
    "pluginManifestDir",
    "closedLoopContractName",
    "workspaceResidueChecks",
  ]) {
    if (Object.hasOwn(hostProfile, retired)) {
      errors.push(`host profile must not retain unused field ${retired}`);
    }
  }
  if (Object.hasOwn(hostProfile.artifact ?? {}, "marketplacePath")) {
    errors.push("host profile artifact must not retain unused field marketplacePath");
  }
}

// Public cutover gate 保证 normal 入口只认 v3，并保持 migration-only dependency 直接隔离。
function validatePublicV3Boundary() {
  if (WAKEFLOW_CONFIG_V3_VERSION !== PUBLIC_CONFIG_SCHEMA_VERSION) {
    errors.push(
      `normal runtime config schema version must be v3 (${PUBLIC_CONFIG_SCHEMA_VERSION}), `
        + `found ${WAKEFLOW_CONFIG_V3_VERSION}`,
    );
  }

  const schema = readJson("schemas/wakeflow-config.schema.json");
  if (schema) {
    if (schema.$id !== WAKEFLOW_CONFIG_V3_SCHEMA_ID) {
      errors.push(`public config schema $id must remain ${WAKEFLOW_CONFIG_V3_SCHEMA_ID}`);
    }
    if (schema.properties?.schemaVersion?.const !== PUBLIC_CONFIG_SCHEMA_VERSION) {
      errors.push(`public config schema must require schemaVersion ${PUBLIC_CONFIG_SCHEMA_VERSION}`);
    }
  }

  for (const file of publicV3BoundaryFiles) {
    const source = readText(file);
    if (source.includes("urn:wakeflow:internal:config:v3-candidate")) {
      errors.push(`${file} must not reference the retired internal config candidate schema`);
    }
    if (/wakeflow-(?:config|mcp-tools|setup|validate|smoke)-v3-candidate/u.test(source)) {
      errors.push(`${file} must not reference a retired v3 candidate entrypoint`);
    }
  }

  const normalEntryFiles = [
    "lib/wakeflow-mcp-tools.mjs",
    "scripts/lib/wakeflow-public-v3-runtime.mjs",
    "scripts/wakeflow-cli.mjs",
    "scripts/wakeflow-setup.mjs",
    "scripts/wakeflow-smoke.mjs",
    "scripts/wakeflow-validate.mjs",
  ];
  const migrationOnlyDependencies = new Set([
    "wakeflow-artifact-tree-identity.mjs",
    "wakeflow-codex-migration-decommission.mjs",
    "wakeflow-codex-migration-effect.mjs",
    "wakeflow-claude-migration-decommission.mjs",
    "wakeflow-claude-migration-effect.mjs",
    "wakeflow-legacy-archive-records.mjs",
    "wakeflow-legacy-archive-transform.mjs",
    "wakeflow-legacy-classifier.mjs",
    "wakeflow-legacy-owner-drain.mjs",
    "wakeflow-migration-apply.mjs",
    "wakeflow-migration-host-decommission.mjs",
    "wakeflow-migration-inventory.mjs",
    "wakeflow-migration-plan.mjs",
  ]);
  for (const file of normalEntryFiles) {
    const imports = moduleImportSpecifiers(readText(file)).map((specifier) => path.posix.basename(specifier));
    if (imports.includes("wakeflow-config.mjs")) {
      errors.push(`${file} must not import the legacy normal config parser`);
    }
    for (const dependency of imports) {
      if (migrationOnlyDependencies.has(dependency)) {
        errors.push(`${file} must not import migration-only dependency ${dependency}`);
      }
    }
  }
}

// 从真实 MCP module 读取声明，固定工具数量及 annotation 的安全提示矩阵。
async function validateMcpToolDeclarations() {
  const toolModule = path.join(root, "lib/wakeflow-mcp-tools.mjs");
  if (!existsSync(toolModule)) return;
  let tools;
  try {
    ({ tools } = await import(pathToFileURL(toolModule).href));
  } catch (error) {
    errors.push(`failed to load Wakeflow MCP tools: ${error.message}`);
    return;
  }
  if (!Array.isArray(tools) || tools.length === 0) {
    errors.push("Wakeflow MCP tools export must be a non-empty array");
    return;
  }
  if (tools.length !== 31) {
    errors.push(`Wakeflow MCP public surface must contain exactly 31 tools, found ${tools.length}`);
  }
  const publicNames = new Set(tools.map((tool) => tool?.name).filter(Boolean));
  for (const retired of [
    "wakeflow_render_progress",
    "wakeflow_pod_list",
    "wakeflow_sanitize_archive",
    "wakeflow_pod_prepare_design_request",
    "wakeflow_pod_prepare_test_access",
    "wakeflow_pod_close",
    "wakeflow_pod_record_materialization",
    "wakeflow_pod_record_design_handoff",
    "wakeflow_pod_record_test_access",
    "wakeflow_pod_record_close_receipt",
  ]) {
    if (publicNames.has(retired)) errors.push(`retired MCP tool must not be public: ${retired}`);
  }
  const readOnlyTools = new Set([
    "wakeflow_status",
    "wakeflow_review_pack",
    "wakeflow_view",
    "wakeflow_next_work",
    "wakeflow_verify",
  ]);
  const destructiveTools = new Set([
    "wakeflow_maintain_workspace",
    "wakeflow_replace_windows",
    "wakeflow_release_window_lock",
    "wakeflow_storage_preserve",
    "wakeflow_archive",
    "wakeflow_pod_bind",
    "wakeflow_prune_runtime",
  ]);
  for (const tool of tools) {
    if (!tool?.name) {
      errors.push("Wakeflow MCP tool declaration is missing name");
      continue;
    }
    const annotations = tool.annotations;
    if (!annotations || typeof annotations !== "object" || Array.isArray(annotations)) {
      errors.push(`MCP tool ${tool.name} must declare annotations`);
      continue;
    }
    for (const field of ["title", "readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint"]) {
      if (!(field in annotations)) errors.push(`MCP tool ${tool.name} annotations missing ${field}`);
    }
    const expectedReadOnly = readOnlyTools.has(tool.name);
    const expectedDestructive = destructiveTools.has(tool.name);
    if (annotations.readOnlyHint !== expectedReadOnly) {
      errors.push(`MCP tool ${tool.name} must declare readOnlyHint=${expectedReadOnly}`);
    }
    if (annotations.destructiveHint !== expectedDestructive) {
      errors.push(`MCP tool ${tool.name} must declare destructiveHint=${expectedDestructive}`);
    }
    if (annotations.idempotentHint !== true) {
      errors.push(`MCP tool ${tool.name} must declare idempotentHint=true`);
    }
    if (annotations.openWorldHint !== false) {
      errors.push(`MCP tool ${tool.name} must stay local; openWorldHint must be false`);
    }
  }
}

// 公开脚本清单是 normal artifact 的精确四项表面；不存在通用 subprocess dispatcher。
function validatePublicRuntimeScripts() {
  const names = new Set(publicRuntimeScriptEntries.map((entry) => entry.name));
  for (const expected of [
    "wakeflow-cli",
    "wakeflow-setup",
    "wakeflow-smoke",
    "wakeflow-validate",
  ]) {
    if (!names.has(expected)) errors.push(`runtime whitelist is missing ${expected}`);
  }
  if (names.size !== 4) errors.push(`runtime whitelist must contain exactly 4 public v3 entries, found ${names.size}`);
  for (const entry of publicRuntimeScriptEntries) {
    requireFile(path.join("scripts", entry.file));
  }
}

// Skill gate 从每个 SKILL.md 出发验证 frontmatter、链接可达性、孤儿资源与 symlink 边界。
function validateSkillSurface() {
  const skillsRoot = path.join(root, "skills");
  if (!existsSync(skillsRoot)) return;
  const skillsRootStat = lstatSync(skillsRoot);
  if (skillsRootStat.isSymbolicLink() || !skillsRootStat.isDirectory()) {
    errors.push("skills/ must be a real directory and not a symlink");
    return;
  }
  const skillDirectories = [];
  for (const entry of readdirSync(skillsRoot, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    const absolute = path.join(skillsRoot, entry.name);
    if (entry.isSymbolicLink()) {
      errors.push(`${relative(absolute)} must be a real Skill directory and not a symlink`);
    } else if (!entry.isDirectory()) {
      errors.push(`${relative(absolute)} is not a Skill package directory`);
    } else {
      skillDirectories.push(absolute);
    }
  }
  if (skillDirectories.length < 6) {
    errors.push("skills/ must expose controller, target, target-craft, governance, design, and test skills");
  }
  const names = new Map();
  for (const skillRoot of skillDirectories) validateSkillPackage(skillRoot, names);
  const governance = readText("skills/wakeflow-governance/SKILL.md");
  for (const required of [
    "workspace initialization",
    "wakeflow_maintain_workspace",
    "fresh-initialize",
    "preview",
    "wakeflow_replace_windows",
    "wakeflow_register_window",
    "MCP server is unavailable",
  ]) {
    if (!governance.includes(required)) {
      errors.push(`wakeflow-governance skill must direct initialization through MCP: ${required}`);
    }
  }
}

function validateSkillPackage(skillRoot, names) {
  const directoryName = path.basename(skillRoot);
  const main = path.join(skillRoot, "SKILL.md");
  if (!existsSync(main)) {
    errors.push(`${relative(main)} is missing from the Skill package`);
    return;
  }
  const mainStat = lstatSync(main);
  if (mainStat.isSymbolicLink() || !mainStat.isFile()) {
    errors.push(`${relative(main)} must be a real file and not a symlink`);
    return;
  }
  const text = readFileSync(main, "utf8");
  const frontmatter = text.match(/^---\n([\s\S]*?)\n---(?:\n|$)/u)?.[1] ?? null;
  if (frontmatter === null) {
    errors.push(`${relative(main)} is missing skill frontmatter`);
  } else {
    const name = frontmatter.match(/^name:\s*([A-Za-z0-9_-]+)\s*$/mu)?.[1] ?? null;
    const description = frontmatter.match(/^description:\s*(\S[\s\S]*)$/mu)?.[1] ?? null;
    if (!name) {
      errors.push(`${relative(main)} is missing a frontmatter name`);
    } else {
      if (name !== directoryName) {
        errors.push(`${relative(main)} frontmatter name ${name} must match directory ${directoryName}`);
      }
      const previous = names.get(name);
      if (previous) errors.push(`duplicate skill name ${name}: ${previous} and ${relative(main)}`);
      else names.set(name, relative(main));
    }
    if (!description) errors.push(`${relative(main)} is missing a description`);
  }

  const allFiles = listSkillPackageFiles(skillRoot);
  const reachable = new Set([path.resolve(main)]);
  const queue = [path.resolve(main)];
  while (queue.length) {
    const current = queue.shift();
    if (path.extname(current).toLowerCase() !== ".md") continue;
    const currentText = readFileSync(current, "utf8");
    const links = markdownLinkTargets(currentText);
    for (const label of links.duplicateReferences) {
      errors.push(`${relative(current)} has a duplicate Skill link reference definition: ${label}`);
    }
    for (const label of links.missingReferences) {
      errors.push(`${relative(current)} has a missing Skill link reference definition: ${label}`);
    }
    for (const rawTarget of links.targets) {
      const target = resolveSkillLink({ skillRoot, current, rawTarget });
      if (!target || reachable.has(target)) continue;
      reachable.add(target);
      queue.push(target);
    }
  }
  for (const file of allFiles) {
    const packageRelative = path.relative(skillRoot, file).split(path.sep).join("/");
    if (
      (packageRelative.startsWith("references/") || packageRelative.startsWith("assets/"))
      && !reachable.has(path.resolve(file))
    ) {
      errors.push(`${relative(file)} is an orphan Skill resource not reachable from ${relative(main)}`);
    }
  }
}

function listSkillPackageFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      errors.push(`${relative(absolute)} must not be a symlink inside a Skill package`);
    } else if (entry.isDirectory()) {
      files.push(...listSkillPackageFiles(absolute));
    } else if (entry.isFile()) {
      files.push(absolute);
    }
  }
  return files;
}

function markdownLinkTargets(text) {
  const markdown = text
    .replace(/```[\s\S]*?```/gu, "")
    .replace(/~~~[\s\S]*?~~~/gu, "")
    .replace(/`[^`\n]*`/gu, "");
  const definitions = new Map();
  const duplicateReferences = [];
  const definitionPattern = /^[ \t]{0,3}\[([^\]\n]+)\]:[ \t]*(<[^>\n]+>|[^ \t\n]+)(?:[ \t]+(?:"[^"\n]*"|'[^'\n]*'|\([^\)\n]*\)))?[ \t]*$/gmu;
  const withoutDefinitions = markdown.replace(definitionPattern, (_match, rawLabel, rawTarget) => {
    const label = normalizeMarkdownReferenceLabel(rawLabel);
    if (definitions.has(label)) duplicateReferences.push(label);
    else definitions.set(label, rawTarget.replace(/^<|>$/gu, ""));
    return "";
  });
  const targets = [...withoutDefinitions.matchAll(/!?\[[^\]]*\]\(\s*(<[^>]+>|[^)\s]+)(?:\s+["'][^"']*["'])?\s*\)/gu)]
    .map((match) => match[1].replace(/^<|>$/gu, ""));
  const missingReferences = [];
  for (const match of withoutDefinitions.matchAll(/!?\[([^\]\n]+)\]\[([^\]\n]*)\]/gu)) {
    const label = normalizeMarkdownReferenceLabel(match[2] || match[1]);
    const target = definitions.get(label);
    if (target === undefined) missingReferences.push(label);
    else targets.push(target);
  }
  for (const match of withoutDefinitions.matchAll(/!?\[([^\]\n]+)\]/gu)) {
    const start = match.index;
    const end = start + match[0].length;
    const previous = withoutDefinitions[start - 1] ?? "";
    const next = withoutDefinitions[end] ?? "";
    if (previous === "]" || next === "(" || next === "[" || next === ":") continue;
    const target = definitions.get(normalizeMarkdownReferenceLabel(match[1]));
    if (target !== undefined) targets.push(target);
  }
  return {
    targets,
    missingReferences: [...new Set(missingReferences)].sort(),
    duplicateReferences: [...new Set(duplicateReferences)].sort(),
  };
}

function normalizeMarkdownReferenceLabel(value) {
  return value.trim().replace(/[ \t]+/gu, " ").toLowerCase();
}

function resolveSkillLink({ skillRoot, current, rawTarget }) {
  if (rawTarget.startsWith("#") || /^(?:https?|mailto):/iu.test(rawTarget)) return null;
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/u.test(rawTarget)) {
    errors.push(`${relative(current)} has unsupported local Skill link scheme: ${rawTarget}`);
    return null;
  }
  const withoutFragment = rawTarget.split("#", 1)[0].split("?", 1)[0];
  let decoded;
  try {
    decoded = decodeURIComponent(withoutFragment);
  } catch {
    errors.push(`${relative(current)} has an invalid encoded Skill link: ${rawTarget}`);
    return null;
  }
  if (
    !decoded
    || decoded.includes("\\")
    || path.posix.isAbsolute(decoded)
    || /^[A-Za-z]:\//u.test(decoded)
    || path.posix.normalize(decoded) !== decoded
    || decoded.split("/").includes("..")
  ) {
    errors.push(`${relative(current)} has a non-canonical or traversing Skill link: ${rawTarget}`);
    return null;
  }
  const target = path.resolve(path.dirname(current), ...decoded.split("/"));
  const packageRelative = path.relative(skillRoot, target);
  if (!packageRelative || packageRelative.startsWith("..") || path.isAbsolute(packageRelative)) {
    errors.push(`${relative(current)} has a Skill link outside ${relative(skillRoot)}: ${rawTarget}`);
    return null;
  }
  let cursor = skillRoot;
  for (const segment of packageRelative.split(path.sep)) {
    cursor = path.join(cursor, segment);
    if (!existsSync(cursor)) {
      errors.push(`${relative(current)} has a missing Skill link target: ${rawTarget}`);
      return null;
    }
    if (lstatSync(cursor).isSymbolicLink()) {
      errors.push(`${relative(current)} has a symlinked Skill link target: ${rawTarget}`);
      return null;
    }
  }
  if (!statSync(target).isFile()) {
    errors.push(`${relative(current)} Skill links must target files: ${rawTarget}`);
    return null;
  }
  return target;
}

// 旧 template bundle 已是 forbidden absence contract；当前唯一模板入口是严格 asset bundle parser。
function validateAssetBundle() {
  const bundle = readJson("templates/wakeflow-asset-bundle.json");
  if (!bundle) return;
  try {
    parseWakeflowAssetBundle(bundle);
  } catch (error) {
    errors.push(`invalid Wakeflow asset bundle: ${error.code ?? error.name}: ${error.message}`);
  }
}

// 文本 gate 排除本地运行态目录，只审查可复用 artifact 中的占位符、项目泄漏与本地化边界。
function validateTextSurface() {
  for (const file of listTextFiles(root)) {
    const rel = relative(file);
    const text = readFileSync(file, "utf8");
    const runtimeText = localizedCommentOnlyTextFiles.has(rel)
      ? omitCommentOnlyLines(text, { hashComments: rel === "bin/wakeflow-bootstrap" })
      : text;
    const allowsLocalizedRuntimeText = localizedRuntimeTextFiles.has(rel);
    const allowsLocalizedDocumentationText = localizedDocumentationTextFiles.has(rel);
    const allowsLocalizedText = allowsLocalizedRuntimeText || allowsLocalizedDocumentationText;
    if (text.includes(placeholderToken)) errors.push(`placeholder remains in ${rel}`);
    if (text.includes(oldWorkspaceToken)) {
      errors.push(`old workspace name remains in ${rel}`);
    }
    if (text.includes(oldLedgerToken)) {
      errors.push(`old ledger directory name remains in ${rel}`);
    }
    if (!allowsProjectSpecificFixtureText(rel)) {
      for (const token of projectSpecificTokens) {
        if (text.includes(token)) errors.push(`project-specific token ${token} remains in ${rel}`);
      }
    }
    if (!allowsLocalizedText && /\p{Script=Han}/u.test(runtimeText)) {
      errors.push(`non-English Han text remains in ${rel}`);
    }
    if (!allowsLocalizedText && /[\u3000-\u303F\uFF00-\uFFEF]/u.test(runtimeText)) {
      errors.push(`fullwidth punctuation remains in ${rel}`);
    }
  }
}

/**
 * 只移除完整注释行或从完整块注释关闭点之后留下的代码。
 * 不能按行首星号猜测注释，否则合法乘法续行会绕过运行文本检查。
 */
function omitCommentOnlyLines(text, { hashComments = false } = {}) {
  let blockCommentOpen = false;
  return text
    .split(/\r?\n/u)
    .map((line) => {
      let remainder = line.trimStart();
      while (true) {
        if (blockCommentOpen) {
          const close = remainder.indexOf("*/");
          if (close === -1) return "";
          blockCommentOpen = false;
          remainder = remainder.slice(close + 2).trimStart();
          if (!remainder) return "";
          continue;
        }
        if (remainder.startsWith("//")) return "";
        if (hashComments && remainder.startsWith("#")) return "";
        if (!remainder.startsWith("/*")) return remainder === line.trimStart() ? line : remainder;
        const close = remainder.indexOf("*/", 2);
        if (close === -1) {
          blockCommentOpen = true;
          return "";
        }
        remainder = remainder.slice(close + 2).trimStart();
        if (!remainder) return "";
      }
    })
    .join("\n");
}

function allowsProjectSpecificFixtureText(relativePath) {
  return relativePath.startsWith("scripts/fixtures/") || /\.test\.mjs$/u.test(relativePath);
}

function requireFile(relativePath) {
  const absolute = path.join(root, relativePath);
  if (!existsSync(absolute) || !statSync(absolute).isFile()) {
    errors.push(`missing file: ${relativePath}`);
  }
}

function requirePath(relativePath, message) {
  const absolute = path.join(root, stripDotSlash(relativePath));
  if (!existsSync(absolute)) errors.push(message);
}

function readJson(relativePath) {
  const absolute = path.join(root, relativePath);
  if (!existsSync(absolute)) return null;
  try {
    return JSON.parse(readFileSync(absolute, "utf8"));
  } catch (error) {
    errors.push(`invalid JSON in ${relativePath}: ${error.message}`);
    return null;
  }
}

function readText(relativePath) {
  const absolute = path.join(root, relativePath);
  return existsSync(absolute) ? readFileSync(absolute, "utf8") : "";
}

/**
 * 构造 normal 与 bootstrap 两张传递图：normal 禁止 legacy/migration，bootstrap 必须包含精确迁移闭包。
 * 这里只解析字面量 import/export/require；真实动态 owner 装载另由其专属合同和测试约束。
 */
function validateM7ANormalRuntimeBoundary() {
  if (
    retiredNormalRuntimePaths.length !== 63
    || new Set(retiredNormalRuntimePaths).size !== retiredNormalRuntimePaths.length
  ) {
    errors.push("M7A retired normal-runtime inventory must contain exactly 63 unique paths");
  }

  for (const relativePath of [...retiredNormalRuntimePaths, ...retiredHostRuntimePaths]) {
    if (existsSync(path.join(root, relativePath))) {
      errors.push(`retired normal-runtime file remains: ${relativePath}`);
    }
  }

  const hostRoots = [
    hostProfile.artifact.podMaterializationHostFile,
    hostProfile.artifact.decommissionHostFile,
    hostProfile.artifact.activationScopeHostFile,
    hostProfile.artifact.locatorHostFile,
    hostProfile.artifact.lifecycleHostFile,
    hostProfile.artifact.facadeHostFile,
    hostProfile.artifact.transportHostFile,
    hostProfile.artifact.settingsAssetsHostFile,
    hostProfile.artifact.activityHostFile,
  ].filter((value) => typeof value === "string" && value.length > 0);
  const normalGraph = inspectLiteralModuleGraph([
    ...normalRuntimeRoots,
    ...hostRoots,
  ]);

  for (const relativePath of normalGraph.missingRoots) {
    errors.push(`normal runtime root is missing: ${relativePath}`);
  }
  for (const edge of normalGraph.edges) {
    if (edge.outsideArtifact) {
      errors.push(`normal runtime graph escapes artifact: ${edge.from} -> ${edge.to}`);
    } else if (!edge.exists) {
      errors.push(`normal runtime graph has unresolved local import: ${edge.from} -> ${edge.specifier}`);
    }
  }
  for (const relativePath of normalGraph.visited) {
    if (retiredNormalRuntimePaths.includes(relativePath) || retiredHostRuntimePaths.includes(relativePath)) {
      errors.push(`normal runtime graph reaches retired file: ${relativePath}`);
    }
    if (migrationParserPaths.includes(relativePath)) {
      errors.push(`normal runtime graph reaches migration-only file: ${relativePath}`);
    }
  }

  const bootstrapEntrypoint = "scripts/wakeflow-bootstrap.mjs";
  const bootstrapGraph = inspectLiteralModuleGraph([bootstrapEntrypoint]);
  for (const relativePath of bootstrapGraph.missingRoots) {
    errors.push(`explicit bootstrap root is missing: ${relativePath}`);
  }
  for (const edge of bootstrapGraph.edges) {
    if (edge.outsideArtifact) {
      errors.push(`explicit bootstrap graph escapes artifact: ${edge.from} -> ${edge.to}`);
    } else if (!edge.exists) {
      errors.push(`explicit bootstrap graph has unresolved local import: ${edge.from} -> ${edge.specifier}`);
    }
  }
  for (const relativePath of bootstrapRequiredMigrationClosure) {
    if (!bootstrapGraph.visited.includes(relativePath)) {
      errors.push(`explicit bootstrap graph is missing migration-only file: ${relativePath}`);
    }
  }
  for (const relativePath of bootstrapGraph.visited) {
    if (retiredNormalRuntimePaths.includes(relativePath) || retiredHostRuntimePaths.includes(relativePath)) {
      errors.push(`explicit bootstrap graph reaches retired writer: ${relativePath}`);
    }
  }

  const scriptsRoot = path.join(root, "scripts");
  if (existsSync(scriptsRoot)) {
    const otherEntrypoints = readdirSync(scriptsRoot, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".mjs"))
      .map((entry) => `scripts/${entry.name}`)
      .filter((relativePath) => relativePath !== bootstrapEntrypoint)
      .sort();
    for (const entrypoint of otherEntrypoints) {
      const graph = inspectLiteralModuleGraph([entrypoint]);
      for (const relativePath of graph.visited) {
        if (migrationParserPaths.includes(relativePath)) {
          errors.push(`${entrypoint} reaches migration-only file: ${relativePath}`);
        }
      }
    }
  }

  const packageJson = readJson("package.json");
  const packageBins = Object.values(packageJson?.bin ?? {});
  if (packageBins.some((value) => String(value).includes("wakeflow-bootstrap"))) {
    errors.push("package bin must not expose the explicit migration bootstrap");
  }
  for (const file of ["lib/wakeflow-mcp-tools.mjs", "scripts/wakeflow-cli.mjs"]) {
    if (/wakeflow-bootstrap|wakeflow_migrat/iu.test(readText(file))) {
      errors.push(`${file} must not expose the explicit migration bootstrap`);
    }
  }
}

// 从一组 artifact 内相对 root 做闭包遍历，记录缺 root、未解析边和词法越界边。
function inspectLiteralModuleGraph(relativeRoots) {
  const pending = relativeRoots.map((relativePath) => path.resolve(root, relativePath));
  const visited = new Set();
  const edges = [];
  const missingRoots = [];

  for (const absoluteRoot of pending) {
    if (!existsSync(absoluteRoot)) missingRoots.push(relative(absoluteRoot));
  }

  while (pending.length > 0) {
    const file = pending.shift();
    if (visited.has(file) || !existsSync(file)) continue;
    visited.add(file);
    const source = readFileSync(file, "utf8");
    for (const specifier of moduleImportSpecifiers(source)) {
      if (!specifier.startsWith(".")) continue;
      const unresolved = path.resolve(path.dirname(file), specifier);
      const candidates = path.extname(unresolved)
        ? [unresolved]
        : [
            unresolved,
            `${unresolved}.mjs`,
            `${unresolved}.js`,
            `${unresolved}.cjs`,
            path.join(unresolved, "index.mjs"),
          ];
      const target = candidates.find((candidate) => existsSync(candidate)) ?? unresolved;
      const from = relative(file);
      const to = relative(target);
      const outsideArtifact = to === ".." || to.startsWith("../");
      const edge = Object.freeze({
        exists: existsSync(target),
        from,
        outsideArtifact,
        specifier,
        to,
      });
      edges.push(edge);
      if (edge.exists && !outsideArtifact && !visited.has(target)) pending.push(target);
    }
  }

  return Object.freeze({
    edges: Object.freeze(edges.sort((left, right) => (
      left.from.localeCompare(right.from)
      || left.to.localeCompare(right.to)
      || left.specifier.localeCompare(right.specifier)
    ))),
    missingRoots: Object.freeze([...new Set(missingRoots)].sort()),
    visited: Object.freeze([...visited].map((file) => relative(file)).sort()),
  });
}

// 提取 static import/export、literal dynamic import 与 CommonJS literal require。
function moduleImportSpecifiers(source) {
  const specifiers = [];
  const staticImport = /\b(?:import|export)\s+(?:[^"']*?\s+from\s+)?["']([^"']+)["']/gu;
  const dynamicImport = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/gu;
  const commonJsRequire = /\brequire\s*\(\s*["']([^"']+)["']\s*\)/gu;
  for (const match of source.matchAll(staticImport)) specifiers.push(match[1]);
  for (const match of source.matchAll(dynamicImport)) specifiers.push(match[1]);
  for (const match of source.matchAll(commonJsRequire)) specifiers.push(match[1]);
  return [...new Set(specifiers)].sort();
}

// 递归枚举发布文本；symlink 与打包树真实性由 release packaging gate 独立负责。
function listTextFiles(directory) {
  return listFiles(directory).filter((file) => {
    return (
      /\.(md|json|cjs|mjs|js|ts|tsx|yaml|yml)$/.test(file)
      // extensionless shell launcher 也是发布文本，必须进入本地化与占位符检查。
      || file === path.join(root, "bin", "wakeflow-bootstrap")
    );
  });
}

function listFiles(directory) {
  if (!existsSync(directory)) return [];
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (ignoredDirectoryNames.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFiles(absolute));
    } else if (entry.isFile()) {
      files.push(absolute);
    }
  }
  return files;
}

function countSkillFiles() {
  return listFiles(path.join(root, "skills")).filter((file) => path.basename(file) === "SKILL.md").length;
}

function getArgValue(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}

function stripDotSlash(value) {
  return String(value).replace(/^\.\//, "");
}

function relative(absolute) {
  return path.relative(root, absolute).split(path.sep).join("/");
}
