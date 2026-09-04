import type { Sha256Digest } from "../foundation/crypto/sha256.js";
import type { RootedDirectory } from "../foundation/filesystem/rooted-directory.js";
import { runCommandShell } from "./command-shell.js";
import { fail } from "./error.js";
import { deriveDemandCommitId, parseIdempotencyKey } from "./ids.js";
import type { NextProjection } from "./next-projection.js";

/**
 * Wakeflow Kernel / Append Command：追加型调用形状的唯一外壳
 * （ADR-0013 决定 C，ADR-0012 决定 D2）。
 *
 * 一次调用：共用外壳负责请求解析、上限、隐私、根、上下文与结果脱敏；本模块只
 * 负责追加形状特有的部分：校验客户端幂等键与观察到的流修订、由幂等键派生
 * commitId、执行切片的决定与追加、派生 `next`。切片只提供纯决定与数据形状。
 */

export interface AppendCommandEnvelope {
  readonly root: string;
  readonly demandId: string;
  readonly idempotencyKey: string;
  readonly expectedStreamRevision: number;
}

export interface AppendCommandBinding {
  readonly commitId: ReturnType<typeof deriveDemandCommitId>;
  readonly idempotencyKey: string;
  readonly requestDigest: Sha256Digest;
  readonly expectedStreamRevision: number;
}

export interface AppendCommandParsedRequest<Input> {
  readonly envelope: AppendCommandEnvelope;
  readonly input: Input;
}

export interface AppendCommandSpec<Input, Context, Outcome, Result> {
  readonly tool: string;
  /** 用切片自己的 Schema 解析请求；返回信封与切片输入。 */
  readonly parseRequest: (
    value: unknown,
  ) => Readonly<AppendCommandParsedRequest<Input>>;
  /** 打开本次命令需要的上下文（配置、权威、Demand 根等）。 */
  readonly open: (
    workspaceRoot: RootedDirectory,
    envelope: Readonly<AppendCommandEnvelope>,
  ) => Promise<Context>;
  readonly close: (context: Context) => Promise<void>;
  /** 决定、追加、投影；必须只用 `binding` 里的身份，保证重试落在同一提交。 */
  readonly execute: (
    context: Context,
    input: Input,
    binding: Readonly<AppendCommandBinding>,
  ) => Promise<Outcome>;
  /** 从追加后的状态派生下一前沿；缺省为无前沿。 */
  readonly next?: (
    context: Context,
    outcome: Outcome,
  ) => Promise<Readonly<NextProjection>>;
  /** 组装公共结果；内核随后做脱敏与上限检查。 */
  readonly result: (
    envelope: Readonly<AppendCommandEnvelope>,
    outcome: Outcome,
    next: Readonly<NextProjection>,
  ) => Result;
  /** 除工作区根与 home 之外还必须脱敏的值，例如 ledger 根与宿主句柄。 */
  readonly privateValues?: (context: Context) => Iterable<string>;
}

const NO_NEXT: Readonly<NextProjection> = Object.freeze({
  frontier: null,
  owner: "none",
  suggestedTool: null,
  blockers: Object.freeze([]),
});

/** 执行一个追加型公共命令。 */
export async function runAppendCommand<Input, Context, Outcome, Result>(
  spec: Readonly<AppendCommandSpec<Input, Context, Outcome, Result>>,
  value: unknown,
): Promise<Result> {
  return runCommandShell<AppendCommandEnvelope, Input, Context, Result>(
    spec,
    value,
    (binding) => {
      parseIdempotencyKey(
        binding.envelope.idempotencyKey,
        "$request.idempotencyKey",
      );
      if (
        !Number.isSafeInteger(binding.envelope.expectedStreamRevision) ||
        binding.envelope.expectedStreamRevision < 0
      ) {
        fail(
          "invalid-request",
          "expected-stream-revision",
          "$request.expectedStreamRevision",
        );
      }
    },
    async (context, shell) => {
      const { envelope } = shell;
      const idempotencyKey = parseIdempotencyKey(
        envelope.idempotencyKey,
        "$request.idempotencyKey",
      );
      const binding: Readonly<AppendCommandBinding> = Object.freeze({
        commitId: deriveDemandCommitId(envelope.demandId, idempotencyKey),
        idempotencyKey,
        requestDigest: shell.requestDigest,
        expectedStreamRevision: envelope.expectedStreamRevision,
      });
      const outcome = await spec.execute(context, shell.input, binding);
      const next =
        spec.next === undefined ? NO_NEXT : await spec.next(context, outcome);
      return spec.result(envelope, outcome, next);
    },
  );
}
