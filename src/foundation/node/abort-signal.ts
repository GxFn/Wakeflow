/**
 * Wakeflow Foundation / Node：AbortSignal 的小帮助与唯一的中止错误。
 *
 * 它们不依赖任何模块自己的错误类，所以收在这里。中止只有一种错误 `OperationAbortedError`（1.4.5 批 1）。
 * signal 是类型化的选项，不再在运行时判断它是不是真的 AbortSignal（1.4.5 层次计划 A）。
 */

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
