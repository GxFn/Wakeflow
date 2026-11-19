/**
 * Wakeflow Kernel / Privacy Scan：文本内容的唯一隐私扫描引擎（能力卡 8 Q1，ADR-0013）。
 *
 * 只拒绝不脱敏，只认凭证：私钥块、提供商令牌、凭证赋值（含 Authorization 头与 URL 里的口令）。结果只含
 * 类别与位置，从不含命中的文本，因此可以进入公共错误与记录。
 *
 * 1.4 第 5 段（ADR-0031，用户 2026-11-18 同意）：此前另有两类按白名单判断的命中——不在允许根之下的绝对
 * 路径、不带已知前缀的 UUID。六轮现场里它们命中的都不是秘密，只制造返工，已删除；带着这两类命中的旧
 * 受管证据清单照旧读得出（清单的 Schema 没有动）。
 */

const PRIVACY_FINDING_KINDS = Object.freeze([
  "private-key",
  "provider-credential",
  "credential-assignment",
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

const PRIVATE_KEY_PATTERN = /-----BEGIN [A-Z ]*PRIVATE KEY(?: BLOCK)?-----/gu;
// 提供商令牌前缀；JWT 按 base64url 的三段 `eyJ…` 形状识别（§13.165 F6），Slack 含 e/r 的轮换与刷新令牌。
const PROVIDER_CREDENTIAL_PATTERN =
  /\b(?:sk-(?:ant-)?[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{20,}|npm_[A-Za-z0-9]{20,}|xox[abepr]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,}|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})/gu;
// 键名与赋值只允许同一行上的空白：标题 `## Password:` 后换行接正文不是赋值（§13.161 B9-7）。
const CREDENTIAL_ASSIGNMENT_PATTERN =
  /(?<![\p{L}\p{N}_])(?:[\p{L}\p{N}_]*_)?(?:password|passwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|secret[_-]?key(?:[_-]?base)?|encryption[_-]?key|app[_-]?key)["']?[ \t]*[:=][ \t]*["']?[^\s"'<>]{8,}/giu;
const AUTHORIZATION_PATTERN =
  /\b(?:proxy-)?authorization["']?[ \t]*:[ \t]*["']?(?:Bearer|Basic|Token)[ \t]+[A-Za-z0-9._~+/=-]{8,}/giu;
const URL_CREDENTIAL_PATTERN =
  /(?<![A-Za-z0-9+.-])[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s"'<>/?#:@]+:[^\s"'<>/?#@]+@/gu;
// biome-ignore lint/suspicious/noControlCharactersInRegex: CSI bytes delimit terminal formatting, not payload text.
const CSI_PATTERN = /(?:\u001b\[|\u009b)[0-?]*[ -/]*[@-~]/gu;
// biome-ignore lint/suspicious/noControlCharactersInRegex: Unknown controls retain the opaque-content review boundary.
const NON_TEXT_CONTROL_PATTERN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u;
interface Match {
  readonly kind: PrivacyFindingKind;
  readonly index: number;
  readonly length: number;
}

function collect(text: string, pattern: RegExp, kind: PrivacyFindingKind, sink: Match[]): void {
  pattern.lastIndex = 0;
  for (const match of text.matchAll(pattern)) {
    if (match[0].length === 0) continue;
    sink.push({ kind, index: match.index, length: match[0].length });
  }
}

/** 按递增的位置一次走完文本；命中已排序，所以行列定位总体线性。 */
function createLocator(text: string): (index: number) => { line: number; column: number } {
  let cursor = 0;
  let line = 1;
  let lineStart = 0;
  return (index: number) => {
    for (; cursor < index; cursor += 1) {
      if (text.charCodeAt(cursor) === 10) {
        line += 1;
        lineStart = cursor + 1;
      }
    }
    return { line, column: index - lineStart + 1 };
  };
}

/** 扫描一段文本的凭证命中；空列表表示通过。 */
function scanMatches(text: string): Match[] {
  const matches: Match[] = [];
  collect(text, PRIVATE_KEY_PATTERN, "private-key", matches);
  collect(text, PROVIDER_CREDENTIAL_PATTERN, "provider-credential", matches);
  collect(text, CREDENTIAL_ASSIGNMENT_PATTERN, "credential-assignment", matches);
  collect(text, AUTHORIZATION_PATTERN, "credential-assignment", matches);
  collect(text, URL_CREDENTIAL_PATTERN, "credential-assignment", matches);
  return matches;
}

interface RemovedCsi {
  readonly index: number;
  readonly removed: number;
}

/** Keep an offset map: findings always identify the original, unchanged payload. */
function withoutCsi(text: string): { text: string; offsets: readonly RemovedCsi[] } {
  const parts: string[] = [];
  const offsets: RemovedCsi[] = [];
  let cursor = 0;
  let removed = 0;
  for (const match of text.matchAll(CSI_PATTERN)) {
    parts.push(text.slice(cursor, match.index));
    removed += match[0].length;
    cursor = match.index + match[0].length;
    offsets.push({ index: cursor - removed, removed });
  }
  parts.push(text.slice(cursor));
  return { text: parts.join(""), offsets };
}

function originalIndex(index: number, offsets: readonly RemovedCsi[]): number {
  let low = 0;
  let high = offsets.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if ((offsets[middle]?.index ?? Number.POSITIVE_INFINITY) <= index) low = middle + 1;
    else high = middle;
  }
  return index + (offsets[low - 1]?.removed ?? 0);
}

export interface PrivacyTextScan {
  readonly opaque: boolean;
  readonly findings: readonly PrivacyFinding[];
}

/**
 * Stripping one layer of terminal formatting can join the pieces of another (`ESC ESC[31m[31m`), so the
 * scan repeats on each stripped layer. The bound keeps hostile nesting linear; whatever is still wrapped
 * after it leaves an escape byte behind, which classifies the text as opaque.
 */
const CSI_STRIP_PASSES = 32;

function originalIndexThrough(index: number, layers: readonly (readonly RemovedCsi[])[]): number {
  let mapped = index;
  for (let layer = layers.length - 1; layer >= 0; layer -= 1) {
    mapped = originalIndex(mapped, layers[layer] ?? []);
  }
  return mapped;
}

/** Opaque classification never suppresses scanning of decodable text. */
export function scanPrivacyText(text: string): Readonly<PrivacyTextScan> {
  // The original and every stripped layer are scanned: a credential hidden inside an escape sequence
  // does not get away, and one interrupted by formatting is still recognised.
  const matches = scanMatches(text);
  const layers: (readonly RemovedCsi[])[] = [];
  let stripped = text;
  for (let pass = 0; pass < CSI_STRIP_PASSES; pass += 1) {
    const view = withoutCsi(stripped);
    if (view.offsets.length === 0) break;
    layers.push(view.offsets);
    stripped = view.text;
    for (const match of scanMatches(stripped)) {
      const index = originalIndexThrough(match.index, layers);
      matches.push({
        ...match,
        index,
        length: originalIndexThrough(match.index + match.length - 1, layers) - index + 1,
      });
    }
  }
  const unique = new Map<string, Match>();
  for (const match of matches) {
    const key = `${match.kind}:${match.index}`;
    if ((unique.get(key)?.length ?? 0) < match.length) unique.set(key, match);
  }
  const ordered = [...unique.values()].sort((left, right) => left.index - right.index);
  const locator = createLocator(text);
  const findings = Object.freeze(
    ordered.map((match) => {
      const position = locator(match.index);
      return Object.freeze({
        kind: match.kind,
        line: position.line,
        column: position.column,
        length: match.length,
      });
    }),
  );
  return Object.freeze({ opaque: NON_TEXT_CONTROL_PATTERN.test(stripped), findings });
}

export function scanPrivacy(text: string): readonly PrivacyFinding[] {
  return scanPrivacyText(text).findings;
}
