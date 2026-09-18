import type { Sha256Digest } from "../../foundation/crypto/sha256.js";
import type { PortableResourcePath } from "../../foundation/filesystem/portable-resource-path.js";
import {
  WAKEFLOW_ACTIVE_WORKSPACE_INDEX_REF,
  WAKEFLOW_ACTIVE_WORKSPACE_STATUS_REF,
} from "../../kernel/layout.js";
import type { NextProjection } from "../../kernel/next-projection.js";

/**
 * Wakeflow Capabilities / Observation：纯决定（gate-log §13.94 D1、D3、D10）。
 *
 * 这里没有 I/O：下一步的排序、verify 门的判定与汇总、投影新鲜度、worktree 处置引导都只看
 * service 从观察记录压出来的纯数据。
 */

export type NextActionOwner = "controller" | "target" | "test" | "user" | "none";

export interface NextAction {
  readonly owner: NextActionOwner;
  readonly tool: string | null;
  readonly reason: string;
  readonly subject: string | null;
}

export interface NextActionInput {
  /** 配置或活动布局读不到：先维护。 */
  readonly maintenance: boolean;
  readonly unregisteredWindows: readonly Readonly<{
    readonly windowId: string;
    readonly podId: string;
    readonly placement: "primary" | "worktree";
    /** pod 上有活动 Demand，或就是 primary：未登记窗口才值得先做。 */
    readonly podActive: boolean;
  }>[];
  readonly demands: readonly Readonly<{
    readonly demandId: string;
    readonly placement: "primary" | "worktree";
    readonly disposition: string;
    readonly frontier: string | null;
    readonly owner: NextActionOwner;
    readonly suggestedTool: string | null;
  }>[];
  readonly pendingPackages: readonly Readonly<{ readonly requirementId: string }>[];
}

const NEXT_ACTIONS_MAXIMUM = 64;
const WORKSPACE_MAINTENANCE_FRONTIER = "workspace-maintenance" as const;
const MAINTENANCE_TOOL = "wakeflow_maintain_workspace" as const;
const REGISTRATION_TOOL = "wakeflow_register_window_binding" as const;
const CREATE_DEMAND_TOOL = "wakeflow_create_demand" as const;

/**
 * 顺序：维护 > 活动 pod 的未登记窗口 > 活动 Demand 前沿（primary 先，再按 demandId）>
 * 待认领需求包；去重，上限 64。
 */
export function deriveNextActions(
  input: Readonly<NextActionInput>,
): readonly Readonly<NextAction>[] {
  const actions: NextAction[] = [];
  if (input.maintenance) {
    actions.push({
      owner: "controller",
      tool: MAINTENANCE_TOOL,
      reason: WORKSPACE_MAINTENANCE_FRONTIER,
      subject: null,
    });
  }
  for (const window of [...input.unregisteredWindows]
    .filter((entry) => entry.podActive)
    .sort((left, right) => left.windowId.localeCompare(right.windowId))) {
    actions.push({
      owner: "controller",
      tool: REGISTRATION_TOOL,
      reason: "pod-window-registration",
      subject: window.windowId,
    });
  }
  const demands = [...input.demands].sort((left, right) => {
    if (left.placement !== right.placement) return left.placement === "primary" ? -1 : 1;
    return left.demandId.localeCompare(right.demandId);
  });
  for (const demand of demands) {
    if (demand.disposition === "terminal" || demand.frontier === null) continue;
    actions.push({
      owner: demand.owner,
      tool: demand.suggestedTool,
      reason: demand.frontier,
      subject: demand.demandId,
    });
  }
  for (const entry of [...input.pendingPackages].sort((left, right) =>
    left.requirementId.localeCompare(right.requirementId),
  )) {
    actions.push({
      owner: "controller",
      tool: CREATE_DEMAND_TOOL,
      reason: "requirement-claim",
      subject: entry.requirementId,
    });
  }
  const seen = new Set<string>();
  const unique = actions.filter((action) => {
    const key = [action.owner, action.tool, action.reason, action.subject].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return Object.freeze(
    unique.slice(0, NEXT_ACTIONS_MAXIMUM).map((action) => Object.freeze(action)),
  );
}

/**
 * status 列表的 wire 上限（见 wakeflow-status-result Schema）：目录列举与活动 Demand 数都可以
 * 超过它们，越界只截断并报出略去的条数，不让整份结果被输出边界挡下。
 */
export const STATUS_LIST_MAXIMUMS = Object.freeze({
  demands: 256,
  windows: 512,
  claims: 512,
  pods: 64,
  repositories: 64,
  worktrees: 64,
  unmergedAccepted: 256,
});

/** 截到上限并报出被略去的条数；调用方先做确定性排序，截断才是确定的。 */
export function capStatusList<Entry>(
  entries: readonly Entry[],
  maximum: number,
): Readonly<{ readonly entries: readonly Entry[]; readonly omitted: number }> {
  return Object.freeze({
    entries: Object.freeze(entries.slice(0, maximum)),
    omitted: Math.max(0, entries.length - maximum),
  });
}

/** 不带 demandId 的 `next`：头项动作；没有动作即无前沿。 */
export function nextFromActions(
  actions: readonly Readonly<NextAction>[],
): Readonly<NextProjection> {
  const first = actions[0];
  if (first === undefined) {
    return Object.freeze({
      frontier: null,
      owner: "none",
      suggestedTool: null,
      blockers: Object.freeze([]),
    });
  }
  return Object.freeze({
    frontier: first.reason,
    owner: first.owner,
    suggestedTool: first.tool,
    blockers: Object.freeze([]),
  });
}

// ---- verify ------------------------------------------------------------------

export type VerifyGateStatus = "pass" | "fail" | "unavailable";

export interface VerifyGate {
  readonly name: string;
  readonly owner: string;
  readonly status: VerifyGateStatus;
  readonly code: string | null;
  readonly evidence: readonly Readonly<{
    readonly ref: PortableResourcePath;
    readonly digest: Sha256Digest;
  }>[];
}

export interface WorkspaceGateFacts {
  /**
   * 三个域的观察状态（§13.94 D1）：读不出时空列表不是"没有"，依赖它们的门只能 unavailable，
   * 需要活动 Demand 集合的交叉检查（看板认领、孤儿声明）也不做。
   */
  readonly domains: Readonly<{
    readonly demands: Readonly<{
      readonly status: "observed" | "unavailable";
      readonly issue: string | null;
    }>;
    readonly claims: Readonly<{
      readonly status: "observed" | "unavailable";
      readonly issue: string | null;
    }>;
    readonly pods: Readonly<{
      readonly status: "observed" | "unavailable";
      readonly issue: string | null;
    }>;
  }>;
  readonly configRecheck: "current" | "changed" | "unavailable";
  readonly configRef: PortableResourcePath;
  readonly configDigest: Sha256Digest;
  readonly layout: "current" | "absent" | "incomplete" | "conflict" | "unavailable";
  /** 静态资源矩阵的零写对账预览（§13.94 D3）：ready 且没有计划步骤才是通过；codes 是阻塞码与步骤种类。 */
  readonly local: Readonly<{
    readonly status: "ready" | "blocked" | "unavailable";
    readonly codes: readonly string[];
  }>;
  readonly ledger: string;
  readonly board: Readonly<{
    readonly status: "observed" | "unavailable";
    readonly skipped: number;
    readonly indexCurrent: boolean | null;
    readonly claimedWithoutRoot: readonly string[];
  }>;
  readonly demands: readonly Readonly<{
    readonly demandId: string;
    readonly status: "observed" | "unavailable";
    readonly audit: VerifyGateStatus;
    readonly evidence: VerifyGateStatus;
    readonly appendCandidates: number;
  }>[];
  /** 非活动 Demand 的生命周期日志；目录读不出为 null。 */
  readonly strayJournals: readonly string[] | null;
  readonly claims: readonly Readonly<{ readonly windowId: string; readonly orphan: boolean }>[];
  readonly claimsUnreadable: number;
  /** hook 通道：`current` 是当前制品的宿主，只有它的目录缺席或零记录值得报出来（§13.97 D10）。 */
  readonly hooks: readonly Readonly<{
    readonly hostId: string;
    readonly current: boolean;
    readonly status: "observed" | "unavailable";
    readonly directory: "absent" | "private" | "mode";
    readonly records: number;
    readonly skipped: number;
  }>[];
  readonly windows: readonly Readonly<{
    readonly windowId: string;
    readonly identity: "registered" | "unregistered" | "unobserved";
  }>[];
  readonly pods: readonly Readonly<{
    readonly podId: string;
    readonly placement: "primary" | "worktree";
    readonly lifecycle: "open" | "closing";
    readonly state: "creating" | "ready" | "closing" | "closed" | "unobserved";
    readonly worktrees: readonly Readonly<{
      readonly repositoryId: string;
      readonly receipt: "absent" | "present" | "checkout-missing";
    }>[];
  }>[];
  /** primary pod 的仓库根 `.git` 是否都是目录（主检出）；仓库未观察为 null。 */
  readonly primaryCheckouts: boolean | null;
  readonly assets: readonly Readonly<{
    readonly hostId: string;
    readonly status: "current" | "missing" | "drift" | "mode" | "not-applicable" | "unavailable";
    readonly settings: "current" | "missing" | "drift" | "mode" | "unreadable" | "not-applicable";
  }>[];
  readonly projection: Readonly<{
    readonly status: "observed" | "unavailable";
    readonly targets: readonly Readonly<{
      readonly resourcePath: PortableResourcePath;
      readonly status: "current" | "missing" | "stale" | "unsafe";
      readonly reason: string | null;
      readonly digest: Sha256Digest | null;
    }>[];
  }>;
}

type Evidence = VerifyGate["evidence"];

const CODE_MAXIMUM_LENGTH = 256;
/**
 * 截断收尾用 `more-<剩余数>`：wire 的 `code` 只收 `[A-Za-z0-9._:,/-]` 且首字符必须是字母数字，
 * 所以收尾串既不能带 `+`，独占整个 code 时也要能自己起头。预留 `,more-` 六字符加六位数字。
 */
const CODE_TRUNCATION_PREFIX = "more-";
const CODE_SUFFIX_RESERVE = 12;

/** 把多个码连成一个 code（`,` 分隔）；超过 wire 上限时只保留放得下的前缀并以 `more-<剩余数>` 收尾。 */
function joinCodes(codes: readonly string[]): string | null {
  if (codes.length === 0) return null;
  const kept: string[] = [];
  for (const entry of codes) {
    const candidate = [...kept, entry].join(",");
    if (candidate.length > CODE_MAXIMUM_LENGTH - CODE_SUFFIX_RESERVE) break;
    kept.push(entry);
  }
  if (kept.length === codes.length) return kept.join(",");
  const rest = `${CODE_TRUNCATION_PREFIX}${codes.length - kept.length}`;
  return kept.length === 0 ? rest : `${kept.join(",")},${rest}`;
}

/** 域读不出时相关门的原因码：观察记录的 issue 已经是 `<域>:<原因>`，缺失时退回 `<域>:unavailable`。 */
function domainCode(name: string, domain: Readonly<{ readonly issue: string | null }>): string {
  return domain.issue ?? `${name}:unavailable`;
}

function gate(
  name: string,
  owner: string,
  status: VerifyGateStatus,
  code: string | null = null,
  evidence: Evidence = Object.freeze([]),
): Readonly<VerifyGate> {
  return Object.freeze({ name, owner, status, code, evidence });
}

function verdict(pass: boolean, unavailable: boolean): VerifyGateStatus {
  return unavailable ? "unavailable" : pass ? "pass" : "fail";
}

function aggregate(statuses: readonly VerifyGateStatus[]): VerifyGateStatus {
  if (statuses.some((status) => status === "fail")) return "fail";
  if (statuses.some((status) => status === "unavailable")) return "unavailable";
  return "pass";
}

function configGate(facts: WorkspaceGateFacts): Readonly<VerifyGate> {
  return gate(
    "config-authority",
    "config-authority",
    verdict(facts.configRecheck === "current", facts.configRecheck === "unavailable"),
    facts.configRecheck === "current" ? null : facts.configRecheck,
    Object.freeze([Object.freeze({ ref: facts.configRef, digest: facts.configDigest })]),
  );
}

/** local-layout：静态资源矩阵的对账预览 ready 且无步骤，加活动布局 current（§13.94 D3）。 */
function localLayoutGate(facts: WorkspaceGateFacts): Readonly<VerifyGate> {
  const local = facts.local;
  const pass = local.status === "ready" && facts.layout === "current";
  const codes = [
    ...(local.status === "ready" ? [] : [`local:${local.status}`, ...local.codes]),
    ...(facts.layout === "current" ? [] : [`active:${facts.layout}`]),
  ];
  return gate(
    "local-layout",
    "workspace-layout",
    verdict(pass, local.status === "unavailable" || facts.layout === "unavailable"),
    joinCodes(codes),
  );
}

function layoutGates(facts: WorkspaceGateFacts): readonly Readonly<VerifyGate>[] {
  return [
    localLayoutGate(facts),
    gate(
      "ledger-layout",
      "ledger",
      verdict(facts.ledger === "current", facts.ledger === "unavailable"),
      facts.ledger === "current" ? null : facts.ledger,
    ),
  ];
}

function boardGate(facts: WorkspaceGateFacts): Readonly<VerifyGate> {
  const board = facts.board;
  if (board.status !== "observed") {
    return gate("board-consistency", "requirement-board", "unavailable", "unavailable");
  }
  const own = [
    ...(board.skipped > 0 ? [`skipped:${board.skipped}`] : []),
    ...(board.indexCurrent === false ? ["index-stale"] : []),
  ];
  // claimed 指向活动 Demand 的对账需要活动 Demand 集合；demands 域读不出就不做，也不假装通过。
  const demands = facts.domains.demands;
  if (demands.status !== "observed") {
    return gate(
      "board-consistency",
      "requirement-board",
      "unavailable",
      joinCodes([...own, domainCode("demands", demands)]),
    );
  }
  const codes = [
    ...own,
    ...board.claimedWithoutRoot.map((demandId) => `claimed-without-root:${demandId}`),
  ];
  return gate(
    "board-consistency",
    "requirement-board",
    codes.length === 0 ? "pass" : "fail",
    joinCodes(codes),
  );
}

function demandGates(facts: WorkspaceGateFacts): readonly Readonly<VerifyGate>[] {
  const domain = facts.domains.demands;
  if (domain.status !== "observed") {
    const code = domainCode("demands", domain);
    return [
      gate("demand-root-audit", "demand-stream", "unavailable", code),
      gate("append-candidates-clear", "demand-stream", "unavailable", code),
      gate("evidence-integrity", "managed-evidence", "unavailable", code),
    ];
  }
  const unavailable = facts.demands.filter((demand) => demand.status !== "observed");
  const audit = aggregate([
    ...facts.demands.map((demand) => demand.audit),
    ...unavailable.map(() => "unavailable" as const),
  ]);
  const evidence = aggregate(facts.demands.map((demand) => demand.evidence));
  const candidates = facts.demands.reduce((sum, demand) => sum + demand.appendCandidates, 0);
  const strayCode = [
    ...(candidates > 0 ? [`candidates:${candidates}`] : []),
    ...(facts.strayJournals ?? []).map((demandId) => `journal:${demandId}`),
    ...(facts.strayJournals === null ? ["journals:unreadable"] : []),
  ];
  const strayStatus =
    facts.strayJournals === null ? "unavailable" : verdict(strayCode.length === 0, false);
  return [
    gate(
      "demand-root-audit",
      "demand-stream",
      audit,
      audit === "pass"
        ? null
        : joinCodes([
            ...new Set(
              [...facts.demands.filter((d) => d.audit !== "pass"), ...unavailable].map(
                (d) => d.demandId,
              ),
            ),
          ]),
    ),
    gate("append-candidates-clear", "demand-stream", strayStatus, joinCodes(strayCode)),
    gate(
      "evidence-integrity",
      "managed-evidence",
      evidence,
      evidence === "pass"
        ? null
        : joinCodes(facts.demands.filter((d) => d.evidence !== "pass").map((d) => d.demandId)),
    ),
  ];
}

function claimsGate(facts: WorkspaceGateFacts): Readonly<VerifyGate> {
  const claims = facts.domains.claims;
  if (claims.status !== "observed") {
    return gate("work-claims", "work-claims", "unavailable", domainCode("claims", claims));
  }
  const unreadable = facts.claimsUnreadable > 0 ? [`unreadable:${facts.claimsUnreadable}`] : [];
  // 孤儿判定要活动 Demand 集合；demands 域读不出就不把每份声明都算成孤儿。
  const demands = facts.domains.demands;
  if (demands.status !== "observed") {
    return gate(
      "work-claims",
      "work-claims",
      "unavailable",
      joinCodes([...unreadable, domainCode("demands", demands)]),
    );
  }
  const orphans = facts.claims
    .filter((claim) => claim.orphan)
    .map((claim) => `orphan:${claim.windowId}`);
  const code = [...orphans, ...unreadable];
  return gate("work-claims", "work-claims", code.length === 0 ? "pass" : "fail", joinCodes(code));
}

type HookGateFacts = WorkspaceGateFacts["hooks"][number];

/**
 * 一个宿主的 hook 通道码：不可用、模式不对、有读不出的记录是损坏；当前宿主的目录缺席或零记录
 * 不是损坏但值得看见——"hook 从未触发"（未信任、`node` 不在 PATH、cwd 匹配失败）在 verify 里
 * 以 `absent` / `records-0` 报出（§13.97 D10），同伴宿主的缺席保持沉默。
 */
function hookHostCode(host: HookGateFacts): string | null {
  if (host.status !== "observed") return "unavailable";
  if (host.directory === "mode") return "mode";
  if (host.skipped > 0) return `skipped-${host.skipped}`;
  if (!host.current) return null;
  if (host.directory === "absent") return "absent";
  return host.records === 0 ? "records-0" : null;
}

function hooksGate(facts: WorkspaceGateFacts): Readonly<VerifyGate> {
  const statuses = facts.hooks.map((host) =>
    verdict(host.directory !== "mode" && host.skipped === 0, host.status !== "observed"),
  );
  const status = aggregate(statuses);
  const code = facts.hooks.flatMap((host) => {
    const hostCode = hookHostCode(host);
    return hostCode === null ? [] : [`${host.hostId}:${hostCode}`];
  });
  return gate("host-hook-channel", "host-hooks", status, joinCodes(code));
}

function windowsGate(facts: WorkspaceGateFacts): Readonly<VerifyGate> {
  const unobserved = facts.windows.filter((window) => window.identity === "unobserved").length;
  const unregistered = facts.windows.filter((window) => window.identity === "unregistered").length;
  return gate(
    "window-identity",
    "window-identity",
    unobserved > 0 ? "unavailable" : "pass",
    unobserved > 0
      ? `unobserved:${unobserved}`
      : unregistered > 0
        ? `unregistered:${unregistered}`
        : null,
  );
}

type PodGateFacts = WorkspaceGateFacts["pods"][number];

/** code 里不算失败的两种过渡态：待登记（creating）与待处置（closing）。 */
const PENDING_POD_CODE_SUFFIXES = Object.freeze([":pending-registration", ":disposal-pending"]);

/**
 * worktree pod：回执要求只落在 ready（与 closing 的检出处置）上（§13.94 D3）。creating 的 pod
 * 还没登记窗口，回执缺席是过渡态——报 `pending-registration` 但不失败，否则 verify 会把只能靠
 * 窗口登记解决的状态指向工作区维护。closing 时仍在的检出只是待处置，也不算失败。
 */
function worktreePodCodes(pod: PodGateFacts): readonly string[] {
  return pod.worktrees.flatMap((worktree) => {
    if (pod.lifecycle === "closing") {
      return worktree.receipt === "present"
        ? [`${pod.podId}:${worktree.repositoryId}:disposal-pending`]
        : [];
    }
    if (worktree.receipt === "present") return [];
    if (pod.state === "creating") {
      return [`${pod.podId}:${worktree.repositoryId}:pending-registration`];
    }
    return [`${pod.podId}:${worktree.repositoryId}:${worktree.receipt}`];
  });
}

/** primary pod：仓库根必须是主检出（`.git` 是目录）；仓库未观察即 unavailable。 */
function primaryPodCodes(
  pod: PodGateFacts,
  primaryCheckouts: boolean | null,
): Readonly<{ readonly codes: readonly string[]; readonly unavailable: boolean }> {
  if (primaryCheckouts === null) return { codes: [], unavailable: true };
  return { codes: primaryCheckouts ? [] : [`${pod.podId}:main-checkout`], unavailable: false };
}

function podsGate(facts: WorkspaceGateFacts): Readonly<VerifyGate> {
  const domain = facts.domains.pods;
  if (domain.status !== "observed") {
    return gate("pod-execution-location", "pod", "unavailable", domainCode("pods", domain));
  }
  const codes: string[] = [];
  let unavailable = facts.pods.some((pod) => pod.state === "unobserved");
  for (const pod of facts.pods) {
    if (pod.placement === "primary") {
      const primary = primaryPodCodes(pod, facts.primaryCheckouts);
      codes.push(...primary.codes);
      unavailable = unavailable || primary.unavailable;
    } else {
      codes.push(...worktreePodCodes(pod));
    }
  }
  const failing = codes.some(
    (code) => !PENDING_POD_CODE_SUFFIXES.some((suffix) => code.endsWith(suffix)),
  );
  return gate(
    "pod-execution-location",
    "pod",
    failing ? "fail" : unavailable ? "unavailable" : "pass",
    joinCodes(codes),
  );
}

/** 资产字节与本地设置条目各一票：资产读不出、设置文件不是 JSON 对象算 unavailable。 */
function assetsGate(facts: WorkspaceGateFacts): Readonly<VerifyGate> {
  const applicable = facts.assets.filter((asset) => asset.status !== "not-applicable");
  const status = aggregate(
    applicable.flatMap((asset) => [
      verdict(asset.status === "current", asset.status === "unavailable"),
      verdict(asset.settings === "current", asset.settings === "unreadable"),
    ]),
  );
  const code =
    applicable.length === 0
      ? "not-applicable"
      : status === "pass"
        ? null
        : joinCodes(
            applicable.flatMap((asset) => [
              ...(asset.status === "current" ? [] : [`${asset.hostId}:${asset.status}`]),
              ...(asset.settings === "current"
                ? []
                : [`${asset.hostId}:settings-${asset.settings}`]),
            ]),
          );
  return gate("host-settings-assets", "host-assets", status, code);
}

/**
 * 门证据只收两份工作区页：每个活动 Demand 另有两份投影页，32 个 Demand 就会越过 wire 的
 * `evidence` 上限 64 而让整次 verify 变成 output-boundary。每 Demand 的页已经由
 * `status.projection.targets` 逐项带摘要，门不必重复它们。
 */
const PROJECTION_EVIDENCE_REFS: readonly PortableResourcePath[] = Object.freeze([
  WAKEFLOW_ACTIVE_WORKSPACE_INDEX_REF,
  WAKEFLOW_ACTIVE_WORKSPACE_STATUS_REF,
]);

function projectionGate(facts: WorkspaceGateFacts): Readonly<VerifyGate> {
  const targets = facts.projection.targets;
  const evidence = Object.freeze(
    targets.flatMap((target) =>
      target.digest === null || !PROJECTION_EVIDENCE_REFS.includes(target.resourcePath)
        ? []
        : [Object.freeze({ ref: target.resourcePath, digest: target.digest })],
    ),
  );
  if (facts.projection.status !== "observed") {
    return gate("active-projection", "active-projection", "unavailable", "unavailable", evidence);
  }
  const handwritten = targets.filter(
    (target) => target.status === "unsafe" && target.reason === "handwritten",
  );
  const broken = targets.filter(
    (target) =>
      target.status !== "current" &&
      !(target.status === "unsafe" && target.reason === "handwritten"),
  );
  // 手写文件让整轮零写：那是用户的选择，不是系统故障；同轮被挡下的兄弟文件只在 code 里报出。
  if (handwritten.length > 0) {
    return gate(
      "active-projection",
      "active-projection",
      "pass",
      broken.length === 0 ? "handwritten" : `handwritten,blocked:${broken.length}`,
      evidence,
    );
  }
  if (broken.length > 0) {
    return gate(
      "active-projection",
      "active-projection",
      "fail",
      joinCodes(
        broken.map(
          (target) => `${target.status}${target.reason === null ? "" : `-${target.reason}`}`,
        ),
      ),
      evidence,
    );
  }
  return gate("active-projection", "active-projection", "pass", null, evidence);
}

/** 十三道工作区门，按名字排序；每门只看纯事实。 */
export function deriveWorkspaceGates(
  facts: Readonly<WorkspaceGateFacts>,
): readonly Readonly<VerifyGate>[] {
  const gates = [
    configGate(facts),
    ...layoutGates(facts),
    boardGate(facts),
    ...demandGates(facts),
    claimsGate(facts),
    hooksGate(facts),
    windowsGate(facts),
    podsGate(facts),
    assetsGate(facts),
    projectionGate(facts),
  ];
  return Object.freeze([...gates].sort((left, right) => left.name.localeCompare(right.name)));
}

export interface VerifySummary {
  readonly ok: boolean;
  readonly summary: Readonly<{
    readonly pass: number;
    readonly fail: number;
    readonly unavailable: number;
  }>;
}

/** `ok` 要求至少一门且全部 pass；`unavailable` 算不通过但分开计数（能力卡 9 Q3）。 */
export function summarizeGates(
  gates: readonly Readonly<{ readonly status: VerifyGateStatus }>[],
): Readonly<VerifySummary> {
  const pass = gates.filter((entry) => entry.status === "pass").length;
  const fail = gates.filter((entry) => entry.status === "fail").length;
  const unavailable = gates.filter((entry) => entry.status === "unavailable").length;
  return Object.freeze({
    ok: gates.length > 0 && pass === gates.length,
    summary: Object.freeze({ pass, fail, unavailable }),
  });
}

/** verify 的 next：不通过时指向维护，列出未通过的门。 */
export function verifyNext(gates: readonly Readonly<VerifyGate>[]): Readonly<NextProjection> {
  const failing = gates.filter((entry) => entry.status !== "pass");
  if (failing.length === 0) {
    return Object.freeze({
      frontier: null,
      owner: "none",
      suggestedTool: null,
      blockers: Object.freeze([]),
    });
  }
  return Object.freeze({
    frontier: WORKSPACE_MAINTENANCE_FRONTIER,
    owner: "controller",
    suggestedTool: MAINTENANCE_TOOL,
    blockers: Object.freeze(failing.map((entry) => `${entry.name}:${entry.status}`)),
  });
}

export type ProjectionFreshness = "current" | "stale" | "missing" | "unsafe" | "unavailable";

export function projectionFreshness(
  targets:
    | readonly Readonly<{ readonly status: "current" | "missing" | "stale" | "unsafe" }>[]
    | null,
): ProjectionFreshness {
  if (targets === null) return "unavailable";
  if (targets.some((target) => target.status === "unsafe")) return "unsafe";
  if (targets.some((target) => target.status === "missing")) return "missing";
  if (targets.some((target) => target.status === "stale")) return "stale";
  return "current";
}

export { worktreeDisposalGuidance as disposalGuidance } from "../../governance/pod/worktree-disposal.js";
