import type { Sha256Digest } from "../foundation/crypto/sha256.js";
import type { RootedDirectory } from "../foundation/filesystem/rooted-directory.js";
import {
  runCommandShell,
  type CommandShellBinding,
  type CommandShellExecutionOptions,
} from "./command-shell.js";
import { fail } from "./error.js";
import type { NextProjection } from "./next-projection.js";

/**
 * Wakeflow Kernel / Publication Transaction：效果型调用形状的唯一外壳
 * （ADR-0013 决定 C，ADR-0012 决定 D2，ADR-0004）。
 *
 * 三种模式：`preview` 零写推导计划并返回 `planDigest`；`apply` 用同一请求重新推导
 * 计划，摘要不同即以 `precondition-failed/plan-drift` 拒绝，相同才执行；`recover`
 * 只凭操作标识完成被中断的事务。摘要不是授权令牌：apply 从不信任客户端回显的
 * 计划，计划永远由服务端在当前工作区状态上重算。`planRef` 在这里就是原请求本身，
 * 因此 preview 不需要为了 apply 而写任何文件。
 */

type PublicationTransactionMode = "preview" | "apply" | "recover";

export interface PublicationTransactionEnvelope {
  readonly root: string;
  readonly mode: PublicationTransactionMode;
  /** `apply` 必带：preview 返回的计划摘要。 */
  readonly planDigest: Sha256Digest | null;
  /** `recover` 必带：被中断事务的操作标识，已由切片解析。 */
  readonly operationId: string | null;
}

export interface PublicationTransactionPlan<Plan> {
  readonly status: "ready" | "blocked";
  readonly blockers: readonly string[];
  /** 就绪时的计划；阻塞时为 `null`。 */
  readonly plan: Plan | null;
  /** 就绪计划的摘要；阻塞时为 `null`。 */
  readonly digest: Sha256Digest | null;
}

export type PublicationTransactionPhase<Plan, Outcome> =
  | Readonly<{
      readonly mode: "preview";
      readonly planned: Readonly<PublicationTransactionPlan<Plan>>;
    }>
  | Readonly<{
      readonly mode: "apply";
      readonly planned: Readonly<PublicationTransactionPlan<Plan>>;
      readonly plan: Plan;
      readonly outcome: Outcome;
    }>
  | Readonly<{
      readonly mode: "recover";
      readonly operationId: string;
      readonly outcome: Outcome;
    }>;

export interface PublicationTransactionSpec<Input, Context, Plan, Outcome, Result> {
  readonly tool: string;
  readonly parseRequest: (value: unknown) => Readonly<{
    readonly envelope: PublicationTransactionEnvelope;
    readonly input: Input;
  }>;
  readonly open: (
    workspaceRoot: RootedDirectory,
    envelope: Readonly<PublicationTransactionEnvelope>,
  ) => Promise<Context>;
  readonly close: (context: Context) => Promise<void>;
  /** 零写推导计划；preview 与 apply 共用同一函数，apply 靠它重算并比对摘要。 */
  readonly plan: (
    context: Context,
    input: Input,
  ) => Promise<Readonly<PublicationTransactionPlan<Plan>>>;
  /** 执行已重算且摘要相符的计划；事务内部仍可再次验证。 */
  readonly apply: (context: Context, input: Input, plan: Plan) => Promise<Outcome>;
  readonly recover: (context: Context, operationId: string) => Promise<Outcome>;
  /** 从本次结局派生下一责任；缺省为无前沿。 */
  readonly next?: (
    context: Context,
    phase: PublicationTransactionPhase<Plan, Outcome>,
  ) => Promise<Readonly<NextProjection>>;
  readonly result: (
    envelope: Readonly<PublicationTransactionEnvelope>,
    input: Input,
    phase: PublicationTransactionPhase<Plan, Outcome>,
    next: Readonly<NextProjection>,
  ) => Result;
  readonly privateValues?: (context: Context) => Iterable<string>;
}

const NO_NEXT: Readonly<NextProjection> = Object.freeze({
  frontier: null,
  owner: "none",
  suggestedTool: null,
  blockers: Object.freeze([]),
});

function admitEnvelope(
  binding: Readonly<CommandShellBinding<PublicationTransactionEnvelope, unknown>>,
): void {
  const { mode, planDigest, operationId } = binding.envelope;
  if (mode === "apply" && planDigest === null) {
    fail("invalid-request", "plan-digest-required", "$request.planDigest");
  }
  if (mode !== "apply" && planDigest !== null) {
    fail("invalid-request", "plan-digest-unexpected", "$request.planDigest");
  }
  if (mode === "recover" && operationId === null) {
    fail("invalid-request", "operation-id-required", "$request.operationId");
  }
  if (mode !== "recover" && operationId !== null) {
    fail("invalid-request", "operation-id-unexpected", "$request.operationId");
  }
}

/** 执行一个效果型公共命令；`options` 是注入的执行选项，不是请求的一部分。 */
export async function runPublicationTransaction<Input, Context, Plan, Outcome, Result>(
  spec: Readonly<PublicationTransactionSpec<Input, Context, Plan, Outcome, Result>>,
  value: unknown,
  options: Readonly<CommandShellExecutionOptions> = {},
): Promise<Result> {
  return runCommandShell<PublicationTransactionEnvelope, Input, Context, Result>(
    spec,
    value,
    admitEnvelope,
    async (context, binding) => {
      const { envelope, input } = binding;
      const phase = await runPhase(spec, context, envelope, input);
      const next = spec.next === undefined ? NO_NEXT : await spec.next(context, phase);
      return spec.result(envelope, input, phase, next);
    },
    options,
  );
}

async function runPhase<Input, Context, Plan, Outcome, Result>(
  spec: Readonly<PublicationTransactionSpec<Input, Context, Plan, Outcome, Result>>,
  context: Context,
  envelope: Readonly<PublicationTransactionEnvelope>,
  input: Input,
): Promise<PublicationTransactionPhase<Plan, Outcome>> {
  if (envelope.mode === "recover") {
    const operationId = envelope.operationId as string;
    const outcome = await spec.recover(context, operationId);
    return Object.freeze({ mode: "recover" as const, operationId, outcome });
  }
  const planned = await spec.plan(context, input);
  if (envelope.mode === "preview") {
    return Object.freeze({ mode: "preview" as const, planned });
  }
  if (planned.status !== "ready" || planned.plan === null || planned.digest === null) {
    fail("precondition-failed", "plan-blocked", "$request.planDigest");
  }
  if (planned.digest !== envelope.planDigest) {
    fail("precondition-failed", "plan-drift", "$request.planDigest");
  }
  const outcome = await spec.apply(context, input, planned.plan);
  return Object.freeze({ mode: "apply" as const, planned, plan: planned.plan, outcome });
}
