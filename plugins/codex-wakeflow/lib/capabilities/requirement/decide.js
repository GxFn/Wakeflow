import { REQUIRED_REQUIREMENT_SECTIONS, REQUIREMENT_SUMMARY_ANCHORS, resolveRequirementSectionAnchor, } from "../../contracts/vocabulary/requirement-sections.js";
import { computeCanonicalJsonSha256Digest } from "../../foundation/crypto/canonical-json-sha256.js";
import { parseJsonValue } from "../../foundation/data/json-value.js";
import { deriveDurableId } from "../../kernel/ids.js";
import { markdownSectionBodyDigest, normalizeMarkdownAnchor, parseMarkdownSections, } from "../../kernel/markdown-sections.js";
import { DEFAULT_ALLOWED_ID_PREFIXES, scanPrivacy } from "../../kernel/privacy-scan.js";
const SUMMARY_TEXT_MAXIMUM = 4000;
const PRIVACY_BLOCKER_MAXIMUM = 32;
const PRIVACY_POLICY = Object.freeze({
    allowedPathRoots: Object.freeze([]),
    allowedIdPrefixes: DEFAULT_ALLOWED_ID_PREFIXES,
});
/**
 * 需求文档里常见的 URL 路由与站内链接（`/api/orders`、`/docs/spec.md`）不是私有路径；
 * 只有指向用户目录或系统目录的绝对路径才算泄露。
 */
const SYSTEM_PATH_PATTERN = /^(?:~|\/(?:Users|home|private|var|tmp|etc|opt|srv|root|mnt|Volumes|usr|Library|Applications))(?:\/|$)/u;
function matchedText(text, finding) {
    const line = text.split(/\r?\n/u)[finding.line - 1] ?? "";
    return line.slice(finding.column - 1, finding.column - 1 + finding.length);
}
/** 隐私命中只报位置与类别，从不回显命中文本。 */
export function privacyBlockers(label, text) {
    return scanPrivacy(text, PRIVACY_POLICY)
        .filter((finding) => finding.kind !== "unlisted-absolute-path" ||
        SYSTEM_PATH_PATTERN.test(matchedText(text, finding)))
        .slice(0, PRIVACY_BLOCKER_MAXIMUM)
        .map((finding) => `privacy-violation:${label}:${finding.line}:${finding.kind}`);
}
export const PRIVACY_BLOCKER_PREFIX = "privacy-violation:";
const BLOCKERS_MAXIMUM = 64;
function sectionsOf(document) {
    const recorded = [];
    const bodies = new Map();
    const duplicates = [];
    for (const section of parseMarkdownSections(document.text)) {
        const anchor = resolveRequirementSectionAnchor(section.heading) ?? normalizeMarkdownAnchor(section.heading);
        if (anchor === null)
            continue;
        if (bodies.has(anchor)) {
            duplicates.push(`duplicate-section:${document.path}#${anchor}`);
            continue;
        }
        bodies.set(anchor, section.body);
        recorded.push(Object.freeze({
            path: document.path,
            anchor,
            heading: section.heading,
            line: section.line,
            bodyDigest: markdownSectionBodyDigest(section.body),
        }));
    }
    return Object.freeze({
        recorded: Object.freeze(recorded),
        bodies,
        duplicates: Object.freeze(duplicates),
    });
}
function requiredAnchors(demandType, role) {
    const table = REQUIRED_REQUIREMENT_SECTIONS[demandType];
    return role === "requirement" ? table.requirement : role === "landing" ? table.landing : [];
}
function summaryText(body) {
    return body.length > SUMMARY_TEXT_MAXIMUM ? `${body.slice(0, SUMMARY_TEXT_MAXIMUM - 1)}…` : body;
}
function missingSectionsOf(demandType, document, parsed) {
    return requiredAnchors(demandType, document.role)
        .filter((anchor) => (parsed.bodies.get(anchor) ?? "").length === 0)
        .map((anchor) => Object.freeze({ path: document.path, anchor }));
}
function summaryOf(document, parsed) {
    if (document.role === "attachment")
        return [];
    return parsed.recorded
        .filter((section) => REQUIREMENT_SUMMARY_ANCHORS.includes(section.anchor))
        .map((section) => Object.freeze({
        path: document.path,
        anchor: section.anchor,
        heading: section.heading,
        text: summaryText(parsed.bodies.get(section.anchor) ?? ""),
    }));
}
function confirmationDigestOf(document, parsed) {
    if (document.role !== "requirement")
        return null;
    const section = parsed.recorded.find((entry) => entry.anchor === "user-confirmation");
    if (section === undefined || (parsed.bodies.get("user-confirmation") ?? "").length === 0)
        return null;
    return section.bodyDigest;
}
/** 切分全部文档，按 demandType 报缺章，抽出确认点 1 的摘要与用户确认节摘要。 */
export function analyzePackageDocuments(demandType, title, documents) {
    const sections = [];
    const missing = [];
    const summary = [];
    const blockers = [...privacyBlockers("title", title)];
    let confirmationSectionDigest = null;
    for (const document of documents) {
        const parsed = sectionsOf(document);
        sections.push(...parsed.recorded);
        blockers.push(...parsed.duplicates, ...privacyBlockers(document.path, document.text));
        missing.push(...missingSectionsOf(demandType, document, parsed));
        summary.push(...summaryOf(document, parsed));
        confirmationSectionDigest ??= confirmationDigestOf(document, parsed);
    }
    return Object.freeze({
        sections: Object.freeze(sections),
        missing: Object.freeze(missing),
        summary: Object.freeze(summary),
        confirmationSectionDigest,
        blockers: Object.freeze(blockers),
    });
}
const BLOCKER_TEXT_MAXIMUM = 256;
/** 阻塞项带文档路径，路径可到 1024 码点；按结果 Schema 的 256 码点上限截断并加省略号。 */
function boundedBlocker(blocker) {
    const codePoints = Array.from(blocker);
    return codePoints.length > BLOCKER_TEXT_MAXIMUM
        ? `${codePoints.slice(0, BLOCKER_TEXT_MAXIMUM - 1).join("")}…`
        : blocker;
}
/** 发布计划的阻塞项；空即 ready。总数有界，超出的只剩前 64 项。 */
export function derivePublishBlockers(input) {
    const blockers = [
        ...input.analysis.blockers,
        ...input.headerTexts.flatMap((entry) => privacyBlockers(entry.label, entry.text)),
        ...input.analysis.missing.map((entry) => `missing-section:${entry.path}#${entry.anchor}`),
    ];
    if (input.confirmedAt === null || input.analysis.confirmationSectionDigest === null) {
        blockers.push("user-confirmation-missing");
    }
    if ((input.demandType === "research") !== (input.testingDecisionMode === "not-applicable")) {
        blockers.push("testing-decision-mode");
    }
    if (input.supersedes === "unknown")
        blockers.push("supersedes-unknown");
    return Object.freeze([...new Set(blockers.map(boundedBlocker))].slice(0, BLOCKERS_MAXIMUM));
}
/** requirementId 由内容确定性派生：同内容同标识，改内容即新包。 */
export function deriveRequirementId(input) {
    const digest = computeCanonicalJsonSha256Digest(parseJsonValue({
        programId: input.programId,
        designSurfaceId: input.designSurfaceId,
        title: input.title,
        demandType: input.demandType,
        priority: input.priority,
        originWindowId: input.originWindowId,
        testingDecision: input.testingDecision,
        taskPlanReview: input.taskPlanReview,
        supersedes: input.supersedes,
        parkedTrigger: input.parkedTrigger,
        confirmedAt: input.confirmedAt,
        documents: [...input.documents]
            .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0))
            .map((document) => ({
            role: document.role,
            path: document.path,
            digest: document.digest,
        })),
        confirmationSectionDigest: input.confirmationSectionDigest,
    }, "$identity"));
    return deriveDurableId("requirement", "requirement-package", digest);
}
/** activate 与 withdraw 的阻塞项：包存在、摘要相符、状态允许。 */
export function deriveClaimTransitionBlockers(action, current, expectedStateDigest) {
    if (current === null)
        return Object.freeze(["package-unknown"]);
    const blockers = [];
    if (current.digest !== expectedStateDigest)
        blockers.push("claim-state-drift");
    const allowed = action === "activate" ? ["parked"] : ["pending", "parked"];
    if (!allowed.includes(current.state.status))
        blockers.push(`claim-status:${current.state.status}`);
    return Object.freeze(blockers);
}
