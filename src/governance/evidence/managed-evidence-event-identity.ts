import type { WakeflowDurableId } from "../../contracts/identity/wakeflow-durable-id.js";
import { deriveDurableId } from "../../kernel/ids.js";

/**
 * Wakeflow Governance / Evidence：记录事件的身份由证据身份派生。
 *
 * 同一份证据永远得到同一个 Event 与 Commit 身份，所以重复记录在事件流上自然幂等。记录证据的工具与
 * 导入结果时自动记提交证据（ADR-0028）共用这一条派生。
 */

export interface ManagedEvidenceEventIdentity {
  readonly eventId: WakeflowDurableId<"demand-event">;
  readonly commitId: WakeflowDurableId<"demand-event-commit">;
}

export function deriveManagedEvidenceEventIdentity(
  evidenceId: WakeflowDurableId<"evidence">,
): ManagedEvidenceEventIdentity {
  return Object.freeze({
    eventId: deriveDurableId("demand-event", "managed-evidence-recorded", evidenceId),
    commitId: deriveDurableId("demand-event-commit", "managed-evidence-recorded", evidenceId),
  });
}
