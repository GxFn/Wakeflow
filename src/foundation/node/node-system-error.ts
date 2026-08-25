import { types } from "node:util";

/**
 * Wakeflow Foundation / Node：被动识别 Node.js 系统错误代码。
 *
 * 本文件只从真实 native Error 的自有 `code` 数据属性读取规范 errno 名称，供
 * filesystem 等平台能力区分 ENOENT、EEXIST、ELOOP、EXDEV 等操作结果。它不读
 * message、path、syscall、errno、stack 或 cause，也不把错误代码解释为授权、
 * 文件身份或可恢复性证明。
 *
 * Proxy、accessor、继承字段、Node `ERR_*` 内部错误和非规范 code 都返回
 * undefined；分类失败本身不是另一个异常。
 */

const NODE_SYSTEM_ERROR_CODE_PATTERN = /^E(?!RR_)[A-Z0-9_]{1,63}$/u;

/** 已从 native Error 自有数据属性读取的规范 Node.js 系统错误代码。 */
export type NodeSystemErrorCode = `E${string}`;

/** 带有已验证系统错误 code 的 native Error。 */
export interface NodeSystemError extends Error {
  readonly code: NodeSystemErrorCode;
}

function isObjectOrFunction(value: unknown): value is object {
  return (
    (typeof value === "object" && value !== null)
    || typeof value === "function"
  );
}

function isCanonicalNodeSystemErrorCode(
  value: unknown,
): value is NodeSystemErrorCode {
  return (
    typeof value === "string"
    && NODE_SYSTEM_ERROR_CODE_PATTERN.test(value)
  );
}

/**
 * 被动读取 native Error 的规范系统错误代码。
 *
 * `types.isProxy()` 必须先于任何属性反射；随后只接受 `code` 的自有 data
 * descriptor，因此 getter、原型字段和普通 `{ code: "ENOENT" }` 记录都不能
 * 参与文件系统分支。函数不会抛出，也不会执行候选对象上的用户代码。
 */
export function readNodeSystemErrorCode(
  value: unknown,
): NodeSystemErrorCode | undefined {
  if (!isObjectOrFunction(value) || types.isProxy(value)) return undefined;
  if (!types.isNativeError(value)) return undefined;

  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Object.getOwnPropertyDescriptor(value, "code");
  } catch {
    return undefined;
  }
  if (
    descriptor === undefined
    || !Object.hasOwn(descriptor, "value")
    || !isCanonicalNodeSystemErrorCode(descriptor.value)
  ) {
    return undefined;
  }
  return descriptor.value;
}

/** 判断 unknown 是否为带规范系统 code 的 native Error。 */
export function isNodeSystemError(
  value: unknown,
): value is NodeSystemError {
  return readNodeSystemErrorCode(value) !== undefined;
}

/**
 * 判断 native Error 是否携带调用方要求的准确系统错误代码。
 *
 * expected 虽由 TypeScript 限定为 `E${string}`，运行时仍复验完整词法；伪造的
 * ERR_*、小写或控制字符不会命中。
 */
export function hasNodeSystemErrorCode(
  value: unknown,
  expected: NodeSystemErrorCode,
): boolean {
  return (
    isCanonicalNodeSystemErrorCode(expected)
    && readNodeSystemErrorCode(value) === expected
  );
}
