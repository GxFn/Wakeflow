import { deepEqual, equal, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { WAKEFLOW_TEST_TARGET_RESULT_REPORT_SCHEMA } from "../../src/contracts/generated/governance/result/test-target-result-report.generated.js";
import { WAKEFLOW_PUBLIC_TOOL_CATALOG } from "../../src/entrypoints/wakeflow-public-mcp-catalog.js";
import { WAKEFLOW_TOOL_DESCRIPTION_MAXIMUM_BYTES } from "../../src/kernel/tool-registry.js";

/**
 * 公共工具描述与技能词汇的静态门（gate-log §13.130，收 §13.122 与 §13.129 的残留）。
 *
 * verify 的描述从 §13.111 起把门数停在 "thirteen" 两轮没人发现；§13.129 只给那一个数字加了
 * 决定测试。这里把同类检查推广到整张目录：每个工具的请求 Schema 里的主判别枚举（顶层的
 * `mode` / `action` / `operation` / `decision`，以及 `intent` 各分支的 `kind`）必须逐字出现在
 * 描述里；描述不超过 640 字节；只读注解与 "Reads only" 的措辞一致，写工具则必须说出它写什么。
 * 最后一条把 Test 技能列出的判定、失败分类与归属词汇对着拥有它们的报告 Schema 核对：
 * 少一个值是撒谎，多一个 Schema 里没有的词也是撒谎。
 *
 * 纯对象遍历加两份技能文件读取：没有夹具、没有服务进程、不跑构建。
 */

type SchemaNode = Readonly<Record<string, unknown>>;

function isSchemaNode(value: unknown): value is SchemaNode {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 只解析同文档内的 `#/...` 引用；生成的请求 Schema 保留这种局部引用，跨文档引用已内联。 */
function resolveLocal(root: SchemaNode, node: unknown): SchemaNode | null {
  let current = node;
  for (let hops = 0; hops < 8; hops += 1) {
    if (!isSchemaNode(current)) return null;
    const ref = current.$ref;
    if (typeof ref !== "string") return current;
    ok(ref.startsWith("#/"), `request schema keeps a non-local $ref: ${ref}`);
    let target: unknown = root;
    for (const segment of ref.slice(2).split("/")) {
      target = isSchemaNode(target) ? target[segment] : undefined;
    }
    current = target;
  }
  return null;
}

/** 一个节点连同它 `oneOf` / `anyOf` 各分支（递归、解析局部引用）。 */
function branchesOf(root: SchemaNode, node: unknown): readonly SchemaNode[] {
  const resolved = resolveLocal(root, node);
  if (resolved === null) return [];
  const branches: SchemaNode[] = [resolved];
  for (const combinator of ["oneOf", "anyOf"] as const) {
    const alternatives = resolved[combinator];
    if (!Array.isArray(alternatives)) continue;
    for (const alternative of alternatives) branches.push(...branchesOf(root, alternative));
  }
  return branches;
}

/** 节点自己的字面值：`enum` 的字符串项或字符串 `const`；不解析引用。 */
function ownLiterals(node: SchemaNode): readonly string[] {
  if (Array.isArray(node.enum)) {
    return node.enum.filter((value): value is string => typeof value === "string");
  }
  return typeof node.const === "string" ? [node.const] : [];
}

function literalValues(root: SchemaNode, node: unknown): readonly string[] {
  const resolved = resolveLocal(root, node);
  return resolved === null ? [] : ownLiterals(resolved);
}

const TOP_LEVEL_DISCRIMINATORS = Object.freeze([
  "mode",
  "action",
  "operation",
  "decision",
] as const);

/** 每个工具请求的主判别枚举：键是 `mode` 这样的顶层属性名或 `intent.kind`，值是它的全部取值。 */
function discriminatorValues(schema: SchemaNode): ReadonlyMap<string, ReadonlySet<string>> {
  const found = new Map<string, Set<string>>();
  const add = (key: string, values: readonly string[]): void => {
    if (values.length === 0) return;
    const bucket = found.get(key) ?? new Set<string>();
    for (const value of values) bucket.add(value);
    found.set(key, bucket);
  };
  for (const branch of branchesOf(schema, schema)) {
    const properties = branch.properties;
    if (!isSchemaNode(properties)) continue;
    for (const key of TOP_LEVEL_DISCRIMINATORS) {
      if (key in properties) add(key, literalValues(schema, properties[key]));
    }
    if (!("intent" in properties)) continue;
    for (const intent of branchesOf(schema, properties.intent)) {
      const intentProperties = intent.properties;
      if (isSchemaNode(intentProperties) && "kind" in intentProperties) {
        add("intent.kind", literalValues(schema, intentProperties.kind));
      }
    }
  }
  return found;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/** 逐字：区分大小写，两侧不能接字母、数字、下划线或连字符——`Preview` 与 `pre-close` 都不算。 */
function mentionsVerbatim(description: string, value: string): boolean {
  return new RegExp(`(?<![A-Za-z0-9_-])${escapeRegExp(value)}(?![A-Za-z0-9_-])`, "u").test(
    description,
  );
}

/**
 * 目录里带主判别枚举的工具及其判别键。表是守卫：抽取器若因 Schema 改形而漏掉一个工具，
 * 这条 deepEqual 先红，门不会静默变空；工具新增或撤掉判别键时要有意改这张表。
 */
const EXPECTED_DISCRIMINATORS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  wakeflow_cancel_demand: ["mode"],
  wakeflow_complete_demand: ["mode"],
  wakeflow_continue_demand: ["action", "mode"],
  wakeflow_create_demand: ["mode"],
  wakeflow_maintain_workspace: ["action", "mode"],
  wakeflow_pod: ["intent.kind", "mode"],
  wakeflow_publish_requirement: ["action", "mode"],
  wakeflow_record_evidence: ["mode"],
  wakeflow_record_implementation_review_decision: ["decision"],
  wakeflow_record_test_review_decision: ["decision"],
  wakeflow_register_window_binding: ["operation"],
});

test("每个公共工具的描述逐字点名其请求判别枚举的每一个值（§13.130：verify 门数门的推广）", () => {
  const observed: Record<string, readonly string[]> = {};
  for (const tool of WAKEFLOW_PUBLIC_TOOL_CATALOG.tools) {
    const values = discriminatorValues(tool.requestSchema);
    if (values.size > 0) observed[tool.name] = [...values.keys()].sort();
    for (const [key, bucket] of values) {
      ok(bucket.size > 0, `${tool.name}: ${key} carries no literal value`);
      for (const value of bucket) {
        ok(
          mentionsVerbatim(tool.description, value),
          `${tool.name}: ${key}=${value} is not named verbatim in its description`,
        );
      }
    }
  }
  deepEqual(observed, EXPECTED_DISCRIMINATORS);
});

test("每个公共工具的描述不超过 640 字节（§13.130：目录构造已拒绝，这里让上限在测试里可见）", () => {
  equal(WAKEFLOW_PUBLIC_TOOL_CATALOG.tools.length, 20);
  for (const tool of WAKEFLOW_PUBLIC_TOOL_CATALOG.tools) {
    const bytes = Buffer.byteLength(tool.description, "utf8");
    ok(
      bytes <= WAKEFLOW_TOOL_DESCRIPTION_MAXIMUM_BYTES,
      `${tool.name}: description is ${bytes} bytes`,
    );
  }
});

/**
 * 读工具的统一标记是 "Reads only"；写工具不得挂这个标记。写工具描述自己的 preview 模式
 * "read-only" 是在说模式而不是工具，不在此禁止。
 */
const READS_ONLY_PATTERN = /\breads only\b/iu;
/**
 * 写工具必须说出它写的那件事。词干匹配分不清动词、名词与否定（"the record"、"never records"），
 * 所以这里是闭集：每个写工具逐字点名其写效果的短语；新增写工具必须在这里登记它的短语
 * （§13.130 审查 P1-6）。
 */
const EXPECTED_WRITE_EFFECTS: Readonly<Record<string, string>> = Object.freeze({
  wakeflow_cancel_demand: "apply appends the cancellation event",
  wakeflow_complete_demand: "apply appends the completion event",
  wakeflow_continue_demand: "a continuation event is appended",
  wakeflow_create_demand: "apply publishes the Demand root",
  wakeflow_import_target_result: "appends the TargetResult event",
  wakeflow_maintain_workspace: "apply, or recover one workspace Maintenance transaction",
  wakeflow_plan_target_task: "Append one immutable task package",
  wakeflow_pod: "runs one config transaction",
  wakeflow_prepare_delivery: "appends the envelope with its fence token",
  wakeflow_publish_requirement: "apply writes the immutable ledger record",
  wakeflow_rearm_delivery: "the generation increases by one",
  wakeflow_record_delivery_outcome: "Record the outcome of one delivery generation",
  wakeflow_record_evidence: "Record one immutable managed evidence record",
  wakeflow_record_implementation_review_decision:
    "Record the Controller's accept, rework, blocked, or escalate decision",
  wakeflow_record_test_review_decision: "Record the Controller's accept, request-another-attempt",
  wakeflow_register_window_binding: "register binds the observed handle",
});

test("只读注解与描述措辞一致：readOnlyHint 为真必说 Reads only，为假必说它写什么（§13.130）", () => {
  for (const tool of WAKEFLOW_PUBLIC_TOOL_CATALOG.tools) {
    if (tool.annotations.readOnlyHint) {
      ok(
        READS_ONLY_PATTERN.test(tool.description),
        `${tool.name}: read tool must say "Reads only"`,
      );
      continue;
    }
    equal(
      READS_ONLY_PATTERN.test(tool.description),
      false,
      `${tool.name}: a mutating tool must not carry the "Reads only" marker`,
    );
    const effect = EXPECTED_WRITE_EFFECTS[tool.name];
    ok(effect !== undefined, `${tool.name}: a mutating tool must register its write-effect phrase`);
    ok(
      tool.description.includes(effect),
      `${tool.name}: the description no longer names its write effect "${effect}"`,
    );
  }
  deepEqual(
    WAKEFLOW_PUBLIC_TOOL_CATALOG.tools
      .filter((tool) => !tool.annotations.readOnlyHint)
      .map((tool) => tool.name)
      .sort(),
    Object.keys(EXPECTED_WRITE_EFFECTS).sort(),
  );
});

/**
 * Test 技能的词汇对着报告 Schema 核对。技能文本里反引号内的小写 kebab 记号（工具名带下划线、
 * 路径带斜杠，天然不在此列）要么是 Schema 某个枚举的值，要么是 `ts-N` 步骤号；一个文件点名了
 * 某个词汇表的任何值，就必须列全它。
 */
const TEST_SKILL_ROOT = path.join(process.cwd(), "assets", "agent-text", "skills", "wakeflow-test");
const TEST_SKILL_FILES = Object.freeze(["SKILL.md", "references/test-execution.md"]);
const BACKTICK_TOKEN_PATTERN = /`([^`\n]+)`/gu;
const VOCABULARY_TOKEN_PATTERN = /^[a-z][a-z0-9-]*$/u;
/**
 * 反引号里的小写 kebab 记号默认都当词汇核对（故意严格：文本里新造一个像判定词的记号会立刻失败）；
 * 不是词汇的普通命令名只能经这张显式名单放行，名单外的新词要么进 Schema，要么改写法。
 */
const NON_VOCABULARY_WORDS: ReadonlySet<string> = new Set(["git", "node", "npm", "tmux"]);

/** 文档里每个枚举与字符串 const 的值（跨文档 urn 引用保持原样，不跟进）。 */
function collectEnums(node: unknown, into: Set<string>): void {
  if (Array.isArray(node)) {
    for (const item of node) collectEnums(item, into);
    return;
  }
  if (!isSchemaNode(node)) return;
  for (const value of ownLiterals(node)) into.add(value);
  for (const child of Object.values(node)) collectEnums(child, into);
}

function schemaDefinition(schema: SchemaNode, pointer: string): SchemaNode {
  const resolved = resolveLocal(schema, { $ref: pointer });
  ok(resolved !== null, `test report schema lacks ${pointer}`);
  return resolved ?? {};
}

function vocabularyTokens(text: string): ReadonlySet<string> {
  return new Set(
    [...text.matchAll(BACKTICK_TOKEN_PATTERN)]
      .map((match) => match[1] ?? "")
      .filter((token) => VOCABULARY_TOKEN_PATTERN.test(token) && !NON_VOCABULARY_WORDS.has(token)),
  );
}

test("Test 技能列出的判定、失败分类与归属词汇与报告 Schema 的枚举完全一致（§13.130）", () => {
  const schema: SchemaNode = WAKEFLOW_TEST_TARGET_RESULT_REPORT_SCHEMA;
  const failure = schemaDefinition(schema, "#/$defs/failure/properties");
  const named: Readonly<Record<string, readonly string[]>> = Object.freeze({
    verdict: literalValues(schema, schemaDefinition(schema, "#/$defs/verdict")),
    classification: literalValues(schema, failure.classification),
    likelyOwner: literalValues(schema, failure.likelyOwner),
  });
  for (const [name, values] of Object.entries(named)) {
    ok(values.length >= 2, `${name}: the report schema no longer carries this vocabulary`);
  }
  const admitted = new Set<string>();
  collectEnums(schema, admitted);
  const stepIdPattern = schemaDefinition(schema, "#/$defs/stepId").pattern;
  equal(typeof stepIdPattern, "string");
  const stepId = new RegExp(String(stepIdPattern), "u");

  const listedAnywhere = new Set<string>();
  for (const relative of TEST_SKILL_FILES) {
    const tokens = vocabularyTokens(readFileSync(path.join(TEST_SKILL_ROOT, relative), "utf8"));
    for (const token of tokens) {
      listedAnywhere.add(token);
      ok(
        admitted.has(token) || stepId.test(token),
        `wakeflow-test/${relative} lists \`${token}\`, which no enum of the test report schema carries`,
      );
    }
    for (const [name, values] of Object.entries(named)) {
      if (!values.some((value) => tokens.has(value))) continue;
      for (const value of values) {
        ok(
          tokens.has(value),
          `wakeflow-test/${relative} names ${name} values but omits \`${value}\``,
        );
      }
    }
  }
  for (const [name, values] of Object.entries(named)) {
    for (const value of values) {
      ok(listedAnywhere.has(value), `the Test skill never lists ${name} value \`${value}\``);
    }
  }
});
