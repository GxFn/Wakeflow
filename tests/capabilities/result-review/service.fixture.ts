import { executeRearmDeliveryRequest } from "../../../src/capabilities/delivery/service.js";
import type { ExecuteResultReviewOptions } from "../../../src/capabilities/result-review/service.js";
import { parseUtcInstant, type UtcInstant } from "../../../src/foundation/time/utc-instant.js";
import { isWakeflowError } from "../../../src/kernel/error.js";
import { CODEX_DELIVERY_FACADE } from "../../governance/delivery/delivery-workspace.fixture.js";

/**
 * result-review 切片 service 三份测试（导入与回调、实现评审与检查、测试评审）共用的小助手：
 * 结构比较、允许集合判断、错误匹配器、夹具时钟、决定选项与 rearm 入口。只放两份以上文件都用到的；
 * 各文件自己的常量与夹具初始化留在各文件里。工作区夹具本身在 tests/governance 的 *.fixture.ts。
 */

/** 公开结果是冻结的无原型对象；结构比较前转成普通 JSON 值。 */
export function plain<Value>(value: Value): Value {
  return JSON.parse(JSON.stringify(value)) as Value;
}

export function allows(
  unit: Readonly<{ readonly allowedDecisions: readonly string[] }>,
  decision: string,
): boolean {
  return unit.allowedDecisions.includes(decision);
}

export function rejectedWith(reason: string, code = "precondition-failed") {
  return (error: unknown) =>
    isWakeflowError(error) && error.code === code && error.reason === reason;
}

export function at(time: string): UtcInstant {
  return parseUtcInstant(`2026-08-29T${time}.000Z`);
}

export function decisionOptions(clock: UtcInstant, uuid: string): ExecuteResultReviewOptions {
  return { clock: () => clock, uuidFactory: () => uuid };
}

/** 经投递切片的 rearm 入口重发一条回调或目标投递；两种 rearm 走同一条公共路径。 */
export async function rearmCallback(
  fixture: Readonly<{ readonly workspacePath: string; readonly demandId: string }>,
  callbackId: string,
  idempotencyKey: string,
  expectedStreamRevision: number,
  clock: UtcInstant,
) {
  return executeRearmDeliveryRequest(
    CODEX_DELIVERY_FACADE,
    {
      root: fixture.workspacePath,
      demandId: fixture.demandId,
      idempotencyKey,
      expectedStreamRevision,
      deliveryId: callbackId,
    },
    { clock: () => clock },
  );
}
