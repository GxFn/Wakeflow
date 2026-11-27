/**
 * Wakeflow Foundation / Error：模块错误的共同机制（1.4.5 层次计划 R1 试点）。
 *
 * 一个模块的错误类只写自己的原因联合与一行静态 code（`static override readonly code = …`）；名字、code、
 * 原因、位置、cause 与消息在这里写一次。消息由字段导出，与内核的 `WakeflowError` 同形：
 * `<code>: <reason> at <path>`，不再有逐原因的消息表——源码里没有读模块错误消息的地方，事故记录按字段记它。
 * 原因不在运行时对照任何表：类型就是检查。
 *
 * 构造器经 `new.target` 读子类的类名与静态 code，所以消息在 `super` 时就定了。`name`、`code`、`reason`、
 * `path` 是实例的自有数据属性，顺序与各模块原来手写的类相同（内核边界与事故记录按自有属性读）。
 * TypeScript 没有抽象静态成员：子类漏写 code 不是编译错误，由旧错误码家族表的清点测试拦下。
 */
export abstract class ModuleError<Reason extends string> extends Error {
  declare static readonly code: string;
  override readonly name: string;
  readonly code: string;
  readonly reason: Reason;
  readonly path: string;

  constructor(reason: Reason, path: string, options?: ErrorOptions) {
    const { name, code } = new.target;
    super(`${code}: ${reason} at ${path}`, options);
    this.name = name;
    this.code = code;
    this.reason = reason;
    this.path = path;
  }
}

/** 模块内 `fail` 的形状。绑定处写明这个类型，控制流分析才把调用当作不返回。 */
export type Fail<Reason extends string> = (reason: Reason, path: string, cause?: unknown) => never;

/** 一个模块错误类的 `fail`：没有 cause 时不带 `cause` 选项，与各模块原来手写的帮助函数相同。 */
export function failWith<Reason extends string>(
  ErrorClass: new (reason: Reason, path: string, options?: ErrorOptions) => Error,
): Fail<Reason> {
  return (reason, path, cause) => {
    throw new ErrorClass(reason, path, cause === undefined ? undefined : { cause });
  };
}
