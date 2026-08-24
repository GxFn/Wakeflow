/**
 * Wakeflow 双宿主发布包的静态完整性合同与纯报告判定器。
 *
 * 能力导航：
 * - `WAKEFLOW_RELEASE_REQUIRED_*`：按领域保存发布时不可遗漏的最小文件集合；
 * - `WAKEFLOW_RELEASE_PACKAGING_CONTRACTS`：把共享集合与宿主专属集合组合成两个安装包合同；
 * - `evaluateWakeflowPackageReport()`：只判定已解析的 `npm pack --dry-run --json` 报告；
 * - Git、tag、remote、工作树与实际 npm 子进程门继续归 `check-release-consistency.mjs`。
 *
 * 本文件不读取仓库、不启动 npm，也不从文件名推导领域 authority。清单仍需由真实
 * producer/consumer review、artifact validator 与测试共同维护，不能被当作全局运行时 registry。
 */

// ==================== 一、共享 Skill 与领域合同文件 ====================

export const WAKEFLOW_RELEASE_REQUIRED_SKILL_FILES = Object.freeze([
  "skills/wakeflow-controller/SKILL.md",
  "skills/wakeflow-design/SKILL.md",
  "skills/wakeflow-design/assets/original-plan.md",
  "skills/wakeflow-design/assets/requirement-design.md",
  "skills/wakeflow-design/references/clarification.md",
  "skills/wakeflow-design/references/design-handoff.md",
  "skills/wakeflow-design/references/option-planning.md",
  "skills/wakeflow-design/references/requirement-design.md",
  "skills/wakeflow-design/references/work-slicing.md",
  "skills/wakeflow-governance/SKILL.md",
  "skills/wakeflow-governance/references/agents-rule-map.md",
  "skills/wakeflow-governance/references/design-test-skill-realization-source-map.md",
  "skills/wakeflow-governance/references/direct-thread-window-config.md",
  "skills/wakeflow-governance/references/phased-migration.md",
  "skills/wakeflow-governance/references/script-pipeline.md",
  "skills/wakeflow-governance/references/skill-writing-style.md",
  "skills/wakeflow-governance/references/stage-route-map.md",
  "skills/wakeflow-governance/references/testing-validation.md",
  "skills/wakeflow-governance/references/todo-backlog.md",
  "skills/wakeflow-governance/references/wakeflow-architecture.md",
  "skills/wakeflow-governance/references/wakeflow-delivery.md",
  "skills/wakeflow-governance/references/wakeflow-ledgers.md",
  "skills/wakeflow-governance/references/window-dispatch.md",
  "skills/wakeflow-target-craft/SKILL.md",
  "skills/wakeflow-target/SKILL.md",
  "skills/wakeflow-test/SKILL.md",
  "skills/wakeflow-test/references/debugging-triage.md",
  "skills/wakeflow-test/references/regression-advisory.md",
  "skills/wakeflow-test/references/risk-strategy.md",
  "skills/wakeflow-test/references/self-evidence-review.md",
]);

export const WAKEFLOW_RELEASE_REQUIRED_DEMAND_ARTIFACT_FILES = Object.freeze([
  "schemas/wakeflow-demand-artifacts/pod-design-handoff.schema.json",
  "schemas/wakeflow-demand-artifacts/pod-design-request.schema.json",
  "schemas/wakeflow-demand-artifacts/review-candidate.schema.json",
  "schemas/wakeflow-demand-artifacts/target-result.schema.json",
  "schemas/wakeflow-demand-artifacts/task-package.schema.json",
  "schemas/wakeflow-demand-artifacts/test-card.schema.json",
  "scripts/lib/wakeflow-demand-artifact-records.mjs",
  "scripts/lib/wakeflow-demand-artifact-service.mjs",
  "scripts/lib/wakeflow-target-result-authority.mjs",
]);

export const WAKEFLOW_RELEASE_REQUIRED_DEMAND_LIFECYCLE_FILES = Object.freeze([
  "schemas/wakeflow-demand-core/controller-event.schema.json",
  "schemas/wakeflow-demand-core/wakeflow-state.schema.json",
  "scripts/lib/wakeflow-demand-core-records.mjs",
  "scripts/lib/wakeflow-demand-lifecycle-orchestration.mjs",
  "scripts/lib/wakeflow-demand-state-service.mjs",
]);

export const WAKEFLOW_RELEASE_REQUIRED_EVIDENCE_FILES = Object.freeze([
  "schemas/wakeflow-demand-evidence/evidence.schema.json",
  "scripts/lib/wakeflow-evidence-importer.mjs",
  "scripts/lib/wakeflow-evidence-records.mjs",
  "scripts/lib/wakeflow-evidence-tree.mjs",
]);

export const WAKEFLOW_RELEASE_REQUIRED_ACTIVE_PROJECTION_FILES = Object.freeze([
  "scripts/lib/wakeflow-active-identity-lock.mjs",
  "scripts/lib/wakeflow-active-projection-lock.mjs",
  "scripts/lib/wakeflow-active-projector.mjs",
  "scripts/lib/wakeflow-config-v3-snapshot.mjs",
]);

export const WAKEFLOW_RELEASE_REQUIRED_BUSINESS_ARCHIVE_FILES = Object.freeze([
  "schemas/wakeflow-business-archive/archive-transaction.schema.json",
  "schemas/wakeflow-business-archive/business-summary.schema.json",
  "schemas/wakeflow-business-archive/todo-history.schema.json",
  "schemas/wakeflow-business-archive/transport-summary.schema.json",
  "scripts/lib/wakeflow-business-archive-records.mjs",
  "scripts/lib/wakeflow-business-archive-service.mjs",
]);

export const WAKEFLOW_RELEASE_REQUIRED_WINDOW_BINDING_FILES = Object.freeze([
  "schemas/wakeflow-window-identity/window-binding.schema.json",
  "scripts/lib/wakeflow-window-binding-records.mjs",
  "scripts/lib/wakeflow-window-binding-service.mjs",
]);

export const WAKEFLOW_RELEASE_REQUIRED_HOST_DECOMMISSION_FILES = Object.freeze([
  "schemas/wakeflow-window-identity/host-decommission-result.schema.json",
  "scripts/lib/wakeflow-host-decommission-result.mjs",
]);

export const WAKEFLOW_RELEASE_REQUIRED_CODEX_DECOMMISSION_FILES = Object.freeze([
  "scripts/lib/wakeflow-codex-decommission.mjs",
]);

export const WAKEFLOW_RELEASE_REQUIRED_CLAUDE_DECOMMISSION_FILES = Object.freeze([
  "scripts/lib/wakeflow-claude-decommission.mjs",
]);

export const WAKEFLOW_RELEASE_REQUIRED_HOST_ACTIVATION_SCOPE_FILES = Object.freeze([
  "scripts/lib/wakeflow-host-activation-gate.mjs",
  "scripts/lib/wakeflow-host-activation-scope.mjs",
]);

export const WAKEFLOW_RELEASE_REQUIRED_CODEX_ACTIVATION_SCOPE_FILES = Object.freeze([
  "scripts/lib/wakeflow-codex-activation-scope.mjs",
]);

export const WAKEFLOW_RELEASE_REQUIRED_CLAUDE_ACTIVATION_SCOPE_FILES = Object.freeze([
  "scripts/lib/wakeflow-claude-activation-scope.mjs",
]);

export const WAKEFLOW_RELEASE_REQUIRED_WINDOW_COORDINATION_LEASE_FILES = Object.freeze([
  "schemas/wakeflow-coordination/window-lease.schema.json",
  "scripts/lib/wakeflow-window-lease-records.mjs",
  "scripts/lib/wakeflow-window-lease-service.mjs",
]);

export const WAKEFLOW_RELEASE_REQUIRED_POD_FILES = Object.freeze([
  "schemas/wakeflow-pod/close-intent.schema.json",
  "schemas/wakeflow-pod/close-receipt.schema.json",
  "schemas/wakeflow-pod/creation-receipt.schema.json",
  "schemas/wakeflow-pod/launch-intent.schema.json",
  "schemas/wakeflow-pod/materialization-event.schema.json",
  "schemas/wakeflow-pod/pod-scope.schema.json",
  "schemas/wakeflow-pod/resume-observation.schema.json",
  "schemas/wakeflow-pod/test-access-plan.schema.json",
  "schemas/wakeflow-pod/test-access-receipt.schema.json",
  "scripts/lib/wakeflow-pod-records.mjs",
  "scripts/lib/wakeflow-pod-service.mjs",
]);

export const WAKEFLOW_RELEASE_REQUIRED_KEEP_LIVE_FILES = Object.freeze([
  "schemas/wakeflow-keep-live/control.schema.json",
  "schemas/wakeflow-keep-live/lease.schema.json",
  "schemas/wakeflow-keep-live/manager-lock.schema.json",
  "schemas/wakeflow-keep-live/process.schema.json",
  "scripts/lib/wakeflow-keep-live-records.mjs",
  "scripts/lib/wakeflow-keep-live-service.mjs",
  "scripts/lib/wakeflow-process-identity.mjs",
]);

// ==================== 二、宿主专属合同文件 ====================

export const WAKEFLOW_RELEASE_REQUIRED_CLAUDE_LOCATOR_FILES = Object.freeze([
  "schemas/wakeflow-claude-host/window-locator.schema.json",
  "scripts/lib/wakeflow-claude-locator.mjs",
]);

export const WAKEFLOW_RELEASE_REQUIRED_CLAUDE_LIFECYCLE_FILES = Object.freeze([
  "scripts/lib/wakeflow-claude-host.mjs",
  "scripts/lib/wakeflow-claude-lifecycle.mjs",
]);

export const WAKEFLOW_RELEASE_REQUIRED_CLAUDE_TRANSPORT_FILES = Object.freeze([
  "scripts/lib/wakeflow-claude-transport.mjs",
]);

export const WAKEFLOW_RELEASE_REQUIRED_CLAUDE_SETTINGS_FILES = Object.freeze([
  "scripts/lib/wakeflow-claude-settings.mjs",
]);

export const WAKEFLOW_RELEASE_REQUIRED_CLAUDE_ACTIVITY_FILES = Object.freeze([
  "schemas/wakeflow-claude-host/activity-monitor-manager-lock.schema.json",
  "schemas/wakeflow-claude-host/activity-monitor-process.schema.json",
  "scripts/lib/wakeflow-claude-activity.mjs",
]);

// ==================== 三、transport、迁移与公共 v3 文件 ====================

export const WAKEFLOW_RELEASE_REQUIRED_TRANSPORT_FILES = Object.freeze([
  "schemas/wakeflow-delivery/delivery-envelope.schema.json",
  "schemas/wakeflow-delivery/delivery-run.schema.json",
  "schemas/wakeflow-delivery/dispatch-group.schema.json",
  "schemas/wakeflow-delivery/dispatch-packet.schema.json",
  "schemas/wakeflow-maintenance/transport-retention-plan.schema.json",
  "scripts/lib/wakeflow-delivery-orchestration.mjs",
  "scripts/lib/wakeflow-result-review-orchestration.mjs",
  "scripts/lib/wakeflow-transport-retention.mjs",
  "scripts/lib/wakeflow-transport-records.mjs",
  "scripts/lib/wakeflow-transport-store.mjs",
]);

export const WAKEFLOW_RELEASE_REQUIRED_PRESERVATION_FILES = Object.freeze([
  "schemas/wakeflow-maintenance/local-preservation-plan.schema.json",
  "schemas/wakeflow-maintenance/local-preservation.schema.json",
  "scripts/lib/wakeflow-preservation.mjs",
]);

export const WAKEFLOW_RELEASE_REQUIRED_ARTIFACT_TREE_IDENTITY_FILES = Object.freeze([
  "scripts/lib/wakeflow-artifact-tree-identity.mjs",
]);

export const WAKEFLOW_RELEASE_REQUIRED_LEGACY_CLASSIFIER_FILES = Object.freeze([
  "scripts/data/wakeflow-legacy-classifier-catalog.json",
  "scripts/lib/wakeflow-legacy-classifier.mjs",
]);

export const WAKEFLOW_RELEASE_REQUIRED_MIGRATION_INVENTORY_FILES = Object.freeze([
  "scripts/lib/wakeflow-migration-inventory.mjs",
]);

export const WAKEFLOW_RELEASE_REQUIRED_LEGACY_OWNER_DRAIN_FILES = Object.freeze([
  "scripts/lib/wakeflow-legacy-owner-drain.mjs",
]);

export const WAKEFLOW_RELEASE_REQUIRED_LEGACY_ARCHIVE_FILES = Object.freeze([
  "schemas/wakeflow-business-archive/legacy-evidence-summary.schema.json",
  "schemas/wakeflow-business-archive/legacy-source-descriptor.schema.json",
  "schemas/wakeflow-business-archive/legacy-transport-summary.schema.json",
  "schemas/wakeflow-ledger/archive-manifest.schema.json",
  "schemas/wakeflow-maintenance/legacy-archive-transform-plan.schema.json",
  "scripts/lib/wakeflow-ledger-records.mjs",
  "scripts/lib/wakeflow-legacy-archive-records.mjs",
  "scripts/lib/wakeflow-legacy-archive-transform.mjs",
]);

export const WAKEFLOW_RELEASE_REQUIRED_MIGRATION_PLAN_FILES = Object.freeze([
  "scripts/lib/wakeflow-migration-plan.mjs",
]);

export const WAKEFLOW_RELEASE_REQUIRED_MIGRATION_HOST_DECOMMISSION_FILES = Object.freeze([
  "scripts/lib/wakeflow-migration-host-decommission.mjs",
]);

export const WAKEFLOW_RELEASE_REQUIRED_MIGRATION_APPLY_FILES = Object.freeze([
  "bin/wakeflow-bootstrap",
  "schemas/wakeflow-maintenance/maintenance-transaction.schema.json",
  "schemas/wakeflow-maintenance/recovery-claim.schema.json",
  "schemas/wakeflow-maintenance/workspace-mutation-lock.schema.json",
  "scripts/lib/wakeflow-migration-apply.mjs",
  "scripts/lib/wakeflow-migration-config-owner.mjs",
  "scripts/lib/wakeflow-migration-production.mjs",
  "scripts/lib/wakeflow-workspace-mutation.mjs",
  "scripts/wakeflow-bootstrap.mjs",
]);

export const WAKEFLOW_RELEASE_REQUIRED_CODEX_MIGRATION_DECOMMISSION_FILES = Object.freeze([
  "scripts/lib/wakeflow-codex-migration-decommission.mjs",
]);

export const WAKEFLOW_RELEASE_REQUIRED_CODEX_MIGRATION_EFFECT_FILES = Object.freeze([
  "scripts/lib/wakeflow-codex-migration-effect.mjs",
]);

export const WAKEFLOW_RELEASE_REQUIRED_CLAUDE_MIGRATION_DECOMMISSION_FILES = Object.freeze([
  "scripts/lib/wakeflow-claude-migration-decommission.mjs",
]);

export const WAKEFLOW_RELEASE_REQUIRED_CLAUDE_MIGRATION_EFFECT_FILES = Object.freeze([
  "scripts/lib/wakeflow-claude-migration-effect.mjs",
]);

export const WAKEFLOW_RELEASE_REQUIRED_MAINTENANCE_PLAN_FILES = Object.freeze([
  "schemas/wakeflow-maintenance/workspace-maintenance-plan.schema.json",
  "scripts/lib/wakeflow-active-foundation.mjs",
  "scripts/lib/wakeflow-config-v3-owner.mjs",
  "scripts/lib/wakeflow-config-v3-transition-authority.mjs",
  "scripts/lib/wakeflow-fresh-initialize.mjs",
  "scripts/lib/wakeflow-host-settings-assets-owner.mjs",
  "scripts/lib/wakeflow-ledger-materialization.mjs",
  "scripts/lib/wakeflow-ledger-projector.mjs",
  "scripts/lib/wakeflow-local-layout-inspection.mjs",
  "scripts/lib/wakeflow-local-layout-realization.mjs",
  "scripts/lib/wakeflow-managed-content.mjs",
  "scripts/lib/wakeflow-maintenance-action-composition.mjs",
  "scripts/lib/wakeflow-maintenance-plan.mjs",
  "scripts/lib/wakeflow-observability-v3.mjs",
  "scripts/lib/wakeflow-reconcile.mjs",
  "scripts/lib/wakeflow-reconfigure.mjs",
  "scripts/lib/wakeflow-support-materialization.mjs",
  "scripts/lib/wakeflow-support-surface-owner.mjs",
  "scripts/lib/wakeflow-tracked-materialization.mjs",
]);

export const WAKEFLOW_RELEASE_REQUIRED_PUBLIC_V3_SURFACE_FILES = Object.freeze([
  "lib/wakeflow-mcp-tools.mjs",
  "scripts/lib/wakeflow-maintenance-action-runtime.mjs",
  "scripts/lib/wakeflow-maintenance-coordinator.mjs",
  "scripts/lib/wakeflow-public-v3-runtime.mjs",
  "scripts/wakeflow-cli.mjs",
  "scripts/wakeflow-setup.mjs",
  "scripts/wakeflow-smoke.mjs",
  "scripts/wakeflow-validate.mjs",
]);

export const WAKEFLOW_RELEASE_REQUIRED_WINDOW_RUNTIME_FILES = Object.freeze([
  "schemas/wakeflow-window-runtime/window-runtime.schema.json",
  "scripts/lib/wakeflow-window-runtime-projector.mjs",
  "scripts/lib/wakeflow-window-runtime-records.mjs",
]);

// 共享集合只表达两个安装包都必须发布的字节，不包含 edition-owned manifest 与宿主实现。
const SHARED_REQUIRED_FILES = Object.freeze([
  "package.json",
  ".mcp.json",
  "scripts/wakeflow-core-manifest.json",
  "scripts/lib/wakeflow-canonical-json.mjs",
  "scripts/lib/wakeflow-template-renderer.mjs",
  ...WAKEFLOW_RELEASE_REQUIRED_DEMAND_ARTIFACT_FILES,
  ...WAKEFLOW_RELEASE_REQUIRED_DEMAND_LIFECYCLE_FILES,
  ...WAKEFLOW_RELEASE_REQUIRED_EVIDENCE_FILES,
  ...WAKEFLOW_RELEASE_REQUIRED_ACTIVE_PROJECTION_FILES,
  ...WAKEFLOW_RELEASE_REQUIRED_BUSINESS_ARCHIVE_FILES,
  ...WAKEFLOW_RELEASE_REQUIRED_WINDOW_BINDING_FILES,
  ...WAKEFLOW_RELEASE_REQUIRED_HOST_DECOMMISSION_FILES,
  ...WAKEFLOW_RELEASE_REQUIRED_HOST_ACTIVATION_SCOPE_FILES,
  ...WAKEFLOW_RELEASE_REQUIRED_WINDOW_COORDINATION_LEASE_FILES,
  ...WAKEFLOW_RELEASE_REQUIRED_POD_FILES,
  ...WAKEFLOW_RELEASE_REQUIRED_KEEP_LIVE_FILES,
  ...WAKEFLOW_RELEASE_REQUIRED_TRANSPORT_FILES,
  ...WAKEFLOW_RELEASE_REQUIRED_PRESERVATION_FILES,
  ...WAKEFLOW_RELEASE_REQUIRED_ARTIFACT_TREE_IDENTITY_FILES,
  ...WAKEFLOW_RELEASE_REQUIRED_LEGACY_CLASSIFIER_FILES,
  ...WAKEFLOW_RELEASE_REQUIRED_MIGRATION_INVENTORY_FILES,
  ...WAKEFLOW_RELEASE_REQUIRED_LEGACY_OWNER_DRAIN_FILES,
  ...WAKEFLOW_RELEASE_REQUIRED_LEGACY_ARCHIVE_FILES,
  ...WAKEFLOW_RELEASE_REQUIRED_MIGRATION_PLAN_FILES,
  ...WAKEFLOW_RELEASE_REQUIRED_MIGRATION_HOST_DECOMMISSION_FILES,
  ...WAKEFLOW_RELEASE_REQUIRED_MIGRATION_APPLY_FILES,
  ...WAKEFLOW_RELEASE_REQUIRED_MAINTENANCE_PLAN_FILES,
  ...WAKEFLOW_RELEASE_REQUIRED_PUBLIC_V3_SURFACE_FILES,
  ...WAKEFLOW_RELEASE_REQUIRED_WINDOW_RUNTIME_FILES,
  ...WAKEFLOW_RELEASE_REQUIRED_SKILL_FILES,
  "templates/wakeflow-asset-bundle.json",
]);

// ==================== 四、双宿主最终包合同 ====================

export const WAKEFLOW_RELEASE_PACKAGING_CONTRACTS = Object.freeze({
  codex: Object.freeze({
    hostId: "codex",
    workspace: "wakeflow",
    manifest: ".codex-plugin/plugin.json",
    requiredFiles: Object.freeze([
      ...SHARED_REQUIRED_FILES,
      ...WAKEFLOW_RELEASE_REQUIRED_CODEX_DECOMMISSION_FILES,
      ...WAKEFLOW_RELEASE_REQUIRED_CODEX_MIGRATION_DECOMMISSION_FILES,
      ...WAKEFLOW_RELEASE_REQUIRED_CODEX_MIGRATION_EFFECT_FILES,
      ...WAKEFLOW_RELEASE_REQUIRED_CODEX_ACTIVATION_SCOPE_FILES,
      ".codex-plugin/plugin.json",
      "scripts/lib/wakeflow-codex-pod-host.mjs",
    ].sort()),
    forbiddenPrefixes: Object.freeze(["template-sources/", "core/template-sources/"]),
  }),
  "claude-code": Object.freeze({
    hostId: "claude-code",
    workspace: "claude-code-wakeflow",
    manifest: ".claude-plugin/plugin.json",
    requiredFiles: Object.freeze([
      ...SHARED_REQUIRED_FILES,
      ...WAKEFLOW_RELEASE_REQUIRED_CLAUDE_LOCATOR_FILES,
      ...WAKEFLOW_RELEASE_REQUIRED_CLAUDE_LIFECYCLE_FILES,
      ...WAKEFLOW_RELEASE_REQUIRED_CLAUDE_DECOMMISSION_FILES,
      ...WAKEFLOW_RELEASE_REQUIRED_CLAUDE_MIGRATION_DECOMMISSION_FILES,
      ...WAKEFLOW_RELEASE_REQUIRED_CLAUDE_MIGRATION_EFFECT_FILES,
      ...WAKEFLOW_RELEASE_REQUIRED_CLAUDE_ACTIVATION_SCOPE_FILES,
      ...WAKEFLOW_RELEASE_REQUIRED_CLAUDE_ACTIVITY_FILES,
      ...WAKEFLOW_RELEASE_REQUIRED_CLAUDE_SETTINGS_FILES,
      ...WAKEFLOW_RELEASE_REQUIRED_CLAUDE_TRANSPORT_FILES,
      ".claude-plugin/plugin.json",
      "scripts/lib/wakeflow-claude-pod-host.mjs",
    ].sort()),
    forbiddenPrefixes: Object.freeze(["template-sources/", "core/template-sources/"]),
  }),
});

const MAX_PACK_REPORT_ENTRIES = 100_000;

// hostId 是协议词汇；未知宿主不能静默回退到任一现有安装包。
function contractForHost(hostId) {
  if (typeof hostId !== "string" || !Object.hasOwn(WAKEFLOW_RELEASE_PACKAGING_CONTRACTS, hostId)) {
    const label = typeof hostId === "string" ? hostId : "(invalid)";
    throw new Error(`unknown Wakeflow release packaging host ${label}`);
  }
  const contract = WAKEFLOW_RELEASE_PACKAGING_CONTRACTS[hostId];
  return contract;
}

function passivePlainRecord(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

// 只读取own enumerable data property，避免发布准入过程执行调用方getter。
function passiveField(record, key, { required = false } = {}) {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (descriptor === undefined) {
    if (required) throw new TypeError(`release packaging input is missing ${key}`);
    return undefined;
  }
  if (!descriptor.enumerable || !Object.hasOwn(descriptor, "value")) {
    throw new TypeError(`release packaging input ${key} must be an enumerable data property`);
  }
  return descriptor.value;
}

// 闭合判定器自己的三项请求字段；领域报告的结构错误则留在结果issues中表达。
function snapshotEvaluationInput(input) {
  if (!passivePlainRecord(input)) {
    throw new TypeError("release packaging evaluation input must be a passive plain object");
  }
  return {
    hostId: passiveField(input, "hostId", { required: true }),
    expectedVersion: passiveField(input, "expectedVersion", { required: true }),
    report: passiveField(input, "report", { required: true }),
  };
}

function canonicalPackPath(value) {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.includes("\0")
    || value.includes("\\")
    || value.startsWith("/")
    || value.endsWith("/")
  ) {
    return false;
  }
  const segments = value.split("/");
  return segments.every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

// 把npm文件数组投影为路径纯数据；稀疏、扩展、accessor或非canonical path均只产生invalid标记。
function snapshotPackPaths(files) {
  if (!Array.isArray(files) || Object.getPrototypeOf(files) !== Array.prototype) {
    return { paths: [], entryCount: 0, invalid: true };
  }
  const lengthDescriptor = Object.getOwnPropertyDescriptor(files, "length");
  if (
    lengthDescriptor === undefined
    || !Object.hasOwn(lengthDescriptor, "value")
    || !Number.isSafeInteger(lengthDescriptor.value)
    || lengthDescriptor.value < 0
    || lengthDescriptor.value > MAX_PACK_REPORT_ENTRIES
  ) {
    return { paths: [], entryCount: 0, invalid: true };
  }
  const entryCount = lengthDescriptor.value;
  const paths = [];
  const ownKeys = Reflect.ownKeys(files);
  let invalid = ownKeys.some((key) => typeof key !== "string")
    || ownKeys.length !== entryCount + 1;
  for (let index = 0; index < entryCount; index += 1) {
    const entryDescriptor = Object.getOwnPropertyDescriptor(files, String(index));
    if (
      entryDescriptor === undefined
      || !entryDescriptor.enumerable
      || !Object.hasOwn(entryDescriptor, "value")
    ) {
      invalid = true;
      continue;
    }
    const entry = entryDescriptor.value;
    if (!passivePlainRecord(entry)) {
      invalid = true;
      continue;
    }
    let filePath;
    try {
      filePath = passiveField(entry, "path", { required: true });
    } catch {
      invalid = true;
      continue;
    }
    if (!canonicalPackPath(filePath)) {
      invalid = true;
      continue;
    }
    paths.push(filePath);
  }
  return { paths, entryCount, invalid };
}

/**
 * 判定一份已解析的 `npm pack --dry-run --json` 单包报告。
 *
 * 输入只允许被动data property；报告不执行任何getter，也不运行npm/Git。输出列出缺失文件、
 * 重复路径、authoring source泄漏与版本漂移，但不签发“可发布”权限，外层仍须完成release gates。
 */
export function evaluateWakeflowPackageReport(input) {
  const { hostId, expectedVersion, report } = snapshotEvaluationInput(input);
  const contract = contractForHost(hostId);
  const issues = [];
  const normalizedExpectedVersion = typeof expectedVersion === "string" && expectedVersion.length > 0
    ? expectedVersion
    : null;
  if (normalizedExpectedVersion === null) {
    issues.push(`${contract.workspace} has no expected release version`);
  }
  if (!passivePlainRecord(report)) {
    issues.push(`${contract.workspace} pack report is missing or invalid`);
    return {
      ok: false,
      hostId,
      workspace: contract.workspace,
      name: null,
      version: null,
      entryCount: 0,
      requiredFiles: contract.requiredFiles,
      issues,
    };
  }
  let reportName;
  let reportVersion;
  let reportEntryCount;
  let reportFiles;
  try {
    reportName = passiveField(report, "name");
    reportVersion = passiveField(report, "version");
    reportEntryCount = passiveField(report, "entryCount");
    reportFiles = passiveField(report, "files");
  } catch {
    issues.push(`${contract.workspace} pack report is missing or invalid`);
    return {
      ok: false,
      hostId,
      workspace: contract.workspace,
      name: null,
      version: null,
      entryCount: 0,
      requiredFiles: contract.requiredFiles,
      issues,
    };
  }
  const normalizedReportName = typeof reportName === "string" ? reportName : null;
  const normalizedReportVersion = typeof reportVersion === "string" ? reportVersion : null;
  if (normalizedReportName !== contract.workspace) {
    issues.push(`${contract.workspace} pack name ${normalizedReportName ?? "(missing)"} does not match ${contract.workspace}`);
  }
  if (
    normalizedExpectedVersion !== null
    && normalizedReportVersion !== normalizedExpectedVersion
  ) {
    issues.push(`${contract.workspace} pack version ${normalizedReportVersion ?? "(missing)"} does not match ${normalizedExpectedVersion}`);
  }
  const pathSnapshot = snapshotPackPaths(reportFiles);
  const { paths } = pathSnapshot;
  const files = new Set(paths);
  if (pathSnapshot.invalid || paths.length !== pathSnapshot.entryCount) {
    issues.push(`${contract.workspace} pack report contains an invalid file entry`);
  }
  if (
    !Number.isSafeInteger(reportEntryCount)
    || reportEntryCount < 0
    || reportEntryCount !== pathSnapshot.entryCount
  ) {
    issues.push(`${contract.workspace} pack entryCount does not match its files array`);
  }
  if (files.size !== paths.length) issues.push(`${contract.workspace} pack report contains duplicate file paths`);
  for (const required of contract.requiredFiles) {
    if (!files.has(required)) issues.push(`${contract.workspace} pack is missing ${required}`);
  }
  for (const prefix of contract.forbiddenPrefixes) {
    const leaked = paths.find((file) => file === prefix.slice(0, -1) || file.startsWith(prefix));
    if (leaked) issues.push(`${contract.workspace} pack publishes authoring-only source ${leaked}`);
  }
  return {
    ok: issues.length === 0,
    hostId,
    workspace: contract.workspace,
    name: normalizedReportName,
    version: normalizedReportVersion,
    entryCount: pathSnapshot.entryCount,
    requiredFiles: contract.requiredFiles,
    issues,
  };
}

// 供release checker读取冻结合同；调用者不得修改或把它提升为运行时host选择器。
export function wakeflowReleasePackagingContract(hostId) {
  return contractForHost(hostId);
}
