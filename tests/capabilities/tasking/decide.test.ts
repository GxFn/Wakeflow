import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";

import {
  deriveAnchorReferenceBlockers,
  deriveLineageBlockers,
  deriveLineageExpectation,
  derivePlanReview,
  deriveSectionAnchorBlockers,
  parseAcceptanceCriteria,
} from "../../../src/capabilities/tasking/decide.js";
import { parseSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import type { DemandAggregateState } from "../../../src/governance/demand/model/demand-aggregate-state.js";
import { FIXTURE_REQUIREMENT_MARKDOWN } from "../../governance/ledger/requirement-package.fixture.js";

/**
 * tasking 切片纯决定：验收标准条目切分、锚点引用、章节锚点、审阅门、仓库谱系。
 */

const RECORD = parseSha256Digest(`sha256:${"1".repeat(64)}`);
const OTHER = parseSha256Digest(`sha256:${"2".repeat(64)}`);
const AT = parseUtcInstant("2026-09-09T10:00:00.000Z");

function anchor(
  anchorId: string,
  itemId: string,
  recordDigest = RECORD,
  sectionAnchor = "acceptance-criteria",
) {
  return {
    anchorId,
    claim: "c",
    probe: "p",
    expected: "e",
    requirementRef: { recordDigest, sectionAnchor, itemId },
  };
}

test("验收标准条目按顶层列表项切分，围栏与续行按规则处理", () => {
  const criteria = parseAcceptanceCriteria(FIXTURE_REQUIREMENT_MARKDOWN);
  deepEqual(
    criteria.map((item) => item.itemId),
    ["ac-1", "ac-2"],
  );
  equal(criteria[0]?.text.startsWith("AC-1"), true);
  const nested = parseAcceptanceCriteria(
    "## 验收标准\n\n- first\n  continued line\n- second\n\n```\n- not an item\n```\n\n## 其他\n\n- not here\n",
  );
  deepEqual(
    nested.map((item) => item.text),
    ["first continued line", "second"],
  );
  deepEqual(parseAcceptanceCriteria("## 目标\n\n- no criteria section\n"), []);
});

test("锚点引用：记录摘要、节锚点、条目三处各自报出阻塞", () => {
  const criteria = parseAcceptanceCriteria(FIXTURE_REQUIREMENT_MARKDOWN);
  deepEqual(
    deriveAnchorReferenceBlockers({
      anchors: [anchor("a", "ac-1"), anchor("b", "ac-9"), anchor("c", "ac-2", OTHER, "goal")],
      recordDigest: RECORD,
      criteria,
    }),
    ["anchor-item-unknown:b:ac-9", "anchor-record-drift:c", "anchor-section:c:goal"],
  );
  deepEqual(deriveSectionAnchorBlockers(["goal", "nope"], ["goal", "landing-plan"]), [
    "section-anchor-unknown:nope",
  ]);
});

test("审阅门：user 要求确认时间，controller 不接受多余的确认", () => {
  deepEqual(derivePlanReview({ taskPlanReview: "user", confirmedAt: null }), {
    planReview: null,
    blocker: "task-plan-review-required",
  });
  deepEqual(derivePlanReview({ taskPlanReview: "user", confirmedAt: AT }), {
    planReview: { reviewer: "user", confirmedAt: AT },
    blocker: null,
  });
  deepEqual(derivePlanReview({ taskPlanReview: "controller", confirmedAt: null }), {
    planReview: { reviewer: "controller" },
    blocker: null,
  });
  deepEqual(derivePlanReview({ taskPlanReview: "controller", confirmedAt: AT }), {
    planReview: null,
    blocker: "task-plan-review-not-requested",
  });
});

function stateWith(targets: readonly Record<string, unknown>[]): Readonly<DemandAggregateState> {
  return { targetTasks: targets } as unknown as Readonly<DemandAggregateState>;
}

const REPO = "repository_11111111-1111-4111-8111-111111111111";

test("仓库谱系：空仓库不得声明谱系，未接受目标必须替代且可替代，已接受目标必须续接", () => {
  deepEqual(deriveLineageExpectation(stateWith([]), REPO), { kind: "none" });
  deepEqual(deriveLineageBlockers(null, { kind: "none" }), []);
  deepEqual(
    deriveLineageBlockers(
      { kind: "continuation", continuesTargetTaskId: "target-task_x" as never },
      { kind: "none" },
    ),
    ["lineage-unexpected"],
  );
  const open = stateWith([
    {
      workType: "implementation",
      repositoryId: REPO,
      phase: "rework-requested",
      targetTaskId: "t-open",
    },
    { workType: "test", windowId: "w", phase: "planned", targetTaskId: "t-test" },
  ]);
  deepEqual(deriveLineageExpectation(open, REPO), {
    kind: "replacement",
    targetTaskId: "t-open",
    replaceable: true,
  });
  deepEqual(
    deriveLineageBlockers(null, { kind: "replacement", targetTaskId: "t-open", replaceable: true }),
    ["lineage-replacement-required:t-open"],
  );
  deepEqual(
    deriveLineageBlockers(
      { kind: "replacement", replacesTargetTaskId: "t-other" as never },
      { kind: "replacement", targetTaskId: "t-open", replaceable: true },
    ),
    ["lineage-replacement-target:t-open"],
  );
  deepEqual(
    deriveLineageBlockers(
      { kind: "replacement", replacesTargetTaskId: "t-open" as never },
      { kind: "replacement", targetTaskId: "t-open", replaceable: false },
    ),
    ["lineage-target-in-flight:t-open"],
  );
  const inFlight = stateWith([
    {
      workType: "implementation",
      repositoryId: REPO,
      phase: "host-effect-claimed",
      targetTaskId: "t-live",
    },
  ]);
  deepEqual(deriveLineageExpectation(inFlight, REPO), {
    kind: "replacement",
    targetTaskId: "t-live",
    replaceable: false,
  });
  const accepted = stateWith([
    { workType: "implementation", repositoryId: REPO, phase: "accepted", targetTaskId: "t-done" },
    { workType: "implementation", repositoryId: REPO, phase: "superseded", targetTaskId: "t-old" },
  ]);
  deepEqual(deriveLineageExpectation(accepted, REPO), {
    kind: "continuation",
    targetTaskIds: ["t-done"],
  });
  deepEqual(
    deriveLineageBlockers(
      { kind: "continuation", continuesTargetTaskId: "t-old" as never },
      { kind: "continuation", targetTaskIds: ["t-done"] },
    ),
    ["lineage-continuation-target:t-done"],
  );
  deepEqual(
    deriveLineageBlockers(
      { kind: "continuation", continuesTargetTaskId: "t-done" as never },
      { kind: "continuation", targetTaskIds: ["t-done"] },
    ),
    [],
  );
});
