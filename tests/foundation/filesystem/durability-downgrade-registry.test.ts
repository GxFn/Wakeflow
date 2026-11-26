import { deepEqual, notDeepEqual } from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { parseSync } from "@swc/core";

/**
 * Level 0 (pure): 降档调用点的登记表（1.4.1 第 1 段清单 2.2 节；档的定义见
 * docs/reviews/2026-11-19-1.4.1-record-kind-table.md 第 0 节）。
 *
 * 级别说明：本文件放在 tests/foundation/filesystem（目录缺省 1 级）下，因为它登记的是 foundation
 * 文件系统原语的降档；但它只读取仓库里 `src/` 的源码文本并在内存里解析，不打开任何根、不写盘、
 * 不起子进程，按测试标准第 2 节属 0 级（"读取仓库内的 Schema/夹具文本"）。
 *
 * 缺省是最强的一档（权威，`fsync`）：漏登记只会多同步，所以要登记的是"要得比缺省少"的地方。本测试
 * 用 swc 把 `src/` 下的 `.ts`（TypeScript）与 `.mjs`（JavaScript）解析成语法树再遍历；注释、字符串里的
 * `/*`、类型位置里的联合与比较都由语法树区分，不靠文本去注释。（TypeScript 7 的 npm 包不再导出
 * `ts.createSourceFile` 那套进程内编译器 API；swc 是 dependency-cruiser 已经在用的进程内解析器。）
 *
 * 一行登记一个调用点，键是四样：文件、所在函数（最近的具名函数或方法，类的方法写 `类.方法`，类的
 * 字段写类名，直接赋给变量的对象字面量的方法写 `变量.方法`，顶层写 `<module>`；具名函数套在另一个具名
 * 函数里时从外到内用 `>` 连起来，如 `outer>inner`）、去处（字面量交给谁：`call f` / `new C` 是作为某次调用的实参，
 * `const x`、`default x`、`assign x`、`property x`、`return` 是声明、缺省值、赋值、类字段与返回值，
 * 都不是时写 `expression`；成员调用按属性名，`Object.freeze(...)` 只冻结、不算去处）与取值。键完全
 * 相同的才合并计数，所以同一文件里把降档从一处调用挪到另一处调用（换了函数或换了被调者）都会让本
 * 测试失败。
 *
 * 认作降档点的字面量（字符串字面量或不带插值的模板字面量；每个字面量节点只数一次，先到的规则定去处）：
 * 1. 名为 `durability` 的对象属性（标识符键、字符串键、字符串字面量的计算键）的值里任意位置的
 *    `"content-only"` / `"none"`，含条件表达式与 `??`；
 * 2. 名为 `durability` / `parentEntry` 的参数或解构属性的缺省值，含构造器的参数属性
 *    （`constructor(readonly durability = "none")`）；名为 `durability` 的类字段的初始值；
 * 3. 名字含 durability 的变量的初始值；左侧提到 durability 的 `??` 的右侧；名字含 durability 的
 *    函数或方法的返回值；
 * 4. 声明之后对名字含 durability 的标识符或成员的赋值（`options.durability = "none"`、
 *    `options["durability"] ??= "none"`）；
 * 5. 调用实参：凡 `src/` 里有一个函数、方法或构造器的第 i 个参数叫 `durability` / `parentEntry`，
 *    对同名被调者（`new` 按类名）在第 i 位传的字面量（`removeEmptyDirectoryExactly(..., "none")`；
 *    `parentEntry` 只认 `"deferred"`：目录树候选的新建放弃父目录项同步，交给树在成员写完之后的
 *    逐目录同步）；
 * 6. `src/foundation/filesystem/` 里出现在值位置上的每一个 `"none"` / `"content-only"` / `"deferred"`，
 *    不管它进了哪里：原语内部新加一个缺省、一张取值表或一次转发的起点，都会在这里多一行。
 * 值位置不含：类型位置、相等比较的操作数（`=== "none"`）、`switch` 的分支值、对象与成员访问的键。
 *
 * 转发：值不是字面量的去处（`durability: root.durability`、简写 `{ durability }`、计算键、名为
 * durability 的类字段、赋给 durability 的非字面量、在 durability / parentEntry 参数位上传的非字面量）
 * 不是降档本身，但降档的
 * 取值先算进变量再转发时，字面量规则看不见它。在 foundation 文件系统原语之外，这样的点按同样的四样
 * （取值一栏是转发的表达式）列在第二张表里；原语内部的转发是正常的管道，不列，那里改由第 6 条看住
 * 每一个字面量。各命令切片把组合根给的根级别传给 `commandShellExecutionOptions` 的那一种按被调者与
 * 实参整体豁免（见豁免表），换一个实参就不再豁免。
 *
 * 导入守卫：放弃父目录项同步的两个目录树原语（`createTreeCandidateDirectoryAtomically`、
 * `createDirectoryTreeMemberFileDurably`）只许 durable-directory-tree-candidate.ts 导入；具名导入
 * （含改名）、转出、整模块的命名空间导入与 `export *`、对定义模块的动态 `import()`，以及实参不是
 * 字面量、无法判断目标的动态 `import()` 都算导入。获准导入的那个模块只许直接调用它们：绑定到它们的
 * 本地名字出现在调用的被调者之外的任何位置（转出、赋值、放进对象、当实参），或从定义模块带来源地转出，
 * 都算把它们交了出去。
 *
 * 仍然看不见的（新增降档若走这些路，需要评审者自己看）：
 * - 展开一个对象带进来的 durability（`f({ ...LIGHT })`），或把一个现成的选项对象整个当实参传
 *   （`createFileAtomically(root, ref, bytes, LIGHT)`）：只在造出 LIGHT 的那个字面量处
 *   有一行，新增一处使用同一个对象不改表；
 * - 改名导入的被调者（`import { removeEmptyDirectoryExactly as removeDirectory }`）、经
 *   `.call` / `.apply` / `.bind` 或函数值间接调用、展开实参（`f(...args)`）时的参数位；
 * - 参数不叫 `durability` / `parentEntry` 的包装函数：在它的调用点上传的字面量；
 * - 原语之外运行时拼出的取值（字符串拼接、带插值的模板、用变量作计算键、查一张键名不含
 *   durability 的表）：只在它最终落到 durability 键或参数位时以转发出现；
 * - 同一函数里对同一被调者的几次调用合并成一行计数，降档在它们之间挪动看不出；
 * - 原语之内的转发不列（见上），定义模块内部对上述两个目录树原语的调用不受导入守卫约束。
 *
 * 耗时：整个 `src/` 用 swc 解析一遍约 0.6 秒（空载），导入守卫复用同一批语法树，全文件约 0.75 秒；
 * 离 0 级的 1 秒预算很近，门内负载下可能超出，超出的部分是解析本身。
 */

/** 档：现状不变（1.4.1 之前就不同步），或权威写法的组成部分（档表第 0 节两种特殊写法）。 */
type DowngradeClass = "现状不变（1.4.1 之前）" | "权威（追加）的组成" | "权威（目录树发布）的组成";

/** 一个调用点：文件、所在函数、去处与取值（转发点的取值是被转发的表达式）。 */
interface SiteKey {
  readonly file: string;
  readonly scope: string;
  readonly context: string;
  readonly value: string;
}

interface DowngradeRow extends SiteKey {
  readonly count: number;
  readonly kind: DowngradeClass;
  /** 一句话：放弃了什么，为什么可以。 */
  readonly reason: string;
}

interface ForwardedRow extends SiteKey {
  readonly count: number;
  /** 转发的是什么值，为什么不是新的降档。 */
  readonly reason: string;
}

/** 按被调者与实参整体豁免的转发（不按文件列）。 */
interface ForwardingExemption {
  readonly callee: string;
  readonly argument: string;
  readonly reason: string;
}

const UNLINK_CALL = "call unlinkRegularFileExactly";

/** 1.4.1 之前就不同步的一行。 */
function unchanged(file: string, scope: string, context: string, reason: string): DowngradeRow {
  return { file, scope, context, value: "none", count: 1, kind: "现状不变（1.4.1 之前）", reason };
}

const STREAM_INDEX = "src/kernel/event-stream/stream-index.ts";
const SNAPSHOT_STORE = "src/governance/demand/event-sourcing/demand-file-event-snapshot-store.ts";
const INCIDENT = "src/kernel/incident.ts";
const HOOK_OBSERVATIONS = "src/kernel/hook-observations.ts";

// 锁不在这张表里：锁是内核咨询锁（ADR-0033），持有不写盘，也就没有可降的档。
const REGISTRY: readonly DowngradeRow[] = [
  {
    file: "src/governance/demand/event-sourcing/demand-file-event-store.ts",
    scope: "DemandFileEventStore.#appendUnderProcessGate",
    context: "call createFileCandidateDurably",
    value: "content-only",
    count: 1,
    kind: "权威（追加）的组成",
    reason:
      "追加候选放弃链接前的父目录同步；候选不是权威，链接到 commits 之后同步 commits/、删掉候选之后同步 append-candidates/，追加仍是 3 次",
  },
  {
    file: "src/foundation/filesystem/durable-file-candidate.ts",
    scope: "createDirectoryTreeMemberFileDurably",
    context: "call performCreate",
    value: "content-only",
    count: 1,
    kind: "权威（目录树发布）的组成",
    reason:
      "目录树候选的成员文件放弃各自的父目录同步；成员所在目录在成员都写完之后同步一次，树发布 F+D+2 次；只许树候选导入（导入守卫）",
  },
  {
    file: "src/foundation/filesystem/durable-directory-materialization.ts",
    scope: "createTreeCandidateDirectoryAtomically",
    context: "call performAtomicCreate",
    value: "deferred",
    count: 1,
    kind: "权威（目录树发布）的组成",
    reason:
      "目录树候选的新建目录放弃父目录项同步；父目录在成员写完之后同步一次；只许树候选导入（导入守卫）",
  },
  unchanged(
    "src/foundation/filesystem/durable-atomic-file-write.ts",
    "performWrite",
    "const durability",
    "根以 none 打开时原子写跳过本次的全部同步（逐次选项让位于根的级别）；只有测试的一次性根取 none，生产组合根永远是 fsync",
  ),
  unchanged(
    STREAM_INDEX,
    "publishStreamIndex",
    "call createFileAtomically",
    "流索引的发布不同步；派生检查点，丢了下次追加从提交重建",
  ),
  unchanged(
    STREAM_INDEX,
    "retireStreamIndexAt",
    UNLINK_CALL,
    "流索引按序号删除不同步；派生检查点，丢了下次追加从提交重建",
  ),
  unchanged(
    STREAM_INDEX,
    "retireStreamIndexesBefore",
    UNLINK_CALL,
    "流索引的修剪不同步；派生检查点，丢了下次追加从提交重建",
  ),
  unchanged(
    SNAPSHOT_STORE,
    "DemandFileEventSnapshotStore.publish",
    "call createFileAtomically",
    "事件快照的发布不同步；快照缺失、为空或读不懂时加载退回全量重放",
  ),
  unchanged(
    SNAPSHOT_STORE,
    "DemandFileEventSnapshotStore.retireSnapshotAt",
    UNLINK_CALL,
    "事件快照的退休不同步；快照缺失、为空或读不懂时加载退回全量重放",
  ),
  unchanged(
    SNAPSHOT_STORE,
    "DemandFileEventSnapshotStore.retireSnapshotsBefore",
    UNLINK_CALL,
    "事件快照的修剪不同步；快照缺失、为空或读不懂时加载退回全量重放",
  ),
  unchanged(
    INCIDENT,
    "recordIncident",
    "call createFileAtomically",
    "事故记录的写入不同步；诊断用，丢了只影响一个计数，读者容忍损坏",
  ),
  unchanged(
    INCIDENT,
    "pruneIncidents",
    UNLINK_CALL,
    "超出保留数的事故记录修剪不同步；诊断用，丢了只影响一个计数，读者容忍损坏",
  ),
  unchanged(
    HOOK_OBSERVATIONS,
    "unlinkPrunedHostHookEntry",
    UNLINK_CALL,
    "hook 观察的修剪删除不同步；尽力而为，复活的条目下次再收，观察记录本身仍是权威",
  ),
  unchanged(
    HOOK_OBSERVATIONS,
    "retireHostHookStageResidue",
    UNLINK_CALL,
    "属主已死的 hook 暂存退役不同步；尽力而为，复活的条目下次再收，观察记录本身仍是权威",
  ),
  unchanged(
    HOOK_OBSERVATIONS,
    "removeEmptiedHookDirectory",
    "call removeEmptyDirectoryExactly",
    "修剪后空分片目录的回收不同步；尽力而为，复活的条目下次再收，观察记录本身仍是权威",
  ),
  unchanged(
    "src/kernel/active-projection.ts",
    "retireDemandProjection",
    "call removeEmptyDirectoryExactly",
    "Demand 结束后清空的投影目录按身份删除、不同步父目录（档表第 7 节的已有例外）；可重建的派生页面目录，复活的空目录下次发布再清",
  ),
];

const DERIVED_ROOT = "以来源根的级别打开派生根（同一次调用的根不得对耐久性有分歧）";
const OPEN_CALL = "call open";
const STEP_EXECUTOR = "src/workspace/maintenance/wakeflow-static-materialization-step-executor.ts";
const PREVIEW = "src/workspace/maintenance/wakeflow-static-materialization-preview.ts";

/** 一处派生根随来源根级别打开的转发。 */
function derivedRoot(file: string, scope: string, value: string, what: string): ForwardedRow {
  return { file, scope, context: OPEN_CALL, value, count: 1, reason: `${what}：${DERIVED_ROOT}` };
}

/** foundation 文件系统原语之外，durability 取非字面量值的点。 */
const FORWARDED: readonly ForwardedRow[] = [
  {
    file: "src/kernel/command-shell.ts",
    scope: "commandShellExecutionOptions",
    context: "return",
    value: "durability",
    count: 1,
    reason: "把切片给的根级别收进命令外壳的执行选项（缺省不传）；值来自组合根，生产永远是 fsync",
  },
  {
    file: "src/kernel/command-shell.ts",
    scope: "rootOpenOptions",
    context: "return",
    value: "options.durability",
    count: 1,
    reason: "把组合根给的根级别原样传给打开工作区根的选项；生产组合根永远是 fsync",
  },
  derivedRoot(
    "src/capabilities/demand/context.ts",
    "openSliceContext",
    "root.durability",
    "账本根",
  ),
  derivedRoot(
    "src/capabilities/observation/service.ts",
    "openLedgerRoot",
    "root.durability",
    "账本根",
  ),
  derivedRoot(
    "src/capabilities/workspace/maintain-workspace.ts",
    "occupancyDemandBlockers",
    "context.root.durability",
    "维护清点占用时的账本根",
  ),
  derivedRoot(
    "src/governance/demand/demand-operation-authority-context.ts",
    "openDemandAuthorityContext",
    "workspaceRoot.durability",
    "Demand 权威上下文的账本根",
  ),
  derivedRoot(
    "src/governance/demand/demand-operation-authority-context.ts",
    "openDemandOperationRoot",
    "workspaceRoot.durability",
    "Demand 操作根",
  ),
  derivedRoot(
    "src/governance/demand/publication/demand-active-guard.ts",
    "readDemandPodId",
    "root.durability",
    "读 Demand 所属 pod 时的 Demand 根",
  ),
  derivedRoot(
    "src/governance/demand/publication/demand-event-sourcing-publication-storage.ts",
    "openDemandPublicationRoot",
    "workspaceRoot.durability",
    "Demand 发布根",
  ),
  derivedRoot(
    "src/governance/observation/active-projection-refresh.ts",
    "openLedgerRoot",
    "root.durability",
    "投影刷新的账本根",
  ),
  derivedRoot(
    "src/governance/observation/archived-demand-observation.ts",
    "readArchivedReviewSnapshot",
    "ledgerRoot.durability",
    "归档载荷根（随账本根）",
  ),
  derivedRoot(PREVIEW, "inspectExternalInstructions", "root.durability", "预览外部指令的仓库根"),
  derivedRoot(PREVIEW, "planManagedBlockRemovals", "root.durability", "预览托管块移除的仓库根"),
  derivedRoot(
    STEP_EXECUTOR,
    "executeExternalInstruction",
    "root.durability",
    "维护步骤写外部指令的仓库根",
  ),
  derivedRoot(
    STEP_EXECUTOR,
    "executeRemoveManagedBlock",
    "root.durability",
    "维护步骤移除托管块的仓库根",
  ),
  derivedRoot(
    STEP_EXECUTOR,
    "executeSupportGitignore",
    "root.durability",
    "维护步骤写支持仓库 .gitignore 的支持根",
  ),
  derivedRoot(
    STEP_EXECUTOR,
    "executeSupportMemory",
    "root.durability",
    "维护步骤写支持记忆的支持根",
  ),
  derivedRoot(
    "src/workspace/support/wakeflow-managed-support-root-materialization.ts",
    "openSupportRoot",
    "workspaceRoot.durability",
    "支持根",
  ),
];

const FORWARDING_EXEMPTIONS: readonly ForwardingExemption[] = [
  {
    callee: "commandShellExecutionOptions",
    argument: "options.durability",
    reason:
      "各命令切片把组合根给的根级别原样交给命令外壳的执行选项；生产组合根永远是 fsync，只有测试的一次性根取 none",
  },
];

/** 测试从仓库根运行（与 tests/artifacts 读源码文本的方式相同）；编译后的文件在 .build 下，不能据它定位。 */
const REPOSITORY_ROOT = process.cwd();
const PRIMITIVES_DIRECTORY = "src/foundation/filesystem/";
const TREE_CANDIDATE_MODULE = "src/foundation/filesystem/durable-directory-tree-candidate.ts";
const DURABILITY_VALUES: ReadonlySet<string> = new Set(["content-only", "none"]);
const PARENT_ENTRY_VALUES: ReadonlySet<string> = new Set(["deferred"]);
/** 参数名到它的降档取值；出现这些名字的参数位置上传的字面量算降档。 */
const DOWNGRADE_PARAMETERS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ["durability", DURABILITY_VALUES],
  ["parentEntry", PARENT_ENTRY_VALUES],
]);
/** 第 6 条在原语目录里数的取值：两种参数的降档取值都算。 */
const PRIMITIVE_VALUES: ReadonlySet<string> = new Set([
  ...DURABILITY_VALUES,
  ...PARENT_ENTRY_VALUES,
]);
const EQUALITY_OPERATORS: ReadonlySet<string> = new Set(["===", "!==", "==", "!="]);
/** 类型位置的字段：类型注解里的字符串字面量（联合类型）不是值。 */
const TYPE_FIELDS: ReadonlySet<string> = new Set([
  "typeAnnotation",
  "typeParameters",
  "typeParams",
  "typeArguments",
  "returnType",
  "superTypeParams",
  "implements",
]);
/** 以 `Ts` 开头却承载值的节点；其余 `Ts` 节点（别名、接口、字面量类型……）整棵是类型，不进去。 */
const VALUE_TS_NODES: ReadonlySet<string> = new Set([
  "TsAsExpression",
  "TsSatisfiesExpression",
  "TsNonNullExpression",
  "TsConstAssertion",
  "TsTypeAssertion",
  "TsInstantiation",
  "TsParameterProperty",
  "TsEnumDeclaration",
  "TsEnumMember",
  "TsModuleDeclaration",
  "TsModuleBlock",
  "TsExportAssignment",
]);
/** 只包一层、不改值的表达式：括号、`as`、`as const`、`satisfies`、非空断言与尖括号断言。 */
const WRAPPERS: ReadonlySet<string> = new Set([
  "ParenthesisExpression",
  "TsAsExpression",
  "TsConstAssertion",
  "TsSatisfiesExpression",
  "TsNonNullExpression",
  "TsTypeAssertion",
]);
const FUNCTION_EXPRESSIONS: ReadonlySet<string> = new Set([
  "FunctionExpression",
  "ArrowFunctionExpression",
]);
/** 走到这些节点还没找到去处，就是一个独立的表达式。 */
const CONTEXT_BOUNDARIES: ReadonlySet<string> = new Set([
  "Module",
  "Script",
  "FunctionBody",
  "BlockStatement",
  "SwitchCase",
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
  "ClassMethod",
  "PrivateMethod",
  "Constructor",
  "MethodProperty",
  "GetterProperty",
  "SetterProperty",
]);

interface AstNode {
  readonly type?: string;
  readonly [field: string]: unknown;
}

/** 遍历时的一层祖先：节点与它在父节点里的字段名。 */
interface Frame {
  readonly node: AstNode;
  readonly field: string;
}

function isNode(value: unknown): value is AstNode {
  return typeof value === "object" && value !== null;
}

function nodeType(value: unknown): string | undefined {
  return isNode(value) && typeof value.type === "string" ? value.type : undefined;
}

function isTypeOnly(node: AstNode): boolean {
  const type = node.type ?? "";
  return type.startsWith("Ts") && !VALUE_TS_NODES.has(type);
}

/** 去掉括号、`as`、`as const`、`satisfies` 与非空断言，得到表达式本体。 */
function unwrap(value: unknown): unknown {
  let current = value;
  while (WRAPPERS.has(nodeType(current) ?? "")) current = (current as AstNode).expression;
  return current;
}

/** 字符串字面量或不带插值的模板字面量的值；其余为 undefined。 */
function literalValue(value: unknown): string | undefined {
  if (!isNode(value)) return undefined;
  if (value.type === "StringLiteral" && typeof value.value === "string") return value.value;
  if (value.type === "TemplateLiteral") {
    const expressions = value.expressions as unknown[];
    const quasis = value.quasis as AstNode[];
    if (expressions.length === 0 && quasis.length === 1) {
      const element = quasis[0];
      return String(element?.cooked ?? element?.raw ?? "");
    }
  }
  return undefined;
}

/** 名字：标识符、字符串字面量、字符串字面量的计算键（`["durability"]`）与私有名（`#root`）。 */
function nameOf(value: unknown): string | undefined {
  if (!isNode(value)) return undefined;
  if (value.type === "Identifier" && typeof value.value === "string") return value.value;
  if (value.type === "PrivateName" && typeof value.value === "string") return `#${value.value}`;
  if (value.type === "Computed") return literalValue(unwrap(value.expression));
  return literalValue(value);
}

/** 遍历一个节点的子节点（跳过类型位置、类型节点与 span）。 */
function* children(node: AstNode): Generator<readonly [string, AstNode]> {
  for (const [field, value] of Object.entries(node)) {
    if (field === "span" || TYPE_FIELDS.has(field)) continue;
    const items = Array.isArray(value) ? value : [value];
    for (const item of items) {
      if (isNode(item) && !isTypeOnly(item)) yield [field, item];
    }
  }
}

/** 表达式里作为值出现的字面量：不含相等比较的操作数、对象的键与类型位置。 */
function valueLiterals(expression: unknown, found: AstNode[] = []): AstNode[] {
  if (!isNode(expression)) return found;
  if (literalValue(expression) !== undefined) {
    found.push(expression);
    return found;
  }
  const equality =
    expression.type === "BinaryExpression" && EQUALITY_OPERATORS.has(String(expression.operator));
  for (const [field, child] of children(expression)) {
    if (equality && literalValue(unwrap(child)) !== undefined) continue;
    if (field === "key") continue;
    if (expression.type === "SwitchCase" && field === "test") continue;
    valueLiterals(child, found);
  }
  return found;
}

function mentionsDurability(expression: unknown): boolean {
  if (!isNode(expression)) return false;
  if (/durability/iu.test(nameOf(expression) ?? "")) return true;
  for (const [, child] of children(expression)) if (mentionsDurability(child)) return true;
  return false;
}

/** 转发表与去处里用的表达式文本：只认常见的几种形状，其余写节点类型。 */
function render(value: unknown): string {
  const node = unwrap(value);
  if (!isNode(node)) return "<none>";
  const literal = literalValue(node);
  if (literal !== undefined) return JSON.stringify(literal);
  switch (node.type) {
    case "Identifier":
      return String(node.value);
    case "ThisExpression":
      return "this";
    case "MemberExpression": {
      const property = node.property as AstNode;
      const object = render(node.object);
      if (property.type === "Computed") return `${object}[${render(property.expression)}]`;
      return `${object}.${nameOf(property) ?? "<property>"}`;
    }
    case "OptionalChainingExpression":
      return render(node.base);
    case "CallExpression":
      return `${render(node.callee)}(…)`;
    case "ConditionalExpression":
      return `${render(node.test)} ? ${render(node.consequent)} : ${render(node.alternate)}`;
    case "BinaryExpression":
      return `${render(node.left)} ${String(node.operator)} ${render(node.right)}`;
    default:
      return `<${node.type ?? "node"}>`;
  }
}

/** 被调者的名字：成员调用取属性名，`import()` 写 `import`。 */
function calleeName(callee: unknown): string | undefined {
  const target = unwrap(callee);
  if (nodeType(target) === "Import") return "import";
  if (nodeType(target) === "MemberExpression") return nameOf((target as AstNode).property);
  return nameOf(target);
}

/** 参数节点（`Parameter` 包装、参数属性或裸模式，可带缺省值）的名字。 */
function parameterName(parameter: AstNode): string | undefined {
  let pattern: unknown = parameter;
  if (parameter.type === "Parameter") pattern = parameter.pat;
  if (parameter.type === "TsParameterProperty") pattern = parameter.param;
  return nodeType(pattern) === "AssignmentPattern"
    ? nameOf((pattern as AstNode).left)
    : nameOf(pattern);
}

/** 有降档参数的函数：名字到（位置，取值集合）。 */
type ParameterIndex = Map<string, Array<Readonly<{ index: number; values: ReadonlySet<string> }>>>;

function collectParameterPositions(module: AstNode, index: ParameterIndex): void {
  const add = (name: string | undefined, parameters: unknown): void => {
    if (name === undefined || !Array.isArray(parameters)) return;
    (parameters as AstNode[]).forEach((parameter, position) => {
      const values = DOWNGRADE_PARAMETERS.get(parameterName(parameter) ?? "");
      if (values === undefined) return;
      const entries = index.get(name) ?? [];
      entries.push({ index: position, values });
      index.set(name, entries);
    });
  };
  /** 匿名的类表达式按它赋给的变量取名（`const Store = class { … }`）。 */
  const assignedClassNames = new WeakMap<AstNode, string>();
  const visit = (node: AstNode, className: string | undefined): void => {
    let currentClass = className;
    const type = node.type;
    if (type === "ClassDeclaration" || type === "ClassExpression") {
      currentClass = nameOf(node.identifier) ?? assignedClassNames.get(node);
    } else if (type === "FunctionDeclaration") {
      add(nameOf(node.identifier), node.params);
    } else if (type === "VariableDeclarator") {
      const init = unwrap(node.init);
      const name = nameOf(node.id);
      if (FUNCTION_EXPRESSIONS.has(nodeType(init) ?? "")) add(name, (init as AstNode).params);
      if (nodeType(init) === "ClassExpression" && name !== undefined)
        assignedClassNames.set(init as AstNode, name);
    } else if (type === "ClassMethod" || type === "PrivateMethod") {
      add(nameOf(node.key), (node.function as AstNode).params);
    } else if (type === "MethodProperty") {
      add(nameOf(node.key), node.params);
    } else if (type === "Constructor") {
      add(className, node.params);
    } else if (type === "ClassProperty") {
      const value = unwrap(node.value);
      if (FUNCTION_EXPRESSIONS.has(nodeType(value) ?? ""))
        add(nameOf(node.key), (value as AstNode).params);
    }
    for (const [, child] of children(node)) visit(child, currentClass);
  };
  visit(module, undefined);
}

/** 栈里第 `from` 层之上最近的类名。 */
function classNameOf(stack: readonly Frame[], from: number): string {
  for (let index = from; index >= 0; index -= 1) {
    const { node } = stack[index] as Frame;
    if (node.type === "ClassDeclaration" || node.type === "ClassExpression") {
      const own = nameOf(node.identifier);
      if (own !== undefined) return own;
      const parent = stack[index - 1]?.node;
      return parent?.type === "VariableDeclarator" ? (nameOf(parent.id) ?? "<class>") : "<class>";
    }
  }
  return "<class>";
}

/** 第 `index` 层是对象字面量的一个属性时，对象直接赋给的变量名加一个点；否则为空。 */
function objectOwner(stack: readonly Frame[], index: number): string {
  const object = stack[index - 1];
  const declarator = stack[index - 2]?.node;
  if (object?.node.type !== "ObjectExpression" || object.field !== "init") return "";
  const owner = declarator?.type === "VariableDeclarator" ? nameOf(declarator.id) : undefined;
  return owner === undefined ? "" : `${owner}.`;
}

/** 第 `index` 层若是一个具名函数、方法或类，返回它在键里的名字。 */
function scopeName(stack: readonly Frame[], index: number): string | undefined {
  const { node, field } = stack[index] as Frame;
  const parent = stack[index - 1]?.node;
  switch (node.type) {
    case "FunctionDeclaration":
      return nameOf(node.identifier);
    case "ClassMethod":
    case "PrivateMethod":
    case "Constructor":
      return `${classNameOf(stack, index - 1)}.${nameOf(node.key) ?? "<method>"}`;
    case "MethodProperty":
    case "GetterProperty":
    case "SetterProperty":
      return `${objectOwner(stack, index)}${nameOf(node.key) ?? "<method>"}`;
    case "ClassDeclaration":
    case "ClassExpression":
      return classNameOf(stack, index);
    case "FunctionExpression":
    case "ArrowFunctionExpression": {
      const own = nameOf(node.identifier);
      if (own !== undefined) return own;
      if (parent?.type === "VariableDeclarator" && field === "init") return nameOf(parent.id);
      if (
        (parent?.type === "ClassProperty" || parent?.type === "PrivateProperty") &&
        field === "value"
      ) {
        return `${classNameOf(stack, index - 1)}.${nameOf(parent.key) ?? "<property>"}`;
      }
      if (parent?.type === "KeyValueProperty" && field === "value") {
        return `${objectOwner(stack, index - 1)}${nameOf(parent.key) ?? "<property>"}`;
      }
      return undefined;
    }
    default:
      return undefined;
  }
}

/**
 * 栈顶所在的函数：从外到内的具名函数、方法或类，用 `>` 连起来（匿名回调算进外层），顶层是 `<module>`。
 * 类只在它里面没有更内层的名字时出现（类字段）：方法的名字已经带着类名。
 */
function scopeOf(stack: readonly Frame[]): string {
  const names: string[] = [];
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    const name = scopeName(stack, index);
    if (name === undefined) continue;
    const type = (stack[index] as Frame).node.type;
    if ((type === "ClassDeclaration" || type === "ClassExpression") && names.length > 0) continue;
    names.unshift(name);
  }
  return names.length === 0 ? "<module>" : names.join(">");
}

/** 从第 `from` 层往上找它的去处（见文件头）。 */
function contextOf(stack: readonly Frame[], from: number): string {
  for (let index = from; index > 0; index -= 1) {
    const { field } = stack[index] as Frame;
    const parent = (stack[index - 1] as Frame).node;
    switch (parent.type) {
      case "CallExpression":
        // `Object.freeze(...)` 只冻结、不消费，去处在它外面。
        if (field === "arguments" && render(parent.callee) !== "Object.freeze") {
          return `call ${calleeName(parent.callee) ?? render(parent.callee)}`;
        }
        break;
      case "NewExpression":
        if (field === "arguments")
          return `new ${calleeName(parent.callee) ?? render(parent.callee)}`;
        break;
      case "VariableDeclarator":
        if (field === "init") return `const ${nameOf(parent.id) ?? "<pattern>"}`;
        break;
      case "ReturnStatement":
        return "return";
      case "ArrowFunctionExpression":
        if (field === "body") return "return";
        break;
      case "AssignmentExpression":
        if (field === "right") return `assign ${render(parent.left)}`;
        break;
      case "AssignmentPattern":
        if (field === "right") return `default ${nameOf(parent.left) ?? "<pattern>"}`;
        break;
      case "AssignmentPatternProperty":
        if (field === "value") return `default ${nameOf(parent.key) ?? "<pattern>"}`;
        break;
      case "ClassProperty":
      case "PrivateProperty":
        if (field === "value") return `property ${nameOf(parent.key) ?? "<property>"}`;
        break;
      default:
        break;
    }
    const type = parent.type ?? "";
    if (CONTEXT_BOUNDARIES.has(type) || type.endsWith("Statement")) return "expression";
  }
  return "expression";
}

/** 栈顶的字面量是否在值位置上（第 6 条）：跳过包装与计算键之后看它的父节点与字段。 */
function inValuePosition(stack: readonly Frame[]): boolean {
  let index = stack.length - 1;
  while (index > 0 && WRAPPERS.has((stack[index - 1] as Frame).node.type ?? "")) index -= 1;
  if (index > 0 && (stack[index - 1] as Frame).node.type === "Computed") index -= 1;
  if (index === 0) return true;
  const { field } = stack[index] as Frame;
  const parent = (stack[index - 1] as Frame).node;
  if (parent.type === "BinaryExpression" && EQUALITY_OPERATORS.has(String(parent.operator))) {
    return false;
  }
  if (parent.type === "SwitchCase" && field === "test") return false;
  if (parent.type === "MemberExpression" && field === "property") return false;
  return field !== "key";
}

interface ScanResult {
  /** 降档字面量节点到它的调用点（每个节点只记一次）。 */
  readonly downgrades: Map<AstNode, SiteKey>;
  /** 取非字面量值的去处（含原语内部，比对时再滤掉）。 */
  readonly forwarded: SiteKey[];
}

function returnLiterals(body: unknown, found: AstNode[] = []): AstNode[] {
  if (!isNode(body)) return found;
  if (body.type === "ReturnStatement") return valueLiterals(body.argument, found);
  for (const [, child] of children(body)) returnLiterals(child, found);
  return found;
}

/** 扫描一个模块时各条规则共用的：祖先栈、参数位置表、记降档与记转发。 */
interface ModuleScan {
  readonly file: string;
  readonly stack: readonly Frame[];
  readonly parameters: ParameterIndex;
  /** 栈顶节点的去处。 */
  context(): string;
  record(literals: readonly AstNode[], values: ReadonlySet<string>, context: string): void;
  forward(context: string, expression: unknown): void;
}

type SiteRule = (node: AstNode, scan: ModuleScan) => void;

/** 一个去处收到的表达式：字面量部分按降档记，整体不是字面量就记一次转发。 */
function receive(scan: ModuleScan, expression: unknown, context: string): void {
  scan.record(valueLiterals(expression), DURABILITY_VALUES, context);
  if (literalValue(unwrap(expression)) === undefined) scan.forward(context, expression);
}

/** 第 2 条：名为 durability / parentEntry 的参数或解构属性的缺省值。 */
function defaultValueRule(scan: ModuleScan, name: string | undefined, fallback: unknown): void {
  const values = DOWNGRADE_PARAMETERS.get(name ?? "");
  if (values !== undefined) scan.record(valueLiterals(fallback), values, `default ${name}`);
}

/** 第 3 条：名字含 durability 的函数或方法的返回值。 */
function namedFunctionRule(scan: ModuleScan, name: string | undefined, body: unknown): void {
  if (/durability/iu.test(name ?? "")) {
    scan.record(returnLiterals(body), DURABILITY_VALUES, "return");
  }
}

/** 简写属性 `{ durability }` 是一次转发。 */
function shorthandRule(node: AstNode, scan: ModuleScan): void {
  const frame = scan.stack[scan.stack.length - 1];
  const parent = scan.stack[scan.stack.length - 2]?.node;
  if (node.value === "durability" && parent?.type === "ObjectExpression") {
    if (frame?.field === "properties") scan.forward(scan.context(), node);
  }
}

/** 第 2 条的类字段：名为 durability 的类字段的初始值。 */
function classPropertyRule(node: AstNode, scan: ModuleScan): void {
  if (nameOf(node.key) === "durability" && isNode(node.value)) {
    receive(scan, node.value, "property durability");
  }
}

/** 第 4 条：对名字含 durability 的标识符或成员的赋值；恰好名为 durability 且值不是字面量时是转发。 */
function assignmentRule(node: AstNode, scan: ModuleScan): void {
  const target = node.left as AstNode;
  const name = target.type === "MemberExpression" ? nameOf(target.property) : nameOf(target);
  if (!/durability/iu.test(name ?? "")) return;
  const context = `assign ${render(target)}`;
  scan.record(valueLiterals(node.right), DURABILITY_VALUES, context);
  if (name === "durability" && literalValue(unwrap(node.right)) === undefined) {
    scan.forward(context, node.right);
  }
}

/** 第 5 条：降档参数位上的实参；字面量是降档，非字面量是转发。 */
function callRule(node: AstNode, scan: ModuleScan): void {
  const callee = calleeName(node.callee);
  const args = (node.arguments ?? []) as AstNode[];
  const context = `${node.type === "NewExpression" ? "new" : "call"} ${callee}`;
  for (const { index, values } of scan.parameters.get(callee ?? "") ?? []) {
    const argument = args[index];
    if (argument === undefined || isNode(argument.spread)) continue;
    const expression = unwrap(argument.expression);
    if (literalValue(expression) !== undefined) {
      scan.record([expression as AstNode], values, context);
    } else {
      scan.forward(context, argument.expression);
    }
  }
}

/** 第 6 条：原语目录里值位置上的每一个降档取值。 */
function primitiveLiteralRule(node: AstNode, scan: ModuleScan): void {
  if (
    scan.file.startsWith(PRIMITIVES_DIRECTORY) &&
    PRIMITIVE_VALUES.has(literalValue(node) ?? "") &&
    inValuePosition(scan.stack)
  ) {
    scan.record([node], PRIMITIVE_VALUES, scan.context());
  }
}

/** 按节点类型分派的规则（编号见文件头）。 */
const SITE_RULES: ReadonlyMap<string, SiteRule> = new Map<string, SiteRule>([
  [
    "KeyValueProperty",
    (node, scan) => {
      if (nameOf(node.key) === "durability") receive(scan, node.value, scan.context());
    },
  ],
  ["Identifier", shorthandRule],
  ["ClassProperty", classPropertyRule],
  ["PrivateProperty", classPropertyRule],
  ["AssignmentPattern", (node, scan) => defaultValueRule(scan, nameOf(node.left), node.right)],
  [
    "AssignmentPatternProperty",
    (node, scan) => defaultValueRule(scan, nameOf(node.key), node.value),
  ],
  [
    "VariableDeclarator",
    (node, scan) => {
      const name = nameOf(node.id) ?? "";
      if (/durability/iu.test(name)) {
        scan.record(valueLiterals(node.init), DURABILITY_VALUES, `const ${name}`);
      }
    },
  ],
  ["AssignmentExpression", assignmentRule],
  [
    "BinaryExpression",
    (node, scan) => {
      if (node.operator === "??" && mentionsDurability(node.left)) {
        scan.record(valueLiterals(node.right), DURABILITY_VALUES, scan.context());
      }
    },
  ],
  [
    "FunctionDeclaration",
    (node, scan) => namedFunctionRule(scan, nameOf(node.identifier), node.body),
  ],
  [
    "ClassMethod",
    (node, scan) => namedFunctionRule(scan, nameOf(node.key), (node.function as AstNode).body),
  ],
  ["MethodProperty", (node, scan) => namedFunctionRule(scan, nameOf(node.key), node.body)],
  ["CallExpression", callRule],
  ["NewExpression", callRule],
  ["StringLiteral", primitiveLiteralRule],
  ["TemplateLiteral", primitiveLiteralRule],
]);

function scanModule(file: string, module: AstNode, parameters: ParameterIndex, result: ScanResult) {
  const stack: Frame[] = [];
  const scan: ModuleScan = {
    file,
    stack,
    parameters,
    context: () => contextOf(stack, stack.length - 1),
    record: (literals, values, context) => {
      for (const literal of literals) {
        const value = literalValue(literal);
        if (value === undefined || !values.has(value) || result.downgrades.has(literal)) continue;
        result.downgrades.set(literal, { file, scope: scopeOf(stack), context, value });
      }
    },
    forward: (context, expression) => {
      result.forwarded.push({ file, scope: scopeOf(stack), context, value: render(expression) });
    },
  };
  const visit = (node: AstNode, field: string): void => {
    stack.push({ node, field });
    SITE_RULES.get(node.type ?? "")?.(node, scan);
    for (const [childField, child] of children(node)) visit(child, childField);
    stack.pop();
  };
  visit(module, "");
}

function parseSource(file: string, text: string): AstNode {
  const options = file.endsWith(".mjs")
    ? ({ syntax: "ecmascript" } as const)
    : ({ syntax: "typescript" } as const);
  return parseSync(text, { ...options, target: "es2024" }) as unknown as AstNode;
}

/** 解析过的语法树，按文件缓存；一次仓库扫描里的各项检查共用一份。 */
type ParseCache = Map<string, AstNode>;

function parseCached(cache: ParseCache, file: string, text: string): AstNode {
  const cached = cache.get(file) ?? parseSource(file, text);
  cache.set(file, cached);
  return cached;
}

/** 扫描一组（相对路径，源码）；两遍：先收集降档参数的位置，再找调用点。 */
function scanSources(
  sources: ReadonlyMap<string, string>,
  cache: ParseCache = new Map(),
): ScanResult {
  // 只解析可能含降档点的文件：原语目录全解析；其余文件里每条规则都要求文本出现参数名或某个有降档
  // 参数的函数名。这只省解析时间，不改结果：第 3、4 条按名字里含 durability（不分大小写）匹配，所以
  // 第二遍的预筛选也不分大小写；第一遍找的是恰好叫这两个名字的参数，区分大小写。
  const parameterNames = [...DOWNGRADE_PARAMETERS.keys()];
  const parameters: ParameterIndex = new Map();
  for (const [file, text] of sources) {
    if (parameterNames.some((name) => text.includes(name))) {
      collectParameterPositions(parseCached(cache, file, text), parameters);
    }
  }
  const names = [...parameterNames, ...parameters.keys()].map((name) => name.toLowerCase());
  const result: ScanResult = { downgrades: new Map(), forwarded: [] };
  for (const [file, text] of sources) {
    const lowered = text.toLowerCase();
    if (file.startsWith(PRIMITIVES_DIRECTORY) || names.some((name) => lowered.includes(name))) {
      scanModule(file, parseCached(cache, file, text), parameters, result);
    }
  }
  return result;
}

function siteKey(site: SiteKey): string {
  return `${site.file} | ${site.scope} | ${site.context} | ${site.value}`;
}

function countedKeys(sites: Iterable<SiteKey>): string[] {
  const counts = new Map<string, number>();
  for (const site of sites) counts.set(siteKey(site), (counts.get(siteKey(site)) ?? 0) + 1);
  return [...counts].map(([key, count]) => `${key} | ${count}`).sort();
}

function downgradeKeys(result: ScanResult): string[] {
  return countedKeys(result.downgrades.values());
}

function exempted(site: SiteKey, exemption: ForwardingExemption): boolean {
  return site.context === `call ${exemption.callee}` && site.value === exemption.argument;
}

/** 原语之外、不在豁免表里的转发点。 */
function forwardedKeys(
  result: ScanResult,
  exemptions: readonly ForwardingExemption[] = FORWARDING_EXEMPTIONS,
): string[] {
  return countedKeys(
    result.forwarded.filter(
      (site) =>
        !site.file.startsWith(PRIMITIVES_DIRECTORY) &&
        !exemptions.some((exemption) => exempted(site, exemption)),
    ),
  );
}

function rowKeys(rows: readonly (SiteKey & { readonly count: number })[]): string[] {
  return rows.map((row) => `${siteKey(row)} | ${row.count}`).sort();
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(?:ts|mjs)$/u.test(entry.name) && !entry.name.endsWith(".d.ts") ? [full] : [];
  });
}

interface RepositoryScan {
  readonly sources: Map<string, string>;
  readonly cache: ParseCache;
  readonly result: ScanResult;
}

let repositoryScan: RepositoryScan | undefined;

function scanRepository(): RepositoryScan {
  if (repositoryScan !== undefined) return repositoryScan;
  const sources = new Map<string, string>();
  for (const file of sourceFiles(path.join(REPOSITORY_ROOT, "src"))) {
    const relative = path.relative(REPOSITORY_ROOT, file).split(path.sep).join("/");
    sources.set(relative, readFileSync(file, "utf8"));
  }
  const cache: ParseCache = new Map();
  repositoryScan = { sources, cache, result: scanSources(sources, cache) };
  return repositoryScan;
}

/** 相对模块说明符在 `src/` 里指向的文件（`.js` 换回源码的 `.ts`）；包名与 `node:` 模块为 undefined。 */
function resolveSpecifier(importer: string, specifier: unknown): string | undefined {
  if (typeof specifier !== "string" || !specifier.startsWith(".")) return undefined;
  return path.posix
    .normalize(path.posix.join(path.posix.dirname(importer), specifier))
    .replace(/\.js$/u, ".ts");
}

/** 一个文件是否导入（或转出）定义模块里的 `name`（见文件头的导入守卫）。 */
function importsName(file: string, module: AstNode, name: string, definingModule: string): boolean {
  const fromDefining = (source: unknown) =>
    resolveSpecifier(file, nameOf(source)) === definingModule;
  let found = false;
  const visit = (node: AstNode): void => {
    if (found) return;
    if (node.type === "ImportDeclaration" && fromDefining(node.source)) {
      found = ((node.specifiers ?? []) as AstNode[]).some(
        (specifier) =>
          specifier.type === "ImportNamespaceSpecifier" ||
          nameOf(specifier.imported ?? specifier.local) === name,
      );
    } else if (node.type === "ExportNamedDeclaration" && fromDefining(node.source)) {
      found = ((node.specifiers ?? []) as AstNode[]).some(
        (specifier) =>
          specifier.type === "ExportNamespaceSpecifier" || nameOf(specifier.orig) === name,
      );
    } else if (node.type === "ExportAllDeclaration" && fromDefining(node.source)) {
      found = true;
    } else if (node.type === "CallExpression" && nodeType(node.callee) === "Import") {
      const argument = unwrap((node.arguments as AstNode[])[0]?.expression);
      const target = literalValue(argument);
      found = target === undefined || resolveSpecifier(file, target) === definingModule;
    }
    for (const [, child] of children(node)) visit(child);
  };
  visit(module);
  return found;
}

/** 导入（或转出）`name` 的文件，定义模块自己除外。 */
function importersOf(
  name: string,
  definingModule: string,
  sources: ReadonlyMap<string, string>,
  cache: ParseCache = new Map(),
): string[] {
  const basename = path.posix.basename(definingModule, ".ts");
  const importers: string[] = [];
  for (const [file, text] of sources) {
    if (file === definingModule) continue;
    if (!text.includes(basename) && !text.includes("import(")) continue;
    if (importsName(file, parseCached(cache, file, text), name, definingModule)) {
      importers.push(file);
    }
  }
  return importers.sort();
}

/**
 * 获准导入的那个模块把目录树原语交出去的写法（`primitives`：原语的名字到它的定义模块）。它只许直接调用
 * 它们：绑定到原语的本地名字（具名导入，含改名）每一次出现都必须是调用的被调者；整模块的命名空间导入只许
 * 作成员访问的对象，访问到原语时必须当场调用；从定义模块带来源的转出（`export { name } from`、
 * `export * from`、`export * as ns from`）一律不许。别的写法——转出、赋给变量、放进对象、当实参——都会让
 * 别的模块绕过导入守卫拿到它。
 */
function handedOnBy(
  file: string,
  module: AstNode,
  primitives: ReadonlyMap<string, string>,
): string[] {
  const found: string[] = [];
  const definingModules = new Set(primitives.values());
  const fromDefining = (source: unknown): string | undefined => {
    const resolved = resolveSpecifier(file, nameOf(source));
    return resolved !== undefined && definingModules.has(resolved) ? resolved : undefined;
  };
  const locals = new Set<string>();
  const namespaces = new Set<string>();
  for (const item of (module.body ?? []) as AstNode[]) {
    const defining = fromDefining(item.source);
    if (defining === undefined) continue;
    for (const specifier of (item.specifiers ?? []) as AstNode[]) {
      const original = nameOf(specifier.imported ?? specifier.orig ?? specifier.local);
      const handled = original !== undefined && primitives.get(original) === defining;
      if (item.type === "ImportDeclaration") {
        const local = nameOf(specifier.local);
        if (local === undefined) continue;
        if (specifier.type === "ImportNamespaceSpecifier") namespaces.add(local);
        else if (handled) locals.add(local);
      } else if (specifier.type === "ExportNamespaceSpecifier") {
        found.push("export * as … from the defining module");
      } else if (handled) {
        found.push(`export { ${original} } from the defining module`);
      }
    }
    if (item.type === "ExportAllDeclaration") found.push("export * from the defining module");
  }
  const visit = (node: AstNode, parent: AstNode | undefined, field: string): void => {
    if (node.type === "ImportDeclaration") return;
    const name = node.type === "Identifier" ? nameOf(node) : undefined;
    const key = field === "key" || (parent?.type === "MemberExpression" && field === "property");
    if (name !== undefined && !key) {
      const called = parent?.type === "CallExpression" && field === "callee";
      if (locals.has(name) && !called) {
        found.push(`${name} outside a direct call (${parent?.type ?? "module"})`);
      }
      if (namespaces.has(name) && !(parent?.type === "MemberExpression" && field === "object")) {
        found.push(`namespace ${name} outside a member access (${parent?.type ?? "module"})`);
      }
    }
    if (node.type === "MemberExpression" && namespaces.has(nameOf(node.object) ?? "")) {
      const member = nameOf(node.property);
      const called = parent?.type === "CallExpression" && field === "callee";
      if (member !== undefined && primitives.has(member) && !called) {
        found.push(`${member} read from a namespace without calling it`);
      }
    }
    for (const [childField, child] of children(node)) visit(child, node, childField);
  };
  visit(module, undefined, "");
  return found;
}

test("the scan reads syntax: strings with comment markers, conditionals, type positions and comparisons", () => {
  const sources = new Map([
    [
      "src/sample/a.ts",
      [
        "export function writeAll(flag: boolean, durability: string) {",
        '  const marker = "/*";',
        '  write({ durability: "none" });',
        '  const tail = "*/";',
        '  write({ "durability": "none" });',
        '  write({ durability: flag ? "content-only" : "fsync" });',
        '  write({ durability: options.durability ?? "none" });',
        '  write({ durability: "content-only" as const });',
        "  write({ durability });",
        "  write({ durability: root.durability });",
        '  if (durability === "none") write({ durability: "fsync" });',
        '  // write({ durability: "none" });',
        '  const label = { none: "none" };',
        "}",
        'type Union = { durability: "none" | "fsync" };',
        'interface Options { readonly durability?: "none" }',
      ].join("\n"),
    ],
    ["src/sample/b.mjs", 'export const lock = { durability: "none" };\n'],
  ]);
  const result = scanSources(sources);
  deepEqual(downgradeKeys(result), [
    "src/sample/a.ts | writeAll | call write | content-only | 2",
    "src/sample/a.ts | writeAll | call write | none | 3",
    "src/sample/b.mjs | <module> | const lock | none | 1",
  ]);
  // 非字面量：条件、`??`、简写与 root.durability 四处（`as const` 的字面量不算转发）。
  deepEqual(forwardedKeys(result), [
    "src/sample/a.ts | writeAll | call write | durability | 1",
    'src/sample/a.ts | writeAll | call write | flag ? "content-only" : "fsync" | 1',
    'src/sample/a.ts | writeAll | call write | options.durability ?? "none" | 1',
    "src/sample/a.ts | writeAll | call write | root.durability | 1",
  ]);
});

test("each rule records its call site: defaults, class fields, assignments, computed keys, names, positions", () => {
  const sources = new Map([
    [
      "src/sample/rules.ts",
      [
        'function remove(path: string, durability: "fsync" | "none" = "none") {}',
        'function create(path: string, parentEntry: "sync" | "deferred") {}',
        "class Store {",
        '  durability = "content-only";',
        '  constructor(readonly durability: "fsync" | "none" = "none") {}',
        '  reopen() { this.durability = "none"; }',
        '  defaultDurability() { return "content-only"; }',
        "}",
        "class Opener {",
        '  constructor(path: string, durability: "fsync" | "none") {}',
        "}",
        "export function writeAll(flag: boolean, options: Options) {",
        '  create("y", "deferred");',
        '  create("z", "sync");',
        '  remove("x", "none");',
        '  new Opener("p", "none");',
        '  const { durability = "content-only" } = options;',
        '  const lockDurability = flag ? "content-only" : "fsync";',
        '  options.durability = "content-only";',
        '  options["durability"] ??= "none";',
        '  write({ ["durability"]: `none` });',
        '  const parsed = record.durability ?? "content-only";',
        '  let level = "fsync";',
        "  let lockDurabilityLevel = level;",
        '  lockDurabilityLevel = "none";',
        "}",
        'function lockDurabilityOf(kind: string) { return kind === "board" ? "content-only" : "fsync"; }',
      ].join("\n"),
    ],
  ]);
  deepEqual(downgradeKeys(scanSources(sources)), [
    "src/sample/rules.ts | Store | property durability | content-only | 1",
    "src/sample/rules.ts | Store.constructor | default durability | none | 1",
    "src/sample/rules.ts | Store.defaultDurability | return | content-only | 1",
    "src/sample/rules.ts | Store.reopen | assign this.durability | none | 1",
    "src/sample/rules.ts | lockDurabilityOf | return | content-only | 1",
    "src/sample/rules.ts | remove | default durability | none | 1",
    "src/sample/rules.ts | writeAll | assign lockDurabilityLevel | none | 1",
    "src/sample/rules.ts | writeAll | assign options.durability | content-only | 1",
    'src/sample/rules.ts | writeAll | assign options["durability"] | none | 1',
    "src/sample/rules.ts | writeAll | call create | deferred | 1",
    "src/sample/rules.ts | writeAll | call remove | none | 1",
    "src/sample/rules.ts | writeAll | call write | none | 1",
    "src/sample/rules.ts | writeAll | const lockDurability | content-only | 1",
    "src/sample/rules.ts | writeAll | const parsed | content-only | 1",
    "src/sample/rules.ts | writeAll | default durability | content-only | 1",
    "src/sample/rules.ts | writeAll | new Opener | none | 1",
  ]);
});

test("a file that spells durability only in capitals is still scanned", () => {
  const text = [
    'export const LOCK_DURABILITY = "content-only";',
    'export function lockDurabilityFor() { return "none"; }',
    'export function relax(options: Options) { options.lockDurability = "none"; }',
  ].join("\n");
  deepEqual(text.includes("durability"), false);
  deepEqual(downgradeKeys(scanSources(new Map([["src/kernel/levels.ts", text]]))), [
    "src/kernel/levels.ts | <module> | const LOCK_DURABILITY | content-only | 1",
    "src/kernel/levels.ts | lockDurabilityFor | return | none | 1",
    "src/kernel/levels.ts | relax | assign options.lockDurability | none | 1",
  ]);
});

test("a class expression's constructor is indexed by the variable it is assigned to", () => {
  const text = [
    'const Store = class { constructor(root: Root, durability: "fsync" | "none") {} };',
    'export function open(root: Root) { return new Store(root, "none"); }',
  ].join("\n");
  deepEqual(downgradeKeys(scanSources(new Map([["src/kernel/store.ts", text]]))), [
    "src/kernel/store.ts | open | new Store | none | 1",
  ]);
});

test("nested named scopes are qualified by the scopes around them", () => {
  const scan = (body: readonly string[]) =>
    downgradeKeys(scanSources(new Map([["src/sample/nested.ts", body.join("\n")]])));
  const inFirst = scan([
    'function a() { const run = () => unlinkRegularFileExactly(r, x, { durability: "none" }); }',
    "function b() { const run = () => unlinkRegularFileExactly(r, y, {}); }",
    "const hot = { retire() { return unlinkRegularFileExactly(r, z, {}); } };",
    "const cold = { retire() { return unlinkRegularFileExactly(r, z, {}); } };",
  ]);
  const inSecond = scan([
    "function a() { const run = () => unlinkRegularFileExactly(r, x, {}); }",
    'function b() { const run = () => unlinkRegularFileExactly(r, y, { durability: "none" }); }',
    "const hot = { retire() { return unlinkRegularFileExactly(r, z, {}); } };",
    "const cold = { retire() { return unlinkRegularFileExactly(r, z, {}); } };",
  ]);
  const inObject = scan([
    "function a() { const run = () => unlinkRegularFileExactly(r, x, {}); }",
    "function b() { const run = () => unlinkRegularFileExactly(r, y, {}); }",
    'const hot = { retire() { return unlinkRegularFileExactly(r, z, { durability: "none" }); } };',
    "const cold = { retire() { return unlinkRegularFileExactly(r, z, {}); } };",
  ]);
  const inOtherObject = scan([
    "function a() { const run = () => unlinkRegularFileExactly(r, x, {}); }",
    "function b() { const run = () => unlinkRegularFileExactly(r, y, {}); }",
    "const hot = { retire() { return unlinkRegularFileExactly(r, z, {}); } };",
    'const cold = { retire() { return unlinkRegularFileExactly(r, z, { durability: "none" }); } };',
  ]);
  deepEqual(inFirst, ["src/sample/nested.ts | a>run | call unlinkRegularFileExactly | none | 1"]);
  deepEqual(inSecond, ["src/sample/nested.ts | b>run | call unlinkRegularFileExactly | none | 1"]);
  deepEqual(inObject, [
    "src/sample/nested.ts | hot.retire | call unlinkRegularFileExactly | none | 1",
  ]);
  deepEqual(inOtherObject, [
    "src/sample/nested.ts | cold.retire | call unlinkRegularFileExactly | none | 1",
  ]);
});

test("moving a downgrade inside one file from one call or function to another changes its key", () => {
  const scan = (body: readonly string[]) =>
    downgradeKeys(scanSources(new Map([["src/sample/move.ts", body.join("\n")]])));
  const before = scan([
    "export async function publish(root: Root) {",
    '  await createFileAtomically(root, page, bytes, { durability: "content-only" });',
    "  await replaceFileAtomically(root, index, bytes, {});",
    "}",
    "export async function retire(root: Root) { await unlinkRegularFileExactly(root, lock, {}); }",
  ]);
  const movedCall = scan([
    "export async function publish(root: Root) {",
    "  await createFileAtomically(root, page, bytes, {});",
    '  await replaceFileAtomically(root, index, bytes, { durability: "content-only" });',
    "}",
    "export async function retire(root: Root) { await unlinkRegularFileExactly(root, lock, {}); }",
  ]);
  const movedFunction = scan([
    "export async function publish(root: Root) {",
    "  await createFileAtomically(root, page, bytes, {});",
    "  await replaceFileAtomically(root, index, bytes, {});",
    "}",
    "export async function retire(root: Root) {",
    '  await createFileAtomically(root, page, bytes, { durability: "content-only" });',
    "}",
  ]);
  deepEqual(before, [
    "src/sample/move.ts | publish | call createFileAtomically | content-only | 1",
  ]);
  notDeepEqual(movedCall, before);
  notDeepEqual(movedFunction, before);
});

test("inside the filesystem primitives every none, content-only or deferred value literal is counted", () => {
  const text = [
    "export function openLevel(value: string): string {",
    '  const entry = "deferred" as const;',
    '  if (entry === "deferred") return "fsync";',
    '  const accepted = new Set(["fsync", "none"]);',
    '  if (value === "none" || value !== ("content-only" as const)) return "fsync";',
    '  switch (value) { case "none": break; }',
    '  const table = { none: 1, ["content-only"]: 2 };',
    '  if (table["none"] === 1) return "fsync";',
    '  return accepted.has(value) ? "content-only" : "fsync";',
    "}",
    'type Level = "none" | "content-only";',
  ].join("\n");
  const inside = scanSources(new Map([["src/foundation/filesystem/sample.ts", text]]));
  deepEqual(downgradeKeys(inside), [
    "src/foundation/filesystem/sample.ts | openLevel | const entry | deferred | 1",
    "src/foundation/filesystem/sample.ts | openLevel | new Set | none | 1",
    "src/foundation/filesystem/sample.ts | openLevel | return | content-only | 1",
  ]);
  // 同一段代码放在原语目录之外：没有一个字面量进了 durability 的去处，什么都不算。
  deepEqual(downgradeKeys(scanSources(new Map([["src/kernel/sample.ts", text]]))), []);
});

test("forwarded sites: positional non-literals, assignments, computed keys and the exemption by callee and argument", () => {
  const sources = new Map([
    [
      "src/kernel/shell.ts",
      [
        "export function commandShellExecutionOptions(durability: Level | undefined, signal?: AbortSignal) {",
        "  return { ...(durability === undefined ? {} : { durability }) };",
        "}",
      ].join("\n"),
    ],
    [
      "src/capabilities/sample/service.ts",
      [
        "export function execute(options: Options, root: Root, mode: Level) {",
        "  run(commandShellExecutionOptions(options.durability, options.signal));",
        "  run(commandShellExecutionOptions(root.durability));",
        "  removeEmptyDirectoryExactly(root, target, mode);",
        '  open({ ["durability"]: mode });',
        "  options.durability = mode;",
        "}",
        "class Opened { durability = options.durability; }",
      ].join("\n"),
    ],
    [
      "src/foundation/filesystem/exact-removal.ts",
      [
        'export function removeEmptyDirectoryExactly(root: Root, target: string, durability: Level = "fsync") {',
        "  return inner(root, target, { durability });",
        "}",
      ].join("\n"),
    ],
  ]);
  const result = scanSources(sources);
  deepEqual(forwardedKeys(result), [
    "src/capabilities/sample/service.ts | Opened | property durability | options.durability | 1",
    "src/capabilities/sample/service.ts | execute | assign options.durability | mode | 1",
    "src/capabilities/sample/service.ts | execute | call commandShellExecutionOptions | root.durability | 1",
    "src/capabilities/sample/service.ts | execute | call open | mode | 1",
    "src/capabilities/sample/service.ts | execute | call removeEmptyDirectoryExactly | mode | 1",
    "src/kernel/shell.ts | commandShellExecutionOptions | return | durability | 1",
  ]);
  // 没有豁免时，组合根级别的那一处也出现。
  deepEqual(
    forwardedKeys(result, []).filter((key) => key.includes("call commandShellExecutionOptions")),
    [
      "src/capabilities/sample/service.ts | execute | call commandShellExecutionOptions | options.durability | 1",
      "src/capabilities/sample/service.ts | execute | call commandShellExecutionOptions | root.durability | 1",
    ],
  );
});

test("the importer guard counts named, aliased, namespace, re-exported and dynamic imports", () => {
  const defining = "src/foundation/filesystem/durable-file-candidate.ts";
  const sources = new Map([
    [defining, "export async function createDirectoryTreeMemberFileDurably() {}\n"],
    [
      "src/foundation/filesystem/durable-directory-tree-candidate.ts",
      'import { createDirectoryTreeMemberFileDurably } from "./durable-file-candidate.js";\n',
    ],
    [
      "src/kernel/aliased.ts",
      'import { createDirectoryTreeMemberFileDurably as member } from "../foundation/filesystem/durable-file-candidate.js";\n',
    ],
    [
      "src/kernel/namespace.ts",
      'import * as candidate from "../foundation/filesystem/durable-file-candidate.js";\ncandidate.createDirectoryTreeMemberFileDurably();\n',
    ],
    [
      "src/kernel/reexport.ts",
      'export { createDirectoryTreeMemberFileDurably } from "../foundation/filesystem/durable-file-candidate.js";\n',
    ],
    ["src/kernel/star.ts", 'export * from "../foundation/filesystem/durable-file-candidate.js";\n'],
    [
      "src/kernel/dynamic.ts",
      'export async function load() { return (await import("../foundation/filesystem/durable-file-candidate.js")).createDirectoryTreeMemberFileDurably; }\n',
    ],
    [
      "src/kernel/computed.ts",
      "export async function load(target: string) { return import(target); }\n",
    ],
    [
      "src/kernel/other.ts",
      'import { createFileCandidateDurably } from "../foundation/filesystem/durable-file-candidate.js";\n',
    ],
  ]);
  deepEqual(importersOf("createDirectoryTreeMemberFileDurably", defining, sources), [
    "src/foundation/filesystem/durable-directory-tree-candidate.ts",
    "src/kernel/aliased.ts",
    "src/kernel/computed.ts",
    "src/kernel/dynamic.ts",
    "src/kernel/namespace.ts",
    "src/kernel/reexport.ts",
    "src/kernel/star.ts",
  ]);
});

test("every site in src that asks for less than the default durability is registered by call site", () => {
  deepEqual(downgradeKeys(scanRepository().result), rowKeys(REGISTRY));
});

test("every durability forwarded through a non-literal value outside the filesystem primitives is listed", () => {
  deepEqual(forwardedKeys(scanRepository().result), rowKeys(FORWARDED));
});

test("every forwarding exemption still matches a site in src", () => {
  const { forwarded } = scanRepository().result;
  for (const exemption of FORWARDING_EXEMPTIONS) {
    deepEqual(
      forwarded.some((site) => exempted(site, exemption)),
      true,
      `${exemption.callee}(${exemption.argument})`,
    );
  }
});

test("the importer guard also reads what the allowed importer hands on", () => {
  const defining = "src/foundation/filesystem/durable-file-candidate.ts";
  const primitives = new Map([["createDirectoryTreeMemberFileDurably", defining]]);
  const handsOn = (text: string) =>
    handedOnBy(
      "src/foundation/filesystem/durable-directory-tree-candidate.ts",
      parseSource("src/foundation/filesystem/durable-directory-tree-candidate.ts", text),
      primitives,
    );
  const from = '"./durable-file-candidate.js"';
  const imported = `import { createDirectoryTreeMemberFileDurably } from ${from};\n`;
  const aliased = `import { createDirectoryTreeMemberFileDurably as member } from ${from};\n`;
  const namespace = `import * as candidate from ${from};\n`;
  // 只许直接调用：具名导入、改名导入与命名空间导入各一种合法的写法。
  deepEqual(
    handsOn(
      `${imported}export async function publish() { await createDirectoryTreeMemberFileDurably(); }`,
    ),
    [],
  );
  deepEqual(handsOn(`${aliased}export async function publish() { await member(); }`), []);
  deepEqual(
    handsOn(
      `${namespace}export async function publish() { await candidate.createDirectoryTreeMemberFileDurably(); candidate.other; }`,
    ),
    [],
  );
  // 每一种交出去的写法都被点名。
  const refused = (text: string): boolean => handsOn(text).length > 0;
  deepEqual(
    [
      `${imported}export { createDirectoryTreeMemberFileDurably };`,
      `${imported}export { createDirectoryTreeMemberFileDurably as member };`,
      `${aliased}export { member };`,
      `export { createDirectoryTreeMemberFileDurably } from ${from};`,
      `export * from ${from};`,
      `export * as ns from ${from};`,
      `${imported}export const member = createDirectoryTreeMemberFileDurably;`,
      `${imported}const member = createDirectoryTreeMemberFileDurably;\nexport { member };`,
      `${imported}export const api = { createDirectoryTreeMemberFileDurably };`,
      `${imported}export default { createDirectoryTreeMemberFileDurably };`,
      `${imported}export default createDirectoryTreeMemberFileDurably;`,
      `${imported}register(createDirectoryTreeMemberFileDurably);`,
      `${imported}export const bound = createDirectoryTreeMemberFileDurably.bind(null);`,
      `${namespace}export { candidate };`,
      `${namespace}export const member = candidate.createDirectoryTreeMemberFileDurably;`,
      `${namespace}register(candidate);`,
    ].map(refused),
    Array.from({ length: 16 }, () => true),
  );
  deepEqual(handsOn(`${imported}export { createDirectoryTreeMemberFileDurably };`), [
    "createDirectoryTreeMemberFileDurably outside a direct call (ExportSpecifier)",
  ]);
});

test("the two tree primitives that defer parent-entry syncs are imported only by the tree candidate", () => {
  const { sources, cache } = scanRepository();
  const primitives = [
    [
      "createTreeCandidateDirectoryAtomically",
      "src/foundation/filesystem/durable-directory-materialization.ts",
    ],
    ["createDirectoryTreeMemberFileDurably", "src/foundation/filesystem/durable-file-candidate.ts"],
  ] as const;
  for (const [name, definingModule] of primitives) {
    deepEqual(importersOf(name, definingModule, sources, cache), [TREE_CANDIDATE_MODULE], name);
  }
  // 获准导入的那个模块只许直接调用它们，不把它们再交出去。
  const candidate = parseCached(
    cache,
    TREE_CANDIDATE_MODULE,
    sources.get(TREE_CANDIDATE_MODULE) ?? "",
  );
  deepEqual(handedOnBy(TREE_CANDIDATE_MODULE, candidate, new Map(primitives)), []);
});

test("each registered row names its class and a reason, and no two rows share a call site", () => {
  const classes: readonly DowngradeClass[] = [
    "现状不变（1.4.1 之前）",
    "权威（追加）的组成",
    "权威（目录树发布）的组成",
  ];
  for (const row of REGISTRY) {
    deepEqual([classes.includes(row.kind), row.reason.length > 0], [true, true], siteKey(row));
  }
  for (const row of [...FORWARDED, ...FORWARDING_EXEMPTIONS]) {
    deepEqual(row.reason.length > 0, true, JSON.stringify(row));
  }
  for (const rows of [REGISTRY, FORWARDED]) {
    const keys = rows.map(siteKey);
    deepEqual(new Set(keys).size, keys.length);
  }
});
