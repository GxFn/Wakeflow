import { resolveRequirementSectionAnchor } from "../contracts/vocabulary/requirement-sections.js";
import { parseMarkdownListItems, parseMarkdownSections } from "./markdown-sections.js";

export interface AcceptanceCriterion {
  readonly itemId: string;
  readonly text: string;
}

/** 发布、规划与完成共用的验收语法；itemId 按不可变需求正文的顶层列表顺序生成。 */
export function parseAcceptanceCriteria(requirementText: string): readonly AcceptanceCriterion[] {
  const section = parseMarkdownSections(requirementText).find(
    (candidate) => resolveRequirementSectionAnchor(candidate.heading) === "acceptance-criteria",
  );
  if (section === undefined) return Object.freeze([]);
  return Object.freeze(
    parseMarkdownListItems(section.body, "ac").map((item) =>
      Object.freeze({ itemId: item.itemId, text: item.text }),
    ),
  );
}

/**
 * 一条验收标准在阻塞项、门明细与覆盖清单里的写法：源需求的条目是 `ac-N`；并入 Demand 的 supplement 包
 * （Q7 裁决）各自编号，写作 `<requirementId>/ac-N`。
 */
export function acceptanceCriterionLabel(requirementId: string | null, itemId: string): string {
  return requirementId === null ? itemId : `${requirementId}/${itemId}`;
}
