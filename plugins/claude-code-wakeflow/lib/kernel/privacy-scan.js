import path from "node:path";
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
]);
/** 凭证类命中：无条件阻塞，任何内容审阅策略都不能放行；证据捕获门与归档门共用这一份定义。 */
export const CREDENTIAL_PRIVACY_FINDING_KINDS = Object.freeze([
    "private-key",
    "provider-credential",
    "credential-assignment",
]);
export const DEFAULT_ALLOWED_ID_PREFIXES = Object.freeze(WAKEFLOW_DURABLE_ID_KINDS.map((kind) => `${kind}_`));
const PRIVATE_KEY_PATTERN = /-----BEGIN [A-Z ]*PRIVATE KEY-----/gu;
const PROVIDER_CREDENTIAL_PATTERN = /\b(?:sk-(?:ant-)?[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{20,}|npm_[A-Za-z0-9]{20,}|xox[abp]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,})/gu;
const CREDENTIAL_ASSIGNMENT_PATTERN = /(?<![\p{L}\p{N}_])(?:[\p{L}\p{N}_]*_)?(?:password|passwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key)["']?\s*[:=]\s*["']?[^\s"'<>]{8,}/giu;
const AUTHORIZATION_PATTERN = /\b(?:proxy-)?authorization["']?\s*:\s*["']?(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/giu;
const URL_CREDENTIAL_PATTERN = /(?<![A-Za-z0-9+.-])[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s"'<>/?#:@]+:[^\s"'<>/?#@]+@/gu;
const ABSOLUTE_PATH_PATTERN = /(?<![A-Za-z0-9_+.-])file:\/\/[^\s"'`()<>]+|(?<![A-Za-z0-9_./\\-])(?:[A-Za-z]:[\\/]|\\\\)[^\s"'`()<>]+|(?<![\p{L}\p{N}_./\\-])(?:~|\$HOME|\/[^\s"'`()<>:/\\]+)(?:\/[^\s"'`()<>:/\\]+)+\/?/giu;
// Natural-language text may adjoin a system location without an ASCII space.
// Keep that protection without treating arbitrary Unicode slash lists as paths.
const EMBEDDED_PATH_PATTERN = /(?<=\P{ASCII})\/[^\s"'`()<>:/\\]+(?:\/[^\s"'`()<>:/\\]+)+\/?/gu;
// biome-ignore lint/suspicious/noControlCharactersInRegex: CSI bytes delimit terminal formatting, not payload text.
const CSI_PATTERN = /(?:\u001b\[|\u009b)[0-?]*[ -/]*[@-~]/gu;
// biome-ignore lint/suspicious/noControlCharactersInRegex: Unknown controls retain the opaque-content review boundary.
const NON_TEXT_CONTROL_PATTERN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u;
const UUID_PATTERN = /(?<![A-Za-z0-9])[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?![A-Za-z0-9_-])/giu;
function fileUriPath(value) {
    try {
        const url = new URL(value);
        if (url.search !== "" || url.hash !== "")
            return null;
        const pathname = decodeURIComponent(url.pathname);
        if (url.hostname !== "")
            return `\\\\${url.hostname}${pathname.replaceAll("/", "\\")}`;
        return /^\/[A-Za-z]:\//u.test(pathname) ? pathname.slice(1) : pathname;
    }
    catch {
        return null;
    }
}
/** Lexical containment only: normalize dot segments without reading the filesystem. */
function normalizePath(value) {
    if (/^file:\/\//iu.test(value)) {
        const decoded = fileUriPath(value);
        if (decoded === null)
            return null;
        value = decoded;
    }
    // biome-ignore lint/suspicious/noControlCharactersInRegex: A malformed/encoded locator cannot gain a whitelist match.
    if (/[\u0000-\u001f\u007f]/u.test(value))
        return null;
    if (/^[A-Za-z]:[\\/]|^\\\\/u.test(value)) {
        const normalized = path.win32.normalize(value);
        const root = path.win32.parse(normalized).root;
        return {
            value: normalized.length > root.length ? normalized.replace(/\\$/u, "") : normalized,
            separator: "\\",
        };
    }
    if (!value.startsWith("/"))
        return null;
    const normalized = path.posix.normalize(value);
    return {
        value: normalized.length > 1 ? normalized.replace(/\/$/u, "") : normalized,
        separator: "/",
    };
}
function pathIsAllowed(candidate, roots) {
    const normalized = normalizePath(candidate);
    if (normalized === null)
        return false;
    return roots.some((admittedRoot) => {
        if (admittedRoot.separator !== normalized.separator)
            return false;
        const prefix = admittedRoot.value.endsWith(admittedRoot.separator)
            ? admittedRoot.value
            : `${admittedRoot.value}${admittedRoot.separator}`;
        return normalized.value === admittedRoot.value || normalized.value.startsWith(prefix);
    });
}
function uuidIsPrefixed(text, index, prefixes) {
    return prefixes.some((prefix) => {
        const start = index - prefix.length;
        return (prefix.length > 0 &&
            start >= 0 &&
            text.startsWith(prefix, start) &&
            (start === 0 || !/[A-Za-z0-9_-]/u.test(text[start - 1] ?? "")));
    });
}
function collect(text, pattern, kind, accept, sink) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
        if (match[0].length === 0)
            continue;
        if (accept(match)) {
            sink.push({ kind, index: match.index, length: match[0].length });
        }
    }
}
/** 按递增的位置一次走完文本；命中已排序，所以行列定位总体线性。 */
function createLocator(text) {
    let cursor = 0;
    let line = 1;
    let lineStart = 0;
    return (index) => {
        for (; cursor < index; cursor += 1) {
            if (text.charCodeAt(cursor) === 10) {
                line += 1;
                lineStart = cursor + 1;
            }
        }
        return { line, column: index - lineStart + 1 };
    };
}
/** 扫描一段文本，返回按位置排序的命中列表；空列表表示通过。 */
function scanMatches(text, policy, roots) {
    const matches = [];
    collect(text, PRIVATE_KEY_PATTERN, "private-key", () => true, matches);
    collect(text, PROVIDER_CREDENTIAL_PATTERN, "provider-credential", () => true, matches);
    collect(text, CREDENTIAL_ASSIGNMENT_PATTERN, "credential-assignment", () => true, matches);
    collect(text, AUTHORIZATION_PATTERN, "credential-assignment", () => true, matches);
    collect(text, URL_CREDENTIAL_PATTERN, "credential-assignment", () => true, matches);
    collect(text, ABSOLUTE_PATH_PATTERN, "unlisted-absolute-path", (match) => !pathIsAllowed(match[0], roots), matches);
    collect(text, UUID_PATTERN, "bare-uuid", (match) => !uuidIsPrefixed(text, match.index, policy.allowedIdPrefixes), matches);
    collect(text, EMBEDDED_PATH_PATTERN, "unlisted-absolute-path", (match) => isSystemAbsolutePath(match[0]) && !pathIsAllowed(match[0], roots), matches);
    return matches;
}
/** Keep an offset map: findings always identify the original, unchanged payload. */
function withoutCsi(text) {
    const parts = [];
    const offsets = [];
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
/** Requirement prose may name site routes; explicit filesystem locators stay private. */
export function isSystemAbsolutePath(text) {
    const candidate = withoutCsi(text).text;
    if (/^(?:file:\/\/|[A-Za-z]:[\\/]|\\\\|~\/|\$HOME\/)/iu.test(candidate))
        return true;
    const normalized = normalizePath(candidate);
    return (normalized !== null &&
        normalized.separator === "/" &&
        /^\/(?:Users|home|private|var|tmp|etc|opt|srv|root|mnt|Volumes|usr|Library|Applications)(?:\/|$)/u.test(normalized.value));
}
function originalIndex(index, offsets) {
    let low = 0;
    let high = offsets.length;
    while (low < high) {
        const middle = (low + high) >>> 1;
        if ((offsets[middle]?.index ?? Number.POSITIVE_INFINITY) <= index)
            low = middle + 1;
        else
            high = middle;
    }
    return index + (offsets[low - 1]?.removed ?? 0);
}
/** Opaque classification never suppresses scanning of decodable text. */
export function scanPrivacyText(text, policy) {
    const view = withoutCsi(text);
    const roots = policy.allowedPathRoots.map(normalizePath).filter((root) => root !== null);
    // Decoration is not part of a filesystem name. Raw credentials are scanned as
    // well, so hidden terminal payloads do not become an escape from detection.
    const raw = scanMatches(text, policy, roots);
    const matches = view.offsets.length === 0
        ? raw
        : raw.filter((match) => CREDENTIAL_PRIVACY_FINDING_KINDS.includes(match.kind));
    if (view.offsets.length > 0) {
        for (const match of scanMatches(view.text, policy, roots)) {
            const index = originalIndex(match.index, view.offsets);
            matches.push({
                ...match,
                index,
                length: originalIndex(match.index + match.length - 1, view.offsets) - index + 1,
            });
        }
    }
    const unique = new Map();
    for (const match of matches) {
        const key = `${match.kind}:${match.index}`;
        if ((unique.get(key)?.length ?? 0) < match.length)
            unique.set(key, match);
    }
    const ordered = [...unique.values()].sort((left, right) => left.index - right.index);
    const locator = createLocator(text);
    const findings = Object.freeze(ordered.map((match) => {
        const position = locator(match.index);
        return Object.freeze({
            kind: match.kind,
            line: position.line,
            column: position.column,
            length: match.length,
        });
    }));
    return Object.freeze({ opaque: NON_TEXT_CONTROL_PATTERN.test(view.text), findings });
}
export function scanPrivacy(text, policy) {
    return scanPrivacyText(text, policy).findings;
}
/** 任一命中即以 `privacy-violation` 失败，原因是第一个命中的类别。 */
export function assertPrivacyClean(text, policy, path = "$") {
    const first = scanPrivacy(text, policy)[0];
    if (first !== undefined)
        fail("privacy-violation", first.kind, path);
}
