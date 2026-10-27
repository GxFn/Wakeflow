import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";

import {
  type HookEvent as RecordEvidenceResultHookEvent,
  WAKEFLOW_RECORD_EVIDENCE_RESULT_SCHEMA,
} from "../../../src/contracts/generated/entrypoints/wakeflow-record-evidence-result.generated.js";
import { WAKEFLOW_STATUS_RESULT_SCHEMA } from "../../../src/contracts/generated/entrypoints/wakeflow-status-result.generated.js";
import {
  type HookEvent as ManifestHookEvent,
  WAKEFLOW_MANAGED_EVIDENCE_MANIFEST_SCHEMA,
} from "../../../src/contracts/generated/governance/evidence/managed-evidence-manifest.generated.js";
import { HOST_HOOK_EVENTS, type HostHookEvent } from "../../../src/kernel/hook-observations.js";

/**
 * 0 级（纯逻辑）：宿主 hook 事件词汇的同一性（open-items W32）。kernel 的 HOST_HOOK_EVENTS 是唯一来源；
 * Manifest、record_evidence 结果与 status 结果里每一个含 "session-start" 的枚举都必须逐字等于它——此前
 * notification 只在 status 结果里，真实观察到的 notification 记录在证据准入处变成 unexpected/manifest。
 */

/** 类型层面的同一性：生成类型多一个或少一个事件都在这里编译失败。 */
const HOOK_EVENT_TYPE_COVERAGE = {
  manifest: true,
  recordEvidenceResult: true,
} as const satisfies Readonly<{
  readonly manifest: [
    Exclude<ManifestHookEvent, HostHookEvent>,
    Exclude<HostHookEvent, ManifestHookEvent>,
  ] extends [never, never]
    ? true
    : false;
  readonly recordEvidenceResult: [
    Exclude<RecordEvidenceResultHookEvent, HostHookEvent>,
    Exclude<HostHookEvent, RecordEvidenceResultHookEvent>,
  ] extends [never, never]
    ? true
    : false;
}>;

/** Schema 值里所有含 "session-start" 的 enum 数组，不管嵌在 $defs 还是内联在属性里。 */
function hookEventEnums(value: unknown, found: readonly unknown[][] = []): readonly unknown[][] {
  if (Array.isArray(value)) {
    return value.reduce<readonly unknown[][]>((all, item) => hookEventEnums(item, all), found);
  }
  if (typeof value !== "object" || value === null) return found;
  const record = value as Readonly<Record<string, unknown>>;
  const candidate = record.enum;
  const own =
    Array.isArray(candidate) && candidate.includes("session-start") ? [...found, candidate] : found;
  return Object.values(record).reduce<readonly unknown[][]>(
    (all, child) => hookEventEnums(child, all),
    own,
  );
}

test("每份 Schema 里的 hook 事件枚举都与 HOST_HOOK_EVENTS 逐字相同（W32）", () => {
  deepEqual(HOOK_EVENT_TYPE_COVERAGE, { manifest: true, recordEvidenceResult: true });
  equal(HOST_HOOK_EVENTS.includes("notification"), true);
  for (const [name, schema] of [
    ["managed-evidence-manifest", WAKEFLOW_MANAGED_EVIDENCE_MANIFEST_SCHEMA],
    ["wakeflow-record-evidence-result", WAKEFLOW_RECORD_EVIDENCE_RESULT_SCHEMA],
    ["wakeflow-status-result", WAKEFLOW_STATUS_RESULT_SCHEMA],
  ] as const) {
    const enums = hookEventEnums(schema);
    equal(enums.length > 0, true, `${name} declares a hook event enum`);
    for (const candidate of enums) deepEqual(candidate, [...HOST_HOOK_EVENTS], name);
  }
});
