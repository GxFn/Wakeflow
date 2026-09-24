import { applyEdits, findNodeAtLocation, getNodeValue, modify, parseTree, } from "jsonc-parser";
import { computeSha256Digest, } from "../../foundation/crypto/sha256.js";
import { JsonValueError, parseJsonValue, } from "../../foundation/data/json-value.js";
import { encodeUtf8 } from "../../foundation/text/utf8.js";
import { WAKEFLOW_CLAUDE_CODE_TMUX_PERMISSION_RULE } from "./claude-code-tmux-asset.js";
/**
 * Wakeflow Host / Claude Code：`.claude/settings.json` 的权限最小编辑。
 *
 * 新 TS 只拥有 Wakeflow 自己的 allow entry：每个根都有 plugin MCP server 的一条，工作区根
 * 另有精确到 tmux 助手这一条调用的一条（§13.117 D5）；不写入旧项目的
 * `Bash(node *)`、`Bash(tmux *)`、`Bash(git *)`。本模块以严格 JSON 模式解析并拒绝
 * 注释、尾逗号、重复键和类型冲突，再用 `jsonc-parser` 只编辑
 * `permissions.allow`，保留其他用户字段及其原始表示。
 */
export const WAKEFLOW_CLAUDE_CODE_MCP_PERMISSION_RULE = "mcp__plugin_wakeflow_wakeflow";
export const WAKEFLOW_LEGACY_BROAD_BASH_PERMISSION_RULES = Object.freeze([
    "Bash(node *)",
    "Bash(tmux *)",
    "Bash(git *)",
]);
const DEFAULT_RULES = Object.freeze([
    WAKEFLOW_CLAUDE_CODE_MCP_PERMISSION_RULE,
]);
/** 每种根拥有的 allow 规则：支撑面只有 MCP 一条，工作区根多一条 tmux 助手调用。 */
export function claudeCodePortableSettingsRulesFor(rootKind) {
    return rootKind === "program"
        ? Object.freeze([
            WAKEFLOW_CLAUDE_CODE_MCP_PERMISSION_RULE,
            WAKEFLOW_CLAUDE_CODE_TMUX_PERMISSION_RULE,
        ])
        : DEFAULT_RULES;
}
/** Claude Code portable settings transition 输入失败的稳定、脱敏错误。 */
export class ClaudeCodePortableSettingsTransitionError extends Error {
    name = "ClaudeCodePortableSettingsTransitionError";
    code = "wakeflow-claude-code-portable-settings-transition";
    reason;
    path;
    constructor(path) {
        super("Claude Code portable settings transition input is invalid.");
        this.reason = "input";
        this.path = path;
    }
}
const MAXIMUM_SETTINGS_BYTES = 1024 * 1024;
const STRICT_PARSE_OPTIONS = Object.freeze({
    allowTrailingComma: false,
    disallowComments: true,
});
function failInput(path) {
    throw new ClaudeCodePortableSettingsTransitionError(path);
}
function digestText(text) {
    return computeSha256Digest(encodeUtf8(text, "$settings"));
}
function blocked(reason, sourceDigest) {
    return Object.freeze({
        kind: "ClaudeCodePortableSettingsTransition",
        status: "blocked",
        reason,
        sourceDigest,
        desiredDigest: null,
        desiredText: null,
    });
}
function duplicateKeyExists(node) {
    if (node.type === "object") {
        const seen = new Set();
        for (const property of node.children ?? []) {
            const keyNode = property.children?.[0];
            const valueNode = property.children?.[1];
            if (keyNode?.type !== "string"
                || typeof keyNode.value !== "string"
                || valueNode === undefined)
                return true;
            if (seen.has(keyNode.value))
                return true;
            seen.add(keyNode.value);
            if (duplicateKeyExists(valueNode))
                return true;
        }
        return false;
    }
    if (node.type === "array") {
        return (node.children ?? []).some(duplicateKeyExists);
    }
    return false;
}
function jsonObject(node) {
    if (node.type !== "object")
        return null;
    try {
        const value = parseJsonValue(getNodeValue(node), "$settings");
        if (value === null || Array.isArray(value) || typeof value !== "object") {
            return null;
        }
        // JsonValue 已排除原始值和数组；恢复 TypeScript 对 readonly array 的收窄缺口。
        return value;
    }
    catch (error) {
        if (error instanceof JsonValueError)
            return null;
        throw error;
    }
}
function sourceFormatting(text) {
    return {
        insertSpaces: true,
        tabSize: 2,
        eol: text.includes("\r\n") ? "\r\n" : "\n",
    };
}
/** 用户条目原位保留；每条托管规则只留第一次出现，缺席的按规则顺序追加到末尾。 */
function managedAllowEntries(existing, rules) {
    const managed = new Set(rules);
    const emitted = new Set();
    const result = [];
    for (const entry of existing) {
        if (!managed.has(entry)) {
            result.push(entry);
        }
        else if (!emitted.has(entry)) {
            result.push(entry);
            emitted.add(entry);
        }
    }
    for (const rule of rules) {
        if (!emitted.has(rule))
            result.push(rule);
    }
    return Object.freeze(result);
}
function desiredCreateText(rules) {
    return `${JSON.stringify({
        permissions: {
            allow: [...rules],
        },
    }, null, 2)}\n`;
}
function parseRules(value) {
    if (value === undefined)
        return DEFAULT_RULES;
    if (!Array.isArray(value)
        || value.length === 0
        || value.some((entry) => typeof entry !== "string" || entry.length === 0)
        || new Set(value).size !== value.length
        || value.some((entry) => (WAKEFLOW_LEGACY_BROAD_BASH_PERMISSION_RULES.includes(entry)))) {
        failInput("$rules");
    }
    return Object.freeze([...value]);
}
/**
 * 从 absent 或现有严格 JSON 文本计算最小 permissions.allow 变化。
 * `null` 明确表示目标文件不存在；空字符串是非法现有文件，不会被当成 absent。
 * `rules` 是这个根拥有的托管规则，缺省只有 MCP 一条。
 */
export function planClaudeCodePortableSettingsTransition(sourceTextValue, rulesValue) {
    if (sourceTextValue !== null && typeof sourceTextValue !== "string") {
        failInput("$sourceText");
    }
    const rules = parseRules(rulesValue);
    if (sourceTextValue === null) {
        const desiredText = desiredCreateText(rules);
        return Object.freeze({
            kind: "ClaudeCodePortableSettingsTransition",
            status: "create",
            reason: null,
            sourceDigest: null,
            desiredDigest: digestText(desiredText),
            desiredText,
        });
    }
    const sourceText = sourceTextValue;
    const sourceDigest = digestText(sourceText);
    if (Buffer.byteLength(sourceText, "utf8") > MAXIMUM_SETTINGS_BYTES) {
        return blocked("capacity", sourceDigest);
    }
    const errors = [];
    const root = parseTree(sourceText, errors, STRICT_PARSE_OPTIONS);
    if (root === undefined || errors.length > 0) {
        return blocked("syntax", sourceDigest);
    }
    if (duplicateKeyExists(root)) {
        return blocked("duplicate-key", sourceDigest);
    }
    const source = jsonObject(root);
    if (source === null)
        return blocked("root-not-object", sourceDigest);
    const permissionsNode = findNodeAtLocation(root, ["permissions"]);
    if (permissionsNode !== undefined && permissionsNode.type !== "object") {
        return blocked("permissions-not-object", sourceDigest);
    }
    const allowNode = findNodeAtLocation(root, ["permissions", "allow"]);
    let existingAllow = Object.freeze([]);
    if (allowNode !== undefined) {
        if (allowNode.type !== "array"
            || (allowNode.children ?? []).some((entry) => (entry.type !== "string" || typeof entry.value !== "string"))) {
            return blocked("allow-not-string-array", sourceDigest);
        }
        existingAllow = Object.freeze((allowNode.children ?? []).map((entry) => entry.value));
    }
    if (existingAllow.some((entry) => (WAKEFLOW_LEGACY_BROAD_BASH_PERMISSION_RULES.includes(entry)))) {
        return blocked("legacy-broad-permission-present", sourceDigest);
    }
    const desiredAllow = managedAllowEntries(existingAllow, rules);
    if (existingAllow.length === desiredAllow.length
        && existingAllow.every((entry, index) => entry === desiredAllow[index])) {
        return Object.freeze({
            kind: "ClaudeCodePortableSettingsTransition",
            status: "current",
            reason: null,
            sourceDigest,
            desiredDigest: sourceDigest,
            desiredText: null,
        });
    }
    let desiredText;
    try {
        desiredText = applyEdits(sourceText, modify(sourceText, ["permissions", "allow"], desiredAllow, { formattingOptions: sourceFormatting(sourceText) }));
    }
    catch {
        return blocked("syntax", sourceDigest);
    }
    const desiredErrors = [];
    const desiredRoot = parseTree(desiredText, desiredErrors, STRICT_PARSE_OPTIONS);
    if (desiredRoot === undefined
        || desiredErrors.length > 0
        || duplicateKeyExists(desiredRoot)) {
        return blocked("syntax", sourceDigest);
    }
    return Object.freeze({
        kind: "ClaudeCodePortableSettingsTransition",
        status: "update",
        reason: null,
        sourceDigest,
        desiredDigest: digestText(desiredText),
        desiredText,
    });
}
