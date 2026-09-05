import { resolveRequirementSectionAnchor } from "../../../src/contracts/vocabulary/requirement-sections.js";
import { computeSha256Digest, type Sha256Digest } from "../../../src/foundation/crypto/sha256.js";
import { parsePortableResourcePath } from "../../../src/foundation/filesystem/portable-resource-path.js";
import { encodeUtf8 } from "../../../src/foundation/text/utf8.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import {
  markdownSectionBodyDigest,
  normalizeMarkdownAnchor,
  parseMarkdownSections,
} from "../../../src/kernel/markdown-sections.js";
import {
  createRequirementRecord,
  type CreateRequirementRecordInput,
  type RequirementRecord,
} from "../../../src/governance/ledger/ledger-authority-record.js";
import type {
  LedgerAuthorityMemberInput,
  LoadedLedgerAuthorityRecord,
} from "../../../src/governance/ledger/ledger-authority-store-contract.js";
import type { LedgerAuthorityStore } from "../../../src/governance/ledger/ledger-authority-store.js";

/**
 * 需求包 fixture：一份合法的 requirement 类型需求包（requirement.md 与 landing.md），
 * 供 ledger、demand、tasking 等测试直接发布，不经公共工具。
 */

export const FIXTURE_REQUIREMENT_ID = "requirement_77777777-7777-4777-8777-777777777777" as const;
export const FIXTURE_PROGRAM_ID = "program_11111111-1111-4111-8111-111111111111" as const;
export const FIXTURE_ORIGIN_WINDOW_ID = "window_66666666-6666-4666-8666-666666666666" as const;
export const FIXTURE_CONFIRMED_AT = parseUtcInstant("2026-09-04T10:00:00.000Z");
export const FIXTURE_RECORDED_AT = parseUtcInstant("2026-09-04T10:05:00.000Z");

export const FIXTURE_REQUIREMENT_MARKDOWN = `# 示例需求

## 目标

让 Controller 能从需求包创建 Demand。

## 完成定义

需求包发布后出现在看板上，认领后 Demand 根存在。

## 非目标

不改动投递与评审。

## 验收标准

- AC-1 发布后 inspect_board 列出该包为 pending。
- AC-2 create_demand 后状态为 claimed。

## 用户确认

用户于 2026-09-04T10:00:00Z 确认了目标、完成定义、非目标与测试决策。
`;

export const FIXTURE_LANDING_MARKDOWN = `# 示例落地

## 已核实的代码事实

src/capabilities/requirement 目前不存在。

## 落地方案与影响范围

新增 requirement 切片；影响 demand 创建入口。

## 测试决策

controller-only：聚焦测试加场景验收。
`;

export interface FixtureDocument {
  readonly role: "requirement" | "landing" | "attachment";
  readonly path: string;
  readonly text: string;
}

export function fixtureDocuments(
  overrides: Partial<Record<"requirement" | "landing", string>> = {},
): readonly FixtureDocument[] {
  return [
    { role: "requirement", path: "requirement.md", text: overrides.requirement ?? FIXTURE_REQUIREMENT_MARKDOWN },
    { role: "landing", path: "landing.md", text: overrides.landing ?? FIXTURE_LANDING_MARKDOWN },
  ];
}

/** 记录成员与发布成员都按路径升序；ledger 编解码器与发布器按该顺序逐项对应。 */
function sortedByPath<Item extends { readonly path: string }>(items: readonly Item[]): readonly Item[] {
  return [...items].sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
}

export function requirementMembers(
  documents: readonly FixtureDocument[] = fixtureDocuments(),
): readonly LedgerAuthorityMemberInput[] {
  return sortedByPath(documents).map((document) => ({
    path: parsePortableResourcePath(document.path),
    bytes: encodeUtf8(document.text),
  }));
}

function sectionsOf(documents: readonly FixtureDocument[]) {
  return documents.flatMap((document) =>
    parseMarkdownSections(document.text).flatMap((section) => {
      const anchor = resolveRequirementSectionAnchor(section.heading) ?? normalizeMarkdownAnchor(section.heading);
      if (anchor === null) return [];
      return [
        {
          path: parsePortableResourcePath(document.path),
          anchor,
          heading: section.heading,
          line: section.line,
          bodyDigest: markdownSectionBodyDigest(section.body),
        },
      ];
    }),
  );
}

export function requirementRecordDraft(
  overrides: Partial<CreateRequirementRecordInput> = {},
  documents: readonly FixtureDocument[] = fixtureDocuments(),
): CreateRequirementRecordInput {
  const sections = sectionsOf(documents);
  const confirmation = sections.find((section) => section.anchor === "user-confirmation");
  return {
    requirementId: FIXTURE_REQUIREMENT_ID,
    programId: FIXTURE_PROGRAM_ID,
    title: "示例需求",
    demandType: "requirement",
    priority: "P1",
    originWindowId: FIXTURE_ORIGIN_WINDOW_ID,
    testingDecision: { mode: "controller-only", summary: "聚焦测试加场景验收。" },
    taskPlanReview: "controller",
    supersedes: null,
    parked: null,
    confirmation: {
      confirmedAt: FIXTURE_CONFIRMED_AT,
      sectionDigest: confirmation?.bodyDigest ?? (`sha256:${"0".repeat(64)}` as Sha256Digest),
    },
    documents: sortedByPath(documents).map((document) => ({
      role: document.role,
      path: parsePortableResourcePath(document.path),
      mediaType: "text/markdown",
      digest: computeSha256Digest(encodeUtf8(document.text)),
    })),
    sections,
    ...overrides,
  };
}

/** 直接经 store 发布一份需求包记录并返回加载结果。 */
export async function publishFixtureRequirement(
  store: LedgerAuthorityStore,
  overrides: Partial<CreateRequirementRecordInput> = {},
  documents: readonly FixtureDocument[] = fixtureDocuments(),
): Promise<Readonly<LoadedLedgerAuthorityRecord<RequirementRecord>>> {
  const record = createRequirementRecord(requirementRecordDraft(overrides, documents), {
    clock: () => FIXTURE_RECORDED_AT,
  });
  await store.publish(record, requirementMembers(documents));
  return store.loadRequirement(record.requirementId);
}
