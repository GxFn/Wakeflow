// 助手的拒绝与输出协议（两个助手共用）：拒绝带稳定的 reason，结果是 stdout 上恰好一行 JSON。

/** 助手主动拒绝：`reason` 是稳定的拒绝码，`extra` 是随结果一并输出的有界字段。 */
export class HelperFailure extends Error {
  /**
   * @param {string} reason
   * @param {JsonRecord} [extra]
   */
  constructor(reason, extra) {
    super(reason);
    this.reason = reason;
    this.extra = extra ?? {};
  }
}

/**
 * @param {string} reason
 * @param {JsonRecord} [extra]
 * @returns {never}
 */
export function refuse(reason, extra) {
  throw new HelperFailure(reason, extra);
}

// 非 HelperFailure 的异常只暴露错误名与 Node errno，不暴露消息与栈。
/** @param {any} error */
export function unexpectedDetail(error) {
  const name =
    error !== null && typeof error === "object" && typeof error.name === "string"
      ? error.name.slice(0, 64)
      : "unknown";
  const code =
    error !== null &&
    typeof error === "object" &&
    typeof error.code === "string" &&
    /^E(?!RR_)[A-Z0-9_]{1,63}$/u.test(error.code)
      ? error.code
      : undefined;
  return code === undefined ? { errorName: name } : { errorName: name, causeCode: code };
}

/**
 * 每个子命令在 stdout 打印恰好一行 JSON。
 * @param {JsonRecord} value
 * @param {number} exitCode
 */
export function emit(value, exitCode) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
  process.exitCode = exitCode;
}
