import { deepEqual, equal, rejects } from "node:assert/strict";
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
import {
  executeStatusRequest,
  type ObservationHostFacade,
} from "../../../src/capabilities/observation/service.js";
import { parseWakeflowConfig } from "../../../src/configuration/wakeflow-config.js";
import type { PortableResourcePath } from "../../../src/foundation/filesystem/portable-resource-path.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import { countPromptCharacters } from "../../../src/kernel/prompt-digest.js";
import { computeDeliveryPromptDigest } from "../../../src/governance/delivery/delivery-envelope.js";
import {
  CLAUDE_CODE_DESKTOP_ASSET_CONTENT,
  CLAUDE_CODE_DESKTOP_ASSET_DIGEST,
  CLAUDE_CODE_DESKTOP_ASSET_FILE_NAME,
  CLAUDE_CODE_DESKTOP_ASSET_REF,
} from "../../../src/hosts/claude-code/claude-code-desktop-asset.js";
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
import {
  renderClaudeCodeWindowLaunchInstructions,
  renderClaudeCodeWindowLaunchValues,
} from "../../../src/hosts/claude-code/claude-code-window-launch-instructions.js";
import {
  claudeCodeWorkspaceHostResourceProfile,
  claudeCodeWorkspaceHostTransportTable,
} from "../../../src/hosts/claude-code/wakeflow-workspace-host-resource-profile.js";
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
 * facade 带已发布资产的期望，许可一经签发 Controller 就会免提示运行窗口传输助手，所以每一条"发出许可"
 * 的路径——新 prepare、prepare 的同键重放、rearm 换代、rearm 的同键重放——都在取得路由之后、追加或
 * 取声明之前核对状态栏资产与助手的字节；漂移即 `host-asset-drift[:<companion>]`，字节恢复后同一路径
 * 照常签发。结局记录不发出许可，不受资产状态影响。期望按配置的传输选出（ADR-0025 D6）：只有助手的期望
 * （桌面传输）不核对状态栏。Codex 没有资产面（facade 不带 assets），
 * service.test.ts 里的 Codex 路径在没有任何资产的树上通过，就是它不受此前置约束的证明。
 *
 * 同一份 Claude 投递夹具也覆盖落地时的模式证据（open-items X4）：目标会话的 user-prompt-submit 记录报告的权限模式
 * 与选出 profile 要求的启动模式不同，处置仍 accepted，结果的 `next.blockers` 多一条
 * `permission-mode-mismatch:<windowId>`，同键重放照报；模式相同或记录没带模式的判定在 decide.test.ts。
 */

/** tmux 传输的资产期望：状态栏资产、它的设置条目与伴随的 tmux 助手（§13.117 D4）。 */
const CLAUDE_TMUX_HOST_ASSETS = Object.freeze({
  statusline: Object.freeze({
    fileName: CLAUDE_CODE_STATUSLINE_ASSET_FILE_NAME,
    digest: CLAUDE_CODE_STATUSLINE_ASSET_DIGEST,
    settings: Object.freeze({
      path: CLAUDE_CODE_LOCAL_SETTINGS_REF,
      key: CLAUDE_CODE_STATUSLINE_SETTINGS_KEY,
      expectedEntry: claudeCodeStatuslineSettingsEntry,
      ownsEntry: claudeCodeStatuslineEntryIsWakeflows,
    }),
  }),
  companions: Object.freeze([
    Object.freeze({
      fileName: CLAUDE_CODE_TMUX_ASSET_FILE_NAME,
      digest: CLAUDE_CODE_TMUX_ASSET_DIGEST,
    }),
  ]),
});

/** 桌面传输的资产期望：只有桌面助手，没有状态栏与它的设置条目（ADR-0025 D6）。 */
const CLAUDE_DESKTOP_HOST_ASSETS = Object.freeze({
  statusline: null,
  companions: Object.freeze([
    Object.freeze({
      fileName: CLAUDE_CODE_DESKTOP_ASSET_FILE_NAME,
      digest: CLAUDE_CODE_DESKTOP_ASSET_DIGEST,
    }),
  ]),
});

/**
 * 与 Claude Code 组合根一致的投递 facade：profile 表与按传输的资产期望表（F1；ADR-0025 D1、D6），切片准入时
 * 按工作区配置选出一份——夹具配置没有声明传输，选出的是 tmux 的那份，许可签发前核对它的字节。
 */
const CLAUDE_DELIVERY_FACADE: Readonly<DeliveryHostFacade> & Readonly<WindowBindingHostFacade> =
  Object.freeze({
    hostId: "claude-code" as const,
    resourceProfile: claudeCodeWorkspaceHostResourceProfile,
    transports: claudeCodeWorkspaceHostTransportTable,
    identityProfile: claudeCodeWindowHostIdentityProfile,
    renderLaunchInstructions: renderClaudeCodeWindowLaunchInstructions,
    transportAssets: Object.freeze({
      tmux: CLAUDE_TMUX_HOST_ASSETS,
      desktop: CLAUDE_DESKTOP_HOST_ASSETS,
    }),
  });

/**
 * 选出的期望只有助手、没有状态栏的门面（桌面传输的资产形状，ADR-0025 D6）。共享层只按传输键索引期望表、
 * 不认识键的含义，所以这里把夹具配置选中的缺省键映射到桌面传输的期望；配置按 `windowTransport` 选键的路径
 * 由观察与维护的测试（workspace-observation、maintain-workspace-window-transport）覆盖。
 */
const CLAUDE_HELPER_ONLY_DELIVERY_FACADE: Readonly<DeliveryHostFacade> = Object.freeze({
  ...CLAUDE_DELIVERY_FACADE,
  transportAssets: Object.freeze({
    [claudeCodeWorkspaceHostTransportTable.defaultTransport]: CLAUDE_DESKTOP_HOST_ASSETS,
  }),
});

/** 只读本宿主的观察门面，带启动取值渲染器：status 能把会话报告的权限模式与启动要求的模式对照（X4）。 */
const CLAUDE_STATUS_FACADE: Readonly<ObservationHostFacade> = Object.freeze({
  hostId: "claude-code" as const,
  hosts: Object.freeze([
    Object.freeze({
      hostId: "claude-code" as const,
      resourceProfile: claudeCodeWorkspaceHostResourceProfile,
      identityProfile: claudeCodeWindowHostIdentityProfile,
      statuslineAsset: null,
      renderLaunchValues: renderClaudeCodeWindowLaunchValues,
    }),
  ]),
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
    error.reason === blocker.split(":")[0] &&
    error.path === requestPath &&
    error.details?.blocker === blocker;
}

function claimPath(fixture: Readonly<ClaudeDeliveryFixture>): string {
  return path.join(fixture.workspacePath, ...workClaimRef(fixture.windowId).split("/"));
}

async function prepare(
  fixture: Readonly<ClaudeDeliveryFixture>,
  facade: Readonly<DeliveryHostFacade> = CLAUDE_DELIVERY_FACADE,
) {
  return executePrepareDeliveryRequest(
    facade,
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

test("只有助手的资产期望（桌面传输的形状，ADR-0025 D6）：许可前只核对助手字节——状态栏资产、它的设置条目与 tmux 助手都不在场也照常签发；助手缺失或漂移即拒绝且不取声明", async () => {
  const fixture = await createClaudeDeliveryFixture();
  try {
    const helper = workspaceFile(fixture, CLAUDE_CODE_DESKTOP_ASSET_REF);
    const helperOnly = CLAUDE_HELPER_ONLY_DELIVERY_FACADE;
    await rejects(
      prepare(fixture, helperOnly),
      rejectedByHostAsset(
        `host-asset-missing:${CLAUDE_CODE_DESKTOP_ASSET_FILE_NAME}`,
        "$request.targetTaskId",
      ),
    );
    equal(existsSync(claimPath(fixture)), false, "a rejected prepare must not take a claim");
    mkdirSync(path.dirname(helper), { recursive: true, mode: 0o700 });
    writeFileSync(helper, `${CLAUDE_CODE_DESKTOP_ASSET_CONTENT}\n`, { mode: 0o600 });
    await rejects(
      prepare(fixture, helperOnly),
      rejectedByHostAsset(
        `host-asset-drift:${CLAUDE_CODE_DESKTOP_ASSET_FILE_NAME}`,
        "$request.targetTaskId",
      ),
    );
    restore(helper, CLAUDE_CODE_DESKTOP_ASSET_CONTENT);
    for (const ref of [CLAUDE_CODE_STATUSLINE_ASSET_REF, CLAUDE_CODE_TMUX_ASSET_REF]) {
      equal(existsSync(workspaceFile(fixture, ref)), false, ref);
    }
    const prepared = await prepare(fixture, helperOnly);
    equal(prepared.status, "committed");
    equal(prepared.permit.hostAction.hostId, "claude-code");
    equal(existsSync(claimPath(fixture)), true);
  } finally {
    await cleanupTargetTaskPlanningWorkspaceFixture(fixture);
  }
});

test("许可的 hostAction 带传输与接收窗口的桌面会话 id（open-items X29）：tmux 传输没有 id；组合根注入了定位器读取端时原样给出，重发的许可相同", async () => {
  const fixture = await createClaudeDeliveryFixture();
  try {
    materializeClaudeAssets(fixture);
    const desktopSessionId = "local_0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f";
    const asked: string[] = [];
    const withReader: Readonly<DeliveryHostFacade> = Object.freeze({
      ...CLAUDE_DELIVERY_FACADE,
      readControllerDesktopSessionId: async (_root: unknown, windowId: string) => {
        asked.push(windowId);
        return windowId === fixture.windowId ? desktopSessionId : null;
      },
    });
    const prepared = await prepare(fixture, withReader);
    equal(prepared.permit.hostAction.transport, "tmux-session");
    equal(prepared.permit.hostAction.desktopSessionId, desktopSessionId);
    equal(asked.includes(fixture.windowId), true, "the recipient window's locator was read");
    // 没有读取端的门面（tmux 的常态）：同键重放，id 为 null，其余不变。
    const replayed = await prepare(fixture);
    equal(replayed.status, "idempotent");
    equal(replayed.permit.hostAction.transport, "tmux-session");
    equal(replayed.permit.hostAction.desktopSessionId, null);
    equal(replayed.permit.hostAction.handleDigest, prepared.permit.hostAction.handleDigest);
  } finally {
    await cleanupTargetTaskPlanningWorkspaceFixture(fixture);
  }
});

test("落地记录报告的模式与选出 profile 要求的不同（open-items X4）：处置仍 accepted，next.blockers 多一条 permission-mode-mismatch:<windowId>，同键重放照报", async () => {
  const fixture = await createClaudeDeliveryFixture();
  try {
    materializeClaudeAssets(fixture);
    const prepared = await prepare(fixture);
    const landed = await writeHostHookObservation(fixture.workspaceRoot, {
      hostId: "claude-code",
      event: "user-prompt-submit",
      sessionId: CLAUDE_SESSION_ID,
      cwd: fixture.workspacePath,
      recordedAt: parseUtcInstant("2026-08-29T12:05:30.000Z"),
      promptDigest: computeDeliveryPromptDigest(prepared.permit.prompt),
      permissionMode: "default",
    });
    const record = () =>
      executeRecordDeliveryOutcomeRequest(
        CLAUDE_DELIVERY_FACADE,
        {
          root: fixture.workspacePath,
          demandId: fixture.demandId,
          idempotencyKey: "claude-outcome-landed",
          expectedStreamRevision: prepared.event.streamRevision,
          deliveryId: prepared.delivery.deliveryId,
          claimDigest: prepared.permit.fence.claimDigest,
          attempt: { status: "sent" },
          readback: { status: "pending" },
          observedAt: OUTCOME_AT,
        },
        { durability: DISPOSABLE_WORKSPACE_DURABILITY, clock: () => OUTCOME_AT },
      );
    const mismatch = `permission-mode-mismatch:${fixture.windowId}`;
    const accepted = await record();
    equal(accepted.status, "recorded");
    equal(accepted.outcome.disposition, "accepted");
    equal(accepted.outcome.evidenceKind, "hook-record");
    equal(accepted.outcome.hookRecordId, landed.record.recordId);
    // 摘要相符的落地：许可的字符数照给；这条记录没带字符数（早于该字段的记录也是这样），那一边为 null。
    deepEqual(JSON.parse(JSON.stringify(accepted.outcome.landing)), {
      permitCharacters: countPromptCharacters(prepared.permit.prompt),
      recordCharacters: null,
    });
    equal(accepted.target.phase, "host-effect-accepted");
    equal(
      accepted.next.blockers.filter((entry) => entry.startsWith("permission-mode-mismatch")).join(),
      mismatch,
    );
    const replayed = await record();
    equal(replayed.status, "idempotent");
    equal(replayed.outcome.outcomeDigest, accepted.outcome.outcomeDigest);
    deepEqual(
      JSON.parse(JSON.stringify(replayed.outcome.landing)),
      JSON.parse(JSON.stringify(accepted.outcome.landing)),
      "the replay rereads the same record for the counts too",
    );
    equal(replayed.next.blockers.includes(mismatch), true, "the replay rereads the same record");

    // 同一件事 status 也看得见（1.3.0 批 2）：窗口的会话事实给出两个模式，nextActions 列出这个窗口。
    const status = await executeStatusRequest(
      CLAUDE_STATUS_FACADE,
      { root: fixture.workspacePath },
      { durability: DISPOSABLE_WORKSPACE_DURABILITY, clock: () => OUTCOME_AT },
    );
    const window = status.windows.find((entry) => entry.windowId === fixture.windowId);
    deepEqual(JSON.parse(JSON.stringify(window?.session?.permissionMode ?? null)), {
      configured: "auto",
      observed: "default",
      status: "mismatch",
    });
    deepEqual(
      status.nextActions
        .filter((action) => action.reason === "permission-mode-mismatch")
        .map((action) => [action.owner, action.subject]),
      [["controller", fixture.windowId]],
    );
  } finally {
    await cleanupTargetTaskPlanningWorkspaceFixture(fixture);
  }
});
