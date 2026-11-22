import { deepEqual, equal } from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import {
  computeWakeflowConfigDigest,
  parseWakeflowConfig,
} from "../../src/configuration/wakeflow-config.js";
import { renderWakeflowConfig } from "../../src/configuration/wakeflow-config-document.js";
import { claudeCodeWorkspaceHostResourceProfile } from "../../src/hosts/claude-code/wakeflow-workspace-host-resource-profile.js";
import { codexWindowHostIdentityProfile } from "../../src/hosts/codex/codex-window-host-identity-profile.js";
import { codexWorkspaceHostResourceProfile } from "../../src/hosts/codex/wakeflow-workspace-host-resource-profile.js";
import { WORKSPACE_OPERATION_SCOPES_REF } from "../../src/kernel/layout.js";
import { withExistingWakeflowMaintenanceGate } from "../../src/workspace/maintenance/wakeflow-maintenance-gate.js";
import {
  WAKEFLOW_MAINTENANCE_GATE_REF,
  WAKEFLOW_RUNTIME_ROOT_REF,
} from "../../src/workspace/maintenance/wakeflow-maintenance-resource-catalog.js";
import { recomposeWakeflowWorkspaceGitignore } from "../../src/workspace/managed-integration/wakeflow-gitignore-recomposition.js";
import { WAKEFLOW_GITIGNORE_RECOMPOSITION_LOCK_REF } from "../../src/workspace/managed-integration/wakeflow-managed-integration-resource-catalog.js";
import { recomposeWakeflowProgramInstruction } from "../../src/workspace/managed-integration/wakeflow-program-instruction-recomposition.js";
import { createWakeflowWorkspaceStaticResourceMatrix } from "../../src/workspace/wakeflow-workspace-static-resource-matrix.js";
import { withWakeflowWindowHostBindingStore } from "../../src/workspace/window-runtime/wakeflow-window-host-binding-store.js";
import { compileWakeflowWindowHostBindingStoreAuthority } from "../../src/workspace/window-runtime/wakeflow-window-host-binding-store-authority.js";
import { publishFreshWakeflowWindowRuntime } from "../../src/workspace/window-runtime/wakeflow-window-runtime-fresh-publication.js";
import { wakeflowProgramInstructionRecompositionLockRef } from "../../src/workspace/workspace-host-resource-catalog.js";
import { createMinimalWakeflowConfig } from "../configuration/wakeflow-config.fixture.js";
import {
  durableDisposableRoot,
  lockAcquisitionEvents,
  lockCycleEvents,
  lockReleaseEvents,
  traceDurability,
} from "../support/durability-trace.js";
import { materializeFixtureOperationScope } from "../support/workspace-operation-scope.fixture.js";

/**
 * Level 2 (capability): 工作区层的四个锁族经各自的生产包装走一个周期仍是权威档（1.4.1 第 1 段清单
 * 2.1 节：L8 绑定登记锁、L9 维护门、L11 `.gitignore` 重组锁、L12 程序指令锁留在权威档，新建 3、
 * 删除 1；它们留下来之后没有东西自动清掉，或者清之前会挡住别的命令）。
 *
 * 级别说明：`.gitignore` 重组要在一个隔离的 Git 仓库里用 `git` 子进程核对忽略规则，按测试标准属 2 级；
 * 其余三个只在一次性根上调用。每个用例在真实同步的根上先把目标写成"已是当前"，再数一次：锁内只
 * 核对、不写，计到的只有锁（维护门里另有它包着的独占作用域，L1 的三把锁）。有人给这些锁传了轻档，
 * 链接之后与删暂存之后的两次父目录同步会消失。
 *
 * 不调用 useDisposableDurability：本文件测的就是同步。计数补丁是进程全局的，用例顺序执行。
 */

const OPERATION_ID = "maintenance_operation_11111111-1111-4111-8111-111111111111";
const ADMISSION = WORKSPACE_OPERATION_SCOPES_REF;
const LATCH = `${ADMISSION}/latch.lock`;
const WRITER = `${ADMISSION}/writer.lock`;

function config() {
  return parseWakeflowConfig(createMinimalWakeflowConfig());
}

test("binding registration lock (L8) through withWakeflowWindowHostBindingStore", async (t) => {
  const { base, root } = await durableDisposableRoot(t, "wakeflow-lock-family-binding-");
  const model = config();
  materializeFixtureOperationScope(base);
  writeFileSync(path.join(base, "wakeflow.config.json"), renderWakeflowConfig(model), {
    mode: 0o644,
  });
  await publishFreshWakeflowWindowRuntime(root, model, codexWorkspaceHostResourceProfile, {
    recoveringFreshPublication: false,
  });
  const authority = compileWakeflowWindowHostBindingStoreAuthority(
    model,
    codexWorkspaceHostResourceProfile,
    codexWindowHostIdentityProfile,
  );
  const traced = traceDurability(t, base);
  const trace = await traced(() =>
    withWakeflowWindowHostBindingStore(root, authority, {}, async () => {}),
  );
  deepEqual(trace, {
    syncCount: 4,
    directorySyncCount: 3,
    events: lockCycleEvents(authority.lockRef, "default"),
  });
});

test("maintenance gate (L9) through withExistingWakeflowMaintenanceGate around its exclusive scope", async (t) => {
  const { base, root } = await durableDisposableRoot(t, "wakeflow-lock-family-gate-");
  mkdirSync(path.join(base, WAKEFLOW_RUNTIME_ROOT_REF), { recursive: true, mode: 0o700 });
  materializeFixtureOperationScope(base);
  const traced = traceDurability(t, base);
  const trace = await traced(() =>
    withExistingWakeflowMaintenanceGate(root, OPERATION_ID, async () => {}),
  );
  // 门是权威档（4 次，3 次在目录上）；它包着的独占作用域是 L1 的轻档（6 次，3 次在目录上）。
  deepEqual(trace, {
    syncCount: 10,
    directorySyncCount: 6,
    events: [
      ...lockAcquisitionEvents(WAKEFLOW_MAINTENANCE_GATE_REF, "default"),
      ...lockAcquisitionEvents(LATCH, "light"),
      ...lockAcquisitionEvents(WRITER, "light"),
      ...lockReleaseEvents(LATCH),
      ...lockAcquisitionEvents(LATCH, "light"),
      ...lockReleaseEvents(LATCH),
      ...lockReleaseEvents(WRITER),
      ...lockReleaseEvents(WAKEFLOW_MAINTENANCE_GATE_REF),
    ],
  });
});

test("gitignore recomposition lock (L11) through recomposeWakeflowWorkspaceGitignore of a current file", async (t) => {
  const { base, root } = await durableDisposableRoot(t, "wakeflow-lock-family-gitignore-");
  const initialized = spawnSync("git", ["init", "--quiet"], {
    cwd: base,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
  });
  equal(initialized.status, 0);
  const matrix = createWakeflowWorkspaceStaticResourceMatrix(codexWorkspaceHostResourceProfile);
  const request = Object.freeze({
    matrix,
    expectedMatrixDigest: matrix.matrixDigest,
    hostProfiles: Object.freeze([
      codexWorkspaceHostResourceProfile,
      claudeCodeWorkspaceHostResourceProfile,
    ]),
  });
  equal((await recomposeWakeflowWorkspaceGitignore(root, request)).disposition, "created");
  let disposition: string | undefined;
  const traced = traceDurability(t, base);
  const trace = await traced(async () => {
    disposition = (await recomposeWakeflowWorkspaceGitignore(root, request)).disposition;
  });
  equal(disposition, "current");
  deepEqual(trace, {
    syncCount: 4,
    directorySyncCount: 3,
    events: lockCycleEvents(WAKEFLOW_GITIGNORE_RECOMPOSITION_LOCK_REF, "default"),
  });
});

test("program instruction lock (L12) through recomposeWakeflowProgramInstruction of a current file", async (t) => {
  const { base, root } = await durableDisposableRoot(t, "wakeflow-lock-family-instruction-");
  mkdirSync(path.join(base, ".wakeflow-local"), { mode: 0o700 });
  const desired = config();
  const matrix = createWakeflowWorkspaceStaticResourceMatrix(codexWorkspaceHostResourceProfile);
  const request = Object.freeze({
    matrix,
    expectedMatrixDigest: matrix.matrixDigest,
    profile: codexWorkspaceHostResourceProfile,
    currentConfig: null,
    expectedCurrentConfigDigest: null,
    desiredConfig: desired,
    expectedDesiredConfigDigest: computeWakeflowConfigDigest(desired),
  });
  equal((await recomposeWakeflowProgramInstruction(root, request)).disposition, "created");
  let disposition: string | undefined;
  const traced = traceDurability(t, base);
  const trace = await traced(async () => {
    disposition = (await recomposeWakeflowProgramInstruction(root, request)).disposition;
  });
  equal(disposition, "current");
  deepEqual(trace, {
    syncCount: 4,
    directorySyncCount: 3,
    events: lockCycleEvents(
      wakeflowProgramInstructionRecompositionLockRef(codexWorkspaceHostResourceProfile),
      "default",
    ),
  });
});
