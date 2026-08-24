#!/usr/bin/env node

/**
 * 已发布 Wakeflow artifact 的一次性端到端验收探针。
 *
 * 能力导航：
 * - snapshotTree：记录包括 Git 元数据在内的稳定文件树，用作 preview 和 owner-product 零写入证据。
 * - runSetup：只通过公开 setup facade 执行 fresh preview/apply 与 reconcile preview/apply。
 * - assertTargetTree：复核初始化产物、空事件根、宿主表面和外部 ledger 投影。
 * - observability：在写入完成后独立读取 config、storage、status 与 15 项 verification gate。
 *
 * 本文件不规划初始化内容、不直接执行 maintenance 写入，也不持有 workspace authority；真实计划、
 * 事务与恢复仍由 setup 后面的 maintenance owners 负责。所有测试状态必须留在本进程创建的一次性目录中。
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  rmSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  canonicalJson,
  canonicalJsonDigest,
} from "./lib/wakeflow-canonical-json.mjs";
import { loadWakeflowConfigV3Snapshot } from "./lib/wakeflow-config-v3-snapshot.mjs";
import { normalizeWakeflowHostCapabilityProfile } from "./lib/wakeflow-host-capability.mjs";
import { hostProfile } from "./lib/wakeflow-host-profile.mjs";
import { loadWakeflowHostSettingsAssetsAdapter } from "./lib/wakeflow-host-settings-assets-owner.mjs";
import { createWakeflowLayoutDescriptor } from "./lib/wakeflow-layout-descriptor.mjs";
import {
  inspectWakeflowObservabilityV3,
  projectWakeflowConfigView,
  projectWakeflowStatus,
  projectWakeflowStorageView,
  verifyWakeflowWorkspaceV3,
} from "./lib/wakeflow-observability-v3.mjs";
import { planWakeflowReconcileBackbone } from "./lib/wakeflow-reconcile.mjs";
import { loadWakeflowAssetBundle } from "./lib/wakeflow-template-renderer.mjs";

const artifactRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const setupExecutable = path.join(artifactRoot, "scripts/wakeflow-setup.mjs");
const normalizedHost = normalizeWakeflowHostCapabilityProfile(hostProfile);
let base;
let workspaceRoot;
let productRoot;
let ledgerRoot;

class WakeflowSmokeError extends Error {
  constructor(code) {
    super(code);
    this.name = "WakeflowSmokeError";
    this.code = code;
  }
}

function fail(code) {
  throw new WakeflowSmokeError(code);
}

// smoke 必须自己闭合 Git 夹具边界；继承的 GIT_DIR/GIT_WORK_TREE/GIT_TRACE 等变量可能改写命令目标或产生外部副作用。
function clearInheritedGitEnvironment() {
  for (const key of Object.keys(process.env)) {
    if (key.toUpperCase().startsWith("GIT_")) delete process.env[key];
  }
}

function digestBytes(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function digestFile(file) {
  return digestBytes(readFileSync(file));
}

function modeString(mode) {
  return `0${Number(mode & 0o777n).toString(8).padStart(3, "0")}`;
}

/**
 * 记录一次 settled tree evidence。
 *
 * 文件摘要保护内容，BigInt stat 元数据还能发现“写回相同字节”或创建后删除的瞬时写入；符号链接
 * 只记录目标摘要，不跟随到边界外。零写入检查默认包含 `.git`，仅协议残留扫描显式排除宿主拥有的
 * Git 元数据，避免把用户 Git template 中的文件误判为 Wakeflow residue。
 */
function snapshotTree(root, { includeGitMetadata = true } = {}) {
  const result = [];
  function visit(current, ref) {
    const stat = lstatSync(current, { bigint: true });
    const type = stat.isSymbolicLink()
      ? "symlink"
      : stat.isDirectory()
        ? "directory"
        : stat.isFile()
          ? "file"
          : "other";
    result.push({
      ref: ref || ".",
      type,
      mode: modeString(stat.mode),
      device: String(stat.dev),
      inode: String(stat.ino),
      links: String(stat.nlink),
      size: String(stat.size),
      modifiedNs: String(stat.mtimeNs),
      changedNs: String(stat.ctimeNs),
      ...(type === "file" ? { digest: digestFile(current) } : {}),
      ...(type === "symlink"
        ? { targetDigest: digestBytes(readlinkSync(current, { encoding: "buffer" })) }
        : {}),
    });
    if (type !== "directory") return;
    for (const name of readdirSync(current).sort()) {
      if (!includeGitMetadata && name === ".git") continue;
      visit(path.join(current, name), ref ? `${ref}/${name}` : name);
    }
  }
  visit(root, "");
  return result;
}

function snapshotWorld() {
  return canonicalJson(snapshotTree(base));
}

// 只初始化空 Git 夹具；仓库内容和后续 Wakeflow 写入不由本 helper 管理。
function initializeGit(root) {
  const result = spawnSync("git", ["-C", root, "init", "--quiet"], {
    encoding: "utf8",
    shell: false,
  });
  if (result.status !== 0) fail("git-fixture-unavailable");
}

// 在已解析 JSON 值上查找私有根，避免 Windows 转义或兄弟 ledger 路径绕过原始 stdout 字符串检查。
function containsPrivatePath(value, privateRoots) {
  if (typeof value === "string") {
    return privateRoots.some((root) => value.includes(root));
  }
  if (Array.isArray(value)) return value.some((entry) => containsPrivatePath(entry, privateRoots));
  if (value === null || typeof value !== "object") return false;
  return Object.entries(value).some(([key, entry]) => (
    containsPrivatePath(key, privateRoots) || containsPrivatePath(entry, privateRoots)
  ));
}

// setup 是被测公开进程；本层只验证其单一 JSON envelope、静默 stderr、退出状态与路径隐私。
function runSetup(request) {
  const result = spawnSync(
    process.execPath,
    [setupExecutable, "--request-stdin", "--json"],
    {
      cwd: artifactRoot,
      encoding: "utf8",
      input: JSON.stringify(request),
      maxBuffer: 32 * 1024 * 1024,
      shell: false,
      timeout: 120_000,
    },
  );
  if (result.error !== undefined) fail("public-process-unavailable");
  if (result.stderr !== "") fail("public-stderr-not-empty");
  let payload;
  try {
    payload = JSON.parse(result.stdout);
  } catch {
    fail("public-output-invalid");
  }
  if (containsPrivatePath(payload, [base, artifactRoot])) fail("public-output-private-path");
  if (result.status !== 0 || payload?.ok !== true) {
    fail(typeof payload?.error?.code === "string" ? payload.error.code : "public-process-failed");
  }
  return payload;
}

// 固定的最小双宿主拓扑同时覆盖 program、owner-managed product、Design/Test surface 与外部 ledger。
function freshSelection() {
  return {
    program: {
      displayName: "Public Smoke",
      interfaceLanguage: "zh",
    },
    topology: {
      repositories: [{
        selectionKey: "product-a",
        path: "../ProductA",
        displayName: "Product A",
        instructionManagement: "owner-managed",
      }],
      supportSurfaces: [{
        selectionKey: "design",
        capability: "design",
        path: "Design",
        displayName: "Design",
        ownership: "wakeflow-managed",
      }, {
        selectionKey: "test",
        capability: "test",
        path: "Test",
        displayName: "Test",
        ownership: "wakeflow-managed",
      }],
      windows: [{
        role: "controller",
        displayName: "Controller",
        root: { kind: "program" },
      }, {
        role: "design",
        displayName: "Design",
        root: { kind: "support-surface", selectionKey: "design" },
      }, {
        role: "test",
        displayName: "Test",
        root: { kind: "support-surface", selectionKey: "test" },
      }, {
        role: "product",
        displayName: "Product A",
        root: { kind: "repository", selectionKey: "product-a" },
      }],
    },
    storage: { ledgerRoot: "../wakeflow-ledger" },
    governance: {},
    hosts: {},
  };
}

// 目标树检查不跟随符号链接；ref 只来自本文件固定路径或 strict config/layout descriptor。
function assertNode(ref, type) {
  const file = path.resolve(workspaceRoot, ...ref.split("/"));
  let stat;
  try {
    stat = lstatSync(file);
  } catch {
    fail(`target-missing-${type}`);
  }
  if (stat.isSymbolicLink()) fail("target-symlink");
  if ((type === "file" && !stat.isFile()) || (type === "directory" && !stat.isDirectory())) {
    fail(`target-wrong-${type}`);
  }
}

// 初始化后的事件根必须存在但保持空；后续领域事件只能由对应 owner 首次写入。
function assertEmptyDirectory(ref) {
  assertNode(ref, "directory");
  const directory = path.resolve(workspaceRoot, ...ref.split("/"));
  if (readdirSync(directory).length !== 0) fail("event-root-not-empty");
}

function assertNoForbiddenFreshResidue() {
  for (const root of [workspaceRoot, ledgerRoot]) {
    for (const entry of snapshotTree(root, { includeGitMetadata: false })) {
      if (entry.ref === ".") continue;
      const segments = entry.ref.split("/");
      const basename = segments.at(-1);
      if (
        basename === "README.md"
        || basename?.endsWith(".jsonl")
        || segments.includes("next-work")
        || segments.includes("target-results")
      ) fail("forbidden-fresh-residue");
    }
  }
}

// 交叉复核 strict config 与 layout descriptor 落地后的核心目录，不复制初始化 planner 的写入实现。
function assertTargetTree(snapshot, descriptor) {
  for (const ref of [
    "wakeflow.config.json",
    normalizedHost.memoryFile,
    ".gitignore",
    ".wakeflow-active/index.md",
    ".wakeflow-active/current/workspace-current-status.md",
    ".wakeflow-active/current/global-todo-board.md",
  ]) assertNode(ref, "file");
  for (const ref of [
    ".wakeflow-local/runtime/maintenance/transactions",
    ".wakeflow-local/runtime/shared/transport/demands",
    ".wakeflow-local/runtime/shared/coordination/window-leases",
    ".wakeflow-local/audit/preserved",
    `.wakeflow-local/runtime/hosts/${normalizedHost.hostDirName}/identity/window-bindings`,
    `.wakeflow-local/runtime/hosts/${normalizedHost.hostDirName}/projections/window-runtime`,
  ]) assertNode(ref, "directory");
  for (const ref of [
    ".wakeflow-local/runtime/maintenance/transactions",
    ".wakeflow-local/runtime/shared/transport/demands",
    ".wakeflow-local/runtime/shared/coordination/window-leases",
    ".wakeflow-local/audit/preserved",
    `.wakeflow-local/runtime/hosts/${normalizedHost.hostDirName}/identity/window-bindings`,
  ]) assertEmptyDirectory(ref);

  for (const window of snapshot.model.topology.windows) {
    assertNode(
      `.wakeflow-local/runtime/hosts/${normalizedHost.hostDirName}/projections/window-runtime/${window.windowId}.json`,
      "file",
    );
  }
  for (const surface of snapshot.model.topology.supportSurfaces) {
    assertNode(`${surface.path}/${normalizedHost.memoryFile}`, "file");
    if (surface.capability === "design") assertNode(`${surface.path}/drafts`, "directory");
    if (surface.capability === "test") {
      assertNode(`${surface.path}/fixtures`, "directory");
      assertNode(`${surface.path}/harnesses`, "directory");
    }
  }
  for (const ref of [
    "requirement-designs/index.md",
    "goal-stage-confirmation/index.md",
    "workspace/workspace-record-map.md",
    "workspace/archive/index.md",
  ]) {
    const file = path.join(ledgerRoot, ...ref.split("/"));
    let stat;
    try {
      stat = lstatSync(file);
    } catch {
      fail("ledger-projection-missing");
    }
    if (stat.isSymbolicLink() || !stat.isFile()) fail("ledger-projection-invalid");
  }

  const applicableHostFiles = descriptor.entries.filter((entry) => (
    entry.pathKind === "file"
    && entry.scope === "current-host"
    && entry.owner === "host-settings-plan"
    && !String(entry.condition).includes("explicit-product-host-surface-authorization")
  ));
  for (const entry of applicableHostFiles) assertNode(entry.path, "file");
  const statusline = descriptor.entries.find((entry) => entry.key === "local.host.operations.assets.statusline");
  if (normalizedHost.capabilities.assets.applicable) {
    if (statusline === undefined) fail("host-asset-descriptor-missing");
    assertNode(statusline.path, "file");
  } else if (statusline !== undefined) {
    fail("host-asset-descriptor-not-applicable");
  }
  assertNoForbiddenFreshResidue();
}

// 只公开本 smoke 自己产生的稳定错误码；依赖或系统异常不得借 error.code 注入私有信息。
function publicSmokeErrorCode(cause) {
  return cause instanceof WakeflowSmokeError ? cause.code : "public-smoke-failed";
}

let output;
try {
  clearInheritedGitEnvironment();
  base = mkdtempSync(path.join(os.tmpdir(), "wakeflow-public-smoke-"));
  workspaceRoot = path.join(base, "Program");
  productRoot = path.join(base, "ProductA");
  ledgerRoot = path.join(base, "wakeflow-ledger");

  // 第一段通过公开 facade 验证 fresh preview 严格零写入，再应用同一份确认计划。
  mkdirSync(workspaceRoot, { mode: 0o700 });
  mkdirSync(productRoot, { mode: 0o755 });
  initializeGit(workspaceRoot);
  initializeGit(productRoot);
  const productBefore = canonicalJson(snapshotTree(productRoot));
  const beforePreview = snapshotWorld();

  const preview = runSetup({
    root: workspaceRoot,
    action: "fresh-initialize",
    mode: "preview",
    request: { selection: freshSelection(), language: "zh" },
  });
  if (preview.result?.status !== "ready") fail("fresh-preview-not-ready");
  if (snapshotWorld() !== beforePreview) fail("fresh-preview-wrote");
  const confirmedPlan = preview.result.confirmedActionPlan;
  // setup facade 直接返回 coordinator 结果；MCP 才派生 confirmedActionPlanDigest，因此此调用方按精确计划计算摘要。
  const planDigest = canonicalJsonDigest(confirmedPlan);
  const applied = runSetup({
    root: workspaceRoot,
    action: "fresh-initialize",
    mode: "apply",
    confirmedPlan,
    planDigest,
  });
  if (applied.result?.status !== "completed") fail("fresh-apply-not-completed");
  if (canonicalJson(snapshotTree(productRoot)) !== productBefore) fail("owner-product-was-written");

  // 第二段从落地结果重新加载 authority，并以 descriptor/owner 视角独立复核目标树。
  const snapshot = loadWakeflowConfigV3Snapshot({ workspaceRoot });
  const bundle = loadWakeflowAssetBundle({ wakeflowRoot: artifactRoot });
  const hostSettingsAssetsAdapter = await loadWakeflowHostSettingsAssetsAdapter({
    wakeflowRoot: artifactRoot,
    hostProfile,
  });
  const descriptor = createWakeflowLayoutDescriptor({ model: snapshot.model, hostProfile });
  assertTargetTree(snapshot, descriptor);

  // 第三段同时检查内部 reconcile planner 与公开 setup facade 均收敛为同一零步骤 no-op。
  const reconcile = planWakeflowReconcileBackbone({
    workspaceRoot,
    hostProfile,
    bundle,
    language: "zh",
    authorizedRepositoryIds: [],
    hostSettingsAssetsAdapter,
  });
  if (
    reconcile.status !== "ready"
    || reconcile.confirmedActionPlan?.payload?.aggregatePlan?.payload?.steps?.length !== 0
  ) fail("reconcile-not-zero-step");
  const reconcilePreview = runSetup({
    root: workspaceRoot,
    action: "reconcile",
    mode: "preview",
    request: { language: "zh", authorizedRepositoryIds: [] },
  });
  if (
    reconcilePreview.result?.status !== "ready"
    || reconcilePreview.result.confirmedActionPlan?.payload?.aggregatePlan?.payload?.steps?.length !== 0
  ) fail("public-reconcile-not-zero-step");
  const reconcilePlan = reconcilePreview.result.confirmedActionPlan;
  const noOp = runSetup({
    root: workspaceRoot,
    action: "reconcile",
    mode: "apply",
    confirmedPlan: reconcilePlan,
    planDigest: canonicalJsonDigest(reconcilePlan),
  });
  if (noOp.result?.status !== "no-op") fail("public-reconcile-apply-not-no-op");

  // 最后一段只读聚合 config/storage/status/verification，确保初始化结果能被正常运行面真实消费。
  const observation = inspectWakeflowObservabilityV3({
    workspaceRoot,
    hostProfile,
    bundle,
    language: "zh",
    hostSettingsAssetsAdapter,
  });
  const configView = projectWakeflowConfigView({ observation });
  const storageView = projectWakeflowStorageView({ observation });
  const status = projectWakeflowStatus({ observation });
  const verification = verifyWakeflowWorkspaceV3({ observation });
  if (configView.status !== "valid") fail("public-config-view-unhealthy");
  if (storageView.overall !== "healthy") {
    const acceptable = new Set(["current", "empty-ready", "not-created-yet", "not-applicable"]);
    const unhealthy = storageView.items.find((entry) => !acceptable.has(entry.health));
    const diagnosticCode = storageView.diagnostics[0]?.code ?? "no-diagnostic";
    const itemKey = unhealthy?.key ?? "no-item";
    const itemHealth = unhealthy?.health ?? "no-health";
    fail(`public-storage-${storageView.overall}-${diagnosticCode}-${itemKey}-${itemHealth}`);
  }
  const failedGate = verification.gates.find((gate) => gate.status !== "pass");
  if (verification.ok !== true || failedGate !== undefined) {
    const gateId = typeof failedGate?.name === "string"
      ? failedGate.name.replace(/[^a-z0-9.-]/gu, "-")
      : "unknown";
    fail(`public-verification-${gateId}`);
  }
  if (status.overall !== "idle") fail(`public-status-${status.overall}`);

  output = {
    ok: true,
    hostId: normalizedHost.hostId,
    checked: {
      freshApply: true,
      previewZeroWrite: true,
      productZeroWrite: true,
      reconcileNoOp: true,
      targetTree: true,
      verificationGates: verification.gates.length,
    },
  };
} catch (cause) {
  output = {
    ok: false,
    hostId: normalizedHost.hostId,
    error: {
      code: publicSmokeErrorCode(cause),
    },
  };
  process.exitCode = 1;
} finally {
  if (typeof base === "string") {
    try {
      rmSync(base, { recursive: true, force: true });
    } catch {
      // 无法证明一次性状态已经收口时，成功结果必须降级为稳定、脱敏的终结失败。
      output = {
        ok: false,
        hostId: normalizedHost.hostId,
        error: { code: "public-smoke-cleanup-failed" },
      };
      process.exitCode = 1;
    }
  }
}

process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
