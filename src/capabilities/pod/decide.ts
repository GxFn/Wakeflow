import type {
  WakeflowConfigPod,
  WakeflowConfigPodScope,
  WakeflowConfigWindow,
} from "../../configuration/wakeflow-config.js";
import type { WakeflowDurableId } from "../../contracts/identity/wakeflow-durable-id.js";
import { deriveDurableId } from "../../kernel/ids.js";
import type { NextProjection } from "../../kernel/next-projection.js";
import type { PodState } from "../../governance/pod/pod-state.js";
import { WAKEFLOW_POD_PUBLIC_TOOL_NAME } from "./contract.js";

/**
 * Wakeflow Capabilities / Pod：纯决定（ADR-0010 D1、D2、D6；gate-log §13.91 D1 到 D3、D6）。
 *
 * 身份派生、窗口集派生、状态派生与两段关闭的阻塞项都不读文件、不看时钟；效果由 service 执行。
 */

const WAKEFLOW_PRIMARY_POD_RESERVED_NAME = "main" as const;
const WAKEFLOW_WORKTREE_NAME_PREFIX = "wakeflow-" as const;

export { derivePodState, type PodState } from "../../governance/pod/pod-state.js";

/** `podId` 由程序与客户端幂等键派生：同键重放同一 pod，不同键从不复用标识。 */
export function derivePodId(programId: string, idempotencyKey: string): WakeflowDurableId<"pod"> {
  return deriveDurableId("pod", "create-pod", programId, idempotencyKey);
}

export interface DerivedPodWindow {
  readonly windowId: WakeflowDurableId<"window">;
  readonly podId: WakeflowDurableId<"pod">;
  readonly role: WakeflowConfigWindow["role"];
  readonly displayName: string;
  readonly root: WakeflowConfigWindow["root"];
}

export interface DerivedPodWorktree {
  readonly repositoryId: WakeflowDurableId<"repository">;
  readonly windowId: WakeflowDurableId<"window">;
  readonly suggestedName: string;
}

function rootId(window: WakeflowConfigWindow, programId: string): string {
  if (window.root.kind === "program") return programId;
  if (window.root.kind === "repository") return window.root.repositoryId;
  return window.root.surfaceId;
}

function derivedWindow(
  template: WakeflowConfigWindow,
  podId: WakeflowDurableId<"pod">,
  name: string,
  programId: string,
): DerivedPodWindow {
  return Object.freeze({
    windowId: deriveDurableId(
      "window",
      "pod-window",
      podId,
      template.role,
      rootId(template, programId),
    ),
    podId,
    role: template.role,
    displayName: `${name} · ${template.displayName}`,
    root: template.root,
  });
}

/**
 * pod 的窗口集从 primary pod 的模板派生：controller、design、test 各一，每仓库恰好一个
 * product（多个模板时取该仓库的第一个）。显示名 `<name> · <模板显示名>`（能力卡 9 Q6）。
 */
export function derivePodWindows(
  primary: Readonly<WakeflowConfigPodScope>,
  repositoryIds: readonly WakeflowDurableId<"repository">[],
  podId: WakeflowDurableId<"pod">,
  name: string,
  programId: string,
): readonly DerivedPodWindow[] {
  const windows = [
    derivedWindow(primary.controllerWindow, podId, name, programId),
    derivedWindow(primary.designWindow, podId, name, programId),
    derivedWindow(primary.testWindow, podId, name, programId),
  ];
  for (const repositoryId of repositoryIds) {
    const template = primary.windowsByRepositoryId[repositoryId]?.[0];
    if (template === undefined) continue;
    windows.push(derivedWindow(template, podId, name, programId));
  }
  return Object.freeze(windows);
}

export function derivePodWorktrees(
  windows: readonly DerivedPodWindow[],
  name: string,
): readonly DerivedPodWorktree[] {
  return Object.freeze(
    windows.flatMap((window) =>
      window.role === "product" && window.root.kind === "repository"
        ? [
            Object.freeze({
              repositoryId: window.root.repositoryId,
              windowId: window.windowId,
              suggestedName: `${WAKEFLOW_WORKTREE_NAME_PREFIX}${name}`,
            }),
          ]
        : [],
    ),
  );
}

export interface CreateBlockerInput {
  readonly name: string;
  readonly liveNames: readonly string[];
  readonly repositoryCount: number;
  /** 同键已存在的 pod：重放，不算阻塞。 */
  readonly replay: boolean;
}

/** 创建前置：名称不是 `main`、在存活 pod 内唯一；同键重放跳过名称检查。 */
export function deriveCreateBlockers(input: Readonly<CreateBlockerInput>): readonly string[] {
  const blockers: string[] = [];
  if (input.name === WAKEFLOW_PRIMARY_POD_RESERVED_NAME) blockers.push("name-reserved:main");
  if (!input.replay && input.liveNames.includes(input.name)) blockers.push("name-taken");
  if (input.repositoryCount === 0) blockers.push("repository-unavailable");
  return Object.freeze(blockers);
}

export interface CloseRequestBlockerInput {
  readonly placement: WakeflowConfigPod["placement"];
  readonly activeDemandId: string | null;
  /** 已登记 worktree 回执的仓库；每个都需要一条分支处置。 */
  readonly registeredRepositoryIds: readonly string[];
  readonly dispositions: readonly Readonly<{ readonly repositoryId: string }>[];
  readonly knownRepositoryIds: readonly string[];
}

/** 第一段关闭：primary 不可关；pod 上没有活动 Demand；每个已登记 worktree 都有分支处置。 */
export function deriveCloseRequestBlockers(
  input: Readonly<CloseRequestBlockerInput>,
): readonly string[] {
  const blockers: string[] = [];
  if (input.placement === "primary") blockers.push("pod-primary");
  if (input.activeDemandId !== null) blockers.push(`demand-active:${input.activeDemandId}`);
  const given = new Set<string>();
  for (const { repositoryId } of input.dispositions) {
    if (given.has(repositoryId)) blockers.push(`branch-disposition-duplicate:${repositoryId}`);
    given.add(repositoryId);
  }
  for (const repositoryId of input.registeredRepositoryIds) {
    if (!given.has(repositoryId)) blockers.push(`branch-disposition-missing:${repositoryId}`);
  }
  for (const repositoryId of given) {
    if (!input.knownRepositoryIds.includes(repositoryId)) {
      blockers.push(`branch-disposition-unknown:${repositoryId}`);
    }
  }
  return Object.freeze(blockers);
}

export interface CloseCompleteBlockerInput {
  readonly boundWindowIds: readonly string[];
  readonly presentCheckoutRepositoryIds: readonly string[];
}

/** 第二段关闭：全部窗口绑定已退役；每个检出目录已不存在（处置由 Agent 以宿主手段完成）。 */
export function deriveCloseCompleteBlockers(
  input: Readonly<CloseCompleteBlockerInput>,
): readonly string[] {
  return Object.freeze([
    ...input.boundWindowIds.map((windowId) => `window-bound:${windowId}`),
    ...input.presentCheckoutRepositoryIds.map((repositoryId) => `worktree-present:${repositoryId}`),
  ]);
}

export type PodPlanKind = "create" | "close-request" | "close-complete";

const PLAN_FRONTIER: Readonly<Record<PodPlanKind, string>> = Object.freeze({
  create: "pod-create-apply",
  "close-request": "pod-close-apply",
  "close-complete": "pod-close-apply",
});

/** preview 的 next：就绪指向 apply，阻塞列出阻塞项。 */
export function podPreviewNext(
  kind: PodPlanKind,
  planned: Readonly<{ readonly status: "ready" | "blocked"; readonly blockers: readonly string[] }>,
): Readonly<NextProjection> {
  if (planned.status === "blocked") {
    return Object.freeze({
      frontier: null,
      owner: "controller",
      suggestedTool: null,
      blockers: Object.freeze([...planned.blockers].slice(0, 32)),
    });
  }
  return Object.freeze({
    frontier: PLAN_FRONTIER[kind],
    owner: "controller",
    suggestedTool: WAKEFLOW_POD_PUBLIC_TOOL_NAME,
    blockers: Object.freeze([]),
  });
}

export interface PodNextInput {
  readonly state: PodState | null;
  readonly unboundWindowIds: readonly string[];
  readonly boundWindowIds: readonly string[];
  readonly missingReceiptRepositoryIds: readonly string[];
  readonly presentCheckoutRepositoryIds: readonly string[];
}

/** 变更后的 next：创建后登记窗口，closing 先退役窗口再处置检出，都清了回到 close。 */
export function podMutationNext(input: Readonly<PodNextInput>): Readonly<NextProjection> {
  const done = Object.freeze({
    frontier: null,
    owner: "none" as const,
    suggestedTool: null,
    blockers: Object.freeze([]),
  });
  // "closed" 时 pod 仍在配置里，等待第二段 close apply；已移除的 pod 以 null 到达。
  if (input.state === null || input.state === "ready") return done;
  if (input.state === "creating") {
    return Object.freeze({
      frontier: "pod-window-registration",
      owner: "controller",
      suggestedTool: "wakeflow_register_window_binding",
      blockers: Object.freeze(
        [
          ...input.unboundWindowIds.map((id) => `window-unbound:${id}`),
          ...input.missingReceiptRepositoryIds.map((id) => `worktree-receipt-missing:${id}`),
        ].slice(0, 32),
      ),
    });
  }
  if (input.boundWindowIds.length > 0) {
    return Object.freeze({
      frontier: "pod-window-decommission",
      owner: "controller",
      suggestedTool: "wakeflow_register_window_binding",
      blockers: Object.freeze(input.boundWindowIds.map((id) => `window-bound:${id}`).slice(0, 32)),
    });
  }
  if (input.presentCheckoutRepositoryIds.length > 0) {
    return Object.freeze({
      frontier: "pod-worktree-disposal",
      owner: "controller",
      suggestedTool: null,
      blockers: Object.freeze(
        input.presentCheckoutRepositoryIds.map((id) => `worktree-present:${id}`).slice(0, 32),
      ),
    });
  }
  return Object.freeze({
    frontier: "pod-close-apply",
    owner: "controller",
    suggestedTool: WAKEFLOW_POD_PUBLIC_TOOL_NAME,
    blockers: Object.freeze([]),
  });
}
