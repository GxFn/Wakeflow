/**
 * 单需求root的静态能力目录词汇。
 *
 * 这里只根据已经由demand core验证的executionPlacement选择应存在的叶子目录集合；
 * 不验证authorizationRef语义，不观察filesystem，也不判断目录健康或文件owner。
 */
export const WAKEFLOW_DEMAND_COMMON_CAPABILITY_ROOTS = Object.freeze([
  "task-packages",
  "target-results",
  "review-candidates",
  "test-cards",
  "evidence",
]);

export const WAKEFLOW_DEMAND_RECOVERY_ROOT = "transactions";

export const WAKEFLOW_DEMAND_ISOLATED_CAPABILITY_ROOTS = Object.freeze([
  "pod/design-requests",
  "pod/design-handoffs",
]);

const MAIN_LEAF_ROOTS = Object.freeze([
  ...WAKEFLOW_DEMAND_COMMON_CAPABILITY_ROOTS,
  WAKEFLOW_DEMAND_RECOVERY_ROOT,
]);

const ISOLATED_LEAF_ROOTS = Object.freeze([
  ...MAIN_LEAF_ROOTS,
  ...WAKEFLOW_DEMAND_ISOLATED_CAPABILITY_ROOTS,
]);

/**
 * 返回main/isolated placement对应的冻结叶子目录清单。
 * placement只允许被动的mode和可选authorizationRef字段；后者仅为合法领域形状，不在此解释。
 */
export function wakeflowDemandCapabilityRoots(executionPlacement) {
  if (!executionPlacement || typeof executionPlacement !== "object" || Array.isArray(executionPlacement)) {
    throw new TypeError("executionPlacement must be an object with mode main or isolated");
  }
  const prototype = Object.getPrototypeOf(executionPlacement);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("executionPlacement must be a plain data object");
  }
  const keys = Reflect.ownKeys(executionPlacement);
  if (
    keys.some((key) => typeof key !== "string" || !["mode", "authorizationRef"].includes(key))
    || !keys.includes("mode")
  ) {
    throw new TypeError("executionPlacement may contain only mode and authorizationRef");
  }
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(executionPlacement, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      throw new TypeError(`executionPlacement.${key} must be an enumerable data property`);
    }
  }
  const modeDescriptor = Object.getOwnPropertyDescriptor(executionPlacement, "mode");
  if (modeDescriptor.value === "main") return MAIN_LEAF_ROOTS;
  if (modeDescriptor.value === "isolated") return ISOLATED_LEAF_ROOTS;
  throw new TypeError("executionPlacement.mode must be main or isolated");
}
