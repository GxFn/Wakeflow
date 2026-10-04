import { resolveRequirementSectionAnchor } from "../contracts/vocabulary/requirement-sections.js";
import { parseMarkdownListItems, parseMarkdownSections } from "./markdown-sections.js";
/** 发布、规划与完成共用的验收语法；itemId 按不可变需求正文的顶层列表顺序生成。 */
export function parseAcceptanceCriteria(requirementText) {
    const section = parseMarkdownSections(requirementText).find((candidate) => resolveRequirementSectionAnchor(candidate.heading) === "acceptance-criteria");
    if (section === undefined)
        return Object.freeze([]);
    return Object.freeze(parseMarkdownListItems(section.body, "ac").map((item) => Object.freeze({ itemId: item.itemId, text: item.text })));
}
