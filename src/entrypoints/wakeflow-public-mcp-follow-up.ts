import type { DemandCompletionResult } from "../capabilities/demand/contract.js";
import type { ImplementationReviewDecisionResult } from "../capabilities/result-review/contract.js";
import type { TargetTaskPlanningResult } from "../capabilities/tasking/contract.js";
import { computeSha256Digest } from "../foundation/crypto/sha256.js";
import { encodeUtf8 } from "../foundation/text/utf8.js";
import { fail, toWakeflowError } from "../kernel/error.js";
import type {
  WakeflowPublicMcpExecutionContext,
  WakeflowPublicMcpExecutor,
} from "./wakeflow-public-mcp-tool.js";

/**
 * Wakeflow Entrypoint / MCP：接受之后紧接着的那一步，一次调用（ADR-0029 决定 9、10，1.4 第 4 段）。
 *
 * 实现评审的 accept 请求可以带上两样之一：
 * - `thenPlan`——下一份任务包："接受上一份并续接下一份"；
 * - `thenComplete`——"接受即归档"：完成的预览没有阻塞项时直接完成并归档，快速 Demand 就这样收尾。
 *
 * 这里按顺序执行现有的命令：先记下决定，决定落账之后再走第二步。每条命令各自是一次提交、各自校验
 * 自己的请求；这不是一个跨切片的事务：第二步被拒或被阻塞时 accept 仍然成立，结果里带着原因，
 * Controller 用对应的工具接着做即可。切片之间互不引用，所以这个组合放在入口层。谱系规则与完成的各道门
 * 都不变，仍由规划与完成自己把关。
 */

interface FollowUp {
  readonly root: unknown;
  readonly demandId: unknown;
  readonly idempotencyKey: string;
  readonly decision: unknown;
  readonly plan: Readonly<{ readonly taskPackage: unknown; readonly planReview: unknown }> | null;
  readonly complete: boolean;
}

function recordOf(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null;
}

/** 请求里的后续一步；两样都没带即 null。形状不对的交给决定自己的 Schema 去拒绝。 */
function followUpOf(value: unknown): Readonly<FollowUp> | null {
  const request = recordOf(value);
  if (request === null || typeof request.idempotencyKey !== "string") return null;
  const thenPlan = recordOf(request.thenPlan);
  const complete = request.thenComplete === true;
  if (thenPlan === null && !complete) return null;
  return Object.freeze({
    root: request.root,
    demandId: request.demandId,
    idempotencyKey: request.idempotencyKey,
    decision: request.decision,
    plan:
      thenPlan === null
        ? null
        : Object.freeze({ taskPackage: thenPlan.taskPackage, planReview: thenPlan.planReview }),
    complete,
  });
}

/** 在记下任何东西之前拒绝说不通的组合。 */
function assertFollowUp(followUp: Readonly<FollowUp>): void {
  if (followUp.plan !== null && followUp.complete) {
    fail("invalid-request", "then-plan-and-then-complete", "$request.thenComplete");
  }
  if (followUp.decision !== "accept") {
    fail(
      "invalid-request",
      followUp.complete ? "then-complete-requires-accept" : "then-plan-requires-accept",
      followUp.complete ? "$request.thenComplete" : "$request.thenPlan",
    );
  }
}

/** 规划这一步的幂等键：由决定的键派生，长度固定，所以同一次调用重放时两步都重放。 */
function followUpIdempotencyKey(decisionKey: string): string {
  const digest = computeSha256Digest(encodeUtf8(decisionKey, "$request.idempotencyKey"));
  return `then-plan.${digest.slice("sha256:".length, "sha256:".length + 40)}`;
}

/**
 * 规划所依据的流修订：决定事件自己的修订。accept 的那次提交只有这一个事件，所以它就是决定落账之后的
 * 那一刻；取它而不取结果里 `next` 的修订，是因为重放时 `next` 说的是现在——规划的请求必须与第一次
 * 逐字节相同，幂等重放才认它。两步之间若有别的窗口先提交了，规划以修订不符被拒并随结果交回。
 */
function revisionAfter(decided: Readonly<ImplementationReviewDecisionResult>): number {
  return decided.event.streamRevision;
}

type Context = Readonly<WakeflowPublicMcpExecutionContext>;
type Decided = Readonly<ImplementationReviewDecisionResult>;

/** 第二步的已归类拒绝随结果交回；取消与没人认领的错误（编程错误的出口）照常上抛。 */
function refusalOf(error: unknown, context: Context, path: string) {
  if (context.signal.aborted) throw error;
  const failure = toWakeflowError(error, path);
  if (failure.code === "unexpected") throw error;
  return failure.toPublicDetails();
}

async function planNext(
  decided: Decided,
  followUp: Readonly<FollowUp>,
  plan: WakeflowPublicMcpExecutor<TargetTaskPlanningResult>,
  context: Context,
): Promise<Decided> {
  try {
    const planning = await plan(
      {
        root: followUp.root,
        demandId: followUp.demandId,
        idempotencyKey: followUpIdempotencyKey(followUp.idempotencyKey),
        expectedStreamRevision: revisionAfter(decided),
        taskPackage: followUp.plan?.taskPackage,
        ...(followUp.plan?.planReview === undefined
          ? {}
          : { planReview: followUp.plan.planReview }),
      },
      context,
    );
    // 下一步从规划的结果继续：决定自己的 `next` 说的是规划之前的那一刻。
    return Object.freeze({
      ...decided,
      next: planning.next,
      thenPlan: Object.freeze({ status: "planned" as const, planning }),
    });
  } catch (error: unknown) {
    return Object.freeze({
      ...decided,
      thenPlan: Object.freeze({
        status: "refused" as const,
        error: refusalOf(error, context, "$request.thenPlan"),
      }),
    });
  }
}

async function completeNow(
  decided: Decided,
  followUp: Readonly<FollowUp>,
  complete: WakeflowPublicMcpExecutor<DemandCompletionResult>,
  context: Context,
): Promise<Decided> {
  try {
    const request = { root: followUp.root, demandId: followUp.demandId };
    const preview = await complete({ ...request, mode: "preview" }, context);
    if (preview.kind !== "WakeflowDemandCompletionPreview") {
      fail("unexpected", "completion-preview", "$request.thenComplete");
    }
    if (preview.status !== "ready" || preview.planDigest === null) {
      // 还有别的目标没做完、还缺证据……完成的门说了算；accept 已经记下，next 仍是决定给出的那一步。
      return Object.freeze({
        ...decided,
        thenComplete: Object.freeze({ status: "blocked" as const, blockers: preview.blockers }),
      });
    }
    const completion = await complete(
      { ...request, mode: "apply", planDigest: preview.planDigest },
      context,
    );
    return Object.freeze({
      ...decided,
      next: completion.next,
      thenComplete: Object.freeze({ status: "completed" as const, completion }),
    });
  } catch (error: unknown) {
    return Object.freeze({
      ...decided,
      thenComplete: Object.freeze({
        status: "refused" as const,
        error: refusalOf(error, context, "$request.thenComplete"),
      }),
    });
  }
}

export interface FollowUpExecutors {
  readonly plan: WakeflowPublicMcpExecutor<TargetTaskPlanningResult>;
  readonly complete: WakeflowPublicMcpExecutor<DemandCompletionResult>;
}

export function withFollowUp(
  decide: WakeflowPublicMcpExecutor<ImplementationReviewDecisionResult>,
  executors: Readonly<FollowUpExecutors>,
): WakeflowPublicMcpExecutor<ImplementationReviewDecisionResult> {
  return async (value, context) => {
    const followUp = followUpOf(value);
    if (followUp !== null) assertFollowUp(followUp);
    const decided = await decide(value, context);
    if (followUp === null) return decided;
    return followUp.plan !== null
      ? planNext(decided, followUp, executors.plan, context)
      : completeNow(decided, followUp, executors.complete, context);
  };
}
