import { types } from "node:util";

/**
 * Wakeflow Foundation / Node：AbortSignal 的两个小判断（open-items L4）与唯一的中止错误。
 *
 * 这两段此前在二十九个与十五个模块里各有一份逐字节相同的私有副本：改一处判断要在几十份里逐一找。
 * 它们不依赖任何模块自己的错误类，所以收在这里。中止只有一种错误 `OperationAbortedError`（1.4.5 批 1）。
 */

/** 一个真的 AbortSignal：对象、不是 Proxy、是 AbortSignal 的实例。 */
export function isAbortSignal(value: unknown): value is AbortSignal {
  return (
    typeof value === "object" &&
    value !== null &&
    !types.isProxy(value) &&
    value instanceof AbortSignal
  );
}

/** 把可能没有的 signal 变成可展开的选项片段：没有就是空对象。 */
export function signalOptions(signal: AbortSignal | undefined): { readonly signal?: AbortSignal } {
  return signal === undefined ? {} : { signal };
}

/** 调用方的 signal 已触发：全工程唯一的中止错误，各层原样放行，只在内核边界翻成公开拒绝。 */
export class OperationAbortedError extends Error {
  override readonly name = "OperationAbortedError";
  readonly reason = "aborted";
  readonly path = "$signal";

  constructor(options?: ErrorOptions) {
    super("The operation was aborted.", options);
  }
}

/** signal 已触发就抛 `OperationAbortedError`；没有 signal 或未触发则什么也不做。 */
export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) throw new OperationAbortedError();
}
