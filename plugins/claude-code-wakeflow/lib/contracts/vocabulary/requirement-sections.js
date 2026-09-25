/**
 * Wakeflow Contracts / Vocabulary：需求包文档的章节词汇（ADR-0011 D3）。
 *
 * 章节以语言无关的锚点为键；标题按别名表识别，中英文都接受。每种 demandType 对
 * `requirement.md` 与 `landing.md` 各有一张必需章节表；缺章在 preview 报出。
 */
export const REQUIREMENT_DOCUMENT_ROLES = Object.freeze([
    "requirement",
    "landing",
    "attachment",
]);
export const REQUIREMENT_DEMAND_TYPES = Object.freeze([
    "requirement",
    "bug",
    "supplement",
    "research",
]);
export const REQUIREMENT_SECTION_ANCHORS = Object.freeze([
    "goal",
    "completion-definition",
    "non-goals",
    "acceptance-criteria",
    "user-confirmation",
    "code-facts",
    "landing-plan",
    "testing-decision",
    "reproduction",
    "scope",
    "requirement-delta",
    "research-question",
    "boundaries",
    "known-facts",
    "method",
    "fix-plan",
]);
/** 标题别名，比较前依次做 NFKC、小写、空白折叠与 trim。 */
const REQUIREMENT_SECTION_ALIASES = Object.freeze({
    goal: ["目标", "goal", "user goal", "confirmed goal"],
    "completion-definition": ["完成定义", "completion definition", "definition of done"],
    "non-goals": ["非目标", "non-goals", "non goals", "non-goals and forbidden shortcuts"],
    "acceptance-criteria": ["验收标准", "acceptance criteria"],
    "user-confirmation": ["用户确认", "user confirmation", "confirmation"],
    "code-facts": [
        "已核实的代码事实",
        "代码事实",
        "code facts",
        "verified code facts",
        "verified code and documentation facts",
    ],
    "landing-plan": [
        "落地方案与影响范围",
        "落地方案",
        "landing plan",
        "landing plan and impact",
        "repository boundaries and landing intent",
    ],
    "testing-decision": ["测试决策", "testing decision", "validation and testing decision"],
    reproduction: ["复现", "reproduction", "steps to reproduce"],
    scope: ["范围", "scope"],
    "requirement-delta": ["需求增量", "requirement delta"],
    "research-question": ["研究问题", "research question"],
    boundaries: ["边界", "boundaries"],
    "known-facts": ["已知事实", "known facts"],
    method: ["方法", "method", "approach"],
    "fix-plan": ["修复方案", "fix plan"],
});
/** ADR-0011 D3 的必需章节表。 */
export const REQUIRED_REQUIREMENT_SECTIONS = Object.freeze({
    requirement: {
        requirement: [
            "goal",
            "completion-definition",
            "non-goals",
            "acceptance-criteria",
            "user-confirmation",
        ],
        landing: ["code-facts", "landing-plan", "testing-decision"],
    },
    bug: {
        requirement: ["reproduction", "scope", "non-goals", "user-confirmation"],
        landing: ["code-facts", "fix-plan", "testing-decision"],
    },
    supplement: {
        requirement: ["requirement-delta", "completion-definition", "user-confirmation"],
        landing: ["code-facts", "landing-plan", "testing-decision"],
    },
    research: {
        requirement: ["research-question", "boundaries", "user-confirmation"],
        landing: ["known-facts", "method"],
    },
});
/**
 * 确认点 1 摘要所列章节（ADR-0011 D4）：各 demandType 的目标类（goal / requirement-delta /
 * research-question / reproduction）、完成定义、非目标、范围类（scope / boundaries）与测试决策。
 */
export const REQUIREMENT_SUMMARY_ANCHORS = Object.freeze([
    "goal",
    "requirement-delta",
    "research-question",
    "reproduction",
    "completion-definition",
    "non-goals",
    "scope",
    "boundaries",
    "testing-decision",
]);
function normalizeHeading(value) {
    return value.normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim();
}
const ALIAS_INDEX = new Map(REQUIREMENT_SECTION_ANCHORS.flatMap((anchor) => REQUIREMENT_SECTION_ALIASES[anchor].map((alias) => [normalizeHeading(alias), anchor])));
/** 识别一个标题对应的章节锚点；不认识返回 `null`。 */
export function resolveRequirementSectionAnchor(heading) {
    return ALIAS_INDEX.get(normalizeHeading(heading)) ?? null;
}
