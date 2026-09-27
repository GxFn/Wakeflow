import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";

import {
  type DeliveryPromptReadingOrder,
  deliveryPromptRequirementPackage,
  renderDeliveryPortablePrompt,
} from "../../../src/capabilities/delivery/prompt.js";
import type { WakeflowPresentationLanguage } from "../../../src/configuration/wakeflow-config.js";
import { parsePortableResourcePath } from "../../../src/foundation/filesystem/portable-resource-path.js";
import type { ResolvedDemandAuthorityReference } from "../../../src/governance/demand/model/demand-authority.js";
import { createTaskPackage } from "../../../src/governance/tasking/task-package.js";
import {
  TASKING_CREATED_AT,
  taskPackageDraft,
} from "../../governance/tasking/task-package.fixture.js";

/**
 * 投递 prompt 的阅读顺序（gate-log §13.134，收 §13.133 I7）：需求包按文档列出，requirement.md
 * 在 landing.md 之前，每份文档是从窗口根可解析的完整 ledger 路径，任务包指向的章节列在它所在的
 * 文档下，不再挂在 requirement.md 后面。
 */

const REQUIREMENT_ROOT = "requirements/requirement_77777777-7777-4777-8777-777777777777";

const TASK_PACKAGE = createTaskPackage(
  { ...taskPackageDraft(), sectionAnchors: ["landing-plan", "code-facts"] },
  { clock: () => TASKING_CREATED_AT },
);

const RECORD_SECTIONS = [
  { path: parsePortableResourcePath("landing.md"), anchor: "code-facts" },
  { path: parsePortableResourcePath("landing.md"), anchor: "landing-plan" },
  { path: parsePortableResourcePath("landing.md"), anchor: "testing-decision" },
  { path: parsePortableResourcePath("requirement.md"), anchor: "acceptance-criteria" },
  { path: parsePortableResourcePath("requirement.md"), anchor: "background" },
];

/** Demand 权威引用的成员视图：成员按 memberRef 升序（landing.md 在前），章节来自需求包记录。 */
const RESOLVED_MEMBERS = [
  {
    reference: {
      role: "landing" as const,
      memberPath: parsePortableResourcePath("landing.md"),
      memberRef: parsePortableResourcePath(`${REQUIREMENT_ROOT}/landing.md`),
    },
    record: { record: { sections: RECORD_SECTIONS } },
  },
  {
    reference: {
      role: "requirement" as const,
      memberPath: parsePortableResourcePath("requirement.md"),
      memberRef: parsePortableResourcePath(`${REQUIREMENT_ROOT}/requirement.md`),
    },
    record: { record: { sections: RECORD_SECTIONS } },
  },
];

/** 投递服务的接线形态：Demand 权威引用（`admittedAuthority.resolvedAuthority`）原样传入，编译期守住结构。 */
function packageFromAuthority(members: readonly Readonly<ResolvedDemandAuthorityReference>[]) {
  return deliveryPromptRequirementPackage("../wakeflow-ledger", members);
}

function readingOrder(
  overrides: Partial<DeliveryPromptReadingOrder> = {},
): DeliveryPromptReadingOrder {
  return {
    workspaceRootFromWindow: "..",
    attachedWorktrees: [],
    taskPackageRef: parsePortableResourcePath(
      ".wakeflow-active/current/demand_22222222-2222-4222-8222-222222222222/task-packages/task-package_33333333-3333-4333-8333-333333333333.json",
    ),
    requirementSections:
      TASK_PACKAGE.workType === "implementation" ? TASK_PACKAGE.sectionAnchors : [],
    requirementPackage: deliveryPromptRequirementPackage("../wakeflow-ledger", RESOLVED_MEMBERS),
    workspaceInstructionFile: "CLAUDE.md",
    repositoryInstructionFile: "CLAUDE.md",
    stateRootRef: parsePortableResourcePath(
      ".wakeflow-active/current/demand_22222222-2222-4222-8222-222222222222",
    ),
    ...overrides,
  };
}

function render(
  order: DeliveryPromptReadingOrder,
  language: WakeflowPresentationLanguage = "en",
): string {
  return renderDeliveryPortablePrompt({
    language,
    displayTitle: "ProductA",
    taskPackage: TASK_PACKAGE,
    authored: { goal: "goal", focus: ["focus"], boundary: "boundary" },
    identity: {
      demandId: TASK_PACKAGE.demandId,
      podId: "main (pod-1)",
      windowId: "window-1",
      repositoryId: "repository-1",
      bindingId: "binding-1",
    },
    readingOrder: order,
    returnPointer: {
      deliveryId: "delivery-1",
      claimDigest: `sha256:${"1".repeat(64)}`,
      streamRevision: 7,
      generation: 1,
    },
    rework: null,
    productDefectRemediation: null,
    testContract: null,
  });
}

/** 阅读顺序段：从段头到下一个空行。 */
function readingSection(prompt: string, header: string): readonly string[] {
  const lines = prompt.split("\n");
  const start = lines.indexOf(header);
  ok(start >= 0, `prompt lacks ${header}`);
  const end = lines.indexOf("", start);
  return lines.slice(start + 1, end === -1 ? undefined : end);
}

test("需求包成员按记录章节归组：每份成员只带落在自己路径上的锚点", () => {
  const requirementPackage = deliveryPromptRequirementPackage(
    "../wakeflow-ledger",
    RESOLVED_MEMBERS,
  );
  equal(requirementPackage.ledgerRootFromWorkspace, "../wakeflow-ledger");
  deepEqual(packageFromAuthority([]).documents, []);
  deepEqual(
    requirementPackage.documents.map((document) => [
      document.role,
      document.memberRef,
      [...document.sectionAnchors],
    ]),
    [
      [
        "landing",
        `${REQUIREMENT_ROOT}/landing.md`,
        ["code-facts", "landing-plan", "testing-decision"],
      ],
      ["requirement", `${REQUIREMENT_ROOT}/requirement.md`, ["acceptance-criteria", "background"]],
    ],
  );
});

test("阅读顺序按文档列出完整 ledger 路径，章节列在所在文档下（§13.134，收 §13.133 I7）", () => {
  const prompt = render(readingOrder());
  deepEqual(readingSection(prompt, "Read in this order:"), [
    "1. ../.wakeflow-active/current/demand_22222222-2222-4222-8222-222222222222/task-packages/task-package_33333333-3333-4333-8333-333333333333.json",
    `2. ../../wakeflow-ledger/${REQUIREMENT_ROOT}/requirement.md`,
    `3. ../../wakeflow-ledger/${REQUIREMENT_ROOT}/landing.md`,
    "   sections: landing-plan, code-facts",
    "4. ../CLAUDE.md",
    "5. CLAUDE.md",
    "6. ../.wakeflow-active/current/demand_22222222-2222-4222-8222-222222222222",
  ]);
  equal(prompt.includes("requirement.md ("), false, "sections must not hang on requirement.md");
  equal(/^\d+\. requirement\.md$/mu.test(prompt), false, "requirement.md must not be a bare path");
});

test("程序根窗口、没有章节的任务与中文 prompt：路径规整，没有章节行，章节标签随语言", () => {
  const programRoot = render(
    readingOrder({
      workspaceRootFromWindow: ".",
      requirementSections: [],
      repositoryInstructionFile: null,
      requirementPackage: deliveryPromptRequirementPackage("ledger", RESOLVED_MEMBERS),
    }),
  );
  deepEqual(readingSection(programRoot, "Read in this order:"), [
    "1. ./.wakeflow-active/current/demand_22222222-2222-4222-8222-222222222222/task-packages/task-package_33333333-3333-4333-8333-333333333333.json",
    `2. ledger/${REQUIREMENT_ROOT}/requirement.md`,
    `3. ledger/${REQUIREMENT_ROOT}/landing.md`,
    "4. ./CLAUDE.md",
    "5. ./.wakeflow-active/current/demand_22222222-2222-4222-8222-222222222222",
  ]);
  const chinese = render(readingOrder({ workspaceRootFromWindow: "../.." }), "zh-Hans");
  const section = readingSection(chinese, "按序阅读:");
  equal(section[1], `2. ../../../wakeflow-ledger/${REQUIREMENT_ROOT}/requirement.md`);
  equal(section[3], "   章节: landing-plan, code-facts");
});

test("验收锚点超过上限时点明其余条数，不静默略去（§13.134 现场）", () => {
  const base = taskPackageDraft();
  const [first] = base.acceptanceAnchors;
  ok(first !== undefined);
  const anchors = Array.from({ length: 6 }, (_, index) => ({
    ...first,
    anchorId: `anchor-${index + 1}`,
    claim: `claim ${index + 1}`,
  }));
  const taskPackage = createTaskPackage(
    { ...base, sectionAnchors: ["landing-plan"], acceptanceAnchors: anchors },
    { clock: () => TASKING_CREATED_AT },
  );
  const prompt = (language: WakeflowPresentationLanguage) =>
    renderDeliveryPortablePrompt({
      language,
      displayTitle: "ProductA",
      taskPackage,
      authored: { goal: "goal", focus: ["focus"], boundary: "boundary" },
      identity: {
        demandId: taskPackage.demandId,
        podId: "main (pod-1)",
        windowId: "window-1",
        repositoryId: "repository-1",
        bindingId: "binding-1",
      },
      readingOrder: readingOrder({ requirementSections: ["landing-plan"] }),
      returnPointer: {
        deliveryId: "delivery-1",
        claimDigest: `sha256:${"1".repeat(64)}`,
        streamRevision: 7,
        generation: 1,
      },
      rework: null,
      productDefectRemediation: null,
      testContract: null,
    });
  deepEqual(readingSection(prompt("en"), "Acceptance anchors:"), [
    "- anchor-1: claim 1",
    "- anchor-2: claim 2",
    "- anchor-3: claim 3",
    "- anchor-4: claim 4",
    "- … 2 more acceptance anchors are in the task package",
  ]);
  equal(readingSection(prompt("zh-Hans"), "验收锚点:").at(-1), "- … 2 条验收锚点在任务包里");
  // 不超过上限时没有这一行。
  equal(render(readingOrder()).includes("more acceptance anchors"), false);
});
