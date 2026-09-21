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
const PROVIDER_CREDENTIAL_PATTERN = /\b(?:sk-(?:ant-)?[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{20,}|gho_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[abp]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,})/gu;
const CREDENTIAL_ASSIGNMENT_PATTERN = /\b(?:password|passwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key)\b\s*[:=]\s*["']?[^\s"']{8,}/giu;
const ABSOLUTE_PATH_PATTERN = /(?<![A-Za-z0-9_./:-])(?:~|\/[^\s"'`()<>:/]+)(?:\/[^\s"'`()<>:/]+)+\/?/gu;
const UUID_PATTERN = /(?<![A-Za-z0-9_-])[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?![A-Za-z0-9-])/giu;
function normalizeRoot(root) {
    return root.length > 1 && root.endsWith("/") ? root.slice(0, -1) : root;
}
function pathIsAllowed(candidate, roots) {
    const normalized = normalizeRoot(candidate);
    return roots.some((root) => {
        const admittedRoot = normalizeRoot(root);
        return (admittedRoot.length > 0 &&
            (normalized === admittedRoot || normalized.startsWith(`${admittedRoot}/`)));
    });
}
function uuidIsPrefixed(text, index, prefixes) {
    return prefixes.some((prefix) => index >= prefix.length && text.startsWith(prefix, index - prefix.length));
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
export function scanPrivacy(text, policy) {
    const matches = [];
    collect(text, PRIVATE_KEY_PATTERN, "private-key", () => true, matches);
    collect(text, PROVIDER_CREDENTIAL_PATTERN, "provider-credential", () => true, matches);
    collect(text, CREDENTIAL_ASSIGNMENT_PATTERN, "credential-assignment", () => true, matches);
    collect(text, ABSOLUTE_PATH_PATTERN, "unlisted-absolute-path", (match) => !pathIsAllowed(match[0], policy.allowedPathRoots), matches);
    collect(text, UUID_PATTERN, "bare-uuid", (match) => !uuidIsPrefixed(text, match.index, policy.allowedIdPrefixes), matches);
    matches.sort((left, right) => left.index - right.index);
    const locator = createLocator(text);
    return Object.freeze(matches.map((match) => {
        const position = locator(match.index);
        return Object.freeze({
            kind: match.kind,
            line: position.line,
            column: position.column,
            length: match.length,
        });
    }));
}
/** 任一命中即以 `privacy-violation` 失败，原因是第一个命中的类别。 */
export function assertPrivacyClean(text, policy, path = "$") {
    const first = scanPrivacy(text, policy)[0];
    if (first !== undefined)
        fail("privacy-violation", first.kind, path);
}
