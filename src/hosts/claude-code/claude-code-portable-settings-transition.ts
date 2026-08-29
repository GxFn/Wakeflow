import {
  applyEdits,
  findNodeAtLocation,
  getNodeValue,
  modify,
  parseTree,
  type Node as JsonNode,
  type ParseError,
} from "jsonc-parser";

import {
  computeSha256Digest,
  type Sha256Digest,
} from "../../foundation/crypto/sha256.js";
import {
  parseJsonValue,
  JsonValueError,
  type JsonObject,
} from "../../foundation/data/json-value.js";
import { encodeUtf8 } from "../../foundation/text/utf8.js";

/**
 * Wakeflow Host / Claude Code：`.claude/settings.json` 的权限最小编辑。
 *
 * 新 TS 只拥有 Wakeflow plugin MCP server 的一条 allow entry；不写入旧项目的
 * `Bash(node *)`、`Bash(tmux *)`、`Bash(git *)`。本模块以严格 JSON 模式解析并拒绝
 * 注释、尾逗号、重复键和类型冲突，再用 `jsonc-parser` 只编辑
 * `permissions.allow`，保留其他用户字段及其原始表示。
 */

export const WAKEFLOW_CLAUDE_CODE_MCP_PERMISSION_RULE =
  "mcp__plugin_wakeflow_wakeflow" as const;

export const WAKEFLOW_LEGACY_BROAD_BASH_PERMISSION_RULES = Object.freeze([
  "Bash(node *)",
  "Bash(tmux *)",
  "Bash(git *)",
] as const);

export type ClaudeCodePortableSettingsTransitionStatus =
  | "current"
  | "create"
  | "update"
  | "blocked";

export type ClaudeCodePortableSettingsTransitionReason =
  | "syntax"
  | "duplicate-key"
  | "root-not-object"
  | "permissions-not-object"
  | "allow-not-string-array"
  | "legacy-broad-permission-present"
  | "capacity";

export interface ClaudeCodePortableSettingsTransition {
  readonly kind: "ClaudeCodePortableSettingsTransition";
  readonly status: ClaudeCodePortableSettingsTransitionStatus;
  readonly reason: ClaudeCodePortableSettingsTransitionReason | null;
  readonly sourceDigest: Sha256Digest | null;
  readonly desiredDigest: Sha256Digest | null;
  readonly desiredText: string | null;
}

export type ClaudeCodePortableSettingsTransitionErrorReason = "input";

/** Claude Code portable settings transition 输入失败的稳定、脱敏错误。 */
export class ClaudeCodePortableSettingsTransitionError extends Error {
  override readonly name = "ClaudeCodePortableSettingsTransitionError";
  readonly code = "wakeflow-claude-code-portable-settings-transition" as const;
  readonly reason: ClaudeCodePortableSettingsTransitionErrorReason;
  readonly path: string;

  constructor(path: string) {
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

function failInput(path: string): never {
  throw new ClaudeCodePortableSettingsTransitionError(path);
}

function digestText(text: string): Sha256Digest {
  return computeSha256Digest(encodeUtf8(text, "$settings"));
}

function blocked(
  reason: ClaudeCodePortableSettingsTransitionReason,
  sourceDigest: Sha256Digest | null,
): Readonly<ClaudeCodePortableSettingsTransition> {
  return Object.freeze({
    kind: "ClaudeCodePortableSettingsTransition",
    status: "blocked",
    reason,
    sourceDigest,
    desiredDigest: null,
    desiredText: null,
  });
}

function duplicateKeyExists(node: JsonNode): boolean {
  if (node.type === "object") {
    const seen = new Set<string>();
    for (const property of node.children ?? []) {
      const keyNode = property.children?.[0];
      const valueNode = property.children?.[1];
      if (
        keyNode?.type !== "string"
        || typeof keyNode.value !== "string"
        || valueNode === undefined
      ) return true;
      if (seen.has(keyNode.value)) return true;
      seen.add(keyNode.value);
      if (duplicateKeyExists(valueNode)) return true;
    }
    return false;
  }
  if (node.type === "array") {
    return (node.children ?? []).some(duplicateKeyExists);
  }
  return false;
}

function jsonObject(node: JsonNode): Readonly<JsonObject> | null {
  if (node.type !== "object") return null;
  try {
    const value = parseJsonValue(getNodeValue(node), "$settings");
    if (value === null || Array.isArray(value) || typeof value !== "object") {
      return null;
    }
    // JsonValue 已排除原始值和数组；恢复 TypeScript 对 readonly array 的收窄缺口。
    return value as Readonly<JsonObject>;
  } catch (error: unknown) {
    if (error instanceof JsonValueError) return null;
    throw error;
  }
}

function sourceFormatting(text: string) {
  return {
    insertSpaces: true,
    tabSize: 2,
    eol: text.includes("\r\n") ? "\r\n" : "\n",
  };
}

function managedAllowEntries(existing: readonly string[]): readonly string[] {
  const firstManagedIndex = existing.indexOf(
    WAKEFLOW_CLAUDE_CODE_MCP_PERMISSION_RULE,
  );
  if (firstManagedIndex < 0) {
    return Object.freeze([
      ...existing,
      WAKEFLOW_CLAUDE_CODE_MCP_PERMISSION_RULE,
    ]);
  }
  const result: string[] = [];
  let emittedManaged = false;
  for (const entry of existing) {
    if (entry !== WAKEFLOW_CLAUDE_CODE_MCP_PERMISSION_RULE) {
      result.push(entry);
    } else if (!emittedManaged) {
      result.push(entry);
      emittedManaged = true;
    }
  }
  return Object.freeze(result);
}

function desiredCreateText(): string {
  return `${JSON.stringify({
    permissions: {
      allow: [WAKEFLOW_CLAUDE_CODE_MCP_PERMISSION_RULE],
    },
  }, null, 2)}\n`;
}

/**
 * 从 absent 或现有严格 JSON 文本计算最小 permissions.allow 变化。
 * `null` 明确表示目标文件不存在；空字符串是非法现有文件，不会被当成 absent。
 */
export function planClaudeCodePortableSettingsTransition(
  sourceTextValue: unknown,
): Readonly<ClaudeCodePortableSettingsTransition> {
  if (sourceTextValue !== null && typeof sourceTextValue !== "string") {
    failInput("$sourceText");
  }
  if (sourceTextValue === null) {
    const desiredText = desiredCreateText();
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
  const errors: ParseError[] = [];
  const root = parseTree(sourceText, errors, STRICT_PARSE_OPTIONS);
  if (root === undefined || errors.length > 0) {
    return blocked("syntax", sourceDigest);
  }
  if (duplicateKeyExists(root)) {
    return blocked("duplicate-key", sourceDigest);
  }
  const source = jsonObject(root);
  if (source === null) return blocked("root-not-object", sourceDigest);
  const permissionsNode = findNodeAtLocation(root, ["permissions"]);
  if (permissionsNode !== undefined && permissionsNode.type !== "object") {
    return blocked("permissions-not-object", sourceDigest);
  }
  const allowNode = findNodeAtLocation(root, ["permissions", "allow"]);
  let existingAllow: readonly string[] = Object.freeze([]);
  if (allowNode !== undefined) {
    if (
      allowNode.type !== "array"
      || (allowNode.children ?? []).some((entry) => (
        entry.type !== "string" || typeof entry.value !== "string"
      ))
    ) {
      return blocked("allow-not-string-array", sourceDigest);
    }
    existingAllow = Object.freeze(
      (allowNode.children ?? []).map((entry) => entry.value as string),
    );
  }
  if (existingAllow.some((entry) => (
    WAKEFLOW_LEGACY_BROAD_BASH_PERMISSION_RULES.includes(
      entry as (typeof WAKEFLOW_LEGACY_BROAD_BASH_PERMISSION_RULES)[number],
    )
  ))) {
    return blocked("legacy-broad-permission-present", sourceDigest);
  }
  const desiredAllow = managedAllowEntries(existingAllow);
  if (
    existingAllow.length === desiredAllow.length
    && existingAllow.every((entry, index) => entry === desiredAllow[index])
  ) {
    return Object.freeze({
      kind: "ClaudeCodePortableSettingsTransition",
      status: "current",
      reason: null,
      sourceDigest,
      desiredDigest: sourceDigest,
      desiredText: null,
    });
  }
  let desiredText: string;
  try {
    desiredText = applyEdits(sourceText, modify(
      sourceText,
      ["permissions", "allow"],
      desiredAllow,
      { formattingOptions: sourceFormatting(sourceText) },
    ));
  } catch {
    return blocked("syntax", sourceDigest);
  }
  const desiredErrors: ParseError[] = [];
  const desiredRoot = parseTree(
    desiredText,
    desiredErrors,
    STRICT_PARSE_OPTIONS,
  );
  if (
    desiredRoot === undefined
    || desiredErrors.length > 0
    || duplicateKeyExists(desiredRoot)
  ) {
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
