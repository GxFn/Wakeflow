import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";

import { SHA256_DIGEST_PATTERN_SOURCE } from "../../src/contracts/generated/foundation/sha256-digest.generated.js";
import {
  parseWakeflowDurableIdOfKind,
  WAKEFLOW_DURABLE_ID_KINDS,
} from "../../src/contracts/identity/wakeflow-durable-id.js";
import { WAKEFLOW_PUBLIC_TOOL_CATALOG } from "../../src/entrypoints/wakeflow-public-mcp-catalog.js";
import { parseSha256Digest } from "../../src/foundation/crypto/sha256.js";
import { parseUuidV4 } from "../../src/foundation/identity/uuid-v4.js";
import { parseWakeflowMaintenanceOperationId } from "../../src/workspace/maintenance/wakeflow-maintenance-operation-id.js";
import { parseWakeflowWindowHostBindingId } from "../../src/contracts/identity/wakeflow-window-host-binding-id.js";

/**
 * 0 级（纯逻辑）：请求 Schema 里每一条标识与摘要的 `pattern` 都等于代码信赖的那条领域规则（a-spec 第 3.2 节
 * 步骤 2e，风险 5）。请求只在入口准入一次（R13），之后能力代码把 Schema 认过的字符串直接当品牌值用
 * （`request.demandId as WakeflowDurableId<"demand">` 等），下游不再重解析；于是 Schema 就是这些值唯一的
 * 词法检查，它必须与领域解析器（`parseWakeflowDurableIdOfKind`、`parseSha256Digest`、维护操作 id 与窗口
 * 绑定 id 的解析器、`parseUuidV4`）逐字一致，并在一组边界样本上与解析器给出同样的判定。新增一种 UUID 形的
 * 标识而没有在下表登记领域规则，本测试失败。
 */

const UUID_V4 = "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const UUID_SAMPLE = "0f8fad5b-d9cb-469f-a165-70867728950e";

type DomainParser = (value: string) => unknown;

/** 代码在 Schema 之后当作品牌值使用的标识：前缀（不含 `_`）到它的领域解析器；空串是不带前缀的 UUID。 */
const BRANDED_ID_RULES: ReadonlyMap<string, DomainParser> = new Map<string, DomainParser>([
  ...WAKEFLOW_DURABLE_ID_KINDS.map(
    (kind) => [kind, (value: string) => parseWakeflowDurableIdOfKind(value, kind)] as const,
  ),
  ["maintenance_operation", (value) => parseWakeflowMaintenanceOperationId(value)],
  ["window_binding", (value) => parseWakeflowWindowHostBindingId(value)],
  ["", (value) => parseUuidV4(value)],
]);

/**
 * UUID 形、但服务端只当宿主文本转交、从不授予品牌的值：Claude 桌面会话 id `local_<uuid>`（定位子载荷，
 * `claude-code-window-transport-ports.ts`）。它的规则在桌面助手里，不在这里比较。
 */
const HOST_TEXT_PREFIXES: ReadonlySet<string> = new Set(["local"]);

/** 能力代码在 Schema 之后直接 `as WakeflowDurableId<…>` 的类别（2026-11-27 的 grep）。 */
const CAST_KINDS = Object.freeze([
  "demand",
  "demand-event",
  "evidence",
  "pod",
  "requirement",
  "target-task",
  "window",
]);

interface PatternSite {
  readonly tool: string;
  readonly pointer: string;
  readonly pattern: string;
}

function collectPatterns(node: unknown, tool: string, pointer: string, into: PatternSite[]): void {
  if (Array.isArray(node)) {
    node.forEach((entry, index) => {
      collectPatterns(entry, tool, `${pointer}/${index}`, into);
    });
    return;
  }
  if (node === null || typeof node !== "object") return;
  for (const [key, value] of Object.entries(node)) {
    if (key === "pattern" && typeof value === "string") {
      into.push({ tool, pointer, pattern: value });
    } else {
      collectPatterns(value, tool, `${pointer}/${key}`, into);
    }
  }
}

const SITES: readonly PatternSite[] = (() => {
  const sites: PatternSite[] = [];
  for (const tool of WAKEFLOW_PUBLIC_TOOL_CATALOG.tools) {
    collectPatterns(tool.requestSchema, tool.name, "", sites);
  }
  return Object.freeze(sites);
})();

/** Ajv 用 `u` 标志编译 `pattern`。 */
function schemaAccepts(pattern: string, value: string): boolean {
  return new RegExp(pattern, "u").test(value);
}

function domainAccepts(parse: (value: string) => unknown, value: string): boolean {
  try {
    parse(value);
    return true;
  } catch {
    return false;
  }
}

/** 一个前缀的边界样本：合法值，以及大小写、版本、变体、前缀、首尾与长度各错一处的值。 */
function idSamples(prefix: string): readonly string[] {
  const head = prefix === "" ? "" : `${prefix}_`;
  return [
    `${head}${UUID_SAMPLE}`,
    `${head}${UUID_SAMPLE.toUpperCase()}`,
    `${head}0f8fad5b-d9cb-169f-a165-70867728950e`,
    `${head}0f8fad5b-d9cb-469f-c165-70867728950e`,
    `${head}0f8fad5b-d9cb-469f-a165-70867728950`,
    `${head}${UUID_SAMPLE}0`,
    `${head}${UUID_SAMPLE}\n`,
    ` ${head}${UUID_SAMPLE}`,
    `${head}${head}${UUID_SAMPLE}`,
    `other_${UUID_SAMPLE}`,
    UUID_SAMPLE,
    head,
    "",
  ];
}

test("every UUID-shaped identifier pattern in a public request Schema is <prefix>_<UUID v4> for a prefix whose domain rule is registered, and agrees with that rule", () => {
  const uuidSites = SITES.filter((site) => site.pattern.includes("[0-9a-f]{8}-"));
  ok(uuidSites.length > 0);
  const prefixes = new Set<string>();
  for (const site of uuidSites) {
    const where = `${site.tool} ${site.pointer}`;
    const match = /^\^(?:([a-z][a-z-]*(?:_[a-z]+)*)_)?(.*)\$$/u.exec(site.pattern);
    equal(match?.[2], UUID_V4, `${where}: the UUID part is the lowercase UUID v4 rule`);
    const prefix = match?.[1] ?? "";
    prefixes.add(prefix);
    if (HOST_TEXT_PREFIXES.has(prefix)) continue;
    const parse = BRANDED_ID_RULES.get(prefix);
    ok(parse !== undefined, `${where}: no domain rule registered for prefix "${prefix}"`);
    equal(site.pattern, `^${prefix === "" ? "" : `${prefix}_`}${UUID_V4}$`, where);
    for (const sample of idSamples(prefix)) {
      equal(
        schemaAccepts(site.pattern, sample),
        domainAccepts(parse, sample),
        `${where}: ${JSON.stringify(sample)}`,
      );
    }
  }
  // The identifiers capability code casts to brands after the Schema (a-spec s.3.2 step 2e).
  for (const cast of CAST_KINDS) ok(prefixes.has(cast), `request Schemas carry ${cast} ids`);
});

test("every digest pattern in a public request Schema is the sha256 digest rule and agrees with parseSha256Digest", () => {
  const digestSites = SITES.filter((site) => site.pattern.includes("sha256"));
  ok(digestSites.length > 0);
  const hex = "0123456789abcdef".repeat(4);
  const samples = [
    `sha256:${hex}`,
    `sha256:${hex.toUpperCase()}`,
    `sha256:${hex.slice(1)}`,
    `sha256:${hex}0`,
    `SHA256:${hex}`,
    `sha256:${hex}\n`,
    hex,
    "sha256:",
    "",
  ];
  for (const site of digestSites) {
    const where = `${site.tool} ${site.pointer}`;
    equal(site.pattern, SHA256_DIGEST_PATTERN_SOURCE, where);
    deepEqual(
      samples.map((sample) => schemaAccepts(site.pattern, sample)),
      samples.map((sample) => domainAccepts(parseSha256Digest, sample)),
      where,
    );
  }
});
