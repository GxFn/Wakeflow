import {
  REQUIRED_REQUIREMENT_SECTIONS,
  REQUIREMENT_SUMMARY_ANCHORS,
  resolveRequirementSectionAnchor,
  type RequirementDemandType,
  type RequirementDocumentRole,
} from "../../contracts/vocabulary/requirement-sections.js";
import { computeCanonicalJsonSha256Digest } from "../../foundation/crypto/canonical-json-sha256.js";
import type { Sha256Digest } from "../../foundation/crypto/sha256.js";
import { parseJsonValue } from "../../foundation/data/json-value.js";
import type { PortableResourcePath } from "../../foundation/filesystem/portable-resource-path.js";
import { deriveDurableId } from "../../kernel/ids.js";
import {
  markdownSectionBodyDigest,
  normalizeMarkdownAnchor,
  parseMarkdownSections,
} from "../../kernel/markdown-sections.js";
import { DEFAULT_ALLOWED_ID_PREFIXES, scanPrivacy } from "../../kernel/privacy-scan.js";
import type {
  RequirementClaimState,
  RequirementClaimStatus,
} from "../../kernel/requirement-board.js";

/**
 * Wakeflow Capabilities / Requirement：纯决定。
 *
 * 输入是读好的文档文本与看板状态，输出是章节、缺章、摘要、阻塞与确定性标识；
 * 不读文件、不看时钟。认领状态的转移是内核纯函数，这里只判定能否转移。
 */

export interface PackageDocumentText {
  readonly role: RequirementDocumentRole;
  readonly path: PortableResourcePath;
  readonly text: string;
  readonly digest: Sha256Digest;
}

export interface RecordSection {
  readonly path: PortableResourcePath;
  readonly anchor: string;
  readonly heading: string;
  readonly line: number;
  readonly bodyDigest: Sha256Digest;
}

export interface SummarySection {
  readonly path: PortableResourcePath;
  readonly anchor: string;
  readonly heading: string;
  readonly text: string;
}

export interface MissingSection {
  readonly path: PortableResourcePath;
  readonly anchor: string;
}

export interface PackageAnalysis {
  readonly sections: readonly RecordSection[];
  readonly missing: readonly MissingSection[];
  readonly summary: readonly SummarySection[];
  /** requirement.md 用户确认节正文的摘要；缺节或空节为 `null`。 */
  readonly confirmationSectionDigest: Sha256Digest | null;
  /** 阻塞项：重复章节与隐私命中。 */
  readonly blockers: readonly string[];
}

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
const SYSTEM_PATH_PATTERN =
  /^(?:~|\/(?:Users|home|private|var|tmp|etc|opt|srv|root|mnt|Volumes|usr|Library|Applications))(?:\/|$)/u;

function matchedText(
  text: string,
  finding: { readonly line: number; readonly column: number; readonly length: number },
): string {
  const line = text.split(/\r?\n/u)[finding.line - 1] ?? "";
  return line.slice(finding.column - 1, finding.column - 1 + finding.length);
}

/** 隐私命中只报位置与类别，从不回显命中文本。 */
export function privacyBlockers(label: string, text: string): readonly string[] {
  return scanPrivacy(text, PRIVACY_POLICY)
    .filter(
      (finding) =>
        finding.kind !== "unlisted-absolute-path" ||
        SYSTEM_PATH_PATTERN.test(matchedText(text, finding)),
    )
    .slice(0, PRIVACY_BLOCKER_MAXIMUM)
    .map((finding) => `privacy-violation:${label}:${finding.line}:${finding.kind}`);
}

export const PRIVACY_BLOCKER_PREFIX = "privacy-violation:";
const BLOCKERS_MAXIMUM = 64;

interface DocumentSections {
  readonly recorded: readonly RecordSection[];
  readonly bodies: ReadonlyMap<string, string>;
  readonly duplicates: readonly string[];
}

function sectionsOf(document: PackageDocumentText): DocumentSections {
  const recorded: RecordSection[] = [];
  const bodies = new Map<string, string>();
  const duplicates: string[] = [];
  for (const section of parseMarkdownSections(document.text)) {
    const anchor =
      resolveRequirementSectionAnchor(section.heading) ?? normalizeMarkdownAnchor(section.heading);
    if (anchor === null) continue;
    if (bodies.has(anchor)) {
      duplicates.push(`duplicate-section:${document.path}#${anchor}`);
      continue;
    }
    bodies.set(anchor, section.body);
    recorded.push(
      Object.freeze({
        path: document.path,
        anchor,
        heading: section.heading,
        line: section.line,
        bodyDigest: markdownSectionBodyDigest(section.body),
      }),
    );
  }
  return Object.freeze({
    recorded: Object.freeze(recorded),
    bodies,
    duplicates: Object.freeze(duplicates),
  });
}

function requiredAnchors(demandType: RequirementDemandType, role: RequirementDocumentRole) {
  const table = REQUIRED_REQUIREMENT_SECTIONS[demandType];
  return role === "requirement" ? table.requirement : role === "landing" ? table.landing : [];
}

function summaryText(body: string): string {
  return body.length > SUMMARY_TEXT_MAXIMUM ? `${body.slice(0, SUMMARY_TEXT_MAXIMUM - 1)}…` : body;
}

function missingSectionsOf(
  demandType: RequirementDemandType,
  document: PackageDocumentText,
  parsed: DocumentSections,
): readonly MissingSection[] {
  return requiredAnchors(demandType, document.role)
    .filter((anchor) => (parsed.bodies.get(anchor) ?? "").length === 0)
    .map((anchor) => Object.freeze({ path: document.path, anchor }));
}

function summaryOf(
  document: PackageDocumentText,
  parsed: DocumentSections,
): readonly SummarySection[] {
  if (document.role === "attachment") return [];
  return parsed.recorded
    .filter((section) =>
      (REQUIREMENT_SUMMARY_ANCHORS as readonly string[]).includes(section.anchor),
    )
    .map((section) =>
      Object.freeze({
        path: document.path,
        anchor: section.anchor,
        heading: section.heading,
        text: summaryText(parsed.bodies.get(section.anchor) ?? ""),
      }),
    );
}

function confirmationDigestOf(
  document: PackageDocumentText,
  parsed: DocumentSections,
): Sha256Digest | null {
  if (document.role !== "requirement") return null;
  const section = parsed.recorded.find((entry) => entry.anchor === "user-confirmation");
  if (section === undefined || (parsed.bodies.get("user-confirmation") ?? "").length === 0)
    return null;
  return section.bodyDigest;
}

/** 切分全部文档，按 demandType 报缺章，抽出确认点 1 的摘要与用户确认节摘要。 */
export function analyzePackageDocuments(
  demandType: RequirementDemandType,
  title: string,
  documents: readonly PackageDocumentText[],
): PackageAnalysis {
  const sections: RecordSection[] = [];
  const missing: MissingSection[] = [];
  const summary: SummarySection[] = [];
  const blockers: string[] = [...privacyBlockers("title", title)];
  let confirmationSectionDigest: Sha256Digest | null = null;
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

export interface PublishBlockerInput {
  readonly analysis: PackageAnalysis;
  readonly demandType: RequirementDemandType;
  readonly testingDecisionMode: "controller-only" | "real-environment" | "not-applicable";
  readonly confirmedAt: string | null;
  /** 请求了 supersedes 但看板上没有该包时为 `"unknown"`；未请求为 `null`。 */
  readonly supersedes: RequirementClaimState | null | "unknown";
  /** 头部里进入记录或看板的自由文本：测试决策摘要、搁置触发条件。 */
  readonly headerTexts: readonly Readonly<{ readonly label: string; readonly text: string }>[];
}

const BLOCKER_TEXT_MAXIMUM = 256;

/** 阻塞项带文档路径，路径可到 1024 码点；按结果 Schema 的 256 码点上限截断并加省略号。 */
function boundedBlocker(blocker: string): string {
  const codePoints = Array.from(blocker);
  return codePoints.length > BLOCKER_TEXT_MAXIMUM
    ? `${codePoints.slice(0, BLOCKER_TEXT_MAXIMUM - 1).join("")}…`
    : blocker;
}

/** 发布计划的阻塞项；空即 ready。总数有界，超出的只剩前 64 项。 */
export function derivePublishBlockers(input: Readonly<PublishBlockerInput>): readonly string[] {
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
  if (input.supersedes === "unknown") blockers.push("supersedes-unknown");
  return Object.freeze([...new Set(blockers.map(boundedBlocker))].slice(0, BLOCKERS_MAXIMUM));
}

export interface RequirementIdentityInput {
  readonly programId: string;
  readonly designSurfaceId: string;
  readonly title: string;
  readonly demandType: RequirementDemandType;
  readonly priority: string;
  readonly originWindowId: string;
  readonly testingDecision: Readonly<{ readonly mode: string; readonly summary: string }>;
  readonly taskPlanReview: string;
  readonly supersedes: string | null;
  readonly parkedTrigger: string | null;
  readonly documents: readonly PackageDocumentText[];
  readonly confirmedAt: string;
  readonly confirmationSectionDigest: Sha256Digest;
}

/** requirementId 由内容确定性派生：同内容同标识，改内容即新包。 */
export function deriveRequirementId(input: Readonly<RequirementIdentityInput>): string {
  const digest = computeCanonicalJsonSha256Digest(
    parseJsonValue(
      {
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
      },
      "$identity",
    ),
  );
  return deriveDurableId("requirement", "requirement-package", digest);
}

export type ClaimAction = "activate" | "withdraw";

/** activate 与 withdraw 的阻塞项：包存在、摘要相符、状态允许。 */
export function deriveClaimTransitionBlockers(
  action: ClaimAction,
  current: Readonly<{
    readonly state: RequirementClaimState;
    readonly digest: Sha256Digest;
  }> | null,
  expectedStateDigest: string,
): readonly string[] {
  if (current === null) return Object.freeze(["package-unknown"]);
  const blockers: string[] = [];
  if (current.digest !== expectedStateDigest) blockers.push("claim-state-drift");
  const allowed: readonly RequirementClaimStatus[] =
    action === "activate" ? ["parked"] : ["pending", "parked"];
  if (!allowed.includes(current.state.status))
    blockers.push(`claim-status:${current.state.status}`);
  return Object.freeze(blockers);
}
