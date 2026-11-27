import { deepEqual, equal, ok, throws } from "node:assert/strict";
import { test } from "node:test";

import { type Fail, failWith, ModuleError } from "../../../src/foundation/error/module-error.js";

/**
 * Level 0 (pure): 模块错误的共同机制（1.4.5 层次计划 R1 试点）。名字取类名、code 取类的静态 code，消息由
 * code、reason 与 path 导出并在构造时成为自有属性；name、code、reason、path 是按这个顺序的自有数据属性
 * （内核边界与事故记录按自有属性读）；`failWith` 只在有 cause 时带 cause；带额外字段与自己构造器的子类
 * 保留基类的字段。
 */

type SampleReason = "input" | "conflict";

class SampleError extends ModuleError<SampleReason> {
  static override readonly code = "wakeflow-sample";
}

class DetailedSampleError extends ModuleError<SampleReason> {
  static override readonly code = "wakeflow-detailed-sample";
  readonly found: number | null;

  constructor(reason: SampleReason, path: string, found: number | null = null) {
    super(reason, path);
    this.found = found;
  }
}

const fail: Fail<SampleReason> = failWith(SampleError);

function ownDataValue(value: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  ok(
    descriptor !== undefined && Object.hasOwn(descriptor, "value"),
    `${key} is an own data property`,
  );
  return descriptor.value;
}

test("a module error takes its name from the class and its code from the class's static code", () => {
  const cause = new Error("inner");
  const error = new SampleError("conflict", "$config", { cause });

  ok(error instanceof SampleError);
  ok(error instanceof ModuleError);
  ok(error instanceof Error);
  deepEqual(Object.keys(error), ["name", "code", "reason", "path"]);
  equal(ownDataValue(error, "name"), "SampleError");
  equal(ownDataValue(error, "code"), "wakeflow-sample");
  equal(ownDataValue(error, "reason"), "conflict");
  equal(ownDataValue(error, "path"), "$config");
  equal(ownDataValue(error, "message"), "wakeflow-sample: conflict at $config");
  equal(String(error), "SampleError: wakeflow-sample: conflict at $config");
  equal(error.stack?.split("\n")[0], "SampleError: wakeflow-sample: conflict at $config");
  equal(error.cause, cause);
});

test("failWith throws the module's class and attaches a cause only when one is given", () => {
  throws(
    () => fail("input", "$root"),
    (error: unknown) =>
      error instanceof SampleError &&
      error.reason === "input" &&
      error.path === "$root" &&
      !Object.hasOwn(error, "cause"),
  );
  const cause = new Error("inner");
  throws(
    () => fail("conflict", "$expected", cause),
    (error: unknown) =>
      error instanceof SampleError && error.reason === "conflict" && error.cause === cause,
  );
});

test("a subclass with its own constructor keeps the base fields and adds its own after them", () => {
  const error = new DetailedSampleError("conflict", "$config.schemaVersion", 7);

  ok(error instanceof ModuleError);
  deepEqual(Object.keys(error), ["name", "code", "reason", "path", "found"]);
  equal(error.name, "DetailedSampleError");
  equal(error.message, "wakeflow-detailed-sample: conflict at $config.schemaVersion");
  equal(ownDataValue(error, "found"), 7);
  equal(new DetailedSampleError("input", "$").found, null);
  ok(!Object.hasOwn(error, "cause"));
});
