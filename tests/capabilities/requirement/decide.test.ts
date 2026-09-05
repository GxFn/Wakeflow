import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";

import {
  analyzePackageDocuments,
  deriveClaimTransitionBlockers,
  derivePublishBlockers,
  deriveRequirementId,
  type PackageDocumentText,
} from "../../../src/capabilities/requirement/decide.js";
import {
  boardCounts,
  deriveRequirementNext,
  selectBoardEntries,
} from "../../../src/capabilities/requirement/projection.js";
import { computeSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import { parsePortableResourcePath } from "../../../src/foundation/filesystem/portable-resource-path.js";
import { encodeUtf8 } from "../../../src/foundation/text/utf8.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import {
  computeRequirementClaimStateDigest,
  createRequirementClaimState,
} from "../../../src/kernel/requirement-board.js";
import {
  FIXTURE_LANDING_MARKDOWN,
  FIXTURE_REQUIREMENT_MARKDOWN,
} from "../../governance/ledger/requirement-package.fixture.js";

function document(
  role: PackageDocumentText["role"],
  path: string,
  text: string,
): PackageDocumentText {
  return {
    role,
    path: parsePortableResourcePath(path),
    text,
    digest: computeSha256Digest(encodeUtf8(text)),
  };
}

const REQUIREMENT = document("requirement", "requirement.md", FIXTURE_REQUIREMENT_MARKDOWN);
const LANDING = document("landing", "landing.md", FIXTURE_LANDING_MARKDOWN);

test("章节切分：识别中英文标题、报缺章、抽摘要与用户确认摘要", () => {
  const analysis = analyzePackageDocuments("requirement", "示例需求", [REQUIREMENT, LANDING]);
  deepEqual(
    analysis.sections.map((section) => `${section.path}#${section.anchor}`),
    [
      "requirement.md#goal",
      "requirement.md#completion-definition",
      "requirement.md#non-goals",
      "requirement.md#acceptance-criteria",
      "requirement.md#user-confirmation",
      "landing.md#code-facts",
      "landing.md#landing-plan",
      "landing.md#testing-decision",
    ],
  );
  deepEqual(analysis.missing, []);
  deepEqual(
    analysis.summary.map((section) => section.anchor),
    ["goal", "completion-definition", "non-goals", "testing-decision"],
  );
  equal(analysis.confirmationSectionDigest?.startsWith("sha256:"), true);
  deepEqual(analysis.blockers, []);

  const bug = analyzePackageDocuments("bug", "缺陷", [REQUIREMENT, LANDING]);
  deepEqual(
    bug.missing.map((entry) => `${entry.path}#${entry.anchor}`),
    ["requirement.md#reproduction", "requirement.md#scope", "landing.md#fix-plan"],
  );
  const english = analyzePackageDocuments("requirement", "t", [
    document("requirement", "requirement.md", "## Goal\n\ng\n\n## Goal\n\nagain\n"),
    LANDING,
  ]);
  equal(english.blockers.includes("duplicate-section:requirement.md#goal"), true);
});

test("发布阻塞：缺确认、测试决策与类型不符、supersedes 未知、隐私命中", () => {
  const analysis = analyzePackageDocuments("requirement", "示例需求", [REQUIREMENT, LANDING]);
  deepEqual(
    derivePublishBlockers({
      analysis,
      demandType: "requirement",
      testingDecisionMode: "controller-only",
      confirmedAt: "2026-09-04T10:00:00.000Z",
      supersedes: null,
      headerTexts: [],
    }),
    [],
  );
  deepEqual(
    derivePublishBlockers({
      analysis,
      demandType: "requirement",
      testingDecisionMode: "not-applicable",
      confirmedAt: null,
      supersedes: "unknown",
      headerTexts: [
        {
          label: "testingDecision.summary",
          text: "token=sk-ant-abcdefghijklmnopqrstuvwxyz0123456789",
        },
      ],
    }),
    [
      "privacy-violation:testingDecision.summary:1:credential-assignment",
      "privacy-violation:testingDecision.summary:1:provider-credential",
      "user-confirmation-missing",
      "testing-decision-mode",
      "supersedes-unknown",
    ],
  );
  const leaking = analyzePackageDocuments("requirement", "示例需求", [
    document(
      "requirement",
      "requirement.md",
      `${FIXTURE_REQUIREMENT_MARKDOWN}\n## 附注\n\n见 /Users/someone/secret.txt\n`,
    ),
    LANDING,
  ]);
  equal(
    leaking.blockers.some((blocker) => blocker.startsWith("privacy-violation:requirement.md:")),
    true,
  );
});

test("requirementId 由内容确定性派生", () => {
  const input = {
    programId: "program_11111111-1111-4111-8111-111111111111",
    designSurfaceId: "surface_33333333-3333-4333-8333-333333333333",
    title: "示例需求",
    demandType: "requirement" as const,
    priority: "P1",
    originWindowId: "window_66666666-6666-4666-8666-666666666666",
    testingDecision: { mode: "controller-only", summary: "s" },
    taskPlanReview: "controller",
    supersedes: null,
    parkedTrigger: null,
    documents: [REQUIREMENT, LANDING],
    confirmedAt: "2026-09-04T10:00:00.000Z",
    confirmationSectionDigest: computeSha256Digest(encodeUtf8("c")),
  };
  const first = deriveRequirementId(input);
  equal(first, deriveRequirementId(input));
  equal(first.startsWith("requirement_"), true);
  equal(first === deriveRequirementId({ ...input, priority: "P0" }), false);
});

test("看板投影：排序、过滤、计数、认领转移阻塞与 next", () => {
  const at = parseUtcInstant("2026-09-04T10:00:00.000Z");
  const later = parseUtcInstant("2026-09-04T12:00:00.000Z");
  const base = {
    programId: "program_11111111-1111-4111-8111-111111111111",
    recordDigest: `sha256:${"a".repeat(64)}` as never,
    title: "t",
    demandType: "requirement" as const,
    supersedes: null,
    parkedTrigger: null,
  };
  const a = createRequirementClaimState({
    ...base,
    requirementId: "requirement_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    priority: "P2",
    publishedAt: at,
  });
  const b = createRequirementClaimState({
    ...base,
    requirementId: "requirement_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    priority: "P0",
    publishedAt: later,
  });
  const c = createRequirementClaimState({
    ...base,
    requirementId: "requirement_cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    priority: "P0",
    publishedAt: at,
    parkedTrigger: "later",
  });
  const selected = selectBoardEntries([a, b, c], {}, 2);
  deepEqual(
    selected.entries.map((entry) => entry.requirementId.slice(12, 20)),
    ["cccccccc", "bbbbbbbb"],
  );
  equal(selected.totalMatched, 3);
  deepEqual(
    selectBoardEntries([a, b, c], { statuses: ["parked"] }, 10).entries.map((e) => e.status),
    ["parked"],
  );
  deepEqual(boardCounts([a, b, c]), {
    pending: 2,
    parked: 1,
    claimed: 0,
    withdrawn: 0,
    archived: 0,
  });
  const digest = computeRequirementClaimStateDigest(c);
  deepEqual(deriveClaimTransitionBlockers("activate", { state: c, digest }, digest), []);
  deepEqual(
    deriveClaimTransitionBlockers("activate", { state: a, digest }, `sha256:${"0".repeat(64)}`),
    ["claim-state-drift", "claim-status:pending"],
  );
  deepEqual(deriveClaimTransitionBlockers("withdraw", null, digest), ["package-unknown"]);
  equal(
    deriveRequirementNext({ confirmationMissing: true, awaitingApply: false, pendingCount: 0 })
      .frontier,
    "requirement-confirmation",
  );
  equal(
    deriveRequirementNext({ confirmationMissing: false, awaitingApply: true, pendingCount: 0 })
      .frontier,
    "requirement-publication-apply",
  );
  equal(
    deriveRequirementNext({ confirmationMissing: false, awaitingApply: false, pendingCount: 2 })
      .suggestedTool,
    "wakeflow_create_demand",
  );
  equal(
    deriveRequirementNext({ confirmationMissing: false, awaitingApply: false, pendingCount: 0 })
      .frontier,
    null,
  );
});
