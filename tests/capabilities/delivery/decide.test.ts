import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";

import {
  DELIVERY_LANDING_SILENCE_MILLISECONDS,
  DELIVERY_REQUIRED_SKILLS,
  deriveClaimBlocker,
  deriveDeliveryDisposition,
  derivePrepareBlockers,
  deriveRearmBlockers,
  landingSilenceExceeded,
  type DispositionInput,
} from "../../../src/capabilities/delivery/decide.js";
import { parseSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";

/**
 * delivery 切片纯决定：处置由证据派生（hook 记录优先、发送失败即拒绝、Codex 发送返回、其余
 * indeterminate、显式解决只在 indeterminate）；准备与 rearm 的 phase 阻塞；声明占用与回收。
 */

const PROMPT_DIGEST = parseSha256Digest(`sha256:${"1".repeat(64)}`);
const OTHER_DIGEST = parseSha256Digest(`sha256:${"2".repeat(64)}`);
const ISSUED_AT = parseUtcInstant("2026-09-09T10:00:00.000Z");

function input(overrides: Partial<DispositionInput> = {}): DispositionInput {
  return {
    hostId: "claude-code",
    attempt: { status: "sent", evidenceDigest: null },
    readback: { status: "pending", evidenceDigest: null },
    landingRecords: [],
    expectedPromptDigest: PROMPT_DIGEST,
    resolution: null,
    resolutionRecordFound: false,
    currentlyIndeterminate: false,
    ...overrides,
  };
}

test("处置派生：匹配的 hook 记录为 accepted，发送前失败为 rejected，其余 indeterminate", () => {
  deepEqual(
    deriveDeliveryDisposition(
      input({
        landingRecords: [
          { recordId: "r-1", promptDigest: OTHER_DIGEST, recordedAt: ISSUED_AT },
          { recordId: "r-2", promptDigest: PROMPT_DIGEST, recordedAt: ISSUED_AT },
        ],
      }),
    ),
    {
      accepted: true,
      disposition: "accepted",
      evidenceKind: "hook-record",
      hookRecordId: "r-2",
      rationale: null,
    },
  );
  deepEqual(
    deriveDeliveryDisposition(
      input({ attempt: { status: "failed-before-send", evidenceDigest: null } }),
    ),
    {
      accepted: true,
      disposition: "rejected-before-send",
      evidenceKind: "agent-declaration",
      hookRecordId: null,
      rationale: null,
    },
  );
  deepEqual(deriveDeliveryDisposition(input()), {
    accepted: true,
    disposition: "indeterminate",
    evidenceKind: "agent-declaration",
    hookRecordId: null,
    rationale: null,
  });
  // Agent 声明的 readback 不能把 indeterminate 抬成 accepted。
  const confirmedOnly = deriveDeliveryDisposition(
    input({ readback: { status: "confirmed", evidenceDigest: OTHER_DIGEST } }),
  );
  equal(confirmedOnly.accepted && confirmedOnly.disposition, "indeterminate");
});

test("Codex 的发送返回摘要是 accepted 证据；Claude 的同样声明只是 indeterminate", () => {
  const codex = deriveDeliveryDisposition(
    input({ hostId: "codex", attempt: { status: "sent", evidenceDigest: OTHER_DIGEST } }),
  );
  equal(codex.accepted && codex.disposition, "accepted");
  equal(codex.accepted && codex.evidenceKind, "host-send-return");
  const claude = deriveDeliveryDisposition(
    input({ hostId: "claude-code", attempt: { status: "sent", evidenceDigest: OTHER_DIGEST } }),
  );
  equal(claude.accepted && claude.disposition, "indeterminate");
  const codexWithoutReturn = deriveDeliveryDisposition(input({ hostId: "codex" }));
  equal(codexWithoutReturn.accepted && codexWithoutReturn.disposition, "indeterminate");
});

test("indeterminate 之后：再次无证据的记录被阻塞，显式解决只在此时允许且 accepted 需要真实记录", () => {
  deepEqual(deriveDeliveryDisposition(input({ currentlyIndeterminate: true })), {
    accepted: false,
    blocker: "landing-evidence-missing",
  });
  deepEqual(
    deriveDeliveryDisposition(
      input({
        currentlyIndeterminate: true,
        attempt: { status: "failed-before-send", evidenceDigest: null },
      }),
    ),
    { accepted: false, blocker: "attempt-status" },
  );
  const resolution = {
    disposition: "accepted" as const,
    hookRecordId: "r-9",
    rationale: "核对过。",
  };
  deepEqual(deriveDeliveryDisposition(input({ resolution })), {
    accepted: false,
    blocker: "resolution-phase",
  });
  deepEqual(deriveDeliveryDisposition(input({ resolution, currentlyIndeterminate: true })), {
    accepted: false,
    blocker: "resolution-evidence-missing",
  });
  deepEqual(
    deriveDeliveryDisposition(
      input({ resolution, currentlyIndeterminate: true, resolutionRecordFound: true }),
    ),
    {
      accepted: true,
      disposition: "accepted",
      evidenceKind: "controller-resolution",
      hookRecordId: "r-9",
      rationale: "核对过。",
    },
  );
  deepEqual(
    deriveDeliveryDisposition(
      input({
        resolution: {
          disposition: "rejected-before-send",
          hookRecordId: null,
          rationale: "会话无痕。",
        },
        currentlyIndeterminate: true,
      }),
    ),
    {
      accepted: true,
      disposition: "rejected-before-send",
      evidenceKind: "controller-resolution",
      hookRecordId: null,
      rationale: "会话无痕。",
    },
  );
  // 解决优先于同时提交的 hook 记录：Controller 明确说明时不再自动匹配。
  const resolved = deriveDeliveryDisposition(
    input({
      resolution: { disposition: "rejected-before-send", hookRecordId: null, rationale: "误发。" },
      currentlyIndeterminate: true,
      landingRecords: [{ recordId: "r-2", promptDigest: PROMPT_DIGEST, recordedAt: ISSUED_AT }],
    }),
  );
  equal(resolved.accepted && resolved.evidenceKind, "controller-resolution");
});

test("静默阈值以签发时刻起算，十分钟整不算超过", () => {
  equal(DELIVERY_LANDING_SILENCE_MILLISECONDS, 10 * 60 * 1000);
  equal(landingSilenceExceeded(ISSUED_AT, parseUtcInstant("2026-09-09T10:10:00.000Z")), false);
  equal(landingSilenceExceeded(ISSUED_AT, parseUtcInstant("2026-09-09T10:10:00.001Z")), true);
  equal(landingSilenceExceeded(ISSUED_AT, ISSUED_AT, 0), false);
});

test("准备与 rearm 的 phase 阻塞：rearm 未用尽的 rejected 目标必须先 rearm", () => {
  deepEqual(
    derivePrepareBlockers({ workType: "implementation", phase: "planned", generation: null }),
    [],
  );
  deepEqual(
    derivePrepareBlockers({ workType: "implementation", phase: "rework-requested", generation: 1 }),
    [],
  );
  deepEqual(
    derivePrepareBlockers({
      workType: "implementation",
      phase: "delivery-prepared",
      generation: 1,
    }),
    ["target-phase:delivery-prepared"],
  );
  deepEqual(
    derivePrepareBlockers({
      workType: "implementation",
      phase: "host-effect-rejected",
      generation: 3,
    }),
    ["rearm-available:3"],
  );
  deepEqual(
    derivePrepareBlockers({
      workType: "implementation",
      phase: "host-effect-rejected",
      generation: 4,
    }),
    [],
  );
  deepEqual(
    derivePrepareBlockers({
      workType: "test",
      phase: "test-another-attempt-requested",
      generation: 1,
    }),
    [],
  );
  deepEqual(derivePrepareBlockers({ workType: "test", phase: "rework-requested", generation: 1 }), [
    "target-phase:rework-requested",
  ]);
  deepEqual(deriveRearmBlockers({ phase: "host-effect-rejected", generation: 3 }), []);
  deepEqual(deriveRearmBlockers({ phase: "test-host-effect-rejected", generation: 1 }), []);
  deepEqual(deriveRearmBlockers({ phase: "host-effect-rejected", generation: 4 }), [
    "rearm-limit:4",
  ]);
  deepEqual(deriveRearmBlockers({ phase: "host-effect-accepted", generation: 1 }), [
    "target-phase:host-effect-accepted",
  ]);
});

test("窗口声明：他人持有即阻塞，同目标的孤儿声明可回收", () => {
  const holder = {
    demandId: "demand_a",
    targetTaskId: "target-task_a",
    deliveryId: "target-delivery_a",
  };
  deepEqual(deriveClaimBlocker(null, "demand_a", "target-task_a", []), {
    blocker: null,
    reclaim: false,
  });
  deepEqual(deriveClaimBlocker(holder, "demand_b", "target-task_a", []), {
    blocker: "window-claimed:demand_a",
    reclaim: false,
  });
  deepEqual(deriveClaimBlocker(holder, "demand_a", "target-task_b", []), {
    blocker: "window-claimed:target-task_a",
    reclaim: false,
  });
  deepEqual(deriveClaimBlocker(holder, "demand_a", "target-task_a", ["target-delivery_a"]), {
    blocker: "window-claimed:target-delivery_a",
    reclaim: false,
  });
  deepEqual(deriveClaimBlocker(holder, "demand_a", "target-task_a", ["target-delivery_z"]), {
    blocker: null,
    reclaim: true,
  });
});

test("目标窗口必须加载的技能路径按 workType 固定", () => {
  deepEqual(DELIVERY_REQUIRED_SKILLS.implementation, [
    "skills/wakeflow-target/SKILL.md",
    "skills/wakeflow-target-craft/SKILL.md",
  ]);
  deepEqual(DELIVERY_REQUIRED_SKILLS.test, [
    "skills/wakeflow-target/SKILL.md",
    "skills/wakeflow-test/SKILL.md",
  ]);
});
