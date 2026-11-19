import type { PrepareDeliveryResult } from "../capabilities/delivery/contract.js";
import type { DemandCreationResult } from "../capabilities/demand/contract.js";
import type { BoardInspectionResult } from "../capabilities/requirement/contract.js";
import { executeRequirementPublicationRequest } from "../capabilities/requirement/service.js";
import type { TargetTaskPlanningResult } from "../capabilities/tasking/contract.js";
import {
  readWakeflowConfigAuthoritySnapshot,
  type WakeflowConfigAuthoritySnapshot,
  WakeflowConfigAuthoritySnapshotError,
} from "../configuration/wakeflow-config-authority-snapshot.js";
import { computeCanonicalJsonSha256Digest } from "../foundation/crypto/canonical-json-sha256.js";
import { computeSha256Digest, type Sha256Digest } from "../foundation/crypto/sha256.js";
import {
  RootedDirectory,
  RootedDirectoryError,
} from "../foundation/filesystem/rooted-directory.js";
import { truncateToCodePoints } from "../foundation/text/bounded-text.js";
import { encodeUtf8 } from "../foundation/text/utf8.js";
import { assertNoActiveDemand } from "../governance/demand/publication/demand-active-guard.js";
import { fail, failWithBlockers, toWakeflowError, WakeflowError } from "../kernel/error.js";
import type { NextProjection } from "../kernel/next-projection.js";
import {
  admitQuickDemandResult,
  parseQuickDemandRequest,
  type QuickDemandRequest,
  type QuickDemandResult,
  WAKEFLOW_QUICK_DEMAND_PUBLIC_TOOL_NAME,
} from "./wakeflow-public-mcp-quick-demand-contract.js";
import type {
  WakeflowPublicMcpExecutionContext,
  WakeflowPublicMcpExecutor,
} from "./wakeflow-public-mcp-tool.js";

/**
 * Wakeflow Entrypoint / MCP：快速 Demand（ADR-0029 决定 9，open-items K9，1.4 第 4 段）。
 *
 * 使用者的一句话加一个仓库，一次确认，变成一份准备好投递的 Demand。它不是新的流程，是服务端按顺序执行
 * 四条现有的命令——发布需求、认领、规划一个实现目标、准备投递——每一步用从计划摘要派生的幂等键，所以
 * 整次调用可以原样重放；哪一步被拒就停在那里，留下的是普通工具接得上的状态。事件流与归档的格式与
 * 普通 Demand 相同，需求仍然是一份两个文档的需求包——文档由这里从那句话生成，不加新的需求类型。
 *
 * 限制是结构性的，不看改动大小：一个仓库、一个实现目标、Controller 自己核验（没有测试目标）、主 pod、
 * 工作区此刻空闲。超出任何一条就走普通路径。四条保证不变：写明的要求（生成的需求包进账本）、落地证明、
 * 结果绑定到提交（任务包要求提交）、一个接受的决定。预览零写；确认只有开头这一次。
 */

type Language = "en" | "zh-Hans";

const CRITERION_MAXIMUM_CODE_POINTS = 500;
/** 生成的需求包不占设计面里的文件；这两个路径只是发布请求里必填成员的占位。 */
const PLACEHOLDER_REQUIREMENT_PATH = "drafts/quick-demand/requirement.md";
const PLACEHOLDER_LANDING_PATH = "drafts/quick-demand/landing.md";

const TEXT = Object.freeze({
  en: Object.freeze({
    goal: "Goal",
    completion: "Completion definition",
    nonGoals: "Non-goals",
    criteria: "Acceptance criteria",
    confirmation: "User confirmation",
    completionBody: "The goal above is met and every acceptance criterion below holds.",
    nonGoalsBody:
      "Anything beyond the goal above. This is a quick Demand: one repository, one implementation task, no separate test target.",
    confirmationBody:
      "The user confirmed the goal, the completion definition, the non-goals and the testing decision in the Controller window before this package was published (quick Demand).",
    landingTitle: (title: string) => `${title} - landing`,
    codeFacts: "Verified code facts",
    codeFactsBody:
      "None were verified before publication. This is a quick Demand written from the user's request without a design pass; the implementation window verifies what it relies on.",
    landingPlan: "Landing plan and impact",
    landingPlanBody: (repository: string) =>
      `One implementation task in the repository ${repository}. Nothing else is in scope.`,
    testing: "Testing decision",
    testingBody:
      "controller-only: the Controller checks the result against the acceptance criteria.",
    testingSummary: "The Controller checks the result against the acceptance criteria.",
    context: [
      "This is a quick Demand: the requirement was written from the user's request and did not go through the Design window.",
      "No code fact was verified beforehand; verify what you rely on in this repository.",
    ],
    inScope: "The smallest change in this repository that meets the goal.",
    outOfScope: "Anything beyond the goal.",
    forbidden: "Changing another repository.",
    probe: "Check the change against this criterion and say what you observed.",
    expected: "The criterion holds as written.",
    boundary: "Stay inside this repository and do nothing beyond the goal.",
  }),
  "zh-Hans": Object.freeze({
    goal: "目标",
    completion: "完成定义",
    nonGoals: "非目标",
    criteria: "验收标准",
    confirmation: "用户确认",
    completionBody: "上面的目标达成，并且下面每一条验收标准都成立。",
    nonGoalsBody:
      "上述目标之外的任何改动。这是一个快速 Demand：一个仓库、一个实现任务、没有单独的测试目标。",
    confirmationBody:
      "用户在本需求包发布之前，于 Controller 窗口确认了目标、完成定义、非目标与测试决策（快速 Demand）。",
    landingTitle: (title: string) => `${title} - 落地`,
    codeFacts: "已核实的代码事实",
    codeFactsBody:
      "发布之前没有核实任何代码事实。这是一个快速 Demand，需求由使用者的一句话生成，没有经过设计；实现窗口自己核实它所依赖的事实。",
    landingPlan: "落地方案与影响范围",
    landingPlanBody: (repository: string) =>
      `仓库 ${repository} 里的一个实现任务，别的都不在范围内。`,
    testing: "测试决策",
    testingBody: "controller-only：由 Controller 对照验收标准核验结果。",
    testingSummary: "由 Controller 对照验收标准核验结果。",
    context: [
      "这是一个快速 Demand：需求由使用者的一句话生成，没有经过 Design 窗口。",
      "事先没有核实任何代码事实；你所依赖的事实请在本仓库里自己核实。",
    ],
    inScope: "在本仓库内达成目标所需的最小改动。",
    outOfScope: "目标之外的任何改动。",
    forbidden: "改动其他仓库。",
    probe: "对照这条标准核对改动，并说出你实际看到的。",
    expected: "这条标准如其所写地成立。",
    boundary: "只在本仓库内完成，不做目标之外的事。",
  }),
});

/** 一段话里以 `#` 开头的行会被当成章节标题：逐行转义，生成的文档里只有这里写下的那几个章节。 */
function paragraph(text: string): string {
  return text
    .normalize("NFC")
    .split("\n")
    .map((line) => (/^\s{0,3}#/u.test(line) ? `\\${line.trimStart()}` : line.trimEnd()))
    .join("\n")
    .trim();
}

function singleLine(text: string, maximum: number): string {
  return truncateToCodePoints(text.normalize("NFC").replace(/\s+/gu, " ").trim(), maximum);
}

interface QuickPlan {
  readonly language: Language;
  readonly title: string;
  readonly request: string;
  readonly repositoryId: string;
  readonly repositoryName: string | null;
  readonly designSurfaceId: string | null;
  readonly controllerWindowId: string | null;
  readonly podId: string | null;
  readonly criteria: readonly Readonly<{ readonly itemId: string; readonly text: string }>[];
  readonly requirement: string;
  readonly landing: string;
  readonly blockers: readonly string[];
}

function documentsOf(
  language: Language,
  title: string,
  request: string,
  criteria: QuickPlan["criteria"],
  repositoryLabel: string,
): Readonly<{ requirement: string; landing: string }> {
  const text = TEXT[language];
  const requirement = [
    `# ${title}`,
    "",
    `## ${text.goal}`,
    "",
    request,
    "",
    `## ${text.completion}`,
    "",
    text.completionBody,
    "",
    `## ${text.nonGoals}`,
    "",
    text.nonGoalsBody,
    "",
    `## ${text.criteria}`,
    "",
    ...criteria.map((entry, index) => `- AC-${index + 1} ${entry.text}`),
    "",
    `## ${text.confirmation}`,
    "",
    text.confirmationBody,
    "",
  ].join("\n");
  const landing = [
    `# ${text.landingTitle(title)}`,
    "",
    `## ${text.codeFacts}`,
    "",
    text.codeFactsBody,
    "",
    `## ${text.landingPlan}`,
    "",
    text.landingPlanBody(repositoryLabel),
    "",
    `## ${text.testing}`,
    "",
    text.testingBody,
    "",
  ].join("\n");
  return Object.freeze({ requirement, landing });
}

/** 结构性前提：仓库在配置里、主 pod 里恰好一个根是它的 product 窗口、有设计面、有 Controller 窗口。 */
function topologyOf(
  snapshot: Readonly<WakeflowConfigAuthoritySnapshot>,
  repositoryId: string,
): Readonly<
  Pick<QuickPlan, "repositoryName" | "designSurfaceId" | "controllerWindowId" | "podId"> & {
    readonly blockers: readonly string[];
  }
> {
  const model = snapshot.model;
  const blockers: string[] = [];
  const pod = model.pods.find((entry) => entry.placement === "primary") ?? null;
  if (pod === null) blockers.push("primary-pod-missing");
  const repository = model.topology.repositories.find(
    (entry) => entry.repositoryId === repositoryId,
  );
  if (repository === undefined) blockers.push("repository-unknown");
  const windows = model.topology.windows.filter((window) => window.podId === pod?.podId);
  const product = windows.filter(
    (window) =>
      window.role === "product" &&
      window.root.kind === "repository" &&
      window.root.repositoryId === repositoryId,
  );
  if (repository !== undefined && product.length === 0) blockers.push("repository-window-missing");
  if (product.length > 1) blockers.push("repository-window-ambiguous");
  const controller = windows.find((window) => window.role === "controller");
  if (controller === undefined) blockers.push("controller-window-missing");
  const surface = model.topology.supportSurfaces.find((entry) => entry.capability === "design");
  if (surface === undefined) blockers.push("design-surface-missing");
  return Object.freeze({
    repositoryName: repository?.displayName ?? null,
    designSurfaceId: surface?.surfaceId ?? null,
    controllerWindowId: controller?.windowId ?? null,
    podId: pod?.podId ?? null,
    blockers: Object.freeze(blockers),
  });
}

function planOf(
  snapshot: Readonly<WakeflowConfigAuthoritySnapshot>,
  request: QuickDemandRequest,
): Readonly<QuickPlan> {
  const language = snapshot.model.presentation.language;
  const title = singleLine(request.title, 120);
  const goal = paragraph(request.request);
  const criteria = (request.doneWhen ?? [request.request]).map((entry, index) =>
    Object.freeze({
      itemId: `ac-${index + 1}`,
      text: singleLine(entry, CRITERION_MAXIMUM_CODE_POINTS),
    }),
  );
  const topology = topologyOf(snapshot, request.repositoryId);
  const documents = documentsOf(
    language,
    title,
    goal,
    criteria,
    topology.repositoryName ?? request.repositoryId,
  );
  return Object.freeze({
    language,
    title,
    request: goal,
    repositoryId: request.repositoryId,
    ...topology,
    criteria: Object.freeze(criteria),
    ...documents,
  });
}

/** 计划摘要只盖调用方确认的内容与解析出来的拓扑；确认时间不在里面，所以预览与应用算出同一个值。 */
function planDigestOf(plan: Readonly<QuickPlan>): Sha256Digest {
  return computeCanonicalJsonSha256Digest({
    kind: "WakeflowQuickDemandPlan",
    schemaVersion: 1,
    language: plan.language,
    title: plan.title,
    repositoryId: plan.repositoryId,
    designSurfaceId: plan.designSurfaceId,
    controllerWindowId: plan.controllerWindowId,
    podId: plan.podId,
    requirementDigest: computeSha256Digest(encodeUtf8(plan.requirement, "$plan")),
    landingDigest: computeSha256Digest(encodeUtf8(plan.landing, "$plan")),
  });
}

function packageOf(plan: Readonly<QuickPlan>, confirmedAt: string | null) {
  return {
    designSurfaceId: plan.designSurfaceId,
    title: plan.title,
    demandType: "requirement",
    priority: "P2",
    originWindowId: plan.controllerWindowId,
    testingDecision: { mode: "controller-only", summary: TEXT[plan.language].testingSummary },
    requirementPath: PLACEHOLDER_REQUIREMENT_PATH,
    landingPath: PLACEHOLDER_LANDING_PATH,
    ...(confirmedAt === null ? {} : { confirmation: { confirmedAt } }),
  };
}

type Context = Readonly<WakeflowPublicMcpExecutionContext>;

function publish(
  root: string,
  plan: Readonly<QuickPlan>,
  body: Readonly<Record<string, unknown>>,
  confirmedAt: string | null,
  context: Context,
) {
  return executeRequirementPublicationRequest(
    { root, action: "publish", package: packageOf(plan, confirmedAt), ...body },
    {
      signal: context.signal,
      inlineDocuments: { requirement: plan.requirement, landing: plan.landing },
    },
  );
}

/** 主 pod 此刻有活动的 Demand（或有没收尾的 pod 事务）时，快速 Demand 不可用。 */
async function idleBlockers(root: string, podId: string | null, context: Context) {
  let directory: RootedDirectory;
  try {
    directory = await RootedDirectory.open(root, "$request.root");
  } catch (error: unknown) {
    if (error instanceof RootedDirectoryError) {
      fail("invalid-request", "workspace-root", "$request.root", { cause: error });
    }
    throw error;
  }
  try {
    await assertNoActiveDemand(directory, context.signal, null, podId);
    return Object.freeze([]);
  } catch (error: unknown) {
    if (!(error instanceof WakeflowError) || error.code !== "precondition-failed") throw error;
    const demandId = error.toPublicDetails().details?.demandId;
    return Object.freeze([demandId === undefined ? error.reason : `${error.reason}:${demandId}`]);
  } finally {
    await directory.close();
  }
}

async function readSnapshot(root: string, context: Context) {
  let directory: RootedDirectory;
  try {
    directory = await RootedDirectory.open(root, "$request.root");
  } catch (error: unknown) {
    if (error instanceof RootedDirectoryError) {
      fail("invalid-request", "workspace-root", "$request.root", { cause: error });
    }
    throw error;
  }
  try {
    return await readWakeflowConfigAuthoritySnapshot(directory, { signal: context.signal });
  } catch (error: unknown) {
    if (error instanceof WakeflowConfigAuthoritySnapshotError) {
      if (error.reason === "aborted") fail("io-failure", "aborted", "$signal", { cause: error });
      fail("precondition-failed", `config-${error.reason}`, "$request.root", { cause: error });
    }
    throw error;
  } finally {
    await directory.close();
  }
}

/** 发布这一步的预览里，"还没有确认"不算快速 Demand 的阻塞项：确认发生在预览之后。 */
const CONFIRMATION_BLOCKER = "user-confirmation-missing";

async function previewBlockers(
  root: string,
  plan: Readonly<QuickPlan>,
  context: Context,
): Promise<readonly string[]> {
  if (plan.blockers.length > 0) return plan.blockers;
  const idle = await idleBlockers(root, plan.podId, context);
  const publication = await publish(root, plan, { mode: "preview" }, null, context);
  if (publication.kind !== "WakeflowRequirementPublicationPreview") {
    fail("unexpected", "quick-publication-preview", "$request");
  }
  return Object.freeze([
    ...idle,
    ...publication.blockers.filter((blocker) => blocker !== CONFIRMATION_BLOCKER),
  ]);
}

const STEPS = Object.freeze(["publish", "claim", "plan", "prepare"] as const);
type Step = (typeof STEPS)[number];

function waitingNext(blockers: readonly string[]): Readonly<NextProjection> {
  return Object.freeze({
    frontier: "requirement-confirmation",
    owner: blockers.length === 0 ? ("user" as const) : ("controller" as const),
    suggestedTool: blockers.length === 0 ? WAKEFLOW_QUICK_DEMAND_PUBLIC_TOOL_NAME : null,
    blockers: Object.freeze([...blockers]),
  });
}

function previewResult(
  plan: Readonly<QuickPlan>,
  blockers: readonly string[],
): Readonly<QuickDemandResult> {
  const ready = blockers.length === 0;
  return admitQuickDemandResult({
    kind: "WakeflowQuickDemandPreview" as const,
    schemaVersion: 1 as const,
    tool: WAKEFLOW_QUICK_DEMAND_PUBLIC_TOOL_NAME,
    mode: "preview" as const,
    status: ready ? ("ready" as const) : ("blocked" as const),
    blockers: [...blockers],
    planDigest: ready ? planDigestOf(plan) : null,
    summary: {
      title: plan.title,
      repositoryId: plan.repositoryId,
      repositoryName: plan.repositoryName,
      language: plan.language,
      criteria: plan.criteria.map((entry) => ({ ...entry })),
      requirement: plan.requirement,
      landing: plan.landing,
      steps: [...STEPS],
    },
    next: waitingNext(blockers),
  });
}

/** 每一步自己的幂等键：由计划摘要派生，所以同一次确认重放时每一步都重放。 */
function stepKey(planDigest: string, step: Step): string {
  return `quick.${planDigest.slice("sha256:".length, "sha256:".length + 40)}.${step}`;
}

function taskPackageOf(plan: Readonly<QuickPlan>, requirementId: string, recordDigest: string) {
  const text = TEXT[plan.language];
  return {
    assignment: { repositoryId: plan.repositoryId },
    workType: "implementation",
    objective: plan.request,
    confirmedContext: [...text.context],
    selectedAuthorityMemberRefs: [
      `requirements/${requirementId}/requirement.md`,
      `requirements/${requirementId}/landing.md`,
    ],
    boundaries: {
      inScope: [text.inScope],
      outOfScope: [text.outOfScope],
      forbidden: [text.forbidden],
    },
    completionExpectations: plan.criteria.map((entry) => entry.text),
    // 四条保证之一：结果绑定到提交。
    commitExpectation: "commit",
    acceptanceAnchors: plan.criteria.map((entry) => ({
      anchorId: entry.itemId,
      claim: entry.text,
      probe: text.probe,
      expected: text.expected,
      requirementRef: { recordDigest, sectionAnchor: "acceptance-criteria", itemId: entry.itemId },
    })),
    lineage: null,
    sectionAnchors: ["goal"],
  };
}

export interface QuickDemandExecutors {
  readonly inspectBoard: WakeflowPublicMcpExecutor<BoardInspectionResult>;
  readonly createDemand: WakeflowPublicMcpExecutor<DemandCreationResult>;
  readonly planTargetTask: WakeflowPublicMcpExecutor<TargetTaskPlanningResult>;
  readonly prepareDelivery: WakeflowPublicMcpExecutor<PrepareDeliveryResult>;
}

interface Progress {
  requirementId: string | null;
  demandId: string | null;
  targetTaskId: string | null;
  next: Readonly<NextProjection>;
  delivery: Readonly<PrepareDeliveryResult> | null;
  readonly steps: { step: Step; status: string; error?: Readonly<Record<string, unknown>> }[];
}

const CLAIM_STREAM_REVISION = 1;

/** 已经认领了这份需求包的 Demand；包还没有发布或还没有被认领时为 null。 */
async function claimingDemandOf(
  root: string,
  requirementId: string,
  executors: Readonly<QuickDemandExecutors>,
  context: Context,
): Promise<string | null> {
  try {
    const board = await executors.inspectBoard({ root, view: "package", requirementId }, context);
    return "package" in board ? (board.package.claim?.demandId ?? null) : null;
  } catch (error: unknown) {
    if (error instanceof WakeflowError && error.code === "not-found") return null;
    throw error;
  }
}

/**
 * 应用之前再核一次工作区是否空闲——预览之后可能有别的 Demand 被认领了。在发布之前核，免得留下一份
 * 没人认领的需求包。唯一的例外是重放：占着 pod 的就是认领了这份需求包的那个快速 Demand 自己。
 */
async function assertIdleOrOwn(
  request: QuickDemandRequest,
  plan: Readonly<QuickPlan>,
  requirementId: string | null,
  executors: Readonly<QuickDemandExecutors>,
  context: Context,
): Promise<void> {
  const busy = await idleBlockers(request.root, plan.podId, context);
  if (busy.length === 0) return;
  const own =
    requirementId === null
      ? null
      : await claimingDemandOf(request.root, requirementId, executors, context);
  if (own !== null && busy.includes(`pod-busy:${own}`)) return;
  failWithBlockers(busy, "$request");
}

/**
 * 认领这一步。同一次确认重放时需求包已经被第一次认领走了：需求包的标识由内容与确认时间派生，
 * 认领它的只能是这同一个快速 Demand，所以沿用那个 Demand，不再认领一遍。
 */
async function claim(
  request: QuickDemandRequest,
  plan: Readonly<QuickPlan>,
  requirementId: string,
  executors: Readonly<QuickDemandExecutors>,
  context: Context,
  progress: Progress,
): Promise<string> {
  const existing = await claimingDemandOf(request.root, requirementId, executors, context);
  if (existing !== null) {
    progress.demandId = existing;
    progress.steps.push({ step: "claim", status: "current" });
    return existing;
  }
  const created = await executors.createDemand(
    {
      root: request.root,
      mode: "apply",
      requirementId,
      demand: {
        title: plan.title,
        goal: plan.request,
        completionDefinition: TEXT[plan.language].completionBody,
      },
    },
    context,
  );
  if (created.kind !== "WakeflowDemandCreationMutation") {
    failWithBlockers(created.blockers, "$request");
  }
  progress.demandId = created.publication.demandId;
  progress.next = created.next;
  progress.steps.push({ step: "claim", status: created.disposition });
  return created.publication.demandId;
}

/** 按顺序走四步；哪一步抛出已归类的拒绝就停在那一步，之前的各步已经落账。 */
async function runSteps(
  request: QuickDemandRequest,
  plan: Readonly<QuickPlan>,
  planDigest: Sha256Digest,
  executors: Readonly<QuickDemandExecutors>,
  context: Context,
  progress: Progress,
): Promise<void> {
  const confirmedAt = request.confirmation?.confirmedAt ?? null;
  const preview = await publish(request.root, plan, { mode: "preview" }, confirmedAt, context);
  if (preview.kind !== "WakeflowRequirementPublicationPreview" || preview.planDigest === null) {
    failWithBlockers(
      preview.kind === "WakeflowRequirementPublicationPreview" ? preview.blockers : [],
      "$request",
    );
  }
  await assertIdleOrOwn(request, plan, preview.requirementId, executors, context);
  const published = await publish(
    request.root,
    plan,
    { mode: "apply", planDigest: preview.planDigest },
    confirmedAt,
    context,
  );
  if (published.kind !== "WakeflowRequirementPublicationMutation") {
    fail("unexpected", "quick-publication", "$request");
  }
  progress.requirementId = published.package.requirementId;
  progress.next = published.next;
  progress.steps.push({ step: "publish", status: published.disposition });

  const demandId = await claim(
    request,
    plan,
    published.package.requirementId,
    executors,
    context,
    progress,
  );

  const planned = await executors.planTargetTask(
    {
      root: request.root,
      demandId,
      idempotencyKey: stepKey(planDigest, "plan"),
      // 认领是事件流的第一条事件，规划紧跟其后；重放时也是同一个值，规划的请求因此逐字节相同。
      expectedStreamRevision: CLAIM_STREAM_REVISION,
      taskPackage: taskPackageOf(
        plan,
        published.package.requirementId,
        published.package.recordDigest,
      ),
    },
    context,
  );
  progress.targetTaskId = planned.targetTask.targetTaskId;
  progress.next = planned.next;
  progress.steps.push({ step: "plan", status: planned.status });

  const prepared = await executors.prepareDelivery(
    {
      root: request.root,
      demandId,
      idempotencyKey: stepKey(planDigest, "prepare"),
      expectedStreamRevision: planned.event.streamRevision,
      targetTaskId: planned.targetTask.targetTaskId,
      authored: {
        goal: plan.request,
        focus: plan.criteria.slice(0, 2).map((entry) => entry.text),
        boundary: TEXT[plan.language].boundary,
      },
      language: plan.language,
    },
    context,
  );
  progress.delivery = prepared;
  progress.next = prepared.next;
  progress.steps.push({ step: "prepare", status: prepared.status });
}

function mutationResult(progress: Progress, stoppedAt: Step | null): Readonly<QuickDemandResult> {
  return admitQuickDemandResult({
    kind: "WakeflowQuickDemandMutation" as const,
    schemaVersion: 1 as const,
    tool: WAKEFLOW_QUICK_DEMAND_PUBLIC_TOOL_NAME,
    mode: "apply" as const,
    status: stoppedAt === null ? ("prepared" as const) : ("stopped" as const),
    stoppedAt,
    requirementId: progress.requirementId,
    demandId: progress.demandId,
    targetTaskId: progress.targetTaskId,
    steps: progress.steps,
    ...(progress.delivery === null ? {} : { delivery: progress.delivery }),
    next: progress.next,
  });
}

async function apply(
  request: QuickDemandRequest,
  plan: Readonly<QuickPlan>,
  executors: Readonly<QuickDemandExecutors>,
  context: Context,
): Promise<Readonly<QuickDemandResult>> {
  if (plan.blockers.length > 0) failWithBlockers(plan.blockers, "$request.repositoryId");
  const planDigest = planDigestOf(plan);
  if (request.planDigest !== planDigest) {
    fail("precondition-failed", "plan-drift", "$request.planDigest");
  }
  const progress: Progress = {
    requirementId: null,
    demandId: null,
    targetTaskId: null,
    next: waitingNext([]),
    delivery: null,
    steps: [],
  };
  try {
    await runSteps(request, plan, planDigest, executors, context, progress);
    return mutationResult(progress, null);
  } catch (error: unknown) {
    if (context.signal.aborted) throw error;
    const failure = toWakeflowError(error, "$request");
    // 没人认领的错误是编程错误的出口；什么都还没落账时原样拒绝，调用方看到的就是那一步的拒绝。
    if (failure.code === "unexpected" || progress.steps.length === 0) throw error;
    const stoppedAt = STEPS[progress.steps.length] ?? "prepare";
    progress.steps.push({ step: stoppedAt, status: "refused", error: failure.toPublicDetails() });
    return mutationResult(progress, stoppedAt);
  }
}

/** 快速 Demand 的 executor：认领、规划与准备投递用组合根给的那三个，发布直接走需求切片。 */
export function createQuickDemandExecutor(
  executors: Readonly<QuickDemandExecutors>,
): WakeflowPublicMcpExecutor<QuickDemandResult> {
  return async (value, context) => {
    const request = parseQuickDemandRequest(value);
    const plan = planOf(await readSnapshot(request.root, context), request);
    if (request.mode === "apply") return apply(request, plan, executors, context);
    return previewResult(plan, await previewBlockers(request.root, plan, context));
  };
}
