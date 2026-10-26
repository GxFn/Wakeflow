import { equal, rejects } from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  type DeliveryHostFacade,
  executePrepareDeliveryRequest,
  executeRearmDeliveryRequest,
  executeRecordDeliveryOutcomeRequest,
} from "../../../src/capabilities/delivery/service.js";
import {
  executeWindowBindingRequest,
  type WindowBindingHostFacade,
} from "../../../src/capabilities/endpoint/service.js";
import { parseWakeflowConfig } from "../../../src/configuration/wakeflow-config.js";
import type { PortableResourcePath } from "../../../src/foundation/filesystem/portable-resource-path.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import {
  CLAUDE_CODE_STATUSLINE_ASSET_CONTENT,
  CLAUDE_CODE_STATUSLINE_ASSET_DIGEST,
  CLAUDE_CODE_STATUSLINE_ASSET_FILE_NAME,
  CLAUDE_CODE_STATUSLINE_ASSET_REF,
} from "../../../src/hosts/claude-code/claude-code-statusline-asset.js";
import {
  CLAUDE_CODE_LOCAL_SETTINGS_REF,
  CLAUDE_CODE_STATUSLINE_SETTINGS_KEY,
  claudeCodeStatuslineEntryIsWakeflows,
  claudeCodeStatuslineSettingsEntry,
} from "../../../src/hosts/claude-code/claude-code-statusline-settings-operation.js";
import {
  CLAUDE_CODE_TMUX_ASSET_CONTENT,
  CLAUDE_CODE_TMUX_ASSET_DIGEST,
  CLAUDE_CODE_TMUX_ASSET_FILE_NAME,
  CLAUDE_CODE_TMUX_ASSET_REF,
} from "../../../src/hosts/claude-code/claude-code-tmux-asset.js";
import { claudeCodeWindowHostIdentityProfile } from "../../../src/hosts/claude-code/claude-code-window-host-identity-profile.js";
import { renderClaudeCodeWindowLaunchInstructions } from "../../../src/hosts/claude-code/claude-code-window-launch-instructions.js";
import { claudeCodeWorkspaceHostResourceProfile } from "../../../src/hosts/claude-code/wakeflow-workspace-host-resource-profile.js";
import { isWakeflowError } from "../../../src/kernel/error.js";
import { writeHostHookObservation } from "../../../src/kernel/hook-observations.js";
import { workClaimRef } from "../../../src/kernel/layout.js";
import { compileWakeflowWindowLaunchIntents } from "../../../src/workspace/window-runtime/wakeflow-window-launch-intent.js";
import { publishFreshWakeflowWindowRuntime } from "../../../src/workspace/window-runtime/wakeflow-window-runtime-fresh-publication.js";
import { createMinimalWakeflowConfig } from "../../configuration/wakeflow-config.fixture.js";
import { DELIVERY_AUTHORED } from "../../governance/delivery/delivery-workspace.fixture.js";
import {
  cleanupTargetTaskPlanningWorkspaceFixture,
  createTargetTaskPlanningWorkspaceFixture,
  planFixtureTargetTask,
  type TargetTaskPlanningWorkspaceFixture,
} from "../../governance/tasking/target-task-planning-service.fixture.js";
import { useDisposableDurability } from "../../support/disposable-durability.js";
import { DISPOSABLE_WORKSPACE_DURABILITY } from "../../support/prepared-workspace.js";

useDisposableDurability();

/**
 * delivery 切片的宿主资产前置（第 2 级，能力；能力卡 6 §6.2 F1，open-items W16）：Claude 宿主的
 * facade 带已发布资产的期望，许可一经签发 Controller 就会免提示运行 tmux 助手，所以每一条"发出许可"
 * 的路径——新 prepare、prepare 的同键重放、rearm 换代、rearm 的同键重放——都在取得路由之后、追加或
 * 取声明之前核对状态栏资产与助手的字节；漂移即 `host-asset-drift[:<companion>]`，字节恢复后同一路径
 * 照常签发。结局记录不发出许可，不受资产状态影响。Codex 没有资产面（facade 不带 assets），
 * service.test.ts 里的 Codex 路径在没有任何资产的树上通过，就是它不受此前置约束的证明。
 */

const CLAUDE_HOST_ASSETS = Object.freeze({
  fileName: CLAUDE_CODE_STATUSLINE_ASSET_FILE_NAME,
  digest: CLAUDE_CODE_STATUSLINE_ASSET_DIGEST,
  settings: Object.freeze({
    path: CLAUDE_CODE_LOCAL_SETTINGS_REF,
    key: CLAUDE_CODE_STATUSLINE_SETTINGS_KEY,
    expectedEntry: claudeCodeStatuslineSettingsEntry,
    ownsEntry: claudeCodeStatuslineEntryIsWakeflows,
  }),
  companions: Object.freeze([
    Object.freeze({
      fileName: CLAUDE_CODE_TMUX_ASSET_FILE_NAME,
      digest: CLAUDE_CODE_TMUX_ASSET_DIGEST,
    }),
  ]),
});

/** 与 Claude Code 组合根一致的投递 facade：带资产期望（F1），许可签发前核对字节。 */
const CLAUDE_DELIVERY_FACADE: Readonly<DeliveryHostFacade> & Readonly<WindowBindingHostFacade> =
  Object.freeze({
    hostId: "claude-code" as const,
    resourceProfile: claudeCodeWorkspaceHostResourceProfile,
    identityProfile: claudeCodeWindowHostIdentityProfile,
    renderLaunchInstructions: renderClaudeCodeWindowLaunchInstructions,
    assets: CLAUDE_HOST_ASSETS,
  });

const CLAUDE_SESSION_ID = "c1a0dec0-de00-4000-8000-0000000000c1";
const CLAUDE_BINDING_UUID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CLAUDE_TMUX = Object.freeze({
  socketName: null,
  sessionName: "wakeflow",
  windowId: "@5",
  paneId: "%11",
});
const SESSION_STARTED_AT = parseUtcInstant("2026-08-29T12:03:00.000Z");
const BINDING_REGISTERED_AT = parseUtcInstant("2026-08-29T12:04:00.000Z");
const PREPARED_AT = parseUtcInstant("2026-08-29T12:05:00.000Z");
const OUTCOME_AT = parseUtcInstant("2026-08-29T12:06:00.000Z");
const REARMED_AT = parseUtcInstant("2026-08-29T12:07:00.000Z");

interface ClaudeDeliveryFixture extends TargetTaskPlanningWorkspaceFixture {
  readonly demandId: string;
  readonly targetTaskId: string;
  readonly windowId: string;
}

/**
 * Claude 宿主的投递夹具：在规划基线副本上规划一个实现目标，只发布 Claude 的窗口运行时（Fresh 发布要求
 * hosts 根只含本宿主，所以不能叠在 Codex 的投递基线上），再按 tmux 坐标为产品窗口登记 Claude 绑定。
 */
async function createClaudeDeliveryFixture(): Promise<Readonly<ClaudeDeliveryFixture>> {
  const planning = await createTargetTaskPlanningWorkspaceFixture();
  try {
    const planned = await planFixtureTargetTask(planning);
    if (planned.targetTask.workType !== "implementation") {
      throw new Error("Expected an implementation target fixture.");
    }
    mkdirSync(path.join(planning.workspacePath, ".wakeflow-local", "runtime"), {
      recursive: true,
      mode: 0o700,
    });
    const config = parseWakeflowConfig(createMinimalWakeflowConfig());
    await publishFreshWakeflowWindowRuntime(
      planning.workspaceRoot,
      config,
      claudeCodeWorkspaceHostResourceProfile,
      { recoveringFreshPublication: false },
    );
    await registerClaudeRoute(planning, config, planned.targetTask.windowId);
    return Object.freeze({
      ...planning,
      demandId: planning.request.demandId,
      targetTaskId: planned.targetTask.targetTaskId,
      windowId: planned.targetTask.windowId,
    });
  } catch (error: unknown) {
    await cleanupTargetTaskPlanningWorkspaceFixture(planning);
    throw error;
  }
}

/** 为产品窗口登记 Claude 绑定：先落一条本窗口根的 session-start 记录，再带 tmux 坐标注册。 */
async function registerClaudeRoute(
  fixture: Readonly<TargetTaskPlanningWorkspaceFixture>,
  config: ReturnType<typeof parseWakeflowConfig>,
  windowId: string,
): Promise<void> {
  const intent = compileWakeflowWindowLaunchIntents(
    config,
    claudeCodeWorkspaceHostResourceProfile,
  ).intents.find((entry) => entry.windowId === windowId);
  if (intent === undefined) throw new Error("Expected the Claude launch intent of the window.");
  await writeHostHookObservation(fixture.workspaceRoot, {
    hostId: "claude-code",
    event: "session-start",
    sessionId: CLAUDE_SESSION_ID,
    cwd: path.resolve(fixture.workspacePath, intent.root.configuredPlacement),
    recordedAt: SESSION_STARTED_AT,
  });
  const registration = await executeWindowBindingRequest(
    CLAUDE_DELIVERY_FACADE,
    {
      root: fixture.workspacePath,
      operation: "register",
      windowId: intent.windowId,
      observation: {
        handle: { kind: "claude-session", value: CLAUDE_SESSION_ID },
        launchIntentDigest: intent.intentDigest,
        observedAt: "2026-08-29T12:03:30.000Z",
        tmux: CLAUDE_TMUX,
      },
    },
    {
      uuidFactory: () => CLAUDE_BINDING_UUID,
      clock: () => BINDING_REGISTERED_AT,
      durability: DISPOSABLE_WORKSPACE_DURABILITY,
    },
  );
  if (registration.kind !== "WakeflowWindowBindingMutation" || registration.binding === null) {
    throw new Error("Expected a registered Claude Binding fixture.");
  }
}

function workspaceFile(
  fixture: Readonly<{ readonly workspacePath: string }>,
  ref: PortableResourcePath,
): string {
  return path.join(fixture.workspacePath, ...`${ref}`.split("/"));
}

/** 按维护事务的落点与模式写两份资产的精确字节（目录 0700、文件 0600）。 */
function materializeClaudeAssets(fixture: Readonly<ClaudeDeliveryFixture>): void {
  const statusline = workspaceFile(fixture, CLAUDE_CODE_STATUSLINE_ASSET_REF);
  mkdirSync(path.dirname(statusline), { recursive: true, mode: 0o700 });
  writeFileSync(statusline, CLAUDE_CODE_STATUSLINE_ASSET_CONTENT, { mode: 0o600 });
  writeFileSync(
    workspaceFile(fixture, CLAUDE_CODE_TMUX_ASSET_REF),
    CLAUDE_CODE_TMUX_ASSET_CONTENT,
    {
      mode: 0o600,
    },
  );
}

/** 改一个字节（多一个换行）；模式不变，只有摘要变。 */
function drift(file: string, content: string): void {
  writeFileSync(file, `${content}\n`);
}

function restore(file: string, content: string): void {
  writeFileSync(file, content);
}

function rejectedByHostAsset(blocker: string, requestPath: string) {
  return (error: unknown) =>
    isWakeflowError(error) &&
    error.code === "precondition-failed" &&
    error.reason === "host-asset-drift" &&
    error.path === requestPath &&
    error.details?.blocker === blocker;
}

function claimPath(fixture: Readonly<ClaudeDeliveryFixture>): string {
  return path.join(fixture.workspacePath, ...workClaimRef(fixture.windowId).split("/"));
}

async function prepare(fixture: Readonly<ClaudeDeliveryFixture>) {
  return executePrepareDeliveryRequest(
    CLAUDE_DELIVERY_FACADE,
    {
      root: fixture.workspacePath,
      demandId: fixture.demandId,
      idempotencyKey: "claude-prepare-1",
      expectedStreamRevision: 2,
      targetTaskId: fixture.targetTaskId,
      authored: DELIVERY_AUTHORED,
      language: "en",
    },
    { durability: DISPOSABLE_WORKSPACE_DURABILITY, clock: () => PREPARED_AT },
  );
}

async function recordRejected(
  fixture: Readonly<ClaudeDeliveryFixture>,
  deliveryId: string,
  claimDigest: string,
  expectedStreamRevision: number,
) {
  return executeRecordDeliveryOutcomeRequest(
    CLAUDE_DELIVERY_FACADE,
    {
      root: fixture.workspacePath,
      demandId: fixture.demandId,
      idempotencyKey: "claude-outcome-1",
      expectedStreamRevision,
      deliveryId,
      claimDigest,
      attempt: { status: "failed-before-send", failure: { code: "pane-dead", summary: null } },
      readback: { status: "unavailable" },
      observedAt: OUTCOME_AT,
    },
    { durability: DISPOSABLE_WORKSPACE_DURABILITY, clock: () => OUTCOME_AT },
  );
}

async function rearm(
  fixture: Readonly<ClaudeDeliveryFixture>,
  deliveryId: string,
  expectedStreamRevision: number,
) {
  return executeRearmDeliveryRequest(
    CLAUDE_DELIVERY_FACADE,
    {
      root: fixture.workspacePath,
      demandId: fixture.demandId,
      idempotencyKey: "claude-rearm-2",
      expectedStreamRevision,
      deliveryId,
    },
    { durability: DISPOSABLE_WORKSPACE_DURABILITY, clock: () => REARMED_AT },
  );
}

test("Claude 宿主：助手资产漂移后，新 prepare、同键重放、rearm 与 rearm 重放都不交出许可；字节恢复后同一路径照常签发（W16）", async () => {
  const fixture = await createClaudeDeliveryFixture();
  try {
    materializeClaudeAssets(fixture);
    const statusline = workspaceFile(fixture, CLAUDE_CODE_STATUSLINE_ASSET_REF);
    const helper = workspaceFile(fixture, CLAUDE_CODE_TMUX_ASSET_REF);
    const helperDrift = `host-asset-drift:${CLAUDE_CODE_TMUX_ASSET_FILE_NAME}`;

    // 已有前置：新 prepare 先核对状态栏资产，再按声明顺序核对伴随的助手。
    drift(statusline, CLAUDE_CODE_STATUSLINE_ASSET_CONTENT);
    await rejects(
      prepare(fixture),
      rejectedByHostAsset("host-asset-drift", "$request.targetTaskId"),
    );
    restore(statusline, CLAUDE_CODE_STATUSLINE_ASSET_CONTENT);
    drift(helper, CLAUDE_CODE_TMUX_ASSET_CONTENT);
    await rejects(prepare(fixture), rejectedByHostAsset(helperDrift, "$request.targetTaskId"));
    equal(existsSync(claimPath(fixture)), false, "a rejected prepare must not take a claim");
    restore(helper, CLAUDE_CODE_TMUX_ASSET_CONTENT);
    const prepared = await prepare(fixture);
    equal(prepared.status, "committed");
    equal(prepared.permit.hostAction.hostId, "claude-code");
    equal(prepared.delivery.phase, "delivery-prepared");
    equal(existsSync(claimPath(fixture)), true);

    // W16：同键重放也是一次发出许可——漂移后同样拒绝，恢复后仍是同一围栏的幂等回执。
    drift(helper, CLAUDE_CODE_TMUX_ASSET_CONTENT);
    await rejects(prepare(fixture), rejectedByHostAsset(helperDrift, "$request.targetTaskId"));
    restore(helper, CLAUDE_CODE_TMUX_ASSET_CONTENT);
    const replayed = await prepare(fixture);
    equal(replayed.status, "idempotent");
    equal(replayed.permit.fence.claimDigest, prepared.permit.fence.claimDigest);

    // 结局记录不发出许可：资产漂移时照常记录 rejected-before-send 并释放声明。
    drift(helper, CLAUDE_CODE_TMUX_ASSET_CONTENT);
    const rejected = await recordRejected(
      fixture,
      prepared.delivery.deliveryId,
      prepared.permit.fence.claimDigest,
      prepared.event.streamRevision,
    );
    equal(rejected.outcome.disposition, "rejected-before-send");
    equal(rejected.target.phase, "host-effect-rejected");
    equal(existsSync(claimPath(fixture)), false);

    // W16：rearm 在取声明之前核对——漂移时不换代、不取声明、不追加事件；恢复后同一请求签发第二代。
    await rejects(
      rearm(fixture, prepared.delivery.deliveryId, rejected.event.streamRevision),
      rejectedByHostAsset(helperDrift, "$request.deliveryId"),
    );
    equal(existsSync(claimPath(fixture)), false, "a rejected rearm must not take a claim");
    restore(helper, CLAUDE_CODE_TMUX_ASSET_CONTENT);
    const rearmed = await rearm(
      fixture,
      prepared.delivery.deliveryId,
      rejected.event.streamRevision,
    );
    equal(rearmed.status, "rearmed");
    equal(rearmed.rearm.generation, 2);
    equal(rearmed.delivery.phase, "delivery-prepared");
    equal(rearmed.event.streamRevision, rejected.event.streamRevision + 1);
    const fence = rearmed.permit.fence;
    if (fence === null) throw new Error("Expected a target rearm fence.");
    equal(existsSync(claimPath(fixture)), true);

    // W16：rearm 的同键重放同样先核对；恢复后是同一围栏的幂等回执。
    drift(helper, CLAUDE_CODE_TMUX_ASSET_CONTENT);
    await rejects(
      rearm(fixture, prepared.delivery.deliveryId, rejected.event.streamRevision),
      rejectedByHostAsset(helperDrift, "$request.deliveryId"),
    );
    restore(helper, CLAUDE_CODE_TMUX_ASSET_CONTENT);
    const replayedRearm = await rearm(
      fixture,
      prepared.delivery.deliveryId,
      rejected.event.streamRevision,
    );
    equal(replayedRearm.status, "idempotent");
    equal(replayedRearm.rearm.generation, 2);
    equal(replayedRearm.permit.fence?.claimDigest, fence.claimDigest);
  } finally {
    await cleanupTargetTaskPlanningWorkspaceFixture(fixture);
  }
});
