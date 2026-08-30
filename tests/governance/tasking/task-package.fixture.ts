import {
  parseWakeflowDurableIdOfKind,
} from "../../../src/contracts/identity/wakeflow-durable-id.js";
import {
  parseSha256Digest,
} from "../../../src/foundation/crypto/sha256.js";
import {
  parseUtcInstant,
} from "../../../src/foundation/time/utc-instant.js";
import {
  parseLedgerAuthorityMemberReference,
} from "../../../src/governance/ledger/ledger-authority-store.js";
import {
  createTaskPackage,
} from "../../../src/governance/tasking/task-package.js";

/** Tasking 与 Demand Event Sourcing 聚焦测试共享的一份固定、无文件副作用合同。 */

export const TASKING_PROGRAM_ID = parseWakeflowDurableIdOfKind(
  "program_11111111-1111-4111-8111-111111111111",
  "program",
);
export const TASKING_DEMAND_ID = parseWakeflowDurableIdOfKind(
  "demand_22222222-2222-4222-8222-222222222222",
  "demand",
);
export const TASK_PACKAGE_ID = parseWakeflowDurableIdOfKind(
  "task-package_33333333-3333-4333-8333-333333333333",
  "task-package",
);
export const TARGET_TASK_ID = parseWakeflowDurableIdOfKind(
  "target-task_44444444-4444-4444-8444-444444444444",
  "target-task",
);
export const TASKING_REPOSITORY_ID = parseWakeflowDurableIdOfKind(
  "repository_55555555-5555-4555-8555-555555555555",
  "repository",
);
export const TASKING_WINDOW_ID = parseWakeflowDurableIdOfKind(
  "window_66666666-6666-4666-8666-666666666666",
  "window",
);
const REQUIREMENT_ID = parseWakeflowDurableIdOfKind(
  "requirement_77777777-7777-4777-8777-777777777777",
  "requirement",
);
export const TASKING_CREATED_AT = parseUtcInstant(
  "2026-08-29T10:00:00.000Z",
);
export const TASKING_AUTHORITY_DIGEST = parseSha256Digest(
  `sha256:${"a".repeat(64)}`,
);
export const TASKING_CONFIG_DIGEST = parseSha256Digest(
  `sha256:${"f".repeat(64)}`,
);
const RECORD_DIGEST = parseSha256Digest(`sha256:${"b".repeat(64)}`);
const MEMBER_DIGEST = parseSha256Digest(`sha256:${"c".repeat(64)}`);
const REQUIREMENT_ROOT = `requirements/${REQUIREMENT_ID}`;
export const SELECTED_AUTHORITY_REF = parseLedgerAuthorityMemberReference({
  artifactKind: "wakeflow-ledger-authority-member-reference",
  schemaVersion: 1,
  family: "requirement",
  recordId: REQUIREMENT_ID,
  recordRef: `${REQUIREMENT_ROOT}/record.json`,
  recordDigest: RECORD_DIGEST,
  memberPath: "design/implementation.md",
  memberRef: `${REQUIREMENT_ROOT}/design/implementation.md`,
  memberDigest: MEMBER_DIGEST,
  role: "requirement-design",
  mediaType: "text/markdown",
});

export function taskPackageDraft() {
  return {
    programId: TASKING_PROGRAM_ID,
    configDigest: TASKING_CONFIG_DIGEST,
    demandId: TASKING_DEMAND_ID,
    demandAuthorityDigest: TASKING_AUTHORITY_DIGEST,
    taskPackageId: TASK_PACKAGE_ID,
    targetTaskId: TARGET_TASK_ID,
    assignment: {
      repositoryId: TASKING_REPOSITORY_ID,
      windowId: TASKING_WINDOW_ID,
    },
    workType: "implementation" as const,
    objective: "实现确认后的 Tasking 垂直切片",
    confirmedContext: [
      "Demand 已完成权威发布",
      "本轮不触发宿主发送",
    ],
    selectedAuthorityRefs: [SELECTED_AUTHORITY_REF],
    boundaries: {
      inScope: ["建立最小 TaskPackage 合同"],
      outOfScope: ["Delivery transport"],
      forbidden: ["直接调用宿主发送能力"],
    },
    completionExpectations: [
      "合同可确定性渲染并严格回读",
      "仓库与窗口分配保持类型化",
    ],
    commitExpectation: "leave-uncommitted" as const,
    acceptanceAnchors: [{
      anchorId: "task-package-codec",
      claim: "TaskPackage 具有唯一确定性表示",
      probe: "渲染后严格回读并重新计算摘要",
      expected: "领域值和摘要均保持不变",
    }],
  };
}

export function createTaskPackageFixture() {
  return createTaskPackage(taskPackageDraft(), {
    clock: () => TASKING_CREATED_AT,
  });
}
