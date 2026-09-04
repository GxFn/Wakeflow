import { WAKEFLOW_DURABLE_ID_KINDS } from "../contracts/identity/wakeflow-durable-id.js";
import { fail } from "./error.js";

/**
 * Wakeflow Kernel / Privacy Scan：文本内容的唯一隐私扫描引擎（能力卡 8 Q1，ADR-0013）。
 *
 * 只拒绝不脱敏。凭证类三条规则无条件命中；绝对路径与 UUID 按白名单判断：
 * 位于允许根之下的路径与带已知 typed 前缀的 UUID 通过，其余命中。结果只含
 * 类别与位置，从不含命中的文本，因此可以进入公共错误与记录。
 */

const PRIVACY_FINDING_KINDS = Object.freeze([
  "private-key",
  "provider-credential",
  "credential-assignment",
  "unlisted-absolute-path",
  "bare-uuid",
] as const);

type PrivacyFindingKind = (typeof PRIVACY_FINDING_KINDS)[number];

export interface PrivacyFinding {
  readonly kind: PrivacyFindingKind;
  /** 从 1 开始的行号。 */
  readonly line: number;
  /** 从 1 开始的列号，按 UTF-16 码元。 */
  readonly column: number;
  readonly length: number;
}

export interface PrivacyScanPolicy {
  /** 允许出现的绝对路径根；路径必须等于某个根或位于其下。 */
  readonly allowedPathRoots: readonly string[];
  /** 允许直接跟在 UUID 前面的前缀，例如 `demand_`。 */
  readonly allowedIdPrefixes: readonly string[];
}

export const DEFAULT_ALLOWED_ID_PREFIXES: readonly string[] = Object.freeze(
  WAKEFLOW_DURABLE_ID_KINDS.map((kind) => `${kind}_`),
);

const PRIVATE_KEY_PATTERN = /-----BEGIN [A-Z ]*PRIVATE KEY-----/gu;
const PROVIDER_CREDENTIAL_PATTERN =
  /\b(?:sk-(?:ant-)?[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{20,}|gho_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[abp]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,})/gu;
const CREDENTIAL_ASSIGNMENT_PATTERN =
  /\b(?:password|passwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key)\b\s*[:=]\s*["']?[^\s"']{8,}/giu;
const ABSOLUTE_PATH_PATTERN =
  /(?<![A-Za-z0-9_./:-])(?:~|\/[^\s"'`()<>:/]+)(?:\/[^\s"'`()<>:/]+)+\/?/gu;
const UUID_PATTERN =
  /(?<![A-Za-z0-9_-])[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?![A-Za-z0-9-])/giu;

interface Match {
  readonly kind: PrivacyFindingKind;
  readonly index: number;
  readonly length: number;
}

function normalizeRoot(root: string): string {
  return root.length > 1 && root.endsWith("/") ? root.slice(0, -1) : root;
}

function pathIsAllowed(candidate: string, roots: readonly string[]): boolean {
  const normalized = normalizeRoot(candidate);
  return roots.some((root) => {
    const admittedRoot = normalizeRoot(root);
    return (
      admittedRoot.length > 0 &&
      (normalized === admittedRoot || normalized.startsWith(`${admittedRoot}/`))
    );
  });
}

function uuidIsPrefixed(text: string, index: number, prefixes: readonly string[]): boolean {
  return prefixes.some(
    (prefix) => index >= prefix.length && text.startsWith(prefix, index - prefix.length),
  );
}

function collect(
  text: string,
  pattern: RegExp,
  kind: PrivacyFindingKind,
  accept: (match: RegExpExecArray) => boolean,
  sink: Match[],
): void {
  pattern.lastIndex = 0;
  for (const match of text.matchAll(pattern)) {
    if (match[0].length === 0) continue;
    if (accept(match)) {
      sink.push({ kind, index: match.index, length: match[0].length });
    }
  }
}

function locate(text: string, index: number): { line: number; column: number } {
  let line = 1;
  let lineStart = 0;
  for (let cursor = 0; cursor < index; cursor += 1) {
    if (text.charCodeAt(cursor) === 10) {
      line += 1;
      lineStart = cursor + 1;
    }
  }
  return { line, column: index - lineStart + 1 };
}

/** 扫描一段文本，返回按位置排序的命中列表；空列表表示通过。 */
export function scanPrivacy(text: string, policy: PrivacyScanPolicy): readonly PrivacyFinding[] {
  const matches: Match[] = [];
  collect(text, PRIVATE_KEY_PATTERN, "private-key", () => true, matches);
  collect(text, PROVIDER_CREDENTIAL_PATTERN, "provider-credential", () => true, matches);
  collect(text, CREDENTIAL_ASSIGNMENT_PATTERN, "credential-assignment", () => true, matches);
  collect(
    text,
    ABSOLUTE_PATH_PATTERN,
    "unlisted-absolute-path",
    (match) => !pathIsAllowed(match[0], policy.allowedPathRoots),
    matches,
  );
  collect(
    text,
    UUID_PATTERN,
    "bare-uuid",
    (match) => !uuidIsPrefixed(text, match.index, policy.allowedIdPrefixes),
    matches,
  );
  matches.sort((left, right) => left.index - right.index);
  return Object.freeze(
    matches.map((match) => {
      const position = locate(text, match.index);
      return Object.freeze({
        kind: match.kind,
        line: position.line,
        column: position.column,
        length: match.length,
      });
    }),
  );
}

/** 任一命中即以 `privacy-violation` 失败，原因是第一个命中的类别。 */
export function assertPrivacyClean(text: string, policy: PrivacyScanPolicy, path = "$"): void {
  const first = scanPrivacy(text, policy)[0];
  if (first !== undefined) fail("privacy-violation", first.kind, path);
}
