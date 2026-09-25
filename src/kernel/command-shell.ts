import os from "node:os";

import { computeCanonicalJsonSha256Digest } from "../foundation/crypto/canonical-json-sha256.js";
import type { Sha256Digest } from "../foundation/crypto/sha256.js";
import { type JsonValue, JsonValueError, parseJsonValue } from "../foundation/data/json-value.js";
import {
  RootedDirectory,
  type RootedDirectoryDurability,
  RootedDirectoryError,
  type RootedDirectoryOpenOptions,
} from "../foundation/filesystem/rooted-directory.js";
import { fail, toWakeflowError } from "./error.js";
import { assertWithinByteLimit } from "./limits.js";
import {
  assertPublicJson,
  assertRequestFreeOfPrivateText,
  createRedactionBoundary,
  type RedactionBoundary,
} from "./redaction.js";

/**
 * Wakeflow Kernel / Command Shell：三种公共调用形状共用的外壳。
 *
 * 一次调用固定经过：请求解析、字节上限、去掉 `root` 的请求摘要与隐私扫描、
 * 打开工作区根、建立脱敏边界、由切片打开上下文、执行形状特有的主体、
 * 对结果做脱敏与上限检查、关闭上下文与根。追加形状与效果形状各自只提供主体。
 */

export interface CommandShellSpec<Envelope extends { readonly root: string }, Input, Context> {
  readonly tool: string;
  /** 用切片自己的 Schema 解析请求；返回信封与切片输入。 */
  readonly parseRequest: (
    value: unknown,
  ) => Readonly<{ readonly envelope: Envelope; readonly input: Input }>;
  /** 打开本次命令需要的上下文（配置、权威、Demand 根、宿主 facade 等）。 */
  readonly open: (workspaceRoot: RootedDirectory, envelope: Readonly<Envelope>) => Promise<Context>;
  readonly close: (context: Context) => Promise<void>;
  /** 除工作区根与 home 之外还必须脱敏的值，例如 ledger 根与宿主句柄。 */
  readonly privateValues?: (context: Context) => Iterable<string>;
  /**
   * 请求隐私扫描跳过的顶层字段路径（点分，相对请求对象），例如 `observation.worktree`：
   * 只给"内核准入要求原文、且只进私有回执、从不回到公共结果"的字段（§13.128）。结果侧的
   * 公共边界不受影响，仍然逐值脱敏。
   */
  readonly requestPrivacyExemptPaths?: readonly string[];
}

/**
 * 三种调用形状共用的注入执行选项。
 *
 * 这些值与 `clock` 同类：只能由进程内的调用方注入，永远不来自请求、信封或任何
 * 线格式；公共请求里没有、也不会有 `durability` 字段。生产组合根一个都不传，
 * 因此工作区根始终是 `fsync`，工作区下派生出的根也一路继承同一档。
 */
export interface CommandShellExecutionOptions {
  /** 工作区根这次打开的持久化级别；只有一次性测试工作区才会传 `none`。 */
  readonly durability?: RootedDirectoryDurability;
}

function rootOpenOptions(
  options: Readonly<CommandShellExecutionOptions>,
): Readonly<RootedDirectoryOpenOptions> | undefined {
  return options.durability === undefined ? undefined : { durability: options.durability };
}

/**
 * 切片把自己的执行选项收窄成调用形状接受的形状。
 *
 * 切片的执行选项还带 `clock`、`signal` 等与内核无关的注入值；这里只取出持久化级别，
 * 缺省就什么都不传，使外壳与生产组合根看到的是同一个"未指定"。
 */
export function commandShellExecutionOptions(
  durability: RootedDirectoryDurability | undefined,
): Readonly<CommandShellExecutionOptions> {
  return durability === undefined ? Object.freeze({}) : Object.freeze({ durability });
}

export interface CommandShellBinding<Envelope, Input> {
  readonly envelope: Readonly<Envelope>;
  readonly input: Input;
  /** 请求去掉 `root` 后的 JSON；根路径本来就是私有值，且随机器不同。 */
  readonly payload: JsonValue;
  readonly requestDigest: Sha256Digest;
  readonly workspaceRoot: RootedDirectory;
}

function requestJson(value: unknown): JsonValue {
  try {
    return parseJsonValue(value, "$request");
  } catch (error: unknown) {
    if (error instanceof JsonValueError) {
      fail("invalid-request", "not-json", error.path);
    }
    throw error;
  }
}

function payloadWithoutRoot(json: JsonValue): JsonValue {
  if (json === null || typeof json !== "object" || Array.isArray(json)) {
    fail("invalid-request", "not-object", "$request");
  }
  return Object.freeze(Object.fromEntries(Object.entries(json).filter(([key]) => key !== "root")));
}

/**
 * 执行一个公共命令：`admit` 在打开上下文之前做形状特有的纯校验，`body` 在上下文里
 * 执行并返回组装好的公共结果。任何异常都收敛为 `WakeflowError`。
 */
export async function runCommandShell<
  Envelope extends { readonly root: string },
  Input,
  Context,
  Result,
>(
  spec: Readonly<CommandShellSpec<Envelope, Input, Context>>,
  value: unknown,
  admit: (binding: Readonly<CommandShellBinding<Envelope, Input>>) => void,
  body: (
    context: Context,
    binding: Readonly<CommandShellBinding<Envelope, Input>>,
    boundary: Readonly<RedactionBoundary>,
  ) => Promise<Result>,
  options: Readonly<CommandShellExecutionOptions> = {},
): Promise<Result> {
  const json = requestJson(value);
  assertWithinByteLimit(json, "publicRequestBytes", "$request");
  const { envelope, input } = spec.parseRequest(json);
  const payload = payloadWithoutRoot(json);
  const requestDigest = computeCanonicalJsonSha256Digest(payload);

  let workspaceRoot: RootedDirectory;
  try {
    workspaceRoot = await RootedDirectory.open(
      envelope.root,
      "$request.root",
      rootOpenOptions(options),
    );
  } catch (error: unknown) {
    if (error instanceof RootedDirectoryError) {
      fail("root-invalid", error.reason, "$request.root", { cause: error });
    }
    throw error;
  }
  const binding: Readonly<CommandShellBinding<Envelope, Input>> = Object.freeze({
    envelope,
    input,
    payload,
    requestDigest,
    workspaceRoot,
  });
  let boundary = createRedactionBoundary([envelope.root, workspaceRoot.absolutePath, os.homedir()]);
  let context: Context | undefined;
  let result: Result | undefined;
  let failure: unknown;
  try {
    admit(binding);
    assertRequestFreeOfPrivateText(
      withoutExemptPaths(payload, spec.requestPrivacyExemptPaths ?? []),
      boundary,
      "$request",
    );
    context = await spec.open(workspaceRoot, envelope);
    if (spec.privateValues !== undefined) {
      boundary = createRedactionBoundary([
        ...boundary.privateValues,
        ...spec.privateValues(context),
      ]);
    }
    const assembled = await body(context, binding, boundary);
    const assembledJson = parseJsonValue(assembled, "$result");
    assertPublicJson(assembledJson, boundary, "$result");
    assertWithinByteLimit(assembledJson, "publicResultBytes", "$result");
    result = assembled;
  } catch (error: unknown) {
    failure = toWakeflowError(error, "$request");
  }
  failure = await releaseCommandShell(spec, context, workspaceRoot, failure);
  if (failure !== undefined) throw failure;
  if (result === undefined) fail("unexpected", "no-result", "$result");
  return result;
}

/** 去掉请求里豁免扫描的字段（只走对象路径；路径不存在即原样；从不原地修改输入）。 */
function withoutExemptPaths(payload: JsonValue, paths: readonly string[]): JsonValue {
  let current = payload;
  for (const dotted of paths) current = withoutPath(current, dotted.split("."));
  return current;
}

function withoutPath(value: JsonValue, segments: readonly string[]): JsonValue {
  const [head, ...rest] = segments;
  if (head === undefined || typeof value !== "object" || value === null || Array.isArray(value)) {
    return value;
  }
  if (!Object.hasOwn(value, head)) return value;
  const copy: Record<string, JsonValue> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key !== head) {
      copy[key] = entry;
    } else if (rest.length > 0) {
      copy[key] = withoutPath(entry, rest);
    }
  }
  return copy;
}

/** 关闭上下文与根；主体失败优先，关闭失败只在主体成功时成为结局。 */
async function releaseCommandShell<Envelope extends { readonly root: string }, Input, Context>(
  spec: Readonly<CommandShellSpec<Envelope, Input, Context>>,
  context: Context | undefined,
  workspaceRoot: RootedDirectory,
  failure: unknown,
): Promise<unknown> {
  let outcome = failure;
  if (context !== undefined) {
    try {
      await spec.close(context);
    } catch (error: unknown) {
      outcome ??= toWakeflowError(error, "$context");
    }
  }
  try {
    await workspaceRoot.close();
  } catch (error: unknown) {
    outcome ??= toWakeflowError(error, "$request.root");
  }
  return outcome;
}
