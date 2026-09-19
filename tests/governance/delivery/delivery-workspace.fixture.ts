import { mkdirSync, readdirSync } from "node:fs";
import path from "node:path";

import type {
  PrepareDeliveryResult,
  RecordDeliveryOutcomeResult,
} from "../../../src/capabilities/delivery/contract.js";
import {
  executePrepareDeliveryRequest,
  executeRecordDeliveryOutcomeRequest,
  type DeliveryHostFacade,
  type ExecuteDeliveryOptions,
} from "../../../src/capabilities/delivery/service.js";
import { executeWindowBindingRequest } from "../../../src/capabilities/endpoint/service.js";
import { parseWakeflowConfigV3 } from "../../../src/configuration/wakeflow-config-v3.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { parseUtcInstant, type UtcInstant } from "../../../src/foundation/time/utc-instant.js";
import {
  computeDeliveryPromptDigest,
  type DeliveryEnvelope,
} from "../../../src/governance/delivery/delivery-envelope.js";
import type { DeliveryOutcome } from "../../../src/governance/delivery/delivery-outcome.js";
import { DemandEventSourcingRepository } from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-repository.js";
import { demandFinalRootRef } from "../../../src/governance/demand/publication/demand-publication-paths.js";
import { codexWindowHostIdentityProfile } from "../../../src/hosts/codex/codex-window-host-identity-profile.js";
import { codexWorkspaceHostResourceProfile } from "../../../src/hosts/codex/wakeflow-workspace-host-resource-profile.js";
import {
  writeHostHookObservation,
  type WriteHostHookObservationReceipt,
} from "../../../src/kernel/hook-observations.js";
import { compileWakeflowWindowLaunchIntents } from "../../../src/workspace/window-runtime/wakeflow-window-launch-intent.js";
import { publishFreshWakeflowWindowRuntime } from "../../../src/workspace/window-runtime/wakeflow-window-runtime-fresh-publication.js";
import { wakeflowWindowHostBindingRootRef } from "../../../src/workspace/window-runtime/wakeflow-window-runtime-paths.js";
import { createMinimalWakeflowConfigV3 } from "../../configuration/wakeflow-config-v3.fixture.js";
import {
  createPreparedWorkspaceStore,
  DISPOSABLE_ROOT_OPTIONS,
  DISPOSABLE_WORKSPACE_DURABILITY,
} from "../../support/prepared-workspace.js";
import {
  cleanupTargetTaskPlanningWorkspaceFixture,
  materializeTargetTaskPlanningWorkspaceFixture,
  openTargetTaskPlanningWorkspaceFixture,
  planFixtureTargetTask,
  targetTaskPlanningWorkspaceBaselineKey,
  type TargetTaskPlanningWorkspaceFacts,
  type TargetTaskPlanningWorkspaceFixture,
  type TargetTaskPlanningWorkspaceFixtureOptions,
} from "../tasking/target-task-planning-service.fixture.js";

/**
 * 投递切片的工作区夹具：已规划目标 + 已登记的窗口绑定，再通过真实切片准备投递、
 * 落地一条 `user-prompt-submit` 记录并记录 accepted 结局。测试链在
 * `test-delivery-workspace.fixture.ts`，避免与评审链夹具互相引用。
 */

export const CODEX_DELIVERY_FACADE: Readonly<DeliveryHostFacade> = Object.freeze({
  hostId: "codex" as const,
  resourceProfile: codexWorkspaceHostResourceProfile,
  identityProfile: codexWindowHostIdentityProfile,
});

export const DELIVERY_PREPARED_AT = parseUtcInstant("2026-08-29T12:05:00.000Z");
export const DELIVERY_LANDED_AT = parseUtcInstant("2026-08-29T12:05:30.000Z");
export const DELIVERY_OUTCOME_AT = parseUtcInstant("2026-08-29T12:06:00.000Z");
export const DELIVERY_AUTHORED = Object.freeze({
  goal: "按任务包完成本轮实现并回写结果。",
  focus: Object.freeze(["先读任务包与需求锚点", "只改分配仓库"]),
  boundary: "不触碰其他仓库；不自行提交。",
});

const BINDING_OBSERVED_AT = parseUtcInstant("2026-08-29T12:03:00.000Z");
const BINDING_REGISTERED_AT = parseUtcInstant("2026-08-29T12:02:00.000Z");
const BINDING_UUID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const RAW_HANDLE = "codex-host-thread:delivery-fixture";
export interface DeliveryWindowRoute {
  readonly windowId: string;
  readonly bindingId: string;
  readonly rawHandle: string;
  readonly windowPath: string;
}

export interface DeliveryWorkspaceFixture extends TargetTaskPlanningWorkspaceFixture {
  readonly demandId: string;
  readonly targetTaskId: string;
  readonly taskPackageId: string;
  readonly route: Readonly<DeliveryWindowRoute>;
  readonly bindingRootPath: string;
}

export interface DeliveredTarget {
  readonly prepared: PrepareDeliveryResult;
  readonly landed: Readonly<WriteHostHookObservationReceipt>;
  readonly recorded: RecordDeliveryOutcomeResult;
  readonly envelope: Readonly<DeliveryEnvelope>;
}

export async function withFixtureDemandRoot<Result>(
  fixture: Readonly<{ readonly workspacePath: string; readonly demandId: string }>,
  use: (root: RootedDirectory) => Promise<Result>,
): Promise<Result> {
  const root = await RootedDirectory.open(
    path.join(fixture.workspacePath, ...demandFinalRootRef(fixture.demandId).split("/")),
    "$root",
    DISPOSABLE_ROOT_OPTIONS,
  );
  try {
    return await use(root);
  } finally {
    await root.close();
  }
}

/** 从事件流回读某次投递的最新结局记录。 */
export async function loadFixtureDeliveryOutcome(
  fixture: Readonly<{ readonly workspacePath: string; readonly demandId: string }>,
  deliveryId: string,
): Promise<Readonly<DeliveryOutcome>> {
  return withFixtureDemandRoot(fixture, async (root) => {
    const located = await new DemandEventSourcingRepository(root).findDeliveryOutcomeRecordedEvents(deliveryId);
    const last = located.at(-1);
    if (last === undefined) throw new Error("Expected a recorded delivery outcome fixture.");
    return last.event.data.outcome;
  });
}

/** 从事件流回读一份已准备的信封。 */
export async function loadFixtureDeliveryEnvelope(
  fixture: Readonly<{ readonly workspacePath: string; readonly demandId: string }>,
  deliveryId: string,
): Promise<Readonly<DeliveryEnvelope>> {
  return withFixtureDemandRoot(fixture, async (root) => {
    const located = await new DemandEventSourcingRepository(root).findDeliveryPreparedEvent(deliveryId);
    if (located === null) throw new Error("Expected a prepared delivery envelope fixture.");
    return located.event.data.envelope;
  });
}

export async function registerFixtureWindowRoute(
  fixture: Readonly<{ readonly workspacePath: string; readonly workspaceRoot: TargetTaskPlanningWorkspaceFixture["workspaceRoot"] }>,
  windowId: string,
  handle: Readonly<{ readonly value: string; readonly uuid: string; readonly observedAt: UtcInstant; readonly registeredAt: UtcInstant }>,
): Promise<Readonly<DeliveryWindowRoute>> {
  const config = parseWakeflowConfigV3(createMinimalWakeflowConfigV3());
  const launchIntent = compileWakeflowWindowLaunchIntents(
    config,
    codexWorkspaceHostResourceProfile,
  ).intents.find((entry) => entry.windowId === windowId);
  if (launchIntent === undefined) throw new Error("Expected exact window launch intent.");
  const windowPath = path.resolve(fixture.workspacePath, launchIntent.root.configuredPlacement);
  await writeHostHookObservation(fixture.workspaceRoot, {
    hostId: "codex",
    event: "session-start",
    sessionId: handle.value,
    cwd: windowPath,
    recordedAt: handle.observedAt,
  });
  const registration = await executeWindowBindingRequest(
    CODEX_DELIVERY_FACADE,
    {
      root: fixture.workspacePath,
      operation: "register",
      windowId: launchIntent.windowId,
      observation: {
        handle: { kind: "codex-thread", value: handle.value },
        launchIntentDigest: launchIntent.intentDigest,
        observedAt: handle.observedAt,
      },
    },
    {
      uuidFactory: () => handle.uuid,
      clock: () => handle.registeredAt,
      durability: DISPOSABLE_WORKSPACE_DURABILITY,
    },
  );
  if (registration.kind !== "WakeflowWindowBindingMutation" || registration.binding === null) {
    throw new Error("Expected a registered Binding fixture.");
  }
  return Object.freeze({
    windowId: launchIntent.windowId,
    bindingId: registration.binding.bindingId,
    rawHandle: handle.value,
    windowPath,
  });
}

/** 基线事实：规划事实加上这一档基线里已规划目标的身份值。 */
interface DeliveryWorkspaceFacts extends TargetTaskPlanningWorkspaceFacts {
  readonly targetTaskId: string;
  readonly taskPackageId: string;
  readonly windowId: string;
}

/**
 * 投递基线的初始化链：在规划基线之上规划一个 implementation 目标并发布窗口运行时。
 * 到此为止树里还没有任何宿主 hook 记录，因此整棵树不含绝对路径，可以按需复制。
 * 绑定登记留在每个副本里做：它写入的 hook 记录带绝对 `cwd`，不能跨目录复制。
 */
async function buildDeliveryWorkspace(
  fixtureRoot: string,
  options: TargetTaskPlanningWorkspaceFixtureOptions,
): Promise<Readonly<DeliveryWorkspaceFacts>> {
  const fixture = await materializeTargetTaskPlanningWorkspaceFixture(fixtureRoot, options);
  try {
    const planned = await planFixtureTargetTask(fixture);
    if (planned.targetTask.workType !== "implementation") {
      throw new Error("Expected an implementation TaskPackage fixture.");
    }
    mkdirSync(path.join(fixture.workspacePath, ".wakeflow-local", "runtime"), { mode: 0o700 });
    await publishFreshWakeflowWindowRuntime(
      fixture.workspaceRoot,
      parseWakeflowConfigV3(createMinimalWakeflowConfigV3()),
      codexWorkspaceHostResourceProfile,
      { recoveringFreshPublication: false },
    );
    return Object.freeze({
      recordDigest: fixture.recordDigest,
      taskPackage: fixture.request.taskPackage,
      targetTaskId: planned.targetTask.targetTaskId,
      taskPackageId: planned.targetTask.taskPackageId,
      windowId: planned.targetTask.windowId,
    });
  } finally {
    await fixture.workspaceRoot.close();
  }
}

const deliveryWorkspaceStore = createPreparedWorkspaceStore<
  TargetTaskPlanningWorkspaceFixtureOptions,
  Readonly<DeliveryWorkspaceFacts>
>({
  prefix: "wakeflow-delivery-workspace-",
  keyOf: targetTaskPlanningWorkspaceBaselineKey,
  build: buildDeliveryWorkspace,
});

/**
 * 同一测试进程里同档选项只跑一次规划与运行时发布，之后每次调用复制一份隔离副本，
 * 再在副本里登记本次的窗口绑定。因此同档副本共享同一个 `targetTaskId` / `taskPackageId`
 * （它们本来就由固定输入与固定时钟决定），而目录、事件流与 hook 记录仍各自独立。
 */
export async function createDeliveryWorkspaceFixture(
  options: TargetTaskPlanningWorkspaceFixtureOptions = {},
): Promise<Readonly<DeliveryWorkspaceFixture>> {
  const prepared = await deliveryWorkspaceStore.materialize(options);
  const fixture = await openTargetTaskPlanningWorkspaceFixture(
    prepared.fixtureRoot,
    prepared.facts,
  );
  try {
    const route = await registerFixtureWindowRoute(fixture, prepared.facts.windowId, {
      value: RAW_HANDLE,
      uuid: BINDING_UUID,
      observedAt: BINDING_OBSERVED_AT,
      registeredAt: BINDING_REGISTERED_AT,
    });
    const bindingRootPath = path.join(
      fixture.workspacePath,
      ...wakeflowWindowHostBindingRootRef(codexWorkspaceHostResourceProfile).split("/"),
    );
    if (readdirSync(bindingRootPath).length !== 1) {
      throw new Error("Expected one private Binding fixture.");
    }
    return Object.freeze({
      ...fixture,
      demandId: fixture.request.demandId,
      targetTaskId: prepared.facts.targetTaskId,
      taskPackageId: prepared.facts.taskPackageId,
      route,
      bindingRootPath,
    });
  } catch (error: unknown) {
    await cleanupTargetTaskPlanningWorkspaceFixture(fixture);
    throw error;
  }
}

export async function cleanupDeliveryWorkspaceFixture(
  fixture: Readonly<DeliveryWorkspaceFixture>,
): Promise<void> {
  await cleanupTargetTaskPlanningWorkspaceFixture(fixture);
}

export interface PrepareFixtureDeliveryOverrides {
  readonly idempotencyKey?: string;
  readonly expectedStreamRevision?: number;
  readonly targetTaskId?: string;
  readonly authored?: Readonly<{
    readonly goal: string;
    readonly focus: readonly string[];
    readonly boundary: string;
  }>;
  readonly language?: "en" | "zh-Hans";
}

/** 经切片准备一次投递；实现目标缺省期望修订 2（发布 1、规划 2）。 */
export async function prepareFixtureDelivery(
  fixture: Readonly<{ readonly workspacePath: string; readonly demandId: string; readonly targetTaskId: string }>,
  overrides: PrepareFixtureDeliveryOverrides = {},
  options: ExecuteDeliveryOptions = { clock: () => DELIVERY_PREPARED_AT },
): Promise<PrepareDeliveryResult> {
  return executePrepareDeliveryRequest(
    CODEX_DELIVERY_FACADE,
    {
      root: fixture.workspacePath,
      demandId: fixture.demandId,
      idempotencyKey: overrides.idempotencyKey ?? "fixture-prepare-1",
      expectedStreamRevision: overrides.expectedStreamRevision ?? 2,
      targetTaskId: overrides.targetTaskId ?? fixture.targetTaskId,
      authored: overrides.authored ?? DELIVERY_AUTHORED,
      language: overrides.language ?? "zh-Hans",
    },
    { durability: DISPOSABLE_WORKSPACE_DURABILITY, ...options },
  );
}

/** 同一会话同一时刻只能有一条记录；第 n 次投递的落地时刻顺延 n-1 秒。 */
export function fixtureLandingInstant(attempt: number): UtcInstant {
  return attempt === 1
    ? DELIVERY_LANDED_AT
    : parseUtcInstant(new Date(Date.parse(DELIVERY_LANDED_AT) + (attempt - 1) * 1000).toISOString());
}

/** 在目标会话里落地一条与许可 prompt 摘要一致的 `user-prompt-submit` 记录。 */
export async function landFixturePrompt(
  fixture: Readonly<{ readonly workspaceRoot: TargetTaskPlanningWorkspaceFixture["workspaceRoot"] }>,
  route: Readonly<DeliveryWindowRoute>,
  prompt: string,
  recordedAt: UtcInstant = DELIVERY_LANDED_AT,
): Promise<Readonly<WriteHostHookObservationReceipt>> {
  return writeHostHookObservation(fixture.workspaceRoot, {
    hostId: "codex",
    event: "user-prompt-submit",
    sessionId: route.rawHandle,
    cwd: route.windowPath,
    recordedAt,
    promptDigest: computeDeliveryPromptDigest(prompt),
  });
}

export interface RecordFixtureOutcomeOverrides {
  readonly idempotencyKey?: string;
  readonly expectedStreamRevision?: number;
  readonly attempt?: Readonly<{ readonly status: "sent" | "failed-before-send" | "unknown"; readonly evidenceDigest?: string }>;
  readonly readback?: Readonly<{ readonly status: "confirmed" | "pending" | "unavailable"; readonly evidenceDigest?: string }>;
  readonly resolution?: Readonly<{ readonly disposition: "accepted" | "rejected-before-send"; readonly hookRecordId?: string; readonly rationale: string }>;
  readonly observedAt?: UtcInstant;
}

/** 记录一次投递结局；缺省是 `sent` + `pending`，处置由切片按 hook 记录派生。 */
export async function recordFixtureDeliveryOutcome(
  fixture: Readonly<{ readonly workspacePath: string; readonly demandId: string }>,
  prepared: Readonly<PrepareDeliveryResult>,
  overrides: RecordFixtureOutcomeOverrides = {},
  options: ExecuteDeliveryOptions = { clock: () => DELIVERY_OUTCOME_AT },
): Promise<RecordDeliveryOutcomeResult> {
  return executeRecordDeliveryOutcomeRequest(
    CODEX_DELIVERY_FACADE,
    {
      root: fixture.workspacePath,
      demandId: fixture.demandId,
      idempotencyKey: overrides.idempotencyKey ?? `fixture-outcome-${prepared.delivery.generation}`,
      expectedStreamRevision: overrides.expectedStreamRevision ?? prepared.event.streamRevision,
      deliveryId: prepared.delivery.deliveryId,
      claimDigest: prepared.permit.fence.claimDigest,
      attempt: overrides.attempt ?? { status: "sent" },
      readback: overrides.readback ?? { status: "pending" },
      ...(overrides.resolution === undefined ? {} : { resolution: overrides.resolution }),
      observedAt: overrides.observedAt ?? DELIVERY_OUTCOME_AT,
    },
    { durability: DISPOSABLE_WORKSPACE_DURABILITY, ...options },
  );
}

/**
 * 准备 → 落地 → accepted 结局：目标进入 host-effect-accepted，流修订前进两步。
 * 返工后的再投递传入 attempt 序号换结局幂等键并显式给出期望修订。
 */
export async function deliverFixtureTarget(
  fixture: Readonly<DeliveryWorkspaceFixture>,
  overrides: PrepareFixtureDeliveryOverrides = {},
  attempt = 1,
): Promise<Readonly<DeliveredTarget>> {
  const prepared = await prepareFixtureDelivery(fixture, overrides);
  const landed = await landFixturePrompt(
    fixture,
    fixture.route,
    prepared.permit.prompt,
    fixtureLandingInstant(attempt),
  );
  const recorded = await recordFixtureDeliveryOutcome(
    fixture,
    prepared,
    attempt === 1 ? {} : { idempotencyKey: `fixture-outcome-r${attempt}` },
  );
  if (recorded.outcome.disposition !== "accepted") {
    throw new Error("Expected an accepted delivery fixture.");
  }
  const envelope = await loadFixtureDeliveryEnvelope(fixture, prepared.delivery.deliveryId);
  return Object.freeze({ prepared, landed, recorded, envelope });
}
