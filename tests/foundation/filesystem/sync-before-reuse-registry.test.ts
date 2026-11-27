import { deepEqual, equal } from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { parseSync } from "@swc/core";

/**
 * Level 0 (pure): "沿用之前先落盘"的调用点登记表（1.4.1 段 1b，清单第 4 节）。
 *
 * 级别说明：与同目录的降档登记表一样，本文件只读取仓库里 `src/` 的源码文本并在内存里解析，不打开
 * 任何根、不写盘、不起子进程。
 *
 * 规则：变更路径决定沿用一个不是它这一次亲手做成的目录项结果，并且接下来要做不可逆的事时，先调用
 * `settleObservedResourceEntry`（见它的文件头）。这条规则靠人记不住，所以两张表：
 *
 * 1. 第一张列出 `src/` 里每一处对它的调用，键是文件与所在函数（最近的具名函数），值是次数。多一处、
 *    少一处、换了函数，本测试都失败——新增一处沿用要么在这里登记，要么说明它为什么不在第二张表里。
 * 2. 第二张是"看过、决定不补同步"的沿用分支：每一行写明为什么可以不补、登记在哪里。它只在所列的函数
 *    不见了的时候失败，提醒改动的人把这一行的理由重新看一遍。
 *
 * 调用按导入绑定来认：按别名导入的照样算在所在的函数名下。除了直接调用之外的任何引用——存进变量、
 * `.call`、当参数传走、再导出、命名空间导入——都让本测试失败：那样的转手会让第一张表数不到调用点。
 *
 * 看不见的：没有登记在第二张表里、也没有调用这个原语的沿用分支——那需要评审者自己看。
 */

const REPOSITORY_ROOT = process.cwd();
const SETTLE = "settleObservedResourceEntry";

interface SettleSite {
  readonly file: string;
  readonly scope: string;
  readonly count: number;
  /** 沿用的是什么，后面跟着的不可逆操作是什么。 */
  readonly reason: string;
}

const ARCHIVE = "src/capabilities/demand/archive.ts";
const LIFECYCLE = "src/capabilities/demand/lifecycle.ts";
const PUBLICATION =
  "src/governance/demand/publication/demand-event-sourcing-publication-service.ts";
const TREE_RETIREMENT = "src/foundation/filesystem/durable-directory-tree-candidate-retirement.ts";

const SETTLE_SITES: readonly SettleSite[] = [
  {
    file: ARCHIVE,
    scope: "settleRetiredDemandRoot",
    count: 1,
    reason: "Demand 根的名字已经不在（上一次退役改了名或删完了）；之后删生命周期日志。",
  },
  {
    file: ARCHIVE,
    scope: "settleSealedArchive",
    count: 2,
    reason: "归档包已经在：`archives/<id>` 与修订号目录两级名字；之后删活动根、删日志。",
  },
  {
    file: ARCHIVE,
    scope: "sealDemandArchive",
    count: 1,
    reason: "`archives/<id>` 不是这一次建的；之后往里放归档，再删活动根。",
  },
  {
    file: ARCHIVE,
    scope: "materializeRebuildableDirectories",
    count: 1,
    reason: "续接放回的根里已经在的可重建目录；之后删日志。",
  },
  {
    file: ARCHIVE,
    scope: "restoreDemandRoot",
    count: 1,
    reason: "活动根已经放回原位；之后追加续接事件、删日志。",
  },
  {
    file: LIFECYCLE,
    scope: "settleReusedClaimState",
    count: 1,
    reason: "认领状态已经是要的样子；之后删活动根（完成、取消）或删日志（续接）。",
  },
  {
    file: PUBLICATION,
    scope: "settleReusedDemandRoot",
    count: 2,
    reason: "Demand 根已经改名到最终位置：旧名字不在、新名字在；之后认领需求包、删发布标记。",
  },
  {
    file: TREE_RETIREMENT,
    scope: "settleAbsentCandidate",
    count: 1,
    reason: "候选树的根已经不在；之后调用方删它的事务文件。",
  },
];

interface UnsettledReuse {
  readonly file: string;
  readonly scope: string;
  /** 为什么沿用之后不补同步也可以，以及登记在哪里。 */
  readonly reason: string;
}

const UNSETTLED_REUSE: readonly UnsettledReuse[] = [
  {
    file: LIFECYCLE,
    scope: "releaseClaims",
    reason:
      "工作声明已经不在就跳过：掉电后回来的声明是孤儿，verify 的 work-claims 门报出、维护能放掉；不挡任何事务。",
  },
  {
    file: LIFECYCLE,
    scope: "writeJournal",
    reason:
      "日志目录已经在、同一份计划的日志已经在都直接沿用：目录的名字没落盘时要“被杀、重试、再掉电”三件事凑齐，正常路径不为它多一次同步（清单 8.3 第二件，open-items L10）。",
  },
  {
    file: "src/governance/pod/pod-worktree-receipts.ts",
    scope: "retirePodReceipts",
    reason:
      "回执目录已经不在就算退役：之后没有以它为前提的持久步骤，回来的回执目录由 pod recover 清掉。",
  },
  {
    file: "src/governance/ledger/ledger-record-publisher.ts",
    scope: "publishLedgerAuthorityRecord",
    reason:
      "同一条记录已经发布就按幂等返回：后面没有不可逆的删除，记录回退时同一个请求重发会重新发布（open-items L10）。",
  },
];

type AstNode = { readonly type?: string; readonly [key: string]: unknown };

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts") ? [full] : [];
  });
}

function identifierName(node: unknown): string | null {
  if (typeof node !== "object" || node === null) return null;
  const candidate = node as AstNode;
  return candidate.type === "Identifier" && typeof candidate.value === "string"
    ? candidate.value
    : null;
}

/** 这个节点自己起了一个具名函数作用域时，返回那个名字。 */
function scopeName(node: AstNode): string | null {
  if (node.type === "FunctionDeclaration") return identifierName(node.identifier);
  if (node.type === "VariableDeclarator") {
    const init = node.init as AstNode | null | undefined;
    const isFunction =
      init?.type === "ArrowFunctionExpression" || init?.type === "FunctionExpression";
    return isFunction ? identifierName(node.id) : null;
  }
  if (node.type === "ClassMethod" || node.type === "MethodProperty")
    return identifierName(node.key);
  return null;
}

interface FileFacts {
  /** 所在函数 → 调用次数。 */
  readonly calls: Map<string, number>;
  /** 文件里出现过的具名函数。 */
  readonly functions: Set<string>;
  /** 不是直接调用的引用：`所在函数 | 名字`，命名空间导入记作 `<module> | import * as 名字`。 */
  readonly indirect: string[];
}

const SETTLE_MODULE = /durable-resource-entry-settlement\.js$/u;

/** 这个文件里指着原语的名字：原名，加上按别名导入的本地名。命名空间导入记成间接引用。 */
function settleBindings(module: AstNode, facts: FileFacts): ReadonlySet<string> {
  const names = new Set([SETTLE]);
  for (const item of (module.body ?? []) as readonly AstNode[]) {
    if (item.type !== "ImportDeclaration") continue;
    const source = (item.source as AstNode | undefined)?.value;
    if (typeof source !== "string" || !SETTLE_MODULE.test(source)) continue;
    for (const specifier of (item.specifiers ?? []) as readonly AstNode[]) {
      const local = identifierName(specifier.local);
      if (local === null) continue;
      if (specifier.type !== "ImportSpecifier") {
        facts.indirect.push(`<module> | import * as ${local}`);
      } else if ((identifierName(specifier.imported) ?? local) === SETTLE) {
        names.add(local);
      }
    }
  }
  return names;
}

function collect(node: unknown, scope: string, facts: FileFacts, names: ReadonlySet<string>): void {
  if (Array.isArray(node)) {
    for (const child of node) collect(child, scope, facts, names);
    return;
  }
  if (typeof node !== "object" || node === null) return;
  const current = node as AstNode;
  // 导入说明符里的名字不是引用。
  if (current.type === "ImportDeclaration") return;
  const named = scopeName(current);
  const inner = named ?? scope;
  if (named !== null) facts.functions.add(named);
  if (current.type === "CallExpression") {
    const callee = identifierName(current.callee);
    if (callee !== null && names.has(callee)) {
      facts.calls.set(inner, (facts.calls.get(inner) ?? 0) + 1);
      // 被调用的名字已经算过；实参照常往下看。
      collect(current.arguments, inner, facts, names);
      return;
    }
  }
  const referenced = identifierName(current);
  if (referenced !== null && names.has(referenced)) {
    facts.indirect.push(`${scope} | ${referenced}`);
    return;
  }
  for (const value of Object.values(current)) collect(value, inner, facts, names);
}

function scanSources(sources: ReadonlyMap<string, string>): Map<string, FileFacts> {
  const scanned = new Map<string, FileFacts>();
  for (const [file, text] of sources) {
    const facts: FileFacts = { calls: new Map(), functions: new Set(), indirect: [] };
    const module = parseSync(text, {
      syntax: "typescript",
      target: "es2024",
    }) as unknown as AstNode;
    collect(module, "<module>", facts, settleBindings(module, facts));
    scanned.set(file, facts);
  }
  return scanned;
}

let repository: Map<string, FileFacts> | undefined;

function scanRepository(): Map<string, FileFacts> {
  if (repository !== undefined) return repository;
  const sources = new Map<string, string>();
  for (const file of sourceFiles(path.join(REPOSITORY_ROOT, "src"))) {
    const text = readFileSync(file, "utf8");
    // 只解析提到这个原语或被第二张表点名的文件：其余文件既没有调用点，也不需要函数清单。
    const relative = path.relative(REPOSITORY_ROOT, file).split(path.sep).join("/");
    if (text.includes(SETTLE) || UNSETTLED_REUSE.some((row) => row.file === relative)) {
      sources.set(relative, text);
    }
  }
  repository = scanSources(sources);
  return repository;
}

function siteRows(scanned: ReadonlyMap<string, FileFacts>): string[] {
  return [...scanned.entries()]
    .flatMap(([file, facts]) =>
      [...facts.calls.entries()].map(([scope, count]) => `${file} | ${scope} | ${count}`),
    )
    .sort();
}

test("扫描认得出调用所在的具名函数：声明、赋给变量的箭头函数、类的方法；注释与字符串里的名字不算", () => {
  const scanned = scanSources(
    new Map([
      [
        "sample.ts",
        `
        // settleObservedResourceEntry(root, ref, "absent") 在注释里
        const text = "settleObservedResourceEntry(";
        async function declared() { await settleObservedResourceEntry(a, b, "present"); }
        const arrow = async () => { await settleObservedResourceEntry(a, b, "absent"); await settleObservedResourceEntry(a, c, "absent"); };
        class Holder { async method() { return settleObservedResourceEntry(a, b, "present"); } }
        function outer() { function inner() { return settleObservedResourceEntry(a, b, "present"); } return inner; }
        void settleObservedResourceEntry(a, b, "present");
        `,
      ],
    ]),
  );
  deepEqual(siteRows(scanned), [
    "sample.ts | <module> | 1",
    "sample.ts | arrow | 2",
    "sample.ts | declared | 1",
    "sample.ts | inner | 1",
    "sample.ts | method | 1",
  ]);
});

test("扫描按导入绑定认调用：别名照样算；存进变量、.call、当参数、再导出与命名空间导入都记成间接引用", () => {
  const scanned = scanSources(
    new Map([
      [
        "aliased.ts",
        `
        import { settleObservedResourceEntry as settle, other } from "./durable-resource-entry-settlement.js";
        async function aliased() { await settle(a, b, "present"); other(); }
        const stored = settle;
        function viaCall() { return settle.call(null, a, b, "absent"); }
        function passed() { return run(settle); }
        `,
      ],
      [
        "namespace.ts",
        `
        import * as settlement from "./durable-resource-entry-settlement.js";
        function viaNamespace() { return settlement.settleObservedResourceEntry(a, b, "present"); }
        `,
      ],
      [
        "reexport.ts",
        `export { settleObservedResourceEntry } from "./durable-resource-entry-settlement.js";`,
      ],
    ]),
  );
  deepEqual(siteRows(scanned), ["aliased.ts | aliased | 1"]);
  deepEqual(scanned.get("aliased.ts")?.indirect, [
    "<module> | settle",
    "viaCall | settle",
    "passed | settle",
  ]);
  deepEqual(scanned.get("namespace.ts")?.indirect, [
    "<module> | import * as settlement",
    "viaNamespace | settleObservedResourceEntry",
  ]);
  deepEqual(scanned.get("reexport.ts")?.indirect, ["<module> | settleObservedResourceEntry"]);
});

test("沿用之前先落盘：src/ 里每一处调用都在登记表里，登记的每一处都还在", () => {
  const definition = "src/foundation/filesystem/durable-resource-entry-settlement.ts";
  // 只许直接调用：转手之后第一张表数不到。
  deepEqual(
    [...scanRepository()]
      .filter(([file]) => file !== definition)
      .flatMap(([file, facts]) => facts.indirect.map((row) => `${file} | ${row}`)),
    [],
  );
  const actual = siteRows(scanRepository()).filter((row) => !row.startsWith(`${definition} |`));
  deepEqual(
    actual,
    SETTLE_SITES.map((site) => `${site.file} | ${site.scope} | ${site.count}`).sort(),
  );
  for (const site of SETTLE_SITES) equal(site.reason.length > 0, true, site.scope);
});

test("看过、决定不补同步的沿用分支：所列的函数都还在", () => {
  const scanned = scanRepository();
  for (const row of UNSETTLED_REUSE) {
    equal(
      scanned.get(row.file)?.functions.has(row.scope),
      true,
      `${row.file} 里找不到 ${row.scope}：这一行的理由要重新看一遍`,
    );
    equal(row.reason.length > 0, true, row.scope);
  }
});
