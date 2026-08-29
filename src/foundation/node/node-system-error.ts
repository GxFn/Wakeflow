import { types } from "node:util";

/**
 * Wakeflow Foundation / Node：无副作用地读取 Node.js 系统错误代码。
 *
 * 本模块只从真实 `Error` 的自有 `code` 数据属性读取符合规范词法的系统错误名称，
 * 供文件系统等平台能力区分 `ENOENT`、`EEXIST`、`ELOOP`、`EXDEV` 等操作结果。它不读取消息、
 * 路径、系统调用、数值错误码、调用栈或原因链，也不把错误代码解释为授权、文件身份
 * 或可恢复性证明。
 *
 * 返回值是调用方捕获上下文中的一次 code snapshot，不单独证明错误确由 Node.js API
 * 抛出。Proxy、访问器、继承字段、Node.js `ERR_*` 内部错误和非规范 `code` 都返回
 * `undefined`；读取失败本身不会产生另一个异常。
 */

const NODE_SYSTEM_ERROR_CODE_PATTERN = /^E(?!RR_)[A-Z0-9_]{1,63}$/u;

interface Node24ErrorConstructor extends ErrorConstructor {
  isError(value: unknown): value is Error;
}

/** Node 24.19 runtime 已提供该标准入口；当前 TypeScript lib 尚未声明。 */
const node24ErrorConstructor = Error as Node24ErrorConstructor;

/** 已从真实 `Error` 自有数据属性读取、符合规范词法的 Node.js 系统错误代码。 */
export type NodeSystemErrorCode = `E${string}`;

function isCanonicalNodeSystemErrorCode(
  value: unknown,
): value is NodeSystemErrorCode {
  return (
    typeof value === "string"
    && NODE_SYSTEM_ERROR_CODE_PATTERN.test(value)
  );
}

/**
 * 无副作用地读取真实 `Error` 中符合规范词法的系统错误代码。
 *
 * `types.isProxy()` 必须先于任何属性反射；随后只接受 `code` 的自有数据属性描述符，
 * 因此访问器、原型字段和普通 `{ code: "ENOENT" }` 记录都不能
 * 参与文件系统分支。函数不会抛出，也不会执行候选对象上的用户代码。
 */
export function readNodeSystemErrorCode(
  value: unknown,
): NodeSystemErrorCode | undefined {
  if (types.isProxy(value) || !node24ErrorConstructor.isError(value)) {
    return undefined;
  }

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
