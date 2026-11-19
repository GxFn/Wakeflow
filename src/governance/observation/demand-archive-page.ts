import type { Sha256Digest } from "../../foundation/crypto/sha256.js";
import { truncateToCodePoints } from "../../foundation/text/bounded-text.js";
import {
  implementationReportAnchorResults,
  implementationReportOutsideInstructions,
} from "../result/implementation-target-result-report.js";
import type { TargetResult } from "../result/target-result.js";
import type { TargetResultOutsideInstruction } from "../result/target-result-outside-instructions.js";
import type { ControllerReviewDecision } from "../review/controller-review-decision.js";
import type {
  DemandResultReviewSnapshot,
  DemandResultReviewTarget,
} from "../review/demand-result-review-snapshot.js";
import {
  parseTargetSessionPromptObservation,
  type TargetSessionPromptObservation,
  TargetSessionPromptObservationError,
} from "../result/target-session-prompts.js";
import type { TaskPackage } from "../tasking/task-package.js";
import type {
  DemandArchiveIdentityReadback,
  LocatedDemandArchiveSummary,
} from "./demand-archive-locator.js";
import type { DemandArchiveMeasures } from "./demand-archive-measures.js";

/**
 * Wakeflow Governance / Observation：一个已归档 Demand 的人读页面（open-items I22，1.4 第 3 段）。
 *
 * 页面是归档包的投影：四样固定内容——要求了什么、改了什么、验证了什么、还剩什么——加"任务包之外的指示"
 * 一栏（ADR-0030 决定 7）与三个度量，全部
 * 从封存的归档确定地渲染，可以随时重算；它不是记录，归档包才是。本模块只有事实的整理与纯渲染，不读盘。
 * 页面进账本（tracked），所以不含任何会话标识、窗口句柄或本机路径；来自 Agent 的文字先去掉控制字符、
 * 转义 Markdown 与 HTML 的结构字符再进页面，页面里的标记因此伪造不出来。
 */

export type DemandArchivePageLanguage = "en" | "zh-Hans";

/** 页面渲染器的版本：改渲染就加一，现存页面的标记随之失配，下一次刷新重写。 */
const DEMAND_ARCHIVE_PAGE_VERSION = 1 as const;

export interface DemandArchivePageAnchor {
  readonly anchorId: string;
  readonly claim: string;
  /** 目标自己对这条锚点的结论；报告是记录版本 1（未记录）或还没有报告时为 null。 */
  readonly result: Readonly<{ readonly status: string; readonly observed: string }> | null;
}

export interface DemandArchivePageDecision {
  readonly decision: string;
  readonly decidedAt: string;
  readonly rationale: string;
  readonly checks: readonly Readonly<{
    readonly method: string;
    readonly outcome: string;
    readonly observation: string;
  }>[];
  readonly blockingReasons: readonly string[];
  readonly residualRisks: readonly string[];
}

export interface DemandArchivePageReport {
  readonly outcome: string;
  readonly summary: string;
  readonly branch: string | null;
  readonly commits: readonly string[];
  readonly risks: readonly string[];
  /** 任务包之外收到的指示；记录版本 1 的报告没有记录，为 null。 */
  readonly outsideInstructions: readonly Readonly<TargetResultOutsideInstruction>[] | null;
  /** 测试目标的逐步记录；实现目标为 null。 */
  readonly test: Readonly<{
    readonly verdict: string;
    readonly steps: readonly Readonly<{
      readonly stepId: string;
      readonly verdict: string;
      readonly observed: string;
    }>[];
  }> | null;
}

export interface DemandArchivePageTarget {
  readonly targetTaskId: string;
  readonly workType: "implementation" | "test";
  /** 归档时目标所处的阶段（`accepted`、`test-accepted`、`rework-requested`……）。 */
  readonly phase: string;
  readonly accepted: boolean;
  readonly objective: string;
  readonly repositoryId: string | null;
  readonly anchors: readonly Readonly<DemandArchivePageAnchor>[];
  readonly report: Readonly<DemandArchivePageReport> | null;
  /** 按时间排列的全部评审决定：之前几轮的在前，最后一次的在后。 */
  readonly decisions: readonly Readonly<DemandArchivePageDecision>[];
  /** 导入那一刻 Wakeflow 对目标会话的越级观察（open-items H13）；1.4 之前的结果没有，为 null。 */
  readonly sessionPrompts: Readonly<TargetSessionPromptObservation> | null;
}

export interface DemandArchivePageFacts {
  readonly demandId: string;
  /** 归档修订目录的名字（十位数字）。 */
  readonly revision: string;
  readonly outcome: "completed" | "cancelled";
  readonly archivedAt: string;
  readonly manifestDigest: Sha256Digest;
  readonly identity: Readonly<DemandArchiveIdentityReadback>;
  readonly verify: Readonly<{ readonly gateCount: number; readonly failedCount: number }> | null;
  readonly evidenceCount: number;
  /** 归档里的评审历史读不出时为 null：页面仍然渲染，只是说明这一部分读不出。 */
  readonly targets: readonly Readonly<DemandArchivePageTarget>[] | null;
  /** 归档时还没有结果的目标：只有标识与阶段（任务包的正文不在评审历史里）。 */
  readonly pending: readonly Readonly<DemandArchivePagePendingTarget>[];
  readonly measures: Readonly<DemandArchiveMeasures> | null;
}

export interface DemandArchivePagePendingTarget {
  readonly targetTaskId: string;
  readonly workType: "implementation" | "test";
  readonly phase: string;
}

// ---- 事实的整理 ----------------------------------------------------------------

function decisionOf(decision: Readonly<ControllerReviewDecision>): DemandArchivePageDecision {
  return Object.freeze({
    decision: decision.decision,
    decidedAt: decision.decidedAt,
    rationale: decision.rationale,
    checks: Object.freeze(
      decision.independentChecks.map((check) =>
        Object.freeze({
          method: check.method,
          outcome: check.outcome,
          observation: check.observation,
        }),
      ),
    ),
    blockingReasons: Object.freeze([...decision.blockingReasons]),
    residualRisks: Object.freeze([...decision.residualRisks]),
  });
}

function reportOf(result: Readonly<TargetResult>): DemandArchivePageReport {
  const report = result.report;
  if (report.kind === "WakeflowImplementationTargetResultReport") {
    return Object.freeze({
      outcome: report.outcome,
      summary: report.summary,
      branch: report.repositoryChange.branch,
      commits: Object.freeze(report.repositoryChange.commits.map((commit) => commit.value)),
      risks: Object.freeze([...report.risks]),
      outsideInstructions: implementationReportOutsideInstructions(report),
      test: null,
    });
  }
  return Object.freeze({
    outcome: report.outcome,
    summary: report.summary,
    branch: null,
    commits: Object.freeze([]),
    risks: Object.freeze([...report.risks]),
    outsideInstructions: report.outsideInstructions ?? null,
    test: Object.freeze({
      verdict: report.verdict,
      steps: Object.freeze(
        report.steps.map((step) =>
          Object.freeze({ stepId: step.stepId, verdict: step.verdict, observed: step.observed }),
        ),
      ),
    }),
  });
}

function anchorsOf(
  taskPackage: Readonly<TaskPackage>,
  result: Readonly<TargetResult> | null,
): readonly Readonly<DemandArchivePageAnchor>[] {
  const reported =
    result !== null && result.report.kind === "WakeflowImplementationTargetResultReport"
      ? implementationReportAnchorResults(result.report)
      : null;
  return Object.freeze(
    taskPackage.acceptanceAnchors.map((anchor) => {
      const own = reported?.find((entry) => entry.anchorId === anchor.anchorId);
      return Object.freeze({
        anchorId: anchor.anchorId,
        claim: anchor.claim,
        result:
          own === undefined ? null : Object.freeze({ status: own.status, observed: own.observed }),
      });
    }),
  );
}

function repositoryIdOf(taskPackage: Readonly<TaskPackage>): string | null {
  return taskPackage.workType === "implementation" ? taskPackage.assignment.repositoryId : null;
}

function targetOf(
  target: Readonly<DemandResultReviewTarget>,
  observations: ReadonlyMap<string, Readonly<TargetSessionPromptObservation>>,
): DemandArchivePageTarget | null {
  // 还在等结果的目标只带任务包的标识与摘要，没有正文：页面在"还剩什么"里按标识列出它。
  if (target.status === "awaiting-result") return null;
  const decisions = target.priorReviewHistory.map((entry) => decisionOf(entry.decision));
  if (target.status === "review-decided") decisions.push(decisionOf(target.reviewDecision));
  const phase = target.status === "review-decided" ? target.phase : "result-reported";
  return Object.freeze({
    targetTaskId: target.targetTaskId,
    workType: target.taskPackage.workType,
    phase,
    accepted: phase === "accepted" || phase === "test-accepted",
    objective: target.taskPackage.objective,
    repositoryId: repositoryIdOf(target.taskPackage),
    anchors: anchorsOf(target.taskPackage, target.targetResult),
    report: reportOf(target.targetResult),
    decisions: Object.freeze(decisions),
    sessionPrompts: observations.get(target.targetResult.targetResultId) ?? null,
  });
}

export interface DemandArchivePageReviewHistory {
  readonly targets: readonly Readonly<DemandArchivePageTarget>[];
  readonly pending: readonly Readonly<DemandArchivePagePendingTarget>[];
}

/** 把归档里读出的评审快照整理成页面用的目标清单。 */
export function demandArchivePageHistoryOf(
  snapshot: Readonly<DemandResultReviewSnapshot>,
  observations: ReadonlyMap<string, Readonly<TargetSessionPromptObservation>> = new Map(),
): Readonly<DemandArchivePageReviewHistory> {
  const targets: Readonly<DemandArchivePageTarget>[] = [];
  const pending: Readonly<DemandArchivePagePendingTarget>[] = [];
  for (const target of snapshot.targets) {
    const shaped = targetOf(target, observations);
    if (shaped !== null) {
      targets.push(shaped);
      continue;
    }
    if (target.status !== "awaiting-result") continue;
    pending.push(
      Object.freeze({
        targetTaskId: target.targetTaskId,
        workType: target.workType,
        phase: target.phase,
      }),
    );
  }
  return Object.freeze({ targets: Object.freeze(targets), pending: Object.freeze(pending) });
}

/** 页面事实：归档回执、身份、评审历史与度量各自读不出时用 null 或空值顶上，页面照样渲染。 */
export function buildDemandArchivePageFacts(
  input: Readonly<{
    readonly summary: Readonly<LocatedDemandArchiveSummary>;
    readonly identity: Readonly<DemandArchiveIdentityReadback>;
    readonly evidenceCount: number;
    readonly history: Readonly<DemandArchivePageReviewHistory> | null;
    readonly measures: Readonly<DemandArchiveMeasures> | null;
  }>,
): Readonly<DemandArchivePageFacts> {
  const { summary } = input;
  return Object.freeze({
    demandId: summary.demandId,
    revision: summary.archiveRef.slice(summary.archiveRef.lastIndexOf("/") + 1),
    outcome: summary.outcome,
    archivedAt: summary.archivedAt,
    manifestDigest: summary.manifestDigest,
    identity: input.identity,
    verify: summary.verify,
    evidenceCount: input.evidenceCount,
    targets: input.history?.targets ?? null,
    pending: input.history?.pending ?? Object.freeze([]),
    measures: input.measures,
  });
}

type DemandArchivePageInput = Readonly<DemandArchivePageFacts>;

// ---- 文字 ----------------------------------------------------------------------

const TEXT = Object.freeze({
  en: Object.freeze({
    title: "Demand",
    notice: (revision: string) =>
      `Generated from the sealed archive beside this page (\`${revision}/\`). The archive is the record; this page is re-rendered from it and is never read back. Do not edit by hand.`,
    outcome: "Outcome",
    archived: "archived",
    requirement: "Requirement package",
    history: "Demand history",
    asked: "What was asked",
    doneWhen: "Done when",
    changed: "What changed",
    verified: "What was verified",
    remains: "What remains",
    measures: "Measures",
    target: "Target",
    untitled: "(no title recorded)",
    notRecorded: "(not recorded)",
    unreadable:
      "The review history in this archive could not be read, so targets, results and decisions are not shown here; the archive itself is unchanged.",
    noTargets: "No target was planned.",
    noChange: "No implementation result was recorded.",
    branch: "branch",
    commit: "commit",
    noCommit: "no commit recorded",
    reported: "The target reported",
    anchorHeader: "| Anchor | Claim | Target's result | Observed |",
    anchorsNotRecorded:
      "The target's result per anchor was not recorded (report record version 1).",
    testVerdict: "Test verdict",
    stepHeader: "| Step | Verdict | Observed |",
    decisions: "The Controller decided",
    check: "check",
    blocking: "blocking",
    evidence: "Managed evidence records",
    gates: (gates: number, failed: number) =>
      `Verification when archived: ${gates} gates, ${failed} failed`,
    gatesUnknown: "Verification when archived: not recorded",
    nothingLeft: "Nothing was recorded as left open.",
    residual: "Residual risk",
    risk: "Risk the target reported",
    interventions: "Instructions outside the task package",
    interventionsNote:
      "Two accounts side by side: what each target declared it was told to do outside its task package, and what Wakeflow itself counted in the target's session. Neither replaces the other.",
    interventionsNone: "None was declared.",
    declared: "declared by the target",
    observed: (outside: number, permit: number, nudge: number) =>
      `observed by Wakeflow between landing and result import: ${outside} prompt${outside === 1 ? "" : "s"} from outside the delivery, ${permit} carrying a Wakeflow permit, ${nudge} matching a continue phrase the Controller pushed`,
    observedAt: "at",
    unobserved: (reason: string) =>
      `Wakeflow could not observe the target session (${reason}); this is not a count of zero`,
    outsideNotRecorded: "not recorded (report record version 1)",
    notAccepted: "Not accepted when archived",
    noResult: "No result when archived",
    branchLeft: (branch: string) =>
      `Branch \`${branch}\` was recorded by the accepted result; this page cannot tell whether it has been merged`,
    steps: (commits: number, imports: number) =>
      `Recorded steps: ${commits} event commits, ${imports} of them result imports by target windows. Reads such as status and inspect leave no record, so this is not the number of tool calls.`,
    authored: (total: number, targets: number, perTarget: number) =>
      `Text the Controller wrote (task packages and review decisions): ${total} bytes over ${targets} target${targets === 1 ? "" : "s"}, ${perTarget} per target.`,
    review: (median: number, values: string) =>
      `Review phase (result imported to decision): median ${median} s (${values}).`,
    reviewNone: "Review phase: no decision followed a result in this archive.",
    measuresUnreadable: "The measures could not be computed from this archive.",
    more: (count: number) => `… ${count} more not shown`,
  }),
  "zh-Hans": Object.freeze({
    title: "Demand",
    notice: (revision: string) =>
      `本页由旁边封存的归档包（\`${revision}/\`）生成。归档包才是记录；本页随时可以从它重新渲染，不会被读回。请勿手改。`,
    outcome: "结局",
    archived: "归档于",
    requirement: "需求包",
    history: "Demand 历史",
    asked: "要求了什么",
    doneWhen: "怎样算完成",
    changed: "改了什么",
    verified: "验证了什么",
    remains: "还剩什么",
    measures: "度量",
    target: "目标",
    untitled: "（没有记录标题）",
    notRecorded: "（未记录）",
    unreadable: "这份归档里的评审历史读不出，目标、结果与决定因此没有显示；归档包本身没有变。",
    noTargets: "没有规划过目标。",
    noChange: "没有记录到实现结果。",
    branch: "分支",
    commit: "提交",
    noCommit: "没有记录提交",
    reported: "目标报告",
    anchorHeader: "| 锚点 | 主张 | 目标的结论 | 实际看到的 |",
    anchorsNotRecorded: "目标逐条锚点的结论未记录（报告的记录版本为 1）。",
    testVerdict: "测试判定",
    stepHeader: "| 步骤 | 判定 | 实际看到的 |",
    decisions: "Controller 的决定",
    check: "检查",
    blocking: "阻塞",
    evidence: "受管证据记录",
    gates: (gates: number, failed: number) => `归档时的校验：${gates} 道门，${failed} 道未通过`,
    gatesUnknown: "归档时的校验：未记录",
    nothingLeft: "没有记录到遗留事项。",
    residual: "剩余风险",
    risk: "目标报告的风险",
    interventions: "任务包之外的指示",
    interventionsNote:
      "两份说法并排：每个目标申报的、在任务包之外被要求做的事，以及 Wakeflow 自己在目标会话里数到的。谁也不替代谁。",
    interventionsNone: "没有申报。",
    declared: "目标申报",
    observed: (outside: number, permit: number, nudge: number) =>
      `Wakeflow 在落地到结果导入之间观察到：${outside} 条投递之外的 prompt，${permit} 条带 Wakeflow 的许可，${nudge} 条与 Controller 推过的续跑短句相符`,
    observedAt: "时刻",
    unobserved: (reason: string) => `Wakeflow 没能观察目标会话（${reason}）；这不是零条`,
    outsideNotRecorded: "未记录（报告的记录版本为 1）",
    notAccepted: "归档时未被接受",
    noResult: "归档时没有结果",
    branchLeft: (branch: string) =>
      `被接受的结果记录了分支 \`${branch}\`；本页无法得知它是否已经合并`,
    steps: (commits: number, imports: number) =>
      `留下记录的步数：${commits} 次事件提交，其中 ${imports} 次是目标窗口导入结果。读取（status、inspect）不留记录，所以这不是工具调用数。`,
    authored: (total: number, targets: number, perTarget: number) =>
      `Controller 手写的文字（任务包与评审决定）：${total} 字节，${targets} 个目标，每个目标 ${perTarget} 字节。`,
    review: (median: number, values: string) =>
      `评审阶段（结果导入到决定）：中位数 ${median} 秒（${values}）。`,
    reviewNone: "评审阶段：这份归档里没有跟在结果之后的决定。",
    measuresUnreadable: "这份归档算不出度量。",
    more: (count: number) => `…… 另有 ${count} 项未显示`,
  }),
});

type PageText = (typeof TEXT)[DemandArchivePageLanguage];

/** 详略两档：整页超过上限时用短的那一档再渲染一次。 */
export interface DemandArchivePageLimits {
  readonly paragraph: number;
  readonly cell: number;
  readonly list: number;
  readonly targets: number;
}

const DEMAND_ARCHIVE_PAGE_FULL_LIMITS: Readonly<DemandArchivePageLimits> = Object.freeze({
  paragraph: 2000,
  cell: 400,
  list: 24,
  targets: 64,
});

export const DEMAND_ARCHIVE_PAGE_COMPACT_LIMITS: Readonly<DemandArchivePageLimits> = Object.freeze({
  paragraph: 240,
  cell: 120,
  list: 6,
  targets: 24,
});

function isControlCodePoint(codePoint: number): boolean {
  return (
    codePoint < 0x20 ||
    (codePoint >= 0x7f && codePoint <= 0x9f) ||
    codePoint === 0x2028 ||
    codePoint === 0x2029
  );
}

/**
 * 一行安全的文字：控制字符换成空格、空白压成一个、按码点截断，再转义 Markdown 与 HTML 的结构字符——
 * 来自 Agent 的文字因此开不出标签、注释、链接、标题、代码段或表格列。
 */
export function demandArchivePageLine(value: string, maximumCodePoints: number): string {
  let stripped = "";
  for (const character of value) {
    stripped += isControlCodePoint(character.codePointAt(0) ?? 0) ? " " : character;
  }
  const bounded = truncateToCodePoints(stripped.replace(/\s+/gu, " ").trim(), maximumCodePoints);
  return bounded
    .replace(/\\/gu, "\\\\")
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/[`#[\]|]/gu, (character) => `\\${character}`);
}

/** 标识一类的值：只留可见 ASCII，放进行内代码。 */
function code(value: string): string {
  return `\`${value.replace(/[^\x21-\x7e]/gu, "?").replace(/`/gu, "'")}\``;
}

/** 列表超过上限时截断并说明还有多少没显示。 */
function capped<Item>(
  items: readonly Item[],
  maximum: number,
  text: PageText,
  render: (item: Item, index: number) => readonly string[],
): readonly string[] {
  const lines = items.slice(0, maximum).flatMap(render);
  return items.length > maximum ? [...lines, `- ${text.more(items.length - maximum)}`] : lines;
}

// ---- 四个段落 ------------------------------------------------------------------

interface RenderContext {
  readonly text: PageText;
  readonly limits: Readonly<DemandArchivePageLimits>;
}

function targetHeading(
  context: RenderContext,
  target: Readonly<DemandArchivePageTarget>,
  index: number,
): string {
  const repository = target.repositoryId === null ? "" : ` · ${code(target.repositoryId)}`;
  return `### ${context.text.target} ${index + 1} · ${target.workType}${repository} · ${target.phase}`;
}

function askedSection(context: RenderContext, facts: DemandArchivePageInput): readonly string[] {
  const { text, limits } = context;
  const targets =
    facts.targets === null
      ? [text.unreadable, ""]
      : facts.targets.length === 0
        ? [text.noTargets, ""]
        : capped(facts.targets, limits.targets, text, (target, index) => [
            targetHeading(context, target, index),
            "",
            demandArchivePageLine(target.objective, limits.paragraph),
            "",
            ...capped(target.anchors, limits.list, text, (anchor) => [
              `- ${code(anchor.anchorId)} ${demandArchivePageLine(anchor.claim, limits.cell)}`,
            ]),
            ...(target.anchors.length === 0 ? [] : [""]),
          ]);
  return [
    `## ${text.asked}`,
    "",
    facts.identity.goal === ""
      ? text.notRecorded
      : demandArchivePageLine(facts.identity.goal, limits.paragraph),
    "",
    `**${text.doneWhen}:** ${
      facts.identity.completionDefinition === ""
        ? text.notRecorded
        : demandArchivePageLine(facts.identity.completionDefinition, limits.paragraph)
    }`,
    "",
    ...targets,
  ];
}

function changeLine(
  context: RenderContext,
  target: Readonly<DemandArchivePageTarget>,
  index: number,
): readonly string[] {
  const { text, limits } = context;
  const report = target.report;
  if (report === null || target.workType !== "implementation") return [];
  const commit = report.commits.at(-1);
  const where = [
    report.branch === null ? null : `${text.branch} ${code(report.branch)}`,
    commit === undefined ? text.noCommit : `${text.commit} ${code(commit)}`,
  ].filter((part): part is string => part !== null);
  return [
    `- **${text.target} ${index + 1}** · ${target.phase} · ${report.outcome} · ${where.join(" · ")}`,
    `  ${demandArchivePageLine(report.summary, limits.paragraph)}`,
  ];
}

function changedSection(context: RenderContext, facts: DemandArchivePageInput): readonly string[] {
  const { text, limits } = context;
  const lines =
    facts.targets === null
      ? []
      : capped(facts.targets, limits.targets, text, (target, index) =>
          changeLine(context, target, index),
        );
  return [`## ${text.changed}`, "", ...(lines.length === 0 ? [text.noChange] : lines), ""];
}

function anchorTable(
  context: RenderContext,
  target: Readonly<DemandArchivePageTarget>,
): readonly string[] {
  const { text, limits } = context;
  if (target.anchors.length === 0) return [];
  if (target.anchors.every((anchor) => anchor.result === null)) {
    return [text.anchorsNotRecorded, ""];
  }
  return [
    text.anchorHeader,
    "| --- | --- | --- | --- |",
    ...target.anchors
      .slice(0, limits.list)
      .map(
        (anchor) =>
          `| ${code(anchor.anchorId)} | ${demandArchivePageLine(anchor.claim, limits.cell)} | ${anchor.result?.status ?? "—"} | ${anchor.result === null ? "—" : demandArchivePageLine(anchor.result.observed, limits.cell)} |`,
      ),
    "",
  ];
}

function stepTable(
  context: RenderContext,
  report: Readonly<DemandArchivePageReport>,
): readonly string[] {
  const { text, limits } = context;
  if (report.test === null) return [];
  return [
    `${text.testVerdict}: ${report.test.verdict}`,
    "",
    ...(report.test.steps.length === 0
      ? []
      : [
          text.stepHeader,
          "| --- | --- | --- |",
          ...report.test.steps
            .slice(0, limits.list)
            .map(
              (step) =>
                `| ${code(step.stepId)} | ${step.verdict} | ${demandArchivePageLine(step.observed, limits.cell)} |`,
            ),
          "",
        ]),
  ];
}

function decisionLines(
  context: RenderContext,
  decision: Readonly<DemandArchivePageDecision>,
  index: number,
): readonly string[] {
  const { text, limits } = context;
  return [
    `${index + 1}. **${decision.decision}** · ${decision.decidedAt} — ${demandArchivePageLine(decision.rationale, limits.paragraph)}`,
    ...decision.checks
      .slice(0, limits.list)
      .map(
        (check) =>
          `   - ${text.check} (${check.outcome}): ${demandArchivePageLine(check.method, limits.cell)} → ${demandArchivePageLine(check.observation, limits.cell)}`,
      ),
    ...decision.blockingReasons
      .slice(0, limits.list)
      .map((reason) => `   - ${text.blocking}: ${demandArchivePageLine(reason, limits.cell)}`),
  ];
}

function verifiedTarget(
  context: RenderContext,
  target: Readonly<DemandArchivePageTarget>,
  index: number,
): readonly string[] {
  const { text, limits } = context;
  const report = target.report;
  return [
    targetHeading(context, target, index),
    "",
    ...(report === null
      ? []
      : [
          `${text.reported}: ${report.outcome}`,
          "",
          ...anchorTable(context, target),
          ...stepTable(context, report),
        ]),
    ...(target.decisions.length === 0
      ? []
      : [
          `${text.decisions}:`,
          "",
          ...target.decisions
            .slice(-limits.list)
            .flatMap((decision, position) => decisionLines(context, decision, position)),
          "",
        ]),
  ];
}

function verifiedSection(context: RenderContext, facts: DemandArchivePageInput): readonly string[] {
  const { text, limits } = context;
  return [
    `## ${text.verified}`,
    "",
    ...(facts.targets === null
      ? []
      : capped(facts.targets, limits.targets, text, (target, index) =>
          verifiedTarget(context, target, index),
        )),
    `- ${text.evidence}: ${facts.evidenceCount}`,
    `- ${facts.verify === null ? text.gatesUnknown : text.gates(facts.verify.gateCount, facts.verify.failedCount)}`,
    "",
  ];
}

/** 一个目标申报的任务包之外的指示：记录版本 1 的报告没有记录，明说未记录。 */
function outsideLines(
  context: RenderContext,
  label: string,
  report: Readonly<DemandArchivePageReport>,
): readonly string[] {
  const { text, limits } = context;
  if (report.outsideInstructions === null) return [`- ${label}: ${text.outsideNotRecorded}`];
  return report.outsideInstructions
    .slice(0, limits.list)
    .map(
      (entry) =>
        `- ${label}: ${text.declared} (${entry.source}, ${entry.handling}) — ${demandArchivePageLine(entry.summary, limits.cell)}`,
    );
}

/**
 * "任务包之外的指示"（ADR-0030 决定 7 的"直接干预"一栏）：现在只有目标自己的申报；Wakeflow 自己的越级
 * 观察在 1.4 第 4 段加进这一栏。
 */
/** Wakeflow 自己的观察：只有条数与时刻。1.4 之前的结果没有观察，不出这一行。 */
function observedLines(
  context: RenderContext,
  label: string,
  observation: Readonly<TargetSessionPromptObservation> | null,
): readonly string[] {
  const { text } = context;
  if (observation === null) return [];
  if (observation.status === "unobserved") {
    return [`- ${label}: ${text.unobserved(observation.reason ?? "unobserved")}`];
  }
  const times =
    observation.outsideAt.length === 0
      ? ""
      : ` (${text.observedAt} ${observation.outsideAt.join(", ")})`;
  return [
    `- ${label}: ${text.observed(observation.outsidePrompts, observation.permitPrompts, observation.nudgePrompts)}${times}`,
  ];
}

function interventionsSection(
  context: RenderContext,
  facts: DemandArchivePageInput,
): readonly string[] {
  const { text, limits } = context;
  const lines =
    facts.targets === null
      ? [text.notRecorded]
      : capped(facts.targets, limits.targets, text, (target, index) => {
          const label = `${text.target} ${index + 1}`;
          return [
            ...(target.report === null ? [] : outsideLines(context, label, target.report)),
            ...observedLines(context, label, target.sessionPrompts),
          ];
        });
  return [
    `## ${text.interventions}`,
    "",
    `> ${text.interventionsNote}`,
    "",
    ...(lines.length === 0 ? [text.interventionsNone] : lines),
    "",
  ];
}

function remainsOfTarget(
  context: RenderContext,
  target: Readonly<DemandArchivePageTarget>,
  index: number,
): readonly string[] {
  const { text, limits } = context;
  const label = `${text.target} ${index + 1}`;
  const last = target.decisions.at(-1);
  const report = target.report;
  return [
    ...(target.accepted ? [] : [`- ${label}: ${text.notAccepted} (${target.phase})`]),
    ...(last?.residualRisks ?? [])
      .slice(0, limits.list)
      .map((risk) => `- ${label}: ${text.residual} — ${demandArchivePageLine(risk, limits.cell)}`),
    ...(report?.risks ?? [])
      .slice(0, limits.list)
      .map((risk) => `- ${label}: ${text.risk} — ${demandArchivePageLine(risk, limits.cell)}`),
    ...(target.accepted && report !== null && report.branch !== null
      ? [`- ${label}: ${text.branchLeft(report.branch.replace(/`/gu, "'"))}`]
      : []),
  ];
}

function remainsSection(context: RenderContext, facts: DemandArchivePageInput): readonly string[] {
  const { text, limits } = context;
  const lines = [
    ...(facts.targets === null
      ? [`- ${text.unreadable}`]
      : capped(facts.targets, limits.targets, text, (target, index) =>
          remainsOfTarget(context, target, index),
        )),
    ...facts.pending
      .slice(0, limits.list)
      .map(
        (target) =>
          `- ${code(target.targetTaskId)} (${target.workType}): ${text.noResult} (${target.phase})`,
      ),
  ];
  return [`## ${text.remains}`, "", ...(lines.length === 0 ? [text.nothingLeft] : lines), ""];
}

function measuresSection(context: RenderContext, facts: DemandArchivePageInput): readonly string[] {
  const { text } = context;
  const measures = facts.measures;
  if (measures === null) return [`## ${text.measures}`, "", text.measuresUnreadable, ""];
  const review = measures.reviewSeconds;
  return [
    `## ${text.measures}`,
    "",
    `- ${text.steps(measures.eventCommits, measures.resultImports)}`,
    `- ${text.authored(measures.authoredBytes.total, measures.targets, measures.authoredBytes.perTarget)}`,
    `- ${review.median === null ? text.reviewNone : text.review(review.median, review.values.slice(0, 16).join(", "))}`,
    "",
  ];
}

/** 页面的标记：渲染器版本、语言与归档清单的摘要；三者都没变就不必重新渲染。 */
export function demandArchivePageMarker(
  language: DemandArchivePageLanguage,
  manifestDigest: Sha256Digest,
): string {
  return `<!-- wakeflow:demand-archive-page:v${DEMAND_ARCHIVE_PAGE_VERSION}:${language}:${manifestDigest} -->`;
}

/** 渲染一个已归档 Demand 的页面；页面与它的归档修订目录同处 `archives/<demandId>/`。 */
export function renderDemandArchivePage(
  facts: DemandArchivePageInput,
  language: DemandArchivePageLanguage,
  limits: Readonly<DemandArchivePageLimits> = DEMAND_ARCHIVE_PAGE_FULL_LIMITS,
): string {
  const text = TEXT[language];
  const context: RenderContext = { text, limits };
  const title =
    facts.identity.title === ""
      ? text.untitled
      : demandArchivePageLine(facts.identity.title, limits.cell);
  const type = facts.identity.demandType === null ? "" : ` (${facts.identity.demandType})`;
  return `${[
    `# ${text.title}: ${title}`,
    "",
    demandArchivePageMarker(language, facts.manifestDigest),
    "",
    `> ${text.notice(facts.revision)}`,
    "",
    `- Demand: ${code(facts.demandId)}${type}`,
    `- ${text.outcome}: ${facts.outcome} · ${text.archived} ${facts.archivedAt}`,
    ...(facts.identity.requirementId === null
      ? []
      : [
          `- ${text.requirement}: [${code(facts.identity.requirementId)}](../../requirements/${facts.identity.requirementId}/)`,
        ]),
    `- [${text.history}](../../history.md)`,
    "",
    ...askedSection(context, facts),
    ...changedSection(context, facts),
    ...verifiedSection(context, facts),
    ...interventionsSection(context, facts),
    ...remainsSection(context, facts),
    ...measuresSection(context, facts),
  ]
    .join("\n")
    .trimEnd()}\n`;
}

/**
 * 归档事件里各份结果的越级观察，按结果标识取。形状不对的那一条当作没有——页面是投影，不为一条旁证失败。
 */
export function demandArchiveSessionPromptsOf(
  events: readonly Readonly<{
    readonly eventType: string;
    readonly data: Readonly<Record<string, unknown>>;
  }>[],
): ReadonlyMap<string, Readonly<TargetSessionPromptObservation>> {
  const observations = new Map<string, Readonly<TargetSessionPromptObservation>>();
  for (const event of events) {
    if (event.eventType !== "result.target-result-recorded") continue;
    const result = event.data.result;
    const resultId =
      typeof result === "object" && result !== null
        ? (result as { readonly targetResultId?: unknown }).targetResultId
        : undefined;
    if (typeof resultId !== "string" || event.data.sessionPrompts === undefined) continue;
    try {
      observations.set(resultId, parseTargetSessionPromptObservation(event.data.sessionPrompts));
    } catch (error: unknown) {
      if (!(error instanceof TargetSessionPromptObservationError)) throw error;
    }
  }
  return observations;
}
