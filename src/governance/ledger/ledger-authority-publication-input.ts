import {
  parseWakeflowDurableIdOfKind,
  WakeflowDurableIdError,
  type WakeflowDurableId,
} from "../../contracts/identity/wakeflow-durable-id.js";
import {
  parseDenseArray,
  parsePlainRecord,
  PassiveOwnDataError,
} from "../../foundation/data/passive-own-data.js";
import {
  parsePortableResourcePath,
  PortableResourcePathError,
  splitPortableResourcePath,
  type PortableResourcePath,
} from "../../foundation/filesystem/portable-resource-path.js";
import type {
  ConfirmationDocumentRole,
  RequirementDocumentRole,
} from "./ledger-authority-record.js";
import {
  LEDGER_AUTHORITY_MAXIMUM_DOCUMENTS,
} from "./ledger-authority-storage-policy.js";

/**
 * Wakeflow Governance / Ledger：公共Planning之前的author-owned发布输入。
 *
 * 调用方只选择当前Config中的Design support surface、严格Markdown成员和业务title。
 * Program、Record/Demand ID、时间、media type、成员摘要、字节大小、目标引用与发布计划
 * 全部由后续Planning从当前Config和稳定文件字节派生。本模块不读取文件、不分配身份，
 * 也不创建Ledger发布意图。
 */

export const LEDGER_AUTHORITY_PUBLICATION_MEMBER_MEDIA_TYPE =
  "text/markdown" as const;

export interface LedgerAuthorityPublicationDocumentSelection<
  Role extends RequirementDocumentRole | ConfirmationDocumentRole,
> {
  readonly role: Role;
  readonly path: PortableResourcePath;
}

export interface RequirementAuthorityPublicationInput {
  readonly family: "requirement";
  readonly title: string;
  readonly designSurfaceId: WakeflowDurableId<"surface">;
  readonly documents: readonly [
    Readonly<LedgerAuthorityPublicationDocumentSelection<RequirementDocumentRole>>,
    ...Readonly<LedgerAuthorityPublicationDocumentSelection<RequirementDocumentRole>>[],
  ];
}

export interface ConfirmationAuthorityPublicationInput {
  readonly family: "confirmation";
  readonly title: string;
  readonly designSurfaceId: WakeflowDurableId<"surface">;
  readonly documents: readonly [
    Readonly<LedgerAuthorityPublicationDocumentSelection<ConfirmationDocumentRole>>,
    ...Readonly<LedgerAuthorityPublicationDocumentSelection<ConfirmationDocumentRole>>[],
  ];
}

export type LedgerAuthorityPublicationInput =
  | Readonly<RequirementAuthorityPublicationInput>
  | Readonly<ConfirmationAuthorityPublicationInput>;

export type LedgerAuthorityPublicationInputErrorReason =
  | "input"
  | "identifier"
  | "title"
  | "document"
  | "path";

const ERROR_MESSAGES = {
  input: "Ledger authority publication input is invalid.",
  identifier: "Ledger authority publication Design surface identity is invalid.",
  title: "Ledger authority publication title is invalid.",
  document: "Ledger authority publication document selection is invalid.",
  path: "Ledger authority publication document path is invalid.",
} as const satisfies Readonly<Record<
  LedgerAuthorityPublicationInputErrorReason,
  string
>>;

/** Ledger发布输入无法形成关闭、被动且一致的调用方意图时返回的稳定错误。 */
export class LedgerAuthorityPublicationInputError extends Error {
  override readonly name = "LedgerAuthorityPublicationInputError";
  readonly code = "wakeflow-ledger-authority-publication-input" as const;
  readonly reason: LedgerAuthorityPublicationInputErrorReason;
  readonly path: string;

  constructor(
    reason: LedgerAuthorityPublicationInputErrorReason,
    path: string,
  ) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

const INPUT_FIELDS = Object.freeze([
  "designSurfaceId",
  "documents",
  "title",
] as const);
const DOCUMENT_FIELDS = Object.freeze(["path", "role"] as const);
const REQUIREMENT_ROLES = Object.freeze({
  "original-plan": true,
  "requirement-design": true,
  "code-facts": true,
  "landing-plan": true,
  "non-goals": true,
  "user-confirmation": true,
  reproduction: true,
  scope: true,
  "requirement-delta": true,
  "research-question": true,
  boundaries: true,
  "test-environment": true,
  "supporting-evidence": true,
} as const satisfies Readonly<Record<RequirementDocumentRole, true>>);
const CONFIRMATION_ROLES = Object.freeze({
  "goal-stage-decision": true,
  "user-confirmation": true,
  "requirement-delta": true,
  "supporting-evidence": true,
} as const satisfies Readonly<Record<ConfirmationDocumentRole, true>>);
const RESERVED_SOURCE_ROOT_SEGMENTS = new Set([
  ".git",
  ".wakeflow-active",
  ".wakeflow-local",
]);
const CONTROL_EXCEPT_LF_PATTERN =
  /\r|[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/u;
const MAXIMUM_TITLE_CODE_POINTS = 8192;

function fail(
  reason: LedgerAuthorityPublicationInputErrorReason,
  path: string,
): never {
  throw new LedgerAuthorityPublicationInputError(reason, path);
}

function exactRecord(
  value: unknown,
  fields: readonly string[],
  path: string,
  reason: "input" | "document",
): Readonly<Record<string, unknown>> {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value, path);
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail(reason, path);
    throw error;
  }
  const keys = Object.keys(record).sort();
  if (
    keys.length !== fields.length
    || keys.some((key, index) => key !== fields[index])
  ) {
    fail(reason, path);
  }
  return record;
}

function parseTitle(value: unknown): string {
  if (
    typeof value !== "string"
    || !value.isWellFormed()
    || value.normalize("NFC") !== value
    || !/^(?!\s)[\s\S]*\S$/u.test(value)
    || CONTROL_EXCEPT_LF_PATTERN.test(value)
    || Array.from(value).length > MAXIMUM_TITLE_CODE_POINTS
  ) {
    fail("title", "$/title");
  }
  return value;
}

function parseDesignSurfaceId(
  value: unknown,
): WakeflowDurableId<"surface"> {
  try {
    return parseWakeflowDurableIdOfKind(
      value,
      "surface",
      "$/designSurfaceId",
    );
  } catch (error: unknown) {
    if (error instanceof WakeflowDurableIdError) {
      fail("identifier", "$/designSurfaceId");
    }
    throw error;
  }
}

function parseDocumentPath(value: unknown, path: string): PortableResourcePath {
  let memberPath: PortableResourcePath;
  try {
    memberPath = parsePortableResourcePath(value, `${path}/path`);
  } catch (error: unknown) {
    if (error instanceof PortableResourcePathError) fail("path", `${path}/path`);
    throw error;
  }
  const segments = splitPortableResourcePath(memberPath);
  const first = segments[0]?.toLowerCase();
  if (
    first === undefined
    || RESERVED_SOURCE_ROOT_SEGMENTS.has(first)
    || first === "record.json"
    || !memberPath.endsWith(".md")
  ) {
    fail("path", `${path}/path`);
  }
  return memberPath;
}

function parseRole(
  value: unknown,
  family: LedgerAuthorityPublicationInput["family"],
  path: string,
): RequirementDocumentRole | ConfirmationDocumentRole {
  if (typeof value !== "string") fail("document", `${path}/role`);
  if (family === "requirement") {
    if (!Object.hasOwn(REQUIREMENT_ROLES, value)) {
      fail("document", `${path}/role`);
    }
    return value as RequirementDocumentRole;
  }
  if (!Object.hasOwn(CONFIRMATION_ROLES, value)) {
    fail("document", `${path}/role`);
  }
  return value as ConfirmationDocumentRole;
}

function parseDocuments(
  value: unknown,
  family: LedgerAuthorityPublicationInput["family"],
): LedgerAuthorityPublicationInput["documents"] {
  let values: readonly unknown[];
  try {
    values = parseDenseArray(
      value,
      LEDGER_AUTHORITY_MAXIMUM_DOCUMENTS,
      "$/documents",
    );
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("document", "$/documents");
    throw error;
  }
  if (values.length === 0) fail("document", "$/documents");
  const documents = values.map((entry, index) => {
    const path = `$/documents/${index}`;
    const record = exactRecord(entry, DOCUMENT_FIELDS, path, "document");
    return Object.freeze({
      role: parseRole(record.role, family, path),
      path: parseDocumentPath(record.path, path),
    });
  }).sort((left, right) => (
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0
  ));

  const nodesByCaseKey = new Map<
    string,
    Readonly<{ readonly path: string; readonly kind: "directory" | "file" }>
  >();
  for (const [index, document] of documents.entries()) {
    const previous = documents[index - 1];
    if (previous !== undefined && previous.path >= document.path) {
      fail("path", `$/documents/${index}/path`);
    }
    const segments = splitPortableResourcePath(document.path);
    for (let depth = 1; depth <= segments.length; depth += 1) {
      const nodePath = segments.slice(0, depth).join("/");
      const kind = depth === segments.length ? "file" as const : "directory" as const;
      const caseKey = nodePath.toLowerCase();
      const existing = nodesByCaseKey.get(caseKey);
      if (
        existing !== undefined
        && (existing.path !== nodePath || existing.kind !== kind)
      ) {
        fail("path", `$/documents/${index}/path`);
      }
      if (existing === undefined) {
        nodesByCaseKey.set(caseKey, Object.freeze({ path: nodePath, kind }));
      }
    }
  }
  const first = documents[0];
  if (first === undefined) fail("document", "$/documents");
  return Object.freeze([first, ...documents.slice(1)]) as
    LedgerAuthorityPublicationInput["documents"];
}

function parsePublicationInput(
  value: unknown,
  family: LedgerAuthorityPublicationInput["family"],
): Readonly<LedgerAuthorityPublicationInput> {
  const record = exactRecord(value, INPUT_FIELDS, "$input", "input");
  const common = {
    title: parseTitle(record.title),
    designSurfaceId: parseDesignSurfaceId(record.designSurfaceId),
    documents: parseDocuments(record.documents, family),
  };
  return family === "requirement"
    ? Object.freeze({ family: "requirement" as const, ...common }) as
      Readonly<RequirementAuthorityPublicationInput>
    : Object.freeze({ family: "confirmation" as const, ...common }) as
      Readonly<ConfirmationAuthorityPublicationInput>;
}

/** 解析Requirement公共工具进入Planning前的最小调用方选择。 */
export function parseRequirementAuthorityPublicationInput(
  value: unknown,
): Readonly<RequirementAuthorityPublicationInput> {
  return parsePublicationInput(
    value,
    "requirement",
  ) as Readonly<RequirementAuthorityPublicationInput>;
}

/** 解析Confirmation公共工具进入Planning前的最小调用方选择。 */
export function parseConfirmationAuthorityPublicationInput(
  value: unknown,
): Readonly<ConfirmationAuthorityPublicationInput> {
  return parsePublicationInput(
    value,
    "confirmation",
  ) as Readonly<ConfirmationAuthorityPublicationInput>;
}
