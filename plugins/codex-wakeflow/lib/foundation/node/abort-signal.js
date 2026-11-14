import { types } from "node:util";
/**
 * Wakeflow Foundation / Node：AbortSignal 的两个小判断（open-items L4）。
 *
 * 这两段此前在二十九个与十五个模块里各有一份逐字节相同的私有副本：改一处判断要在几十份里逐一找。
 * 它们不依赖任何模块自己的错误类，所以收在这里；带着模块错误类的 `assertNotAborted` 仍是各模块自己的
 * 一行。
 */
/** 一个真的 AbortSignal：对象、不是 Proxy、是 AbortSignal 的实例。 */
export function isAbortSignal(value) {
    return (typeof value === "object" &&
        value !== null &&
        !types.isProxy(value) &&
        value instanceof AbortSignal);
}
/** 把可能没有的 signal 变成可展开的选项片段：没有就是空对象。 */
export function signalOptions(signal) {
    return signal === undefined ? {} : { signal };
}
