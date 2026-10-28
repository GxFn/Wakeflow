import {
  applyEdits,
  findNodeAtLocation,
  getNodeValue,
  type Node as JsonNode,
  modify,
  type ParseError,
  parseTree,
} from "jsonc-parser";

import { computeSha256Digest, type Sha256Digest } from "../../foundation/crypto/sha256.js";
import {
  type JsonObject,
  JsonValueError,
  parseJsonValue,
} from "../../foundation/data/json-value.js";
import { encodeUtf8 } from "../../foundation/text/utf8.js";
import { WAKEFLOW_LEGACY_BROAD_BASH_PERMISSION_RULES as WAKEFLOW_LEGACY_BROAD_BASH_PERMISSION_RULE_LIST } from "../../workspace/wakeflow-legacy-residue-scan.js";
import {
  claudeCodeMcpPermissionRulesFor,
  WAKEFLOW_CLAUDE_CODE_MCP_SERVER_PERMISSION_RULE,
} from "./claude-code-mcp-permission-rules.js";
import { WAKEFLOW_CLAUDE_CODE_TMUX_PERMISSION_RULE } from "./claude-code-tmux-asset.js";

/**
 * Wakeflow Host / Claude Code：`.claude/settings.json` 的权限最小编辑。
 *
 * 新 TS 只拥有 Wakeflow 自己的 allow entry：每个根都有 plugin MCP server 的一条，工作区根
 * 另有精确到 tmux 助手这一条调用的一条（§13.117 D5）；不写入旧项目的
 * `Bash(node *)`、`Bash(tmux *)`、`Bash(git *)`。本模块以严格 JSON 模式解析并拒绝
 * 注释、尾逗号、重复键和类型冲突，再用 `jsonc-parser` 只编辑
 * `permissions.allow`，保留其他用户字段及其原始表示。
 *
 * 退出路径（ADR-0024 `remove-portable-settings-rules`）走同一套解析与编辑：只精确删除
 * Wakeflow 当前与退役的条目，用户的其他条目与键原样保留，文件本身不删。
 */

export const WAKEFLOW_CLAUDE_CODE_MCP_PERMISSION_RULE =
  WAKEFLOW_CLAUDE_CODE_MCP_SERVER_PERMISSION_RULE;

/** 旧插件的三条宽泛规则；唯一来源在 workspace 的遗留残留扫描（F4，§13.168），这里只转发。 */
const WAKEFLOW_LEGACY_BROAD_BASH_PERMISSION_RULES = WAKEFLOW_LEGACY_BROAD_BASH_PERMISSION_RULE_LIST;

const DEFAULT_RULES: readonly string[] = Object.freeze([WAKEFLOW_CLAUDE_CODE_MCP_PERMISSION_RULE]);

/** 一个根的规则归属：工作区根，或带角色（design / test）的支撑面根。 */
export type ClaudeCodePortableSettingsRuleOwner =
  | Readonly<{ readonly rootKind: "program" }>
  | Readonly<{ readonly rootKind: "support-surface"; readonly role: "design" | "test" }>;

/**
 * 每种根拥有的 allow 规则（§13.117 D5；ADR-0020 决定 3，§13.168）：工作区根是整服务器 MCP 规则加一条
 * tmux 助手调用；支撑面按角色只放行该角色使用的工具，不再放行整个服务器。
 */
export function claudeCodePortableSettingsRulesFor(
  owner: ClaudeCodePortableSettingsRuleOwner,
): readonly string[] {
  return owner.rootKind === "program"
    ? Object.freeze([
        WAKEFLOW_CLAUDE_CODE_MCP_PERMISSION_RULE,
        WAKEFLOW_CLAUDE_CODE_TMUX_PERMISSION_RULE,
      ])
    : claudeCodeMcpPermissionRulesFor(owner.role);
}

/** 该根上 Wakeflow 曾写过、现已退役的规则，转换时精确删除：支撑面的整服务器规则（§13.168）。 */
export function claudeCodePortableSettingsRetiredRulesFor(
  owner: ClaudeCodePortableSettingsRuleOwner,
): readonly string[] {
  return owner.rootKind === "program"
    ? Object.freeze([])
    : Object.freeze([WAKEFLOW_CLAUDE_CODE_MCP_SERVER_PERMISSION_RULE]);
}

/**
 * 退出路径删除的条目（ADR-0024 `remove-portable-settings-rules`）：该根当前拥有的规则加它曾拥有、
 * 现已退役的规则，去重。两张表都是 Wakeflow 自己写过的精确条目，所以删除不用猜正文是谁的。
 */
export function claudeCodePortableSettingsRemovedRulesFor(
  owner: ClaudeCodePortableSettingsRuleOwner,
): readonly string[] {
  return Object.freeze([
    ...new Set([
      ...claudeCodePortableSettingsRulesFor(owner),
      ...claudeCodePortableSettingsRetiredRulesFor(owner),
    ]),
  ]);
}

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
        keyNode?.type !== "string" ||
        typeof keyNode.value !== "string" ||
        valueNode === undefined
      )
        return true;
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

/**
 * 用户条目原位保留；每条托管规则只留第一次出现，缺席的按规则顺序追加到末尾；退役规则
 * （Wakeflow 曾写过、现已不再拥有的条目）精确删除，用户的其他条目不动。
 */
function managedAllowEntries(
  existing: readonly string[],
  rules: readonly string[],
  retired: readonly string[],
): readonly string[] {
  const managed = new Set(rules);
  const retiredSet = new Set(retired.filter((rule) => !managed.has(rule)));
  const emitted = new Set<string>();
  const result: string[] = [];
  for (const entry of existing) {
    if (retiredSet.has(entry)) continue;
    if (!managed.has(entry)) {
      result.push(entry);
    } else if (!emitted.has(entry)) {
      result.push(entry);
      emitted.add(entry);
    }
  }
  for (const rule of rules) {
    if (!emitted.has(rule)) result.push(rule);
  }
  return Object.freeze(result);
}

function desiredCreateText(rules: readonly string[]): string {
  return `${JSON.stringify(
    {
      permissions: {
        allow: [...rules],
      },
    },
    null,
    2,
  )}\n`;
}

function parseRules(value: unknown): readonly string[] {
  if (value === undefined) return DEFAULT_RULES;
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((entry) => typeof entry !== "string" || entry.length === 0) ||
    new Set(value).size !== value.length ||
    value.some((entry) =>
      WAKEFLOW_LEGACY_BROAD_BASH_PERMISSION_RULES.includes(
        entry as (typeof WAKEFLOW_LEGACY_BROAD_BASH_PERMISSION_RULES)[number],
      ),
    )
  ) {
    failInput("$rules");
  }
  return Object.freeze([...(value as readonly string[])]);
}

/** 退役规则：缺省为空；非空字符串、不重复。 */
function parseRetiredRules(value: unknown): readonly string[] {
  if (value === undefined) return Object.freeze([]);
  if (
    !Array.isArray(value) ||
    value.some((entry) => typeof entry !== "string" || entry.length === 0) ||
    new Set(value).size !== value.length
  ) {
    failInput("$retiredRules");
  }
  return Object.freeze([...(value as readonly string[])]);
}

/** 退出路径要删的条目：非空、非空字符串、不重复；没有缺省——删什么必须由调用方说出来。 */
function parseRemovedRules(value: unknown): readonly string[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((entry) => typeof entry !== "string" || entry.length === 0) ||
    new Set(value).size !== value.length
  ) {
    failInput("$removedRules");
  }
  return Object.freeze([...(value as readonly string[])]);
}

function current(
  sourceDigest: Sha256Digest | null,
): Readonly<ClaudeCodePortableSettingsTransition> {
  return Object.freeze({
    kind: "ClaudeCodePortableSettingsTransition",
    status: "current",
    reason: null,
    sourceDigest,
    desiredDigest: sourceDigest,
    desiredText: null,
  });
}

type AllowSourceInspection =
  | { readonly blocked: ClaudeCodePortableSettingsTransitionReason }
  | { readonly existingAllow: readonly string[] };

/** 现有严格 JSON 文本里的 `permissions.allow`：容量、语法、重复键、根与节点类型不合即 blocked 的理由。 */
function inspectAllowSource(sourceText: string): AllowSourceInspection {
  if (Buffer.byteLength(sourceText, "utf8") > MAXIMUM_SETTINGS_BYTES) {
    return { blocked: "capacity" };
  }
  const errors: ParseError[] = [];
  const root = parseTree(sourceText, errors, STRICT_PARSE_OPTIONS);
  if (root === undefined || errors.length > 0) return { blocked: "syntax" };
  if (duplicateKeyExists(root)) return { blocked: "duplicate-key" };
  if (jsonObject(root) === null) return { blocked: "root-not-object" };
  const permissionsNode = findNodeAtLocation(root, ["permissions"]);
  if (permissionsNode !== undefined && permissionsNode.type !== "object") {
    return { blocked: "permissions-not-object" };
  }
  const allowNode = findNodeAtLocation(root, ["permissions", "allow"]);
  if (allowNode === undefined) return { existingAllow: Object.freeze([]) };
  const entries = allowNode.children ?? [];
  if (
    allowNode.type !== "array" ||
    entries.some((entry) => entry.type !== "string" || typeof entry.value !== "string")
  ) {
    return { blocked: "allow-not-string-array" };
  }
  return { existingAllow: Object.freeze(entries.map((entry) => entry.value as string)) };
}

/** 同一文本上 `permissions.allow` 的最小编辑：序列不变即 current，否则只改这一键并复验为严格 JSON。 */
function allowTransition(
  sourceText: string,
  sourceDigest: Sha256Digest,
  existingAllow: readonly string[],
  desiredAllow: readonly string[],
): Readonly<ClaudeCodePortableSettingsTransition> {
  if (
    existingAllow.length === desiredAllow.length &&
    existingAllow.every((entry, index) => entry === desiredAllow[index])
  ) {
    return current(sourceDigest);
  }
  let desiredText: string;
  try {
    desiredText = applyEdits(
      sourceText,
      modify(sourceText, ["permissions", "allow"], desiredAllow, {
        formattingOptions: sourceFormatting(sourceText),
      }),
    );
  } catch {
    return blocked("syntax", sourceDigest);
  }
  const desiredErrors: ParseError[] = [];
  const desiredRoot = parseTree(desiredText, desiredErrors, STRICT_PARSE_OPTIONS);
  if (desiredRoot === undefined || desiredErrors.length > 0 || duplicateKeyExists(desiredRoot)) {
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

/**
 * 从 absent 或现有严格 JSON 文本计算最小 permissions.allow 变化。
 * `null` 明确表示目标文件不存在；空字符串是非法现有文件，不会被当成 absent。
 * `rules` 是这个根拥有的托管规则，缺省只有 MCP 一条；`retiredRules` 是曾拥有、现在要精确删除的条目。
 */
export function planClaudeCodePortableSettingsTransition(
  sourceTextValue: unknown,
  rulesValue?: unknown,
  retiredRulesValue?: unknown,
): Readonly<ClaudeCodePortableSettingsTransition> {
  if (sourceTextValue !== null && typeof sourceTextValue !== "string") {
    failInput("$sourceText");
  }
  const rules = parseRules(rulesValue);
  const retiredRules = parseRetiredRules(retiredRulesValue);
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
  const inspected = inspectAllowSource(sourceText);
  if ("blocked" in inspected) return blocked(inspected.blocked, sourceDigest);
  if (
    inspected.existingAllow.some((entry) =>
      WAKEFLOW_LEGACY_BROAD_BASH_PERMISSION_RULES.includes(
        entry as (typeof WAKEFLOW_LEGACY_BROAD_BASH_PERMISSION_RULES)[number],
      ),
    )
  ) {
    return blocked("legacy-broad-permission-present", sourceDigest);
  }
  return allowTransition(
    sourceText,
    sourceDigest,
    inspected.existingAllow,
    managedAllowEntries(inspected.existingAllow, rules, retiredRules),
  );
}

/**
 * 退出路径（ADR-0024 `remove-portable-settings-rules`）：从现有文本里精确删除 `removedRules` 里的条目，
 * 用户的其他条目与键原样保留，`allow` 键即使删空也留着。文件不存在（`null`）或没有任何给定条目即
 * current；读不出、不是对象或节点类型不合即 blocked，理由与写入同一套。不检查旧宽泛规则：它们不能
 * 证明是 Wakeflow 写的，所以既不删也不挡删除。
 */
export function planClaudeCodePortableSettingsRemovalTransition(
  sourceTextValue: unknown,
  removedRulesValue: unknown,
): Readonly<ClaudeCodePortableSettingsTransition> {
  if (sourceTextValue !== null && typeof sourceTextValue !== "string") {
    failInput("$sourceText");
  }
  const removed = new Set(parseRemovedRules(removedRulesValue));
  if (sourceTextValue === null) return current(null);
  const sourceText = sourceTextValue;
  const sourceDigest = digestText(sourceText);
  const inspected = inspectAllowSource(sourceText);
  if ("blocked" in inspected) return blocked(inspected.blocked, sourceDigest);
  return allowTransition(
    sourceText,
    sourceDigest,
    inspected.existingAllow,
    Object.freeze(inspected.existingAllow.filter((entry) => !removed.has(entry))),
  );
}
