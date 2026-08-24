import {
  lstatSync,
  realpathSync,
} from "node:fs";
import path from "node:path";

import { canonicalJsonDigest } from "./wakeflow-canonical-json.mjs";
import {
  buildWakeflowConfigV3Indexes,
  parseWakeflowConfigV3,
  WAKEFLOW_ACTIVE_ROOT,
  WAKEFLOW_LOCAL_ROOT,
  wakeflowConfigV3Digest,
} from "./wakeflow-config-v3.mjs";
import { wakeflowDemandCapabilityRoots } from "./wakeflow-demand-layout.mjs";
import { normalizeWakeflowHostCapabilityProfile } from "./wakeflow-host-capability.mjs";

/**
 * 把严格 v3 config 与静态 host capability 编译为一份不可变的“期望布局目录”。
 *
 * 这里登记的是路径、唯一 writer、authority 类型和生命周期，不证明对应文件已经
 * 存在，也不获得任何写入权限。initialize、migration、reconcile、observability 等
 * consumer 可以共享这份目录，但真实事实仍只能由各 domain owner 在自己的锁、
 * journal 和校验边界内创建。
 *
 * 阅读导航：addHostRuntimeEntries 编译当前宿主的适用表面；
 * addConfiguredPlacementEntries 编译 ledger、support 与 repository；
 * addWorkspaceAndSharedEntries 编译 workspace、active、local/shared 与 demand event；
 * createWakeflowLayoutDescriptor 只做确定性汇总与摘要；query 方法只筛选目录项；
 * validateWakeflowLayoutPlacements 才读取文件系统，但仍只是 placement admission，
 * 不创建目录、不判断业务完成，也不成为任何 domain writer。
 */
const WORKSPACE_CONFIG = "wakeflow.config.json";
const ACTIVE_CURRENT = `${WAKEFLOW_ACTIVE_ROOT}/current`;
const LOCAL_RUNTIME = `${WAKEFLOW_LOCAL_ROOT}/runtime`;
const LOCAL_SHARED = `${LOCAL_RUNTIME}/shared`;
const LOCAL_AUDIT = `${WAKEFLOW_LOCAL_ROOT}/audit`;

// ==================== 一、Descriptor 数据合同与登记原语 ====================

/**
 * Layout 编译与 placement admission 的稳定错误类型。
 */
export class WakeflowLayoutError extends Error {
  constructor(code, message, { path: errorPath = "$", details = {} } = {}) {
    super(message);
    this.name = "WakeflowLayoutError";
    this.code = code;
    this.path = errorPath;
    this.details = details;
  }
}

// 使用稳定 code/path 拒绝重复 key、非法 descriptor 或不安全 placement。
function fail(code, errorPath, message, details = {}) {
  throw new WakeflowLayoutError(code, `${message} at ${errorPath}`, {
    path: errorPath,
    details,
  });
}

// 深冻结 descriptor 与查询结果依赖的数据，防止 consumer 改写期望布局。
function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

// 只在 portable path 词汇中拼接 descriptor 路径，不触碰主机文件系统。
function portableJoin(...parts) {
  return path.posix.join(...parts);
}

// 为未显式声明的 entry 字段应用协议默认值；业务 authority/lifecycle 应由 caller 覆盖。
function entryDefaults(entry) {
  const local = entry.path === WAKEFLOW_LOCAL_ROOT || entry.path.startsWith(`${WAKEFLOW_LOCAL_ROOT}/`);
  const file = entry.pathKind === "file" || entry.pathKind === "pattern";
  // 默认值只描述没有特殊语义的静态表面；业务 entry 应显式声明自己的 owner、
  // authority 和 lifecycle，避免下游把泛化的 “wakeflow” 当成真实写入者。
  return {
    scope: "host-neutral",
    owner: "wakeflow",
    authority: "none",
    lifecycle: "managed-static",
    tracking: local ? "ignored-local" : "tracked",
    mode: local ? (file ? "0600" : "0700") : (file ? "0644" : "0755"),
    createTiming: "fresh",
    condition: null,
    capability: null,
    allowDescendants: false,
    ...entry,
  };
}

// 按唯一 key 登记一项完整 descriptor entry，并立即应用默认值和冻结。
function addEntry(entries, keys, entry) {
  if (keys.has(entry.key)) {
    fail("wakeflow-layout-duplicate-key", entry.key, `duplicate layout key ${entry.key}`);
  }
  keys.add(entry.key);
  entries.push(deepFreeze(entryDefaults(entry)));
}

// ==================== 二、当前宿主 Runtime 表面 ====================

// 根据静态 capability applicability 编译 host-local identity、projection、evidence 与 operation 表面。
function addHostRuntimeEntries(add, model, profile) {
  const hostRoot = `${LOCAL_RUNTIME}/hosts/${profile.hostDirName}`;
  const operations = `${hostRoot}/operations`;

  add({
    key: "local.host.root",
    path: hostRoot,
    pathKind: "directory",
    scope: "current-host",
    owner: "layout-manager",
  });
  // applicable 决定该 host 是否拥有这类协议表面；realization 只说明宿主如何实现，
  // 不能让不适用能力以“待创建”路径混入全局 descriptor。
  if (profile.capabilities.identity.applicable) {
    add({
      key: "local.host.identity",
      path: `${hostRoot}/identity/window-bindings`,
      pathKind: "directory",
      scope: "current-host",
      owner: "window-registration-service",
      capability: "identity",
      condition: "host-capability-applicable",
    });
  }
  add({
    key: "local.host.projections.window-runtime",
    path: `${hostRoot}/projections/window-runtime`,
    pathKind: "directory",
    scope: "current-host",
    owner: "runtime-projection-builder",
    authority: "projection",
  });
  for (const window of model.topology.windows) {
    add({
      key: `local.host.projections.window-runtime.${window.windowId}`,
      path: `${hostRoot}/projections/window-runtime/${window.windowId}.json`,
      pathKind: "file",
      scope: "current-host",
      owner: "runtime-projection-builder",
      authority: "projection",
      lifecycle: "deterministic-projection",
    });
  }

  if (profile.capabilities.pod.applicable) {
    add({
      key: "local.host.evidence.pods",
      path: `${hostRoot}/evidence/pods`,
      pathKind: "directory",
      scope: "current-host",
      owner: "core-pod-service",
      capability: "pod",
      condition: "host-capability-applicable",
      lifecycle: "static-capability-root",
    });
  }

  if (profile.capabilities.keepLive.applicable) {
    add({
      key: "local.host.operations.keep-live",
      path: `${operations}/keep-live`,
      pathKind: "directory",
      scope: "current-host",
      owner: "keep-live-manager",
      capability: "keepLive",
      condition: "host-capability-applicable",
    });
    add({
      key: "local.host.operations.keep-live.leases",
      path: `${operations}/keep-live/leases`,
      pathKind: "directory",
      scope: "current-host",
      owner: "keep-live-manager",
      capability: "keepLive",
      condition: "host-capability-applicable",
    });
  }

  if (profile.capabilities.locator.applicable) {
    add({
      key: "local.host.operations.window-locators",
      path: `${operations}/window-locators`,
      pathKind: "directory",
      scope: "current-host",
      owner: "host-lifecycle-adapter",
      capability: "locator",
      condition: "host-capability-applicable",
    });
  }

  if (profile.capabilities.assets.applicable) {
    add({
      key: "local.host.operations.assets",
      path: `${operations}/assets`,
      pathKind: "directory",
      scope: "current-host",
      owner: "host-settings-assets-owner",
      capability: "assets",
      condition: "host-capability-applicable",
    });
    add({
      key: "local.host.operations.assets.statusline",
      path: `${operations}/assets/${profile.capabilities.assets.statuslineFileName}`,
      pathKind: "file",
      scope: "current-host",
      owner: "host-settings-assets-owner",
      capability: "assets",
      condition: "host-capability-applicable",
      lifecycle: "deterministic-managed-asset",
    });
  }

  if (profile.capabilities.activity.applicable) {
    add({
      key: "local.host.operations.activity-monitor",
      path: `${operations}/activity-monitor`,
      pathKind: "directory",
      scope: "current-host",
      owner: "activity-monitor-manager",
      capability: "activity",
      condition: "host-capability-applicable",
    });
  }

  if (profile.capabilities.temp.applicable) {
    add({
      key: "local.host.operations.temp.prompts",
      path: `${operations}/temp/prompts`,
      pathKind: "directory",
      scope: "current-host",
      owner: "secure-temp-operation-owner",
      capability: "temp",
      condition: "host-capability-applicable",
      lifecycle: "static-secure-fallback-root",
    });
  }

  const event = (entry) => add({
    pathKind: "file",
    scope: "current-host",
    lifecycle: "event-fact",
    createTiming: "event-only",
    ...entry,
  });
  if (profile.capabilities.identity.applicable) {
    event({
      key: "event.identity.binding",
      path: `${hostRoot}/identity/window-bindings/{windowId}.json`,
      owner: "window-registration-service",
      capability: "identity",
      authority: "host-identity",
    });
  }
  if (profile.capabilities.pod.applicable) {
    event({
      key: "event.pod.root",
      path: `${hostRoot}/evidence/pods/{podId}`,
      pathKind: "directory",
      owner: "core-pod-service",
      capability: "pod",
      authority: "host-evidence",
    });
    event({
      key: "event.pod.scope",
      path: `${hostRoot}/evidence/pods/{podId}/pod-scope.json`,
      owner: "core-pod-service",
      capability: "pod",
      authority: "host-evidence",
    });
    event({
      key: "event.pod.binding.creation-receipt",
      path: `${hostRoot}/evidence/pods/{podId}/bindings/{windowId}/creation-receipt.json`,
      owner: "core-pod-service",
      capability: "pod",
      authority: "host-evidence",
    });
    event({
      key: "event.pod.binding.resume-observation",
      path: `${hostRoot}/evidence/pods/{podId}/bindings/{windowId}/resume-observations/{observationId}.json`,
      owner: "core-pod-service",
      capability: "pod",
      authority: "host-evidence",
    });
    event({
      key: "event.pod.test-access.plan",
      path: `${hostRoot}/evidence/pods/{podId}/test-access/{probeId}/plan.json`,
      owner: "core-pod-service",
      capability: "pod",
      authority: "host-evidence",
    });
    event({
      key: "event.pod.test-access.receipt",
      path: `${hostRoot}/evidence/pods/{podId}/test-access/{probeId}/receipt.json`,
      owner: "core-pod-service",
      capability: "pod",
      authority: "host-evidence",
    });
    event({
      key: "event.pod.close.intent",
      path: `${hostRoot}/evidence/pods/{podId}/close/{closeOperationId}/intent.json`,
      owner: "core-pod-service",
      capability: "pod",
      authority: "host-evidence",
    });
    event({
      key: "event.pod.close.receipt",
      path: `${hostRoot}/evidence/pods/{podId}/close/{closeOperationId}/receipt.json`,
      owner: "core-pod-service",
      capability: "pod",
      authority: "host-evidence",
    });
    event({
      key: "event.pod.launch-intent",
      path: `${hostRoot}/evidence/pods/{podId}/launch-intents/{launchOperationId}.json`,
      owner: "core-pod-service",
      capability: "pod",
      authority: "host-evidence",
    });
    event({
      key: "event.pod.materialization",
      path: `${hostRoot}/evidence/pods/{podId}/materialization/{launchOperationId}/events/{eventId}.json`,
      owner: "core-pod-service",
      capability: "pod",
      authority: "host-evidence",
    });
  }
  if (profile.capabilities.keepLive.applicable) {
    for (const [key, relative] of [
      ["event.keep-live.lease", "leases/{automationRunId}.json"],
      ["event.keep-live.process", "process.json"],
      ["event.keep-live.control", "control.json"],
      ["event.keep-live.manager-lock", "manager.lock"],
    ]) {
      event({
        key,
        path: `${operations}/keep-live/${relative}`,
        owner: "keep-live-manager",
        capability: "keepLive",
        authority: "host-operation",
      });
    }
  }
  if (profile.capabilities.locator.applicable) {
    event({
      key: "event.host.locator",
      path: `${operations}/window-locators/{windowId}.json`,
      owner: "host-lifecycle-adapter",
      capability: "locator",
      authority: "host-operation",
    });
    event({
      key: "event.host.locator-lock",
      path: `${operations}/window-locators/{windowId}.lock`,
      owner: "host-lifecycle-adapter",
      capability: "locator",
      authority: "host-operation",
    });
  }
  if (profile.capabilities.activity.applicable) {
    event({
      key: "event.host.activity-process",
      path: `${operations}/activity-monitor/{serverContextId}/process.json`,
      owner: "activity-monitor-manager",
      capability: "activity",
      authority: "host-operation",
    });
    event({
      key: "event.host.activity-manager-lock",
      path: `${operations}/activity-monitor/{serverContextId}/manager.lock`,
      owner: "activity-monitor-manager",
      capability: "activity",
      authority: "host-operation",
    });
  }
  if (profile.capabilities.temp.applicable) {
    event({
      key: "event.host.temp-prompt",
      path: `${operations}/temp/prompts/{operationId}.txt`,
      owner: "secure-temp-operation-owner",
      capability: "temp",
      authority: "host-operation",
    });
  }
}

// 为适用宿主登记 portable/local settings 的 mixed-owned component，不负责写入设置内容。
function addHostSettingsEntries(add, {
  keyPrefix,
  root = ".",
  profile,
  condition = null,
  localCondition = "local-settings-ignore-proven",
}) {
  if (!profile.capabilities.settings.applicable) return;
  for (const [name, relative] of Object.entries(profile.capabilities.settings.paths)) {
    const settingCondition = name === "local" ? localCondition : condition;
    add({
      key: `${keyPrefix}.settings.${name}`,
      path: portableJoin(root, relative),
      pathKind: "file",
      scope: "current-host",
      owner: "host-settings-plan",
      lifecycle: "mixed-owned-managed-component",
      tracking: name === "portable" ? "tracked-mixed-owned" : "ignored-mixed-owned",
      createTiming: settingCondition ? "conditional" : "current-host",
      condition: settingCondition,
      capability: "settings",
    });
  }
}

// ==================== 三、配置声明的 Ledger、Support 与 Repository 放置 ====================

// 编译 config placement 及其 event pattern，并返回供摘要绑定的稳定 modelRefs。
function addConfiguredPlacementEntries(add, model, profile, indexes) {
  const ledger = model.storage.ledgerRoot;
  add({ key: "ledger.root", path: ledger, pathKind: "directory", owner: "ledger-service", authority: "durable-authority" });
  add({ key: "ledger.requirements", path: portableJoin(ledger, "requirement-designs"), pathKind: "directory", owner: "requirement-promotion-service", authority: "durable-authority" });
  add({ key: "ledger.requirements.index", path: portableJoin(ledger, "requirement-designs/index.md"), pathKind: "file", owner: "ledger-projector", authority: "projection", lifecycle: "deterministic-projection" });
  add({ key: "ledger.goal-stage", path: portableJoin(ledger, "goal-stage-confirmation"), pathKind: "directory", owner: "confirmation-service", authority: "durable-authority" });
  add({ key: "ledger.goal-stage.index", path: portableJoin(ledger, "goal-stage-confirmation/index.md"), pathKind: "file", owner: "ledger-projector", authority: "projection", lifecycle: "deterministic-projection" });
  add({ key: "ledger.workspace", path: portableJoin(ledger, "workspace"), pathKind: "directory", owner: "layout-manager", authority: "none", lifecycle: "static-capability-root" });
  add({ key: "ledger.workspace.record-map", path: portableJoin(ledger, "workspace/workspace-record-map.md"), pathKind: "file", owner: "ledger-projector", authority: "projection", lifecycle: "deterministic-projection" });
  add({ key: "ledger.workspace.archive", path: portableJoin(ledger, "workspace/archive"), pathKind: "directory", owner: "archive-service", authority: "durable-authority" });
  add({ key: "ledger.workspace.archive.index", path: portableJoin(ledger, "workspace/archive/index.md"), pathKind: "file", owner: "ledger-projector", authority: "projection", lifecycle: "deterministic-projection" });

  const ledgerEvent = (entry) => add({
    pathKind: "file",
    owner: "ledger-service",
    authority: "durable-authority",
    lifecycle: "event-fact",
    createTiming: "event-only",
    ...entry,
  });
  ledgerEvent({
    key: "event.ledger.requirement.root",
    path: portableJoin(ledger, "requirement-designs/{requirementId}"),
    pathKind: "directory",
    owner: "requirement-promotion-service",
  });
  ledgerEvent({
    key: "event.ledger.requirement.record",
    path: portableJoin(ledger, "requirement-designs/{requirementId}/record.json"),
    owner: "requirement-promotion-service",
  });
  ledgerEvent({
    key: "event.ledger.requirement.document",
    path: portableJoin(ledger, "requirement-designs/{requirementId}/{documentPath}"),
    owner: "requirement-promotion-service",
    allowDescendants: true,
  });
  ledgerEvent({
    key: "event.ledger.confirmation.root",
    path: portableJoin(ledger, "goal-stage-confirmation/{confirmationId}"),
    pathKind: "directory",
    owner: "confirmation-service",
  });
  ledgerEvent({
    key: "event.ledger.confirmation.record",
    path: portableJoin(ledger, "goal-stage-confirmation/{confirmationId}/record.json"),
    owner: "confirmation-service",
  });
  ledgerEvent({
    key: "event.ledger.confirmation.document",
    path: portableJoin(ledger, "goal-stage-confirmation/{confirmationId}/{documentPath}"),
    owner: "confirmation-service",
    allowDescendants: true,
  });
  ledgerEvent({
    key: "event.ledger.archive.root",
    path: portableJoin(ledger, "workspace/archive/{yearMonth}/{archiveId}"),
    pathKind: "directory",
    owner: "archive-service",
  });
  ledgerEvent({
    key: "event.ledger.archive.manifest",
    path: portableJoin(ledger, "workspace/archive/{yearMonth}/{archiveId}/archive-manifest.json"),
    owner: "archive-service",
  });
  ledgerEvent({
    key: "event.ledger.archive.payload",
    path: portableJoin(ledger, "workspace/archive/{yearMonth}/{archiveId}/{memberPath}"),
    owner: "archive-service",
    allowDescendants: true,
  });

  for (const surface of model.topology.supportSurfaces) {
    const prefix = `support.${surface.surfaceId}`;
    const wakeflowOwned = surface.ownership === "wakeflow-managed";
    add({
      key: `${prefix}.root`,
      path: surface.path,
      pathKind: "directory",
      owner: wakeflowOwned ? "wakeflow-support-surface" : "external-support-owner",
      tracking: wakeflowOwned ? "tracked" : "external-owned",
      createTiming: wakeflowOwned ? "conditional" : "reference-only",
      condition: wakeflowOwned ? "support-surface-wakeflow-managed" : null,
    });
    if (wakeflowOwned) {
      add({
        key: `${prefix}.memory`,
        path: portableJoin(surface.path, profile.memoryFile),
        pathKind: "file",
        scope: "current-host",
        owner: "instruction-renderer",
        lifecycle: "managed-whole-file",
        createTiming: "current-host",
      });
      if (profile.capabilities.settings.applicable) {
        add({
          key: `${prefix}.gitignore`,
          path: portableJoin(surface.path, ".gitignore"),
          pathKind: "file",
          scope: "current-host",
          owner: "ignore-plan",
          lifecycle: "mixed-owned-managed-block",
          tracking: "tracked-mixed-owned",
          createTiming: "conditional",
          condition: "distinct-ignore-root-authorized",
          capability: "settings",
        });
      }
      if (surface.capability === "design") {
        add({ key: `${prefix}.drafts`, path: portableJoin(surface.path, "drafts"), pathKind: "directory", owner: "design-surface" });
      }
      if (surface.capability === "test") {
        add({ key: `${prefix}.harnesses`, path: portableJoin(surface.path, "harnesses"), pathKind: "directory", owner: "test-surface" });
        add({ key: `${prefix}.fixtures`, path: portableJoin(surface.path, "fixtures"), pathKind: "directory", owner: "test-surface" });
      }
      addHostSettingsEntries(add, { keyPrefix: prefix, root: surface.path, profile });
    } else if (surface.instructionManagement === "managed-block") {
      add({
        key: `${prefix}.memory`,
        path: portableJoin(surface.path, profile.memoryFile),
        pathKind: "file",
        scope: "current-host",
        owner: "instruction-renderer",
        lifecycle: "mixed-owned-managed-block",
        tracking: "external-owned",
        createTiming: "conditional",
        condition: "instruction-management-managed-block",
      });
    }
  }

  for (const repository of model.topology.repositories) {
    const prefix = `repository.${repository.repositoryId}`;
    add({
      key: `${prefix}.root`,
      path: repository.path,
      pathKind: "directory",
      owner: "repository-owner",
      tracking: "external-owned",
      createTiming: "reference-only",
    });
    if (repository.instructionManagement === "managed-block") {
      add({
        key: `${prefix}.memory`,
        path: portableJoin(repository.path, profile.memoryFile),
        pathKind: "file",
        scope: "current-host",
        owner: "instruction-renderer",
        lifecycle: "mixed-owned-managed-block",
        tracking: "external-owned",
        createTiming: "conditional",
        condition: "instruction-management-managed-block",
      });
    }
    if (profile.capabilities.settings.applicable) {
      add({
        key: `${prefix}.gitignore`,
        path: portableJoin(repository.path, ".gitignore"),
        pathKind: "file",
        scope: "current-host",
        owner: "ignore-plan",
        lifecycle: "mixed-owned-managed-block",
        tracking: "tracked-mixed-owned",
        createTiming: "conditional",
        condition: "explicit-product-host-surface-authorization",
        capability: "settings",
      });
    }
    addHostSettingsEntries(add, {
      keyPrefix: prefix,
      root: repository.path,
      profile,
      condition: "explicit-product-host-surface-authorization",
      localCondition: "explicit-product-host-surface-authorization+local-settings-ignore-proven",
    });
  }

  return {
    repositories: model.topology.repositories.map((entry) => entry.repositoryId),
    supportSurfaces: {
      design: indexes.designWindow.root.surfaceId,
      test: indexes.testWindow.root.surfaceId,
    },
    windows: model.topology.windows.map((entry) => entry.windowId),
  };
}

// ==================== 四、Workspace、Active、Local 与 Shared 事件表面 ====================

// 编译固定协议根、共享运行能力与 demand 事件模式；event-only 项不会被初始化器物化。
function addWorkspaceAndSharedEntries(add, model, profile) {
  add({ key: "workspace.config", path: WORKSPACE_CONFIG, pathKind: "file", owner: "config-service", authority: "durable-intent" });
  add({ key: "workspace.memory", path: profile.memoryFile, pathKind: "file", scope: "current-host", owner: "instruction-renderer", lifecycle: "managed-whole-file", createTiming: "current-host" });
  add({ key: "workspace.gitignore", path: ".gitignore", pathKind: "file", owner: "ignore-plan", lifecycle: "mixed-owned-managed-block", tracking: "tracked-mixed-owned" });
  addHostSettingsEntries(add, { keyPrefix: "workspace", profile });

  add({ key: "active.root", path: WAKEFLOW_ACTIVE_ROOT, pathKind: "directory", owner: "layout-manager", authority: "active-authority", tracking: "ignored" });
  add({ key: "active.index", path: `${WAKEFLOW_ACTIVE_ROOT}/index.md`, pathKind: "file", owner: "active-projector", authority: "projection", lifecycle: "deterministic-projection", tracking: "ignored", mode: "0600" });
  add({ key: "active.current", path: ACTIVE_CURRENT, pathKind: "directory", owner: "layout-manager", authority: "active-authority", tracking: "ignored" });
  add({ key: "active.current.status", path: `${ACTIVE_CURRENT}/workspace-current-status.md`, pathKind: "file", owner: "active-projector", authority: "projection", lifecycle: "deterministic-projection", tracking: "ignored", mode: "0600" });
  add({ key: "active.current.todo", path: `${ACTIVE_CURRENT}/global-todo-board.md`, pathKind: "file", owner: "todo-service", authority: "pre-demand-authority", tracking: "ignored" });
  add({
    key: "event.active.projector.lock",
    path: `${WAKEFLOW_ACTIVE_ROOT}/projector.lock`,
    pathKind: "file",
    owner: "active-projector",
    authority: "mutation-admission",
    lifecycle: "ephemeral-lock",
    tracking: "ignored",
    mode: "0600",
    createTiming: "event-only",
  });

  add({ key: "local.root", path: WAKEFLOW_LOCAL_ROOT, pathKind: "directory", owner: "layout-manager", tracking: "ignored-local", mode: "0700" });
  add({ key: "local.runtime", path: LOCAL_RUNTIME, pathKind: "directory", owner: "layout-manager" });
  add({ key: "local.maintenance.transactions", path: `${LOCAL_RUNTIME}/maintenance/transactions`, pathKind: "directory", owner: "maintenance-manager", lifecycle: "static-recovery-root" });
  add({ key: "local.shared.transport.demands", path: `${LOCAL_SHARED}/transport/demands`, pathKind: "directory", owner: "delivery-runtime", lifecycle: "static-capability-root" });
  add({ key: "local.shared.coordination.window-leases", path: `${LOCAL_SHARED}/coordination/window-leases`, pathKind: "directory", owner: "lease-manager", lifecycle: "static-capability-root" });
  add({ key: "local.audit.preserved", path: `${LOCAL_AUDIT}/preserved`, pathKind: "directory", owner: "preservation-manager", lifecycle: "static-hold-root" });

  const event = (entry) => add({
    pathKind: "file",
    lifecycle: "event-fact",
    createTiming: "event-only",
    ...entry,
  });
  event({ key: "event.maintenance.lock", path: `${LOCAL_RUNTIME}/maintenance.lock`, owner: "mutation-gate-manager", authority: "runtime-admission" });
  event({
    key: "event.maintenance.lock-publisher-stage",
    path: `${LOCAL_RUNTIME}/.wakeflow-publish.lock.{operationId}.{generation}.{platform}.{pid}.{startIdentity}.{nonce}.stage`,
    owner: "mutation-gate-manager",
    authority: "none",
    lifecycle: "transaction-staging-residue",
  });
  event({ key: "event.maintenance.transaction", path: `${LOCAL_RUNTIME}/maintenance/transactions/{operationId}.json`, owner: "maintenance-manager", authority: "recovery-journal" });
  event({
    key: "event.maintenance.publisher-stage",
    path: `${LOCAL_RUNTIME}/maintenance/transactions/.wakeflow-publish.{artifactKind}.{operationId}.{generation}.{platform}.{pid}.{startIdentity}.{nonce}.stage`,
    owner: "mutation-gate-manager",
    authority: "none",
    lifecycle: "transaction-staging-residue",
  });
  event({
    key: "event.maintenance.transaction-stage",
    path: `${LOCAL_RUNTIME}/maintenance/transactions/.{operationId}.{generation}.checkpoint-stage`,
    owner: "maintenance-manager",
    authority: "none",
    lifecycle: "transaction-staging-residue",
  });
  event({
    key: "event.maintenance.recovery-claim",
    path: `${LOCAL_RUNTIME}/maintenance/transactions/{operationId}.recovery-{generation}.json`,
    owner: "mutation-gate-manager",
    authority: "recovery-arbitration",
  });
  for (const directory of ["groups", "packets", "envelopes", "runs"]) {
    event({
      key: `event.transport.demand.${directory}`,
      path: `${LOCAL_SHARED}/transport/demands/{demandId}/${directory}`,
      pathKind: "directory",
      owner: "delivery-runtime",
      authority: "transport",
    });
  }
  event({ key: "event.transport.group", path: `${LOCAL_SHARED}/transport/demands/{demandId}/groups/{groupId}.json`, owner: "delivery-runtime", authority: "transport" });
  event({ key: "event.transport.packet", path: `${LOCAL_SHARED}/transport/demands/{demandId}/packets/{packetId}.json`, owner: "delivery-runtime", authority: "transport" });
  event({ key: "event.transport.envelope", path: `${LOCAL_SHARED}/transport/demands/{demandId}/envelopes/{deliveryId}.json`, owner: "delivery-runtime", authority: "transport" });
  event({ key: "event.transport.run", path: `${LOCAL_SHARED}/transport/demands/{demandId}/runs/{runId}.json`, owner: "delivery-recorder", authority: "transport" });
  event({ key: "event.coordination.window-lease", path: `${LOCAL_SHARED}/coordination/window-leases/{windowId}.json`, owner: "lease-manager", authority: "runtime-lease" });
  event({ key: "event.audit.manager-lock", path: `${LOCAL_AUDIT}/manager.lock`, owner: "preservation-manager", authority: "runtime-admission" });
  event({ key: "event.audit.preservation.root", path: `${LOCAL_AUDIT}/preserved/{preservationId}`, pathKind: "directory", owner: "preservation-manager", authority: "audit-hold" });
  event({ key: "event.audit.preservation", path: `${LOCAL_AUDIT}/preserved/{preservationId}/preservation.json`, owner: "preservation-manager", authority: "audit-hold" });
  event({
    key: "event.audit.preservation.payload",
    path: `${LOCAL_AUDIT}/preserved/{preservationId}/payload`,
    pathKind: "directory",
    owner: "preservation-manager",
    authority: "audit-hold",
    allowDescendants: true,
  });

  const demandEvent = (entry) => event({
    ...entry,
    tracking: "ignored",
    mode: entry.pathKind === "directory" ? "0700" : "0600",
  });
  // demand 事实全部延迟到真实事件发生后创建；初始化只建立适用的空能力目录，
  // 不能预写 lock、journal、artifact 或任何占位业务记录。
  demandEvent({
    key: "event.demand.publication.identity-lock",
    path: `${WAKEFLOW_ACTIVE_ROOT}/current.identity-lock`,
    owner: "demand-publication-service",
    authority: "mutation-admission",
    lifecycle: "ephemeral-lock",
  });
  demandEvent({
    key: "event.demand.publication.intent",
    path: `${ACTIVE_CURRENT}/{demandId}.create-intent.json`,
    owner: "demand-publication-service",
    authority: "recovery-journal",
    lifecycle: "incomplete-transaction-journal",
  });
  demandEvent({
    key: "event.demand.publication.stage",
    path: `${ACTIVE_CURRENT}/.wakeflow-create-stage-{demandId}`,
    pathKind: "directory",
    owner: "demand-publication-service",
    authority: "none",
    lifecycle: "transaction-staging-residue",
  });
  demandEvent({
    key: "event.demand.publication.create-lock",
    path: `${ACTIVE_CURRENT}/{demandId}.create-lock`,
    owner: "demand-publication-service",
    authority: "mutation-admission",
    lifecycle: "ephemeral-lock",
  });
  demandEvent({
    key: "event.demand.transition.state-lock",
    path: `${ACTIVE_CURRENT}/{demandId}.state-lock`,
    owner: "state-transaction-manager",
    authority: "mutation-admission",
    lifecycle: "ephemeral-lock",
  });
  demandEvent({ key: "event.demand.root", path: `${ACTIVE_CURRENT}/{demandId}`, pathKind: "directory", owner: "demand-service", authority: "active-authority" });
  for (const [key, relative, owner, authority] of [
    ["identity", "demand.json", "demand-service", "demand-identity"],
    ["authority", "demand-authority.json", "demand-authority-service", "demand-authority"],
    ["state", "wakeflow-state.json", "state-reducer", "active-state"],
    ["controller-events", "controller-events.jsonl", "state-transition-service", "transition-audit"],
    ["index", "index.md", "demand-projector", "projection"],
    ["progress", "developer-progress.md", "demand-projector", "projection"],
  ]) {
    demandEvent({
      key: `event.demand.${key}`,
      path: `${ACTIVE_CURRENT}/{demandId}/${relative}`,
      owner,
      authority,
    });
  }
  const demandDirectoryRoots = [];
  const seenDemandDirectoryRoots = new Set();
  for (const leafRoot of wakeflowDemandCapabilityRoots({ mode: "isolated" })) {
    const segments = leafRoot.split("/");
    for (let index = 1; index <= segments.length; index += 1) {
      const relative = segments.slice(0, index).join("/");
      if (seenDemandDirectoryRoots.has(relative)) continue;
      seenDemandDirectoryRoots.add(relative);
      demandDirectoryRoots.push(relative);
    }
  }
  for (const relative of demandDirectoryRoots) {
    demandEvent({
      key: `event.demand.${relative.replaceAll("/", ".")}.root`,
      path: `${ACTIVE_CURRENT}/{demandId}/${relative}`,
      pathKind: "directory",
      owner: "demand-service",
      authority: "active-authority",
    });
  }
  demandEvent({ key: "event.demand.task-package", path: `${ACTIVE_CURRENT}/{demandId}/task-packages/{taskPackageId}.json`, owner: "task-package-service", authority: "task-authority" });
  demandEvent({ key: "event.demand.target-results.target-task-root", path: `${ACTIVE_CURRENT}/{demandId}/target-results/{targetTaskId}`, pathKind: "directory", owner: "result-service", authority: "result-authority" });
  demandEvent({ key: "event.demand.target-result", path: `${ACTIVE_CURRENT}/{demandId}/target-results/{targetTaskId}/{targetResultId}.json`, owner: "result-service", authority: "result-authority" });
  demandEvent({ key: "event.demand.review-candidate", path: `${ACTIVE_CURRENT}/{demandId}/review-candidates/{candidateId}.json`, owner: "review-service", authority: "review-proposal" });
  demandEvent({ key: "event.demand.test-card", path: `${ACTIVE_CURRENT}/{demandId}/test-cards/{testCardId}.json`, owner: "test-card-service", authority: "test-contract" });
  demandEvent({ key: "event.demand.evidence.stage", path: `${ACTIVE_CURRENT}/{demandId}/evidence/.{evidenceId}.wakeflow-stage`, pathKind: "directory", owner: "evidence-importer", authority: "none", lifecycle: "transaction-staging-residue" });
  demandEvent({ key: "event.demand.evidence.artifact-root", path: `${ACTIVE_CURRENT}/{demandId}/evidence/{evidenceId}`, pathKind: "directory", owner: "evidence-importer", authority: "managed-evidence" });
  demandEvent({ key: "event.demand.evidence.manifest", path: `${ACTIVE_CURRENT}/{demandId}/evidence/{evidenceId}/evidence.json`, owner: "evidence-importer", authority: "managed-evidence" });
  demandEvent({ key: "event.demand.evidence.payload", path: `${ACTIVE_CURRENT}/{demandId}/evidence/{evidenceId}/payload`, pathKind: "directory", owner: "evidence-importer", authority: "managed-evidence", allowDescendants: true });
  demandEvent({ key: "event.demand.transaction.create", path: `${ACTIVE_CURRENT}/{demandId}/transactions/create.json`, owner: "demand-publication-service", authority: "recovery-journal", lifecycle: "incomplete-transaction-journal" });
  demandEvent({ key: "event.demand.transaction.state-transition", path: `${ACTIVE_CURRENT}/{demandId}/transactions/state-transition.json`, owner: "state-transaction-manager", authority: "recovery-journal", lifecycle: "incomplete-transaction-journal" });
  demandEvent({ key: "event.demand.transaction.archive", path: `${ACTIVE_CURRENT}/{demandId}/transactions/archive.json`, owner: "archive-service", authority: "recovery-journal", lifecycle: "incomplete-transaction-journal" });
  demandEvent({ key: "event.demand.archive.intent", path: `${ACTIVE_CURRENT}/.{demandId}.wakeflow-archive-intent.json`, owner: "archive-service", authority: "recovery-journal", lifecycle: "incomplete-transaction-journal" });
  // tombstone 是被原子 detach 的原 active source。它本身不是第二 archive
  // authority，也不是可由 generic reconcile 清理的普通 stage；只有 archive owner
  // 在 exact sidecar、ledger authority 与 source inventory 闭合后才能前向清理。
  demandEvent({ key: "event.demand.archive.tombstone", path: `${ACTIVE_CURRENT}/.{demandId}.wakeflow-archive-stage`, pathKind: "directory", owner: "archive-service", authority: "none", lifecycle: "incomplete-transaction-tombstone" });
  demandEvent({ key: "event.demand.pod.design-request", path: `${ACTIVE_CURRENT}/{demandId}/pod/design-requests/{requestId}.json`, owner: "pod-state-service", authority: "pod-authority" });
  demandEvent({ key: "event.demand.pod.design-handoff", path: `${ACTIVE_CURRENT}/{demandId}/pod/design-handoffs/{handoffId}.json`, owner: "pod-state-service", authority: "pod-authority" });
}

/**
 * 纯编译入口：相同 config + host profile 必须得到相同 descriptor 和 digest。
 * 不读文件系统、不创建目录，也不缓存“当前 workspace”状态。
 */
export function createWakeflowLayoutDescriptor({ model, hostProfile }) {
  const normalizedModel = parseWakeflowConfigV3(model);
  const indexes = buildWakeflowConfigV3Indexes(normalizedModel);
  const normalizedProfile = normalizeWakeflowHostCapabilityProfile(hostProfile);
  const entries = [];
  const keys = new Set();
  const add = (entry) => addEntry(entries, keys, entry);

  addWorkspaceAndSharedEntries(add, normalizedModel, normalizedProfile);
  addHostRuntimeEntries(add, normalizedModel, normalizedProfile);
  const modelRefs = addConfiguredPlacementEntries(add, normalizedModel, normalizedProfile, indexes);

  const configDigest = wakeflowConfigV3Digest(normalizedModel);
  const hostNeutralEntries = entries.filter((entry) => entry.scope === "host-neutral");
  // hostNeutralDigest 只随 durable config 与共享路径合同变化；layoutDigest 还绑定
  // 当前 host profile 和 host-only 表面，供计划/快照拒绝跨宿主或过期 descriptor。
  const hostNeutralDigest = canonicalJsonDigest({
    configDigest,
    entries: hostNeutralEntries,
    modelRefs,
  });
  const layoutDigest = canonicalJsonDigest({
    configDigest,
    hostNeutralDigest,
    host: normalizedProfile,
    entries,
    modelRefs,
  });
  return deepFreeze({
    kind: "WakeflowLayoutDescriptor",
    configDigest,
    hostNeutralDigest,
    layoutDigest,
    host: normalizedProfile,
    entries,
    modelRefs,
  });
}

// ==================== 五、Descriptor 查询 ====================

// 只接受本模块形状的 descriptor，查询方法不重新编译或补写条目。
function assertDescriptor(descriptor) {
  if (!descriptor || descriptor.kind !== "WakeflowLayoutDescriptor" || !Array.isArray(descriptor.entries)) {
    fail("wakeflow-layout-descriptor", "$descriptor", "expected a WakeflowLayoutDescriptor");
  }
  return descriptor;
}

/**
 * 按稳定 key 查询一项期望布局；缺失返回 null，不把路径存在性当成查询结果。
 */
export function wakeflowLayoutEntry(descriptor, key) {
  return assertDescriptor(descriptor).entries.find((entry) => entry.key === key) ?? null;
}

/**
 * 只返回真实事件发生时才允许由 owner 创建的事实、锁、journal 与恢复残留。
 */
export function eventOnlyWakeflowLayoutEntries(descriptor) {
  return assertDescriptor(descriptor).entries.filter((entry) => entry.createTiming === "event-only");
}

/**
 * 返回初始化/宿主适用/条件授权阶段可能参与计划的静态表面。
 * reference-only 外部 owner 根与全部 event fact 都不能被初始化器物化。
 */
export function freshWakeflowLayoutEntries(descriptor) {
  return assertDescriptor(descriptor).entries.filter((entry) =>
    entry.createTiming !== "event-only" && entry.createTiming !== "reference-only");
}

// ==================== 六、Root Placement 只读 Admission ====================

function physicalRootEntries(descriptor) {
  // 这里只选择会改变整个 workspace placement 拓扑的根；普通叶子路径允许按
  // descriptor 自然嵌套，不能被根级 overlap 校验误判。
  return descriptor.entries.filter((entry) =>
    entry.pathKind === "directory" && (
      entry.key === "active.root"
      || entry.key === "local.root"
      || entry.key === "ledger.root"
      || /^support\.[^.]+\.root$/u.test(entry.key)
      || /^repository\.[^.]+\.root$/u.test(entry.key)
    ));
}

// 将 descriptor portable path 解析到调用方已经确定的 exact workspace root。
function resolvePortable(workspaceRoot, portablePath) {
  return path.resolve(workspaceRoot, ...portablePath.split("/"));
}

// 计算两个绝对根的 same/contains/inside 关系；无重叠时返回 null。
function relation(left, right) {
  const relative = path.relative(left, right);
  if (relative === "") return "same";
  if (!relative.startsWith("..") && !path.isAbsolute(relative)) return "contains";
  const inverse = path.relative(right, left);
  if (!inverse.startsWith("..") && !path.isAbsolute(inverse)) return "inside";
  return null;
}

// 逐段 lstat 一个配置根，拒绝 symlink/非目录，并为现存根取得 realpath 身份。
function inspectExistingRoot({ absolute, key, traversalRoot = null }) {
  const start = traversalRoot ? path.resolve(traversalRoot) : path.dirname(absolute);
  const relative = path.relative(start, absolute);
  const segments = relative ? relative.split(path.sep) : [];
  let current = start;

  if (segments.length === 0) {
    segments.push(path.basename(absolute));
    current = path.dirname(absolute);
  }

  for (const segment of segments) {
    current = path.resolve(current, segment);
    let stat;
    try {
      // 必须用 lstat 看见 dangling link；existsSync/stat 会隐藏或跟随本应由
      // 这次只读 admission 明确拒绝的路径形状。
      stat = lstatSync(current);
    } catch (cause) {
      if (cause?.code === "ENOENT") {
        return { exists: false, absolute, realPath: null };
      }
      fail("wakeflow-layout-stat", key, `cannot inspect configured root segment: ${cause.message}`, {
        absolute,
        inspectedPath: current,
        causeCode: cause.code ?? null,
      });
    }
    if (stat.isSymbolicLink()) {
      fail("wakeflow-layout-symlink", key, "configured root and its existing path segments must not be symbolic links", {
        absolute,
        symlinkPath: current,
      });
    }
    if (!stat.isDirectory()) {
      fail("wakeflow-layout-type", key, "configured root and its existing ancestors must be directories", {
        absolute,
        inspectedPath: current,
      });
    }
  }
  return { exists: true, absolute, realPath: realpathSync(absolute) };
}

/**
 * 验证 descriptor 的物理根在 lexical 与 realpath 层均不重叠、不经 symlink。
 * 缺失目标根可以作为未来 placement 保留，但本入口从不创建它们。
 */
export function validateWakeflowLayoutPlacements({ workspaceRoot, descriptor }) {
  const checked = assertDescriptor(descriptor);
  // placement admission 是只读检查，但入口身份仍必须是调用方已经确定的 exact
  // absolute root；在这里静默 resolve 相对路径会让同一 workspace 获得多种身份。
  if (
    typeof workspaceRoot !== "string"
    || !workspaceRoot
    || workspaceRoot.trim() !== workspaceRoot
    || !path.isAbsolute(workspaceRoot)
    || path.resolve(workspaceRoot) !== workspaceRoot
  ) {
    fail("wakeflow-layout-workspace", "$workspaceRoot", "workspaceRoot must be an exact path");
  }
  const rootAbsolute = workspaceRoot;
  const workspace = inspectExistingRoot({ absolute: rootAbsolute, key: "workspace" });
  if (!workspace.exists) {
    fail("wakeflow-layout-workspace", "workspace", "workspace root must already exist", { absolute: rootAbsolute });
  }

  const plannedRoots = physicalRootEntries(checked).map((entry) => ({
    entry,
    absolute: resolvePortable(rootAbsolute, entry.path),
  }));

  // lexical topology 来自 config authority；当配置与磁盘残留同时非法时，先报告
  // 配置重叠，确保诊断不因偶然存在的文件系统状态而改变。
  for (let leftIndex = 0; leftIndex < plannedRoots.length; leftIndex += 1) {
    const left = plannedRoots[leftIndex];
    for (let rightIndex = leftIndex + 1; rightIndex < plannedRoots.length; rightIndex += 1) {
      const right = plannedRoots[rightIndex];
      const lexicalRelation = relation(left.absolute, right.absolute);
      if (lexicalRelation) {
        fail(
          "wakeflow-layout-overlap",
          `${left.entry.key}|${right.entry.key}`,
          "configured protocol roots must not overlap",
          {
            left: { key: left.entry.key, path: left.entry.path },
            right: { key: right.entry.key, path: right.entry.path },
            lexicalRelation,
            physicalRelation: null,
          },
        );
      }
    }
  }

  const roots = plannedRoots.map(({ entry, absolute }) => ({
    entry,
    ...inspectExistingRoot({ absolute, key: entry.key, traversalRoot: rootAbsolute }),
  }));

  for (let leftIndex = 0; leftIndex < roots.length; leftIndex += 1) {
    const left = roots[leftIndex];
    if (!left.exists) continue;
    for (let rightIndex = leftIndex + 1; rightIndex < roots.length; rightIndex += 1) {
      const right = roots[rightIndex];
      if (!right.exists) continue;
      const physicalRelation = relation(left.realPath, right.realPath);
      if (physicalRelation) {
        fail(
          "wakeflow-layout-overlap",
          `${left.entry.key}|${right.entry.key}`,
          "configured protocol roots must not overlap after realpath resolution",
          {
            left: { key: left.entry.key, path: left.entry.path },
            right: { key: right.entry.key, path: right.entry.path },
            lexicalRelation: null,
            physicalRelation,
          },
        );
      }
    }
  }

  return deepFreeze({
    ok: true,
    workspaceRoot: rootAbsolute,
    checkedRoots: roots.map(({ entry, exists, absolute, realPath }) => ({
      key: entry.key,
      path: entry.path,
      exists,
      absolute,
      realPath,
    })),
    missingRoots: roots.filter((entry) => !entry.exists).map((entry) => entry.entry.key),
  });
}

/**
 * 在尚无完整 host descriptor 时，只用 config 模型验证固定协议根与配置 placement。
 * 它复用统一 placement 算法，不建立第二套路径目录。
 */
export function validateWakeflowConfigRootPlacements({ workspaceRoot, model }) {
  const normalizedModel = parseWakeflowConfigV3(model);
  const entries = [
    // config 尚未编译完整 host descriptor 时，只验证固定协议根和配置 placement；
    // 这里复用同一常量，禁止出现第二套 root 字面量。
    { key: "active.root", path: WAKEFLOW_ACTIVE_ROOT, pathKind: "directory" },
    { key: "local.root", path: WAKEFLOW_LOCAL_ROOT, pathKind: "directory" },
    { key: "ledger.root", path: normalizedModel.storage.ledgerRoot, pathKind: "directory" },
    ...normalizedModel.topology.supportSurfaces.map((surface) => ({
      key: `support.${surface.surfaceId}.root`,
      path: surface.path,
      pathKind: "directory",
    })),
    ...normalizedModel.topology.repositories.map((repository) => ({
      key: `repository.${repository.repositoryId}.root`,
      path: repository.path,
      pathKind: "directory",
    })),
  ];
  return validateWakeflowLayoutPlacements({
    workspaceRoot,
    descriptor: { kind: "WakeflowLayoutDescriptor", entries },
  });
}
