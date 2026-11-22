import { deepEqual, equal } from "node:assert/strict";
import { chmodSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { type TestContext, test } from "node:test";
import { computeSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import {
  createFileAtomically,
  replaceFileAtomically,
} from "../../../src/foundation/filesystem/durable-atomic-file-write.js";
import { materializeDirectoryPath } from "../../../src/foundation/filesystem/durable-directory-materialization.js";
import { removeEmptyDirectoryExactly } from "../../../src/foundation/filesystem/durable-directory-tree-candidate-retirement.js";
import { createFileCandidateDurably } from "../../../src/foundation/filesystem/durable-file-candidate.js";
import { copyFileToCandidateDurably } from "../../../src/foundation/filesystem/durable-file-copy-candidate.js";
import { linkRegularFileWithoutReplacement } from "../../../src/foundation/filesystem/durable-regular-file-link.js";
import { renameResourceDurably } from "../../../src/foundation/filesystem/durable-resource-rename.js";
import { unlinkRegularFileExactly } from "../../../src/foundation/filesystem/exact-regular-file-unlink.js";
import { filesystemMutation } from "../../../src/foundation/filesystem/filesystem-mutation.js";
import { parsePortableResourcePath } from "../../../src/foundation/filesystem/portable-resource-path.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { removeRootedDirectoryTree } from "../../../src/foundation/filesystem/rooted-directory-tree-removal.js";
import { readStableFileDigest } from "../../../src/foundation/filesystem/stable-file-read.js";
import { parseByteCount } from "../../../src/foundation/numeric/byte-count.js";
import { encodeUtf8 } from "../../../src/foundation/text/utf8.js";
import { useDisposableDurability } from "../../support/disposable-durability.js";
import { disposableRoot } from "../../support/temp-root.js";

/**
 * 级别 1（组件）：改动目录项的接缝（1.4.1 阶段 1 第 1 步，阶段 1-2 清单 §2.4）。
 *
 * 序列测试只走十个写入口的成功路径（原子创建与替换、精确删除、逐级建目录、删空目录、删目录树、候选文件与
 * 硬链接、复制候选、重命名），断言其中每一次可见的目录项变化都经过 `filesystemMutation`，顺序与提交顺序一致。
 * 失败清理里的删除，以及目录树候选的创建、发布与退役没有被驱动，它们只由下面的静态扫描担保。
 *
 * 静态扫描走 `src` 下全部 `.ts`（接缝本身与 `generated` 目录除外），每个文件按 `scanSource` 的规则检查：不得
 * 导入新建、删除或改动目录项的 `node:fs` 函数（模块名带不带 `node:`、带不带 `/promises` 都算）；不得默认导入、
 * 命名空间导入或命名导入 `promises`；fs 模块名（单引号、双引号或反引号）不得出现在静态导入之外（再导出、动态
 * `import()`、`require`、`process.getBuiltinModule`）；直接的 `open` 逐个调用点解析它的标志：拆开顶层按位或
 * 与条件表达式的分支，标识符追到它的声明（`let`/`var` 加上每次再赋值），同文件的标志函数追到它的每个 `return`，
 * 层层递归、层数有上限。创建性的标志（`O_CREAT`、`O_EXCL`、含 w、a 或 x 的字符串模式）必须改走
 * `filesystemMutation.openExclusive`，在本文件里解析不出的标志同样算违规。确实绕过接缝的调用逐条列在允许表里并
 * 写明理由；只读地使用 `node:fs` 的模块不需要允许表。发布到工作区的 `.mjs` 助手脚本在宿主的其他进程里运行，
 * 不在快照扫描所量的 MCP 进程里，不在本扫描范围内。
 */

useDisposableDurability();

type SeamMethod = keyof typeof filesystemMutation;
const SEAM_METHODS = Object.keys(filesystemMutation) as SeamMethod[];

/** 包住接缝的每个成员：记录调用顺序，再原样转发给原实现。 */
function recordSeam(t: TestContext): SeamMethod[] {
  const calls: SeamMethod[] = [];
  for (const name of SEAM_METHODS) {
    const original = filesystemMutation[name] as (...args: unknown[]) => Promise<unknown>;
    t.mock.method(filesystemMutation, name, async (...args: unknown[]) => {
      calls.push(name);
      return await original(...args);
    });
  }
  return calls;
}

async function openRoot(t: TestContext): Promise<{ root: RootedDirectory; base: string }> {
  const base = disposableRoot(t, "wakeflow-filesystem-mutation-");
  const root = await RootedDirectory.open(base);
  t.after(() => root.close());
  return { root, base };
}

test("十个写入口的成功路径上，每一次目录项变化都经过接缝，顺序与提交顺序一致", async (t) => {
  const { root, base } = await openRoot(t);
  writeFileSync(path.join(base, "unlink-me"), "u\n", { mode: 0o600 });
  writeFileSync(path.join(base, "rename-me"), "r\n", { mode: 0o600 });
  mkdirSync(path.join(base, "empty"));
  chmodSync(path.join(base, "empty"), 0o700);
  mkdirSync(path.join(base, "tree", "nested"), { recursive: true });
  writeFileSync(path.join(base, "tree", "nested", "leaf"), "l\n");
  const calls = recordSeam(t);
  const observe = async (action: () => Promise<unknown>): Promise<SeamMethod[]> => {
    calls.length = 0;
    await action();
    return [...calls];
  };

  const created = parsePortableResourcePath("created.json");
  deepEqual(
    await observe(() => createFileAtomically(root, created, encodeUtf8("a\n"), { mode: 0o600 })),
    ["openExclusive", "link", "unlink"],
  );

  const expected = await readStableFileDigest(root, created, {
    maximumBytes: parseByteCount(1024),
  });
  deepEqual(
    await observe(() =>
      replaceFileAtomically(root, created, encodeUtf8("b\n"), { mode: 0o600, expected }),
    ),
    ["openExclusive", "rename"],
  );

  const unlinkTarget = parsePortableResourcePath("unlink-me");
  const unlinkNode = (await root.inspectExistingResource(unlinkTarget)).node;
  deepEqual(
    await observe(() => unlinkRegularFileExactly(root, unlinkTarget, { expectedNode: unlinkNode })),
    ["unlink"],
  );

  deepEqual(
    await observe(() =>
      materializeDirectoryPath(root, parsePortableResourcePath("made/deeper"), { mode: 0o700 }),
    ),
    ["mkdir", "mkdir"],
  );

  const empty = parsePortableResourcePath("empty");
  const emptyNode = (await root.inspectExistingResource(empty)).node;
  deepEqual(
    await observe(() => removeEmptyDirectoryExactly(root, empty, emptyNode, 0o700, undefined)),
    ["rmdir"],
  );

  deepEqual(
    await observe(() => removeRootedDirectoryTree(root, parsePortableResourcePath("tree"))),
    ["removeTree"],
  );

  const candidate = parsePortableResourcePath("candidate");
  const alias = parsePortableResourcePath("alias");
  deepEqual(
    await observe(async () => {
      const result = await createFileCandidateDurably(root, candidate, encodeUtf8("c\n"), {
        mode: 0o600,
      });
      await linkRegularFileWithoutReplacement(root, candidate, alias, {
        expectedSourceNode: result.node,
      });
    }),
    ["openExclusive", "link"],
  );

  const copied = encodeUtf8("c\n");
  deepEqual(
    await observe(() =>
      copyFileToCandidateDurably(
        root,
        root,
        candidate,
        parsePortableResourcePath("copy"),
        { byteCount: parseByteCount(copied.byteLength), digest: computeSha256Digest(copied) },
        { maximumBytes: parseByteCount(copied.byteLength), mode: 0o600 },
      ),
    ),
    ["openExclusive"],
  );

  const renameSource = parsePortableResourcePath("rename-me");
  const renameNode = (await root.inspectExistingResource(renameSource)).node;
  deepEqual(
    await observe(() =>
      renameResourceDurably(root, renameSource, parsePortableResourcePath("renamed"), {
        expectedSourceNode: renameNode,
      }),
    ),
    ["rename"],
  );

  deepEqual(readdirSync(base).sort(), [
    "alias",
    "candidate",
    "copy",
    "created.json",
    "made",
    "renamed",
  ]);
});

// 完整性扫描。默认导入、命名空间导入、命名导入 `promises` 与静态导入之外的模块名都被拒绝，所以拿到
// fs 对象再调 `fs.unlink(...)` 的路都被堵住，逐名检查只需看命名导入。读路径要用 `open`，所以它不在禁止
// 名单里，而是逐个调用点解析标志；`readFile` 与 `createReadStream` 的选项也查。标志里的名字按作用域解析
// （见 flagsKind）。解析靠文本与括号结构，不是语法树：认得出的写法里解析不出的一律上报，但有几处已知
// 认不出、因而可能漏报的：正则字面量里不配对的括号或引号与嵌套的模板字面量会把括号结构数错；名叫
// `if`、`while`、`switch`、`for` 的方法的参数认不出；尖括号里带逗号的泛型会把声明项拆错。
const SOURCE_ROOT = path.join(process.cwd(), "src");
const SEAM_SOURCE = "src/foundation/filesystem/filesystem-mutation.ts";
/** 新建、删除或改动目录项的 `node:fs` 函数；同步形式去掉 `Sync` 后比对。`truncate` 只改内容，不在其列。 */
const ENTRY_MUTATORS = new Set([
  "link",
  "rename",
  "unlink",
  "mkdir",
  "rmdir",
  "rm",
  "writeFile",
  "appendFile",
  "copyFile",
  "cp",
  "symlink",
  "mkdtemp",
  "mkdtempDisposable",
  "createWriteStream",
]);
// 引号类含反引号：动态 `import()` 与 `process.getBuiltinModule()` 可以用模板字面量写模块名；静态导入不能。
const FS_SPECIFIER = "[\"'`](?:node:)?fs(?:/promises)?[\"'`]";
const FS_IMPORT = new RegExp(
  String.raw`\bimport\s+(type\s+)?([^;]*?)\s+from\s+(${FS_SPECIFIER})`,
  "g",
);
const FS_SPECIFIER_ANYWHERE = new RegExp(FS_SPECIFIER, "g");
const CREATING_FLAG_CONSTANT = /\bO_(?:CREAT|EXCL)\b/;

/**
 * 允许表：确实绕过接缝的直接调用，每条写明理由，且每条都必须仍被用到。
 * - `git-ignore-candidate-observation.ts` 在系统临时目录下用 `mkdtemp` 建、用递归 `rm` 删 Git 临时工作树：
 *   它在任何工作区根之外，不在快照集合里（见接缝的文档注释）；树里的 `.gitignore` 候选仍经接缝创建。
 */
const ALLOWED = new Set([
  "src/foundation/git/git-ignore-candidate-observation.ts: mkdtemp",
  "src/foundation/git/git-ignore-candidate-observation.ts: rm",
]);

type FlagsKind = "read" | "creating" | "unresolved";
/** 解析标志时追进声明与函数返回值的最大层数；超出算解析不出。 */
const RESOLUTION_DEPTH = 8;

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split("\n").length;
}

function closingQuote(text: string, start: number): number {
  const quote = text.charAt(start);
  for (let index = start + 1; index < text.length; index += 1) {
    if (text.charAt(index) === "\\") index += 1;
    else if (text.charAt(index) === quote) return index;
  }
  return text.length;
}

/** 从一个开括号走到与它配对的闭括号，跳过字符串字面量与注释；返回闭括号的位置。 */
function matchingClose(text: string, openIndex: number): number {
  let depth = 0;
  for (let index = openIndex; index < text.length; index += 1) {
    const char = text.charAt(index);
    const next = text.charAt(index + 1);
    if (char === '"' || char === "'" || char === "`") index = closingQuote(text, index);
    else if (char === "/" && next === "/") index = text.indexOf("\n", index) >>> 0;
    else if (char === "/" && next === "*") index = (text.indexOf("*/", index) >>> 0) + 1;
    else if ("([{".includes(char)) depth += 1;
    else if (")]}".includes(char)) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return text.length;
}

function callArguments(text: string, openIndex: number): string[] {
  const inner = text.slice(openIndex + 1, matchingClose(text, openIndex));
  const args: string[] = [];
  let start = 0;
  for (let index = 0; index < inner.length; index += 1) {
    const char = inner.charAt(index);
    if (char === '"' || char === "'" || char === "`") index = closingQuote(inner, index);
    else if ("([{".includes(char)) index = matchingClose(inner, index);
    else if (char === ",") {
      args.push(inner.slice(start, index).trim());
      start = index + 1;
    }
  }
  args.push(inner.slice(start).trim());
  return args;
}

function escapeIdentifier(identifier: string): string {
  return identifier.replaceAll("$", "\\$");
}

/** 把注释换成等长的空白（换行保留），字符串原样保留，下标与原文一一对应。 */
function withoutComments(text: string): string {
  const parts: string[] = [];
  let copied = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text.charAt(index);
    const next = text.charAt(index + 1);
    if (char === '"' || char === "'" || char === "`") index = closingQuote(text, index);
    else if (char === "/" && (next === "/" || next === "*")) {
      const found = next === "/" ? text.indexOf("\n", index) : text.indexOf("*/", index + 2);
      const end = found < 0 ? text.length : next === "/" ? found : found + 2;
      parts.push(text.slice(copied, index), text.slice(index, end).replace(/[^\n]/g, " "));
      copied = end;
      index = end - 1;
    }
  }
  parts.push(text.slice(copied));
  return parts.join("");
}

/** 从 start 起依次给出括号深度为 0 的位置（跳过字符串字面量）；关闭外层括号的闭括号也给出。 */
function* topLevelIndices(text: string, start: number): Generator<number> {
  let depth = 0;
  for (let index = start; index < text.length; index += 1) {
    const char = text.charAt(index);
    if (char === '"' || char === "'" || char === "`") index = closingQuote(text, index);
    else if ("([{".includes(char)) depth += 1;
    else if (")]}".includes(char) && depth > 0) depth -= 1;
    else if (depth === 0) yield index;
  }
}

/** 从 start 起这条语句（或表达式）的结尾：深度 0 上的第一个分号，或关闭外层括号的闭括号。 */
function statementEnd(text: string, start: number): number {
  for (const index of topLevelIndices(text, start)) {
    if (";)]}".includes(text.charAt(index))) return index;
  }
  return text.length;
}

/** 按顶层的按位或 `|` 拆开（`||` 不拆）。 */
function bitwiseOrOperands(expression: string): string[] {
  const operands: string[] = [];
  let start = 0;
  for (const index of topLevelIndices(expression, 0)) {
    const isBitwiseOr =
      expression.charAt(index) === "|" &&
      expression.charAt(index - 1) !== "|" &&
      expression.charAt(index + 1) !== "|";
    if (isBitwiseOr) {
      operands.push(expression.slice(start, index));
      start = index + 1;
    }
  }
  operands.push(expression.slice(start));
  return operands;
}

/** 顶层条件表达式 `c ? a : b` 的两个分支；不是条件表达式为 null。条件本身不贡献标志。 */
function ternaryBranches(expression: string): readonly string[] | null {
  let question = -1;
  let nested = 0;
  for (const index of topLevelIndices(expression, 0)) {
    const char = expression.charAt(index);
    const isTernary =
      char === "?" &&
      !/[?.]/.test(expression.charAt(index + 1)) &&
      expression.charAt(index - 1) !== "?";
    if (isTernary) {
      if (question < 0) question = index;
      else nested += 1;
    } else if (char === ":" && question >= 0) {
      if (nested === 0) return [expression.slice(question + 1, index), expression.slice(index + 1)];
      nested -= 1;
    }
  }
  return null;
}

function worst(kinds: readonly FlagsKind[]): FlagsKind {
  if (kinds.includes("creating")) return "creating";
  return kinds.includes("unresolved") ? "unresolved" : "read";
}

/**
 * 解析标志用的源文本：去掉注释的代码，加上每个下标处的括号结构（三种括号都算；字符串字面量整个算在它
 * 开头的那一层）与绑定到 fs `constants` 的本地名字。括号结构按字符数出来，正则字面量里不配对的括号与
 * 嵌套的模板字面量会把它数错。
 */
interface Source {
  readonly code: string;
  /** 每个下标处还没闭合的括号层数；括号自己算在外层。 */
  readonly depths: Int32Array;
  /** 每个下标处最内层那个开括号的下标；不在任何括号里为 -1。 */
  readonly enclosing: Int32Array;
  /** 开括号的下标到与它配对的闭括号的下标。 */
  readonly closes: ReadonlyMap<number, number>;
  /** 下标是否落在字符串字面量里。 */
  readonly literal: Uint8Array;
  readonly constants: ReadonlySet<string>;
}

function sourceOf(code: string, constants: ReadonlySet<string>): Source {
  const depths = new Int32Array(code.length + 1);
  const enclosing = new Int32Array(code.length + 1).fill(-1);
  const literal = new Uint8Array(code.length + 1);
  const closes = new Map<number, number>();
  const open: number[] = [];
  for (let index = 0; index < code.length; index += 1) {
    const char = code.charAt(index);
    if (char === '"' || char === "'" || char === "`") {
      const end = Math.min(closingQuote(code, index), code.length - 1);
      enclosing.fill(open.at(-1) ?? -1, index, end + 1);
      depths.fill(open.length, index, end + 1);
      literal.fill(1, index, end + 1);
      index = end;
      continue;
    }
    if (")]}".includes(char)) {
      const opener = open.pop();
      if (opener !== undefined) closes.set(opener, index);
    }
    enclosing[index] = open.at(-1) ?? -1;
    depths[index] = open.length;
    if ("([{".includes(char)) open.push(index);
  }
  return { code, depths, enclosing, closes, literal, constants };
}

function groupEnd(source: Source, opener: number): number {
  return source.closes.get(opener) ?? source.code.length;
}

function enclosingOf(source: Source, position: number): number {
  return source.enclosing[position] ?? -1;
}

/** `position` 是否在 `opener` 打开的括号里；`opener` 为 -1 表示整个文件。 */
function inGroup(source: Source, opener: number, position: number): boolean {
  if (opener === -1) return true;
  for (let at = enclosingOf(source, position); at !== -1; at = enclosingOf(source, at)) {
    if (at === opener) return true;
  }
  return false;
}

/** `at` 处的声明所在的块是否包住 `use`：别的块里的同名声明在 `use` 处看不见。 */
function visibleFrom(source: Source, at: number, use: number): boolean {
  return inGroup(source, enclosingOf(source, at), use);
}

/** 两个都看得见的声明里 `found` 是否比 `chosen` 更近：先比嵌套层数，同层取 `use` 之前靠后的。 */
function nearer(source: Source, found: number, chosen: number, use: number): boolean {
  const foundDepth = source.depths[found] ?? 0;
  const chosenDepth = source.depths[chosen] ?? 0;
  return foundDepth > chosenDepth || (foundDepth === chosenDepth && found < use);
}

/** 标识符作为一个完整的名字出现的每个位置；字符串里的与成员访问（`x.name`）不算，展开（`...name`）算。 */
function* occurrences(source: Source, identifier: string): Generator<number> {
  const { code } = source;
  const word = new RegExp(String.raw`(?<![\w$])${escapeIdentifier(identifier)}(?![\w$])`, "g");
  for (const match of code.matchAll(word)) {
    const at = match.index;
    if (source.literal[at] === 1) continue;
    if (code.charAt(at - 1) === "." && code.charAt(at - 2) !== ".") continue;
    yield at;
  }
}

/** 把字符串字面量换成等长的空白，下标与原文一一对应。 */
function withoutStrings(text: string): string {
  const parts: string[] = [];
  let copied = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text.charAt(index);
    if (char === '"' || char === "'" || char === "`") {
      const end = Math.min(closingQuote(text, index), text.length - 1);
      parts.push(text.slice(copied, index), " ".repeat(end - index + 1));
      copied = end + 1;
      index = end;
    }
  }
  parts.push(text.slice(copied));
  return parts.join("");
}

function skipSpace(code: string, index: number): number {
  let at = index;
  while (/\s/.test(code.charAt(at))) at += 1;
  return at;
}

function previousNonSpace(code: string, index: number): string {
  let at = index - 1;
  while (at >= 0 && /\s/.test(code.charAt(at))) at -= 1;
  return at < 0 ? "" : code.charAt(at);
}

/** 从 `start` 起的函数体或循环体的结尾：花括号块取配对的闭括号，否则取这条语句的结尾。 */
function bodyEnd(source: Source, start: number): number {
  const at = skipSpace(source.code, start);
  return source.code.charAt(at) === "{" ? groupEnd(source, at) : statementEnd(source.code, at);
}

/**
 * 一个圆括号闭合之后若跟着函数体（中间可以隔着返回类型），返回函数体的范围；不是参数表就返回 null。
 * 返回类型里的对象类型（前面是 `:`、`<`、`,`、`|`、`&`、`(`）跳过；箭头后面不是块时取到语句结尾。一个
 * 花括号块后面若还跟着 `{`、`:`、`|`、`&`、`?` 或 `=`，它可能仍是返回类型的一部分（类型谓词、函数类型、
 * 条件类型），继续往后找，取最后一个；范围宁大勿小。
 */
function functionBody(
  source: Source,
  close: number,
): Readonly<{ start: number; end: number }> | null {
  const { code } = source;
  let candidate: Readonly<{ start: number; end: number }> | null = null;
  for (let index = close + 1; index < code.length; index += 1) {
    const char = code.charAt(index);
    if (char === '"' || char === "'" || char === "`") index = closingQuote(code, index);
    else if (char === "=" && code.charAt(index + 1) === ">") {
      const start = skipSpace(code, index + 2);
      if (code.charAt(start) !== "{") return { start, end: statementEnd(code, start) };
      candidate = { start, end: groupEnd(source, start) };
      index = candidate.end;
    } else if (char === "{") {
      const end = groupEnd(source, index);
      if (!":<,|&(".includes(previousNonSpace(code, index) || " ")) {
        candidate = { start: index, end };
      }
      index = end;
    } else if (char === "(" || char === "[") index = groupEnd(source, index);
    else if (";,)]}".includes(char)) return candidate;
    else if (candidate !== null && !/\s/.test(char) && !":|&?=".includes(char)) return candidate;
  }
  return candidate;
}

/** `for (...)` 头里声明的名字所在的区间（相对 header）：`of` / `in` 之前的整段，或每个声明项里 `=` 之前的一段。 */
function forHeaderNameRanges(header: string): Array<readonly [number, number]> {
  const keyword = /^\s*(?:const|let|var)\b/.exec(header);
  if (keyword === null) return [];
  const ranges: Array<readonly [number, number]> = [];
  let start = keyword[0].length;
  let naming = true;
  for (const index of topLevelIndices(header, start)) {
    const char = header.charAt(index);
    const ends = char === ";" || /^\s(?:of|in)\s/.test(header.slice(index, index + 4));
    if (ends || char === ",") {
      if (naming) ranges.push([start, index]);
      if (ends) return ranges;
      start = index + 1;
      naming = true;
    } else if (char === "=" && naming) {
      ranges.push([start, index]);
      naming = false;
    }
  }
  if (naming) ranges.push([start, header.length]);
  return ranges;
}

/**
 * `at` 处的名字若被 `opener` 这个圆括号绑定，返回这个绑定管到的范围：参数表与 `catch (...)` 管到函数体或块
 * 的结尾，`for (...)` 头里声明的名字管到循环体的结尾。条件（`if` / `while` / `switch`）与调用的实参不绑定
 * 名字，返回 null；所以名叫 `if`、`while`、`switch`、`for` 的方法的参数认不出（模块里没有 `with` 语句，名叫
 * `with` 的方法认得出）。参数表里只要出现这个名字就算（缺省值与类型里的也算），范围宁大勿小。
 */
function parenthesisBinding(
  source: Source,
  opener: number,
  at: number,
): Readonly<{ start: number; end: number }> | null {
  const { code } = source;
  const close = groupEnd(source, opener);
  const before = code.slice(Math.max(0, opener - 24), opener);
  if (/(?<![.\w$])(?:if|while|switch)\s*$/.test(before)) return null;
  if (/(?<![.\w$])for\s*(?:await\s*)?$/.test(before)) {
    const bound = forHeaderNameRanges(code.slice(opener + 1, close)).some(
      ([from, to]) => opener + 1 + from <= at && at < opener + 1 + to,
    );
    return bound ? { start: opener, end: bodyEnd(source, close + 1) } : null;
  }
  const body = functionBody(source, close);
  return body === null ? null : { start: opener, end: body.end };
}

/** 一条声明语句里的一个声明项：`const a = 1, { b } = o` 有两项。 */
interface Declarator {
  readonly keyword: string;
  /** 声明关键字的位置：这一项所在的块按它算。 */
  readonly statement: number;
  /** 这一项的范围（不含分隔它的逗号）。 */
  readonly start: number;
  readonly end: number;
}

const declaratorCache = new WeakMap<Source, readonly Declarator[]>();

/** 文件里每一条 `const` / `let` / `var` 语句的每个声明项，按顶层逗号拆开；`for (...)` 头里的也在内。 */
function declarators(source: Source): readonly Declarator[] {
  const cached = declaratorCache.get(source);
  if (cached !== undefined) return cached;
  const { code } = source;
  const found: Declarator[] = [];
  for (const match of code.matchAll(/(?<![.\w$])(?<!\bas\s+)(const|let|var)(?![\w$])/g)) {
    if (source.literal[match.index] === 1) continue;
    let start = match.index + match[0].length;
    for (const index of topLevelIndices(code, start)) {
      const char = code.charAt(index);
      const ends = ";)]}".includes(char);
      if (!ends && char !== ",") continue;
      found.push({ keyword: match[1] ?? "", statement: match.index, start, end: index });
      if (ends) break;
      start = index + 1;
    }
  }
  declaratorCache.set(source, found);
  return found;
}

/** 一个声明项是 `NAME = …`（可带类型标注）时，返回 `=` 之后表达式的起点；否则 -1。 */
function simpleDeclaratorValue(source: Source, item: Readonly<Declarator>, name: string): number {
  const text = source.code.slice(item.start, item.end);
  const match = new RegExp(String.raw`^\s*${escapeIdentifier(name)}\s*(?::[^=]+)?=(?![=>])`).exec(
    text,
  );
  return match === null ? -1 : item.start + match[0].length;
}

/** 一个声明项是解构模式并且提到这个名字。 */
function patternDeclaratorBinds(source: Source, item: Readonly<Declarator>, name: string): boolean {
  const text = source.code.slice(item.start, item.end);
  if (!/^\s*[[{]/.test(text)) return false;
  return new RegExp(String.raw`(?<![.\w$])${escapeIdentifier(name)}(?![\w$])`).test(text);
}

/**
 * `use` 处的名字是否被 `const`/`let`/`var NAME =` 之外的绑定形式遮住：参数（含解构、缺省值、单参数的箭头
 * 函数）、`catch (...)`、`for (...)` 头里的声明、解构声明。这样的绑定管到 `use`、又管不到 `declared`（选中的
 * 那个声明；-1 表示模块层的绑定，例如导入）时，`use` 处的名字指的是它，而它的值在本文件里解析不出。
 */
function shadowed(source: Source, identifier: string, use: number, declared: number): boolean {
  const { code } = source;
  const hides = (start: number, end: number): boolean =>
    start <= use && use <= end && !(start <= declared && declared <= end);
  for (const at of occurrences(source, identifier)) {
    const arrow = /^\s*=>/.exec(code.slice(at + identifier.length));
    if (arrow !== null) {
      const end = bodyEnd(source, at + identifier.length + arrow[0].length);
      if (hides(at, end)) return true;
    }
    for (
      let opener = enclosingOf(source, at);
      opener !== -1;
      opener = enclosingOf(source, opener)
    ) {
      if (code.charAt(opener) !== "(") continue;
      const binding = parenthesisBinding(source, opener, at);
      if (binding !== null && hides(binding.start, binding.end)) return true;
    }
  }
  // 解构声明管它所在的块；`for` 头里的由上面圆括号那一支管。
  for (const item of declarators(source)) {
    if (!patternDeclaratorBinds(source, item, identifier)) continue;
    const block = enclosingOf(source, item.statement);
    if (code.charAt(block) === "(" || !inGroup(source, block, use)) continue;
    if (declared < 0 || !inGroup(source, block, declared)) return true;
  }
  return false;
}

/** 这个名字在本文件里有 `var` 声明（含解构）：`var` 提升到函数作用域，按块判断看得见与否不成立。 */
function varDeclared(source: Source, identifier: string): boolean {
  return declarators(source).some(
    (item) =>
      item.keyword === "var" &&
      (simpleDeclaratorValue(source, item, identifier) >= 0 ||
        patternDeclaratorBinds(source, item, identifier)),
  );
}

interface Declaration {
  readonly keyword: string;
  readonly expression: string;
  readonly index: number;
}

/**
 * 标识符在 `use` 处看得见的 `const`/`let`/`var NAME =` 声明（逗号后面的声明项也算）：所在的块包住 `use` 的
 * 那些里取最内层的，同层取 `use` 之前最近的、没有就取之后的第一个。别的块里的同名声明不算。
 */
function declaration(source: Source, identifier: string, use: number): Declaration | null {
  let chosen: Declaration | null = null;
  for (const item of declarators(source)) {
    const value = simpleDeclaratorValue(source, item, identifier);
    if (value < 0 || !visibleFrom(source, item.statement, use)) continue;
    if (chosen !== null && !nearer(source, item.statement, chosen.index, use)) continue;
    chosen = {
      keyword: item.keyword,
      expression: source.code.slice(value, item.end),
      index: item.statement,
    };
  }
  return chosen;
}

/**
 * 一个 `let`/`var` 标识符在本文件里的每一次再赋值：`=` 与 `|=` 解析右边（右边出现它自己不算新的一项），
 * 其他复合赋值、解构赋值（`[name] = …`、`({ name } = …)`）与作为 `for (name of …)` 的目标算解析不出。不分
 * 作用域，同名的再赋值都算进来，宁可多报。
 */
function reassignedFlagsKinds(source: Source, identifier: string, depth: number): FlagsKind[] {
  const { code } = source;
  const pattern = new RegExp(
    String.raw`(?<![.\w$]|\b(?:const|let|var)\s+)${escapeIdentifier(identifier)}\s*(\*\*=|<<=|>>>=|>>=|&&=|\|\|=|\?\?=|[-+*/%&^|]=|=)(?![=>])`,
    "g",
  );
  const kinds: FlagsKind[] = [];
  for (const match of code.matchAll(pattern)) {
    if (source.literal[match.index] === 1) continue;
    const operator = match[1] ?? "";
    const start = match.index + match[0].length;
    const right = code.slice(start, statementEnd(code, start));
    kinds.push(
      operator === "=" || operator === "|="
        ? flagsKind(right, source, match.index, depth, identifier)
        : "unresolved",
    );
  }
  const forTarget = new RegExp(
    String.raw`\bfor\s*(?:await\s*)?\(\s*${escapeIdentifier(identifier)}\s+(?:of|in)\b`,
    "g",
  );
  for (const match of code.matchAll(forTarget)) {
    if (source.literal[match.index] !== 1) kinds.push("unresolved");
  }
  const declared = declarators(source);
  for (const at of occurrences(source, identifier)) {
    let pattern = -1;
    for (
      let opener = enclosingOf(source, at);
      opener !== -1 && "[{".includes(code.charAt(opener));
      opener = enclosingOf(source, opener)
    ) {
      pattern = opener;
    }
    if (pattern === -1) continue;
    // 声明里的解构是另一个绑定（见 shadowed）；紧贴在名字或闭括号后面的 `[` 是下标访问，类型标注后面的
    // `=` 也不是解构赋值。`if (c) [name] = …` 这样隔着空白的算解构赋值。
    if (declared.some((item) => item.start <= pattern && pattern < item.end)) continue;
    const before = code.slice(Math.max(0, pattern - 16), pattern);
    if (/[\w$)\]]$/.test(before) || /:\s*$/.test(before)) continue;
    if (/^\s*\)?\s*=(?![=>])/.test(code.slice(groupEnd(source, pattern) + 1))) {
      kinds.push("unresolved");
    }
  }
  return kinds;
}

/**
 * `use` 处看得见的 `function name(...)` 的每个 `return` 表达式逐个解析（字符串里的 return 不算）；函数体里
 * 出现 `O_CREAT`/`O_EXCL` 直接算创建性的。找不到函数（含箭头函数与方法）、只有声明没有函数体、名字被别的
 * 绑定遮住或同名的变量看得见、没有 `return`，都算解析不出。
 */
function returnedFlagsKind(source: Source, name: string, use: number, depth: number): FlagsKind {
  const { code } = source;
  const pattern = new RegExp(
    String.raw`\bfunction\s+${escapeIdentifier(name)}\s*(?:<[^>]*>)?\s*\(`,
    "g",
  );
  let chosen: Readonly<{ index: number; length: number }> | null = null;
  for (const match of code.matchAll(pattern)) {
    if (source.literal[match.index] === 1 || !visibleFrom(source, match.index, use)) continue;
    if (chosen !== null && !nearer(source, match.index, chosen.index, use)) continue;
    chosen = { index: match.index, length: match[0].length };
  }
  if (chosen === null || shadowed(source, name, use, chosen.index)) return "unresolved";
  // 同名的变量（`const flagsFor = () => …`）在使用处看得见时，调用的可能是它，不是这个函数。
  if (declaration(source, name, use) !== null || varDeclared(source, name)) return "unresolved";
  const range = functionBody(source, groupEnd(source, chosen.index + chosen.length - 1));
  if (range === null || code.charAt(range.start) !== "{") return "unresolved";
  const bodyStart = range.start;
  const body = code.slice(bodyStart, range.end + 1);
  if (CREATING_FLAG_CONSTANT.test(body)) return "creating";
  const kinds: FlagsKind[] = [];
  for (const found of withoutStrings(body).matchAll(/\breturn\b/g)) {
    const start = bodyStart + found.index + "return".length;
    kinds.push(flagsKind(code.slice(start, statementEnd(code, start)), source, start, depth));
  }
  return kinds.length === 0 ? "unresolved" : worst(kinds);
}

/**
 * 把一个 `open` 的标志实参在本文件里解析到底：拆开括号、条件表达式的两个分支与顶层按位或的每一项，去掉
 * `as T`、`satisfies T` 与非空断言；字符串含 w、a 或 x 是创建性的，fs `constants` 的成员按名字判断（别的
 * 对象上的 `x.O_…` 解析不出），`0` 是只读；标识符追到它在使用处看得见的声明（`let`/`var` 还要加上每一次
 * 再赋值），函数调用追到同样看得见的函数的每个 `return`，层数有上限。名字按作用域解析：别的块里的同名
 * 声明不算，被参数、解构、`for` 头或 `catch` 绑定的名字解析不出，有 `var` 声明的名字解析不出。任何一项
 * 解析不出，整个标志就算解析不出。`self` 是正在解析其再赋值的那个标识符：右边出现它自己时由它的声明与
 * 其余再赋值负责。
 */
function flagsKind(
  expression: string,
  source: Source,
  use: number,
  depth: number,
  self?: string,
): FlagsKind {
  const value = expression.trim();
  if (depth > RESOLUTION_DEPTH) return "unresolved";
  if (CREATING_FLAG_CONSTANT.test(value)) return "creating";
  if (value.startsWith("(") && matchingClose(value, 0) === value.length - 1)
    return flagsKind(value.slice(1, -1), source, use, depth, self);
  const branches = ternaryBranches(value) ?? bitwiseOrOperands(value);
  if (branches.length > 1)
    return worst(branches.map((branch) => flagsKind(branch, source, use, depth, self)));
  const literal = /^(["'`])(.*)\1$/s.exec(value);
  // 整个值是一个字符串字面量才算：`"" + mode + ""` 首尾也是引号，但不是一个字面量。
  if (literal !== null && closingQuote(value, 0) === value.length - 1) {
    if (literal[1] === "`" && (literal[2] ?? "").includes("${")) return "unresolved";
    return /[wax]/.test(literal[2] ?? "") ? "creating" : "read";
  }
  const asserted = value.replace(/(?:\s+(?:as|satisfies)\s+[\w$.<>[\], ]+|!)$/, "");
  if (asserted !== value) return flagsKind(asserted, source, use, depth, self);
  if (value === "0") return "read";
  const member = /^([A-Za-z_$][\w$]*)\.O_[A-Z]+$/.exec(value);
  if (member !== null) {
    // 只认导入的 fs `constants`；同名的参数或局部变量盖住它时不认。
    const object = member[1] ?? "";
    const imported =
      source.constants.has(object) &&
      declaration(source, object, use) === null &&
      !varDeclared(source, object) &&
      !shadowed(source, object, use, -1);
    return imported ? "read" : "unresolved";
  }
  const call = /^([A-Za-z_$][\w$]*)\s*\(/.exec(value);
  if (call !== null && matchingClose(value, call[0].length - 1) === value.length - 1)
    return returnedFlagsKind(source, call[1] ?? "", use, depth + 1);
  if (!/^[A-Za-z_$][\w$]*$/.test(value)) return "unresolved";
  if (value === self) return "read";
  const declared = declaration(source, value, use);
  if (declared === null || shadowed(source, value, use, declared.index)) return "unresolved";
  if (varDeclared(source, value)) return "unresolved";
  const kinds = [flagsKind(declared.expression, source, declared.index, depth + 1)];
  if (declared.keyword !== "const") kinds.push(...reassignedFlagsKinds(source, value, depth + 1));
  return worst(kinds);
}

/** 一个导入的名字在代码里的每个出现处（注释与字符串里的不算），连同它后面紧跟的调用的开括号位置。 */
function* bindingUses(
  source: Source,
  local: string,
): Generator<Readonly<{ at: number; open: number | null }>> {
  const { code } = source;
  const name = new RegExp(String.raw`(?<![.#\w$])${escapeIdentifier(local)}(?![\w$])`, "g");
  for (const match of code.matchAll(name)) {
    if (source.literal[match.index] === 1) continue;
    const lineStart = code.lastIndexOf("\n", match.index) + 1;
    // 同名的函数、方法与访问器的定义不是这个绑定的使用。
    if (/\b(?:function|async|static|get|set)\s+$/.test(code.slice(lineStart, match.index)))
      continue;
    const call = /^\s*\(/.exec(code.slice(match.index + local.length));
    yield {
      at: match.index,
      open: call === null ? null : match.index + local.length + call[0].length - 1,
    };
  }
}

/**
 * 直接导入的 `open`/`openSync` 的每个调用点：标志必须在本文件里解析为只读；别名只许直接调用，展开实参算解析
 * 不出。调用点与标志都在去掉注释的代码上找，下标与原文一致。
 */
function creatingOpens(text: string, source: Source, local: string): string[] {
  const found: string[] = [];
  for (const use of bindingUses(source, local)) {
    const line = lineOf(text, use.at);
    if (use.open === null) {
      found.push(`open binding not called directly at line ${line}`);
      continue;
    }
    const args = callArguments(source.code, use.open);
    const kind = args.some((arg) => arg.startsWith("..."))
      ? "unresolved"
      : flagsKind(args[1] || '"r"', source, use.at, 0);
    if (kind !== "read") found.push(`open with ${kind} flags at line ${line}`);
  }
  return found;
}

/**
 * `readFile` 与 `createReadStream` 的选项可以带 `flag` / `flags`（`"a+"` 会新建文件）。它们的第二个实参只许是
 * 没有、一个字符串字面量（编码），或不提 flag 的对象字面量；别的写法（变量、展开、带 flag 的对象）都上报。
 */
function readsWithFlags(text: string, source: Source, imported: string, local: string): string[] {
  const found: string[] = [];
  for (const use of bindingUses(source, local)) {
    const line = lineOf(text, use.at);
    if (use.open === null) {
      found.push(`${imported} binding not called directly at line ${line}`);
      continue;
    }
    const options = (callArguments(source.code, use.open)[1] ?? "").trim();
    const plainEncoding =
      /^["'`]/.test(options) &&
      closingQuote(options, 0) === options.length - 1 &&
      !options.includes("${");
    const flagless = options.startsWith("{") && !/\bflags?\b|\.\.\./.test(options);
    if (options !== "" && !plainEncoding && !flagless) {
      found.push(`${imported} with options that may carry a flag at line ${line}`);
    }
  }
  return found;
}

/** 一个源文件里绕过接缝的写法；空数组表示没有。 */
function scanSource(text: string): string[] {
  const found: string[] = [];
  const importSpecifiers = new Set<number>();
  const rawOpens: string[] = [];
  const flaggedReads: Array<readonly [imported: string, local: string]> = [];
  const constants = new Set<string>();
  // 注释先换成空白（下标不变）：注释里的 "import type … from" 不能把下面真正的导入吞成类型导入。
  const scanned = withoutComments(text);
  let masked = scanned;
  for (const match of scanned.matchAll(FS_IMPORT)) {
    const specifier = match[3] ?? "";
    importSpecifiers.add(match.index + match[0].length - specifier.length);
    masked =
      masked.slice(0, match.index) +
      " ".repeat(match[0].length) +
      masked.slice(match.index + match[0].length);
    if (match[1] !== undefined) continue;
    const clause = (match[2] ?? "").trim();
    if (!clause.startsWith("{")) {
      found.push(clause);
      continue;
    }
    for (const raw of clause.replace(/[{}]/g, "").split(",")) {
      const entry = raw.trim();
      if (entry === "" || entry.startsWith("type ")) continue;
      const [quoted = "", local = quoted] = entry.split(/\s+as\s+/).map((part) => part.trim());
      // 导入名可以写成字符串（`import { "open" as o }`）。
      const imported = quoted.replace(/^(["'])(.*)\1$/, "$2");
      const base = imported.endsWith("Sync") ? imported.slice(0, -4) : imported;
      if (imported === "promises" || ENTRY_MUTATORS.has(base)) found.push(imported);
      if (base === "open") rawOpens.push(local);
      if (base === "readFile" || base === "createReadStream") flaggedReads.push([imported, local]);
      if (imported === "constants") constants.add(local);
    }
  }
  for (const match of scanned.matchAll(FS_SPECIFIER_ANYWHERE)) {
    if (!importSpecifiers.has(match.index)) {
      found.push(`${match[0]} outside a static import at line ${lineOf(text, match.index)}`);
    }
  }
  const source = sourceOf(masked, constants);
  for (const local of rawOpens) found.push(...creatingOpens(text, source, local));
  for (const [imported, local] of flaggedReads) {
    found.push(...readsWithFlags(text, source, imported, local));
  }
  return found;
}

test("接缝完整：src 下除接缝本身与允许表外，没有模块直接新建、删除或改动目录项", () => {
  const files = readdirSync(SOURCE_ROOT, { recursive: true, encoding: "utf8" })
    .map((entry) => path.posix.join("src", entry))
    .filter(
      (file) =>
        file.endsWith(".ts") && file !== SEAM_SOURCE && !file.split("/").includes("generated"),
    )
    .sort();
  equal(files.length > 300, true);
  const violations: string[] = [];
  for (const file of files) {
    for (const found of scanSource(readFileSync(path.join(process.cwd(), file), "utf8"))) {
      violations.push(`${file}: ${found}`);
    }
  }
  deepEqual(
    violations.filter((violation) => !ALLOWED.has(violation)),
    [],
  );
  deepEqual(
    violations.filter((violation) => ALLOWED.has(violation)).sort(),
    [...ALLOWED].sort(),
    "every allowlist entry is still needed",
  );
});

test("扫描器本身：认出绕过接缝的各种写法，放过只读的用法", () => {
  // 改动目录项的命名导入：带不带 node: 前缀、带不带 /promises、同步形式、别名。
  deepEqual(scanSource('import { type FileHandle, unlink } from "node:fs/promises";'), ["unlink"]);
  deepEqual(scanSource('import { linkSync, open as o } from "node:fs";'), ["linkSync"]);
  deepEqual(scanSource('import { rm as remove } from "node:fs/promises";'), ["rm"]);
  deepEqual(scanSource('import { unlink } from "fs/promises";'), ["unlink"]);
  deepEqual(scanSource('import { renameSync } from "fs";'), ["renameSync"]);
  deepEqual(
    scanSource(
      'import { appendFile, copyFile, cp, mkdtemp, symlink, writeFile } from "node:fs/promises";',
    ),
    ["appendFile", "copyFile", "cp", "mkdtemp", "symlink", "writeFile"],
  );
  deepEqual(
    scanSource(
      'import {\n  appendFileSync,\n  copyFileSync,\n  createWriteStream,\n  writeFileSync,\n} from "node:fs";',
    ),
    ["appendFileSync", "copyFileSync", "createWriteStream", "writeFileSync"],
  );
  // 拿到整个 fs 对象的写法。
  deepEqual(scanSource('import fs from "node:fs";'), ["fs"]);
  deepEqual(scanSource('import * as fs from "fs";'), ["* as fs"]);
  deepEqual(scanSource('import { promises as p } from "node:fs";\nawait p.unlink(x);'), [
    "promises",
  ]);
  deepEqual(scanSource('export { unlink } from "node:fs/promises";'), [
    '"node:fs/promises" outside a static import at line 1',
  ]);
  deepEqual(scanSource('const fs = await import("node:fs/promises");'), [
    '"node:fs/promises" outside a static import at line 1',
  ]);
  deepEqual(scanSource('const fs = require("fs");'), ['"fs" outside a static import at line 1']);
  deepEqual(scanSource("const fs = await import(`node:fs/promises`);\nawait fs.unlink(p);"), [
    "`node:fs/promises` outside a static import at line 1",
  ]);
  deepEqual(scanSource("process.getBuiltinModule(`fs`).unlinkSync(p);"), [
    "`fs` outside a static import at line 1",
  ]);
  deepEqual(scanSource('import { mkdtempDisposable } from "node:fs/promises";'), [
    "mkdtempDisposable",
  ]);
  // 直接 open 的创建性标志，逐个调用点判断。
  const openImport = 'import { constants, open as openFileHandle } from "node:fs/promises";\n';
  deepEqual(scanSource(`${openImport}await openFileHandle(p, "wx");`), [
    "open with creating flags at line 2",
  ]);
  deepEqual(scanSource(`${openImport}await openFileHandle(p, "a", 0o600);`), [
    "open with creating flags at line 2",
  ]);
  deepEqual(
    scanSource(`${openImport}await openFileHandle(p, constants.O_WRONLY | constants.O_CREAT);`),
    ["open with creating flags at line 2"],
  );
  const builder =
    "function exclusiveFlags(): number {\n  return constants.O_RDWR | constants.O_CREAT | constants.O_EXCL;\n}\n";
  deepEqual(
    scanSource(
      `${openImport}${builder}const flags = exclusiveFlags();\nawait openFileHandle(p, flags);`,
    ),
    ["open with creating flags at line 6"],
  );
  // 同一文件里一处走接缝、一处直接打开：只报直接的那一处。
  deepEqual(
    scanSource(
      `${openImport}${builder}await filesystemMutation.openExclusive(p, exclusiveFlags(), 0o600);\nawait openFileHandle(p, exclusiveFlags());`,
    ),
    ["open with creating flags at line 6"],
  );
  deepEqual(
    scanSource(
      `${openImport}async function f(flags: number) {\n  return await openFileHandle(p, flags);\n}`,
    ),
    ["open with unresolved flags at line 3"],
  );
  deepEqual(scanSource(`${openImport}await openFileHandle(p, 512);`), [
    "open with unresolved flags at line 2",
  ]);
  deepEqual(scanSource(`${openImport}const o = openFileHandle;\nawait o(p, "w");`), [
    "open binding not called directly at line 2",
  ]);
  // 本代码库自己的写法：命名的标志常量加标志函数（复审给的例子），O_CREAT 只出现在常量里。
  deepEqual(
    scanSource(
      'import { constants as fileSystemConstants, open as openFileHandle } from "node:fs/promises";\nconst EXCLUSIVE = fileSystemConstants.O_RDWR | fileSystemConstants.O_CREAT | fileSystemConstants.O_EXCL;\nfunction candidateFlags(): number {\n  const noFollow: unknown = fileSystemConstants.O_NOFOLLOW;\n  if (typeof noFollow !== "number") fail("x", "$p");\n  return EXCLUSIVE | noFollow;\n}\nawait openFileHandle(p, candidateFlags());',
    ),
    ["open with creating flags at line 8"],
  );
  // 标志函数返回条件表达式里的字符串模式。
  deepEqual(
    scanSource(
      `${openImport}function modeFor(create: boolean): string {\n  return create ? "wx" : "r";\n}\nawait openFileHandle(p, modeFor(true));`,
    ),
    ["open with creating flags at line 5"],
  );
  // 标志函数返回另一个标志函数。
  deepEqual(
    scanSource(
      `${openImport}function createFlags(): number {\n  return constants.O_WRONLY | constants.O_CREAT;\n}\nfunction flagsFor(): number {\n  return createFlags();\n}\nawait openFileHandle(p, flagsFor());`,
    ),
    ["open with creating flags at line 8"],
  );
  // 按位或的第二项才是创建性的函数。
  deepEqual(
    scanSource(
      `${openImport}function readOnly(): number {\n  return constants.O_RDONLY;\n}\nfunction excl(): number {\n  return constants.O_EXCL;\n}\nawait openFileHandle(p, readOnly() | excl());`,
    ),
    ["open with creating flags at line 8"],
  );
  // let 的再赋值与 |= 都算进标志。
  deepEqual(
    scanSource(
      `${openImport}let flags = constants.O_RDONLY;\nflags = constants.O_WRONLY | constants.O_CREAT;\nawait openFileHandle(p, flags);`,
    ),
    ["open with creating flags at line 4"],
  );
  deepEqual(
    scanSource(
      `${openImport}let flags = constants.O_RDONLY;\nflags |= constants.O_CREAT;\nawait openFileHandle(p, flags);`,
    ),
    ["open with creating flags at line 4"],
  );
  // 解析不出就算违规：展开实参、箭头函数、只返回参数的函数、自我递归到层数上限。
  deepEqual(scanSource(`${openImport}await openFileHandle(...args);`), [
    "open with unresolved flags at line 2",
  ]);
  deepEqual(
    scanSource(`${openImport}const arrow = () => "r";\nawait openFileHandle(p, arrow());`),
    ["open with unresolved flags at line 3"],
  );
  deepEqual(
    scanSource(
      `${openImport}function pass(flags: number): number {\n  return flags;\n}\nawait openFileHandle(p, pass(0));`,
    ),
    ["open with unresolved flags at line 5"],
  );
  deepEqual(
    scanSource(
      `${openImport}function loop(): number {\n  return loop();\n}\nawait openFileHandle(p, loop());`,
    ),
    ["open with unresolved flags at line 5"],
  );

  // 名字按作用域解析：别处同名的只读声明盖不住参数、缺省参数、`for` 头、解构与箭头函数的参数。
  const write = "const WRITE = constants.O_WRONLY | constants.O_CREAT;\n";
  deepEqual(
    scanSource(
      `${openImport}function readOnly(path: string) {\n  const flags = constants.O_RDONLY;\n  return openFileHandle(path, flags);\n}\nasync function openCandidate(p: string, flags: number) {\n  return await openFileHandle(p, flags);\n}`,
    ),
    ["open with unresolved flags at line 7"],
  );
  deepEqual(
    scanSource(
      `${openImport}const flags = constants.O_RDONLY;\nasync function openCandidate(p: string, flags: number) {\n  return await openFileHandle(p, flags);\n}`,
    ),
    ["open with unresolved flags at line 4"],
  );
  deepEqual(
    scanSource(
      `${openImport}${write}const base = constants.O_RDONLY;\nfunction withNoFollow(base: number): number {\n  return base | constants.O_NOFOLLOW;\n}\nawait openFileHandle(p, withNoFollow(WRITE));`,
    ),
    ["open with unresolved flags at line 7"],
  );
  deepEqual(
    scanSource(
      `${openImport}${write}const flags = constants.O_RDONLY;\nasync function f(p: string, flags = WRITE) {\n  return await openFileHandle(p, flags);\n}`,
    ),
    ["open with unresolved flags at line 5"],
  );
  deepEqual(
    scanSource(
      `${openImport}const mode = "r";\nfor (const mode of ["wx"]) await openFileHandle(p, mode);`,
    ),
    ["open with unresolved flags at line 3"],
  );
  deepEqual(
    scanSource(
      `${openImport}${write}const flags = constants.O_RDONLY;\nfor (let flags = WRITE; ; ) {\n  await openFileHandle(p, flags);\n}`,
    ),
    ["open with unresolved flags at line 5"],
  );
  deepEqual(
    scanSource(
      `${openImport}const flags = constants.O_RDONLY;\nasync function g(options: Options) {\n  const { flags } = options;\n  await openFileHandle(p, flags);\n}`,
    ),
    ["open with unresolved flags at line 5"],
  );
  deepEqual(
    scanSource(
      `${openImport}const flags = constants.O_RDONLY;\nconst reopen = async flags => await openFileHandle(p, flags);`,
    ),
    ["open with unresolved flags at line 3"],
  );
  deepEqual(
    scanSource(
      `${openImport}const flags = constants.O_RDONLY;\ntry {\n  work();\n} catch (flags) {\n  await openFileHandle(p, flags);\n}`,
    ),
    ["open with unresolved flags at line 6"],
  );
  // 两个函数里各有一个同名的标志函数：按使用处看得见的那个解析，不取文件里的第一个。
  deepEqual(
    scanSource(
      `${openImport}${write}function a() {\n  function flagsFor(): number {\n    return constants.O_RDONLY;\n  }\n  return flagsFor();\n}\nfunction b() {\n  function flagsFor(): number {\n    return WRITE;\n  }\n  return openFileHandle(p, flagsFor());\n}`,
    ),
    ["open with creating flags at line 13"],
  );
  // 别的对象上的 `x.O_…` 不按名字放过；解构赋值算解析不出。
  deepEqual(
    scanSource(`${openImport}const OWN = { O_RDWR: 2 };\nawait openFileHandle(p, OWN.O_RDWR);`),
    ["open with unresolved flags at line 3"],
  );
  deepEqual(
    scanSource(
      `${openImport}${write}let flags = constants.O_RDONLY;\n[flags] = [WRITE];\nawait openFileHandle(p, flags);`,
    ),
    ["open with unresolved flags at line 5"],
  );
  // 复核补的写法：内层的同名变量盖住外层的标志函数；逗号后面的声明项；`var` 的提升；`for (name of …)`
  // 作目标；隔着空白的数组解构赋值；名叫 `with` 的方法；返回类型里带花括号；同名参数盖住导入的 constants。
  const readOnly = "const flags = constants.O_RDONLY;\n";
  deepEqual(
    scanSource(
      `${openImport}${write}function flagsFor(): number {\n  return constants.O_RDONLY;\n}\nfunction g() {\n  const flagsFor = () => WRITE;\n  return openFileHandle(p, flagsFor());\n}`,
    ),
    ["open with unresolved flags at line 8"],
  );
  deepEqual(
    scanSource(
      `${openImport}${write}${readOnly}function g() {\n  const a = 1, flags = WRITE;\n  return openFileHandle(p, flags);\n}`,
    ),
    ["open with creating flags at line 6"],
  );
  deepEqual(
    scanSource(
      `${openImport}${readOnly}function g(o: Options) {\n  const a = 1, { flags } = o;\n  return openFileHandle(p, flags);\n}`,
    ),
    ["open with unresolved flags at line 5"],
  );
  deepEqual(
    scanSource(
      `${openImport}${write}${readOnly}function g(c: boolean) {\n  if (c) {\n    var flags = WRITE;\n  }\n  return openFileHandle(p, flags);\n}`,
    ),
    ["open with unresolved flags at line 8"],
  );
  deepEqual(
    scanSource(
      `${openImport}${write}let flags = constants.O_RDONLY;\nfor (flags of [WRITE]) await openFileHandle(p, flags);`,
    ),
    ["open with unresolved flags at line 4"],
  );
  deepEqual(
    scanSource(
      `${openImport}${write}let flags = constants.O_RDONLY;\nif (c) [flags] = [WRITE];\nawait openFileHandle(p, flags);`,
    ),
    ["open with unresolved flags at line 5"],
  );
  deepEqual(
    scanSource(
      `${openImport}${readOnly}class A {\n  with(flags: number) {\n    return openFileHandle(p, flags);\n  }\n}`,
    ),
    ["open with unresolved flags at line 5"],
  );
  deepEqual(
    scanSource(
      `${openImport}${readOnly}function g(flags: unknown): flags is { a: 1 } {\n  return openFileHandle(p, flags) === null;\n}`,
    ),
    ["open with unresolved flags at line 4"],
  );
  deepEqual(
    scanSource(
      `${openImport}function g(constants: Own) {\n  return openFileHandle(p, constants.O_RDWR);\n}`,
    ),
    ["open with unresolved flags at line 3"],
  );
  // 字符串写的导入名；导入上方注释里的 "import type … from"；首尾是引号的拼接；只有声明没有函数体的函数。
  deepEqual(scanSource('import { "open" as o } from "node:fs/promises";\nawait o(p, "wx");'), [
    "open with creating flags at line 2",
  ]);
  deepEqual(scanSource('import { "unlink" as u } from "node:fs/promises";'), ["unlink"]);
  deepEqual(
    scanSource(
      '// we import type information from elsewhere\nimport { open, unlink } from "node:fs/promises";\nawait open(p, "r");',
    ),
    ["unlink"],
  );
  deepEqual(scanSource(`${openImport}const M = "wx";\nawait openFileHandle(p, "" + M + "");`), [
    "open with unresolved flags at line 3",
  ]);
  deepEqual(
    scanSource(
      `${openImport}declare function writeFlags(): number;\nfunction other(): number {\n  return constants.O_RDONLY;\n}\nawait openFileHandle(p, writeFlags());`,
    ),
    ["open with unresolved flags at line 6"],
  );
  // `readFile` 与 `createReadStream` 的选项里的 flag 也能新建文件。
  const readImport = 'import { createReadStream, readFile } from "node:fs";\n';
  deepEqual(scanSource(`${readImport}await readFile(p, { flag: "a+" });`), [
    "readFile with options that may carry a flag at line 2",
  ]);
  deepEqual(scanSource(`${readImport}createReadStream(p, options);`), [
    "createReadStream with options that may carry a flag at line 2",
  ]);
  deepEqual(
    scanSource(
      `${readImport}await readFile(p);\nawait readFile(p, "utf8");\nawait readFile(p, { encoding: "utf8", signal });\ncreateReadStream(p, { start: 0 });`,
    ),
    [],
  );

  // 只读的用法不需要允许表。
  deepEqual(scanSource('import type { BigIntStats } from "node:fs";'), []);
  deepEqual(scanSource('import { existsSync, readFileSync, realpathSync } from "node:fs";'), []);
  deepEqual(
    scanSource(
      'import { lstat, open, opendir, readFile } from "node:fs/promises";\nawait open(p);\nawait open(p, "r");\nawait RootedDirectory.open(p, "wx");\nclass A {\n  static async open(path: string, flags: number) {}\n}',
    ),
    [],
  );
  deepEqual(
    scanSource(
      `${openImport}const READ_FLAGS = constants.O_RDONLY | constants.O_NOFOLLOW;\nawait openFileHandle(p, READ_FLAGS);`,
    ),
    [],
  );
  deepEqual(
    scanSource(
      `${openImport}function readFlags(): number {\n  // it's read-only (quote in a comment)\n  return constants.O_RDONLY;\n}\n${builder}await openFileHandle(p, readFlags());\nawait filesystemMutation.openExclusive(p, exclusiveFlags(), 0o600);\nawait RootedDirectory.open(p);`,
    ),
    [],
  );
  // 今天的只读标志函数的样子：局部常量、条件表达式、let 加再赋值；返回值之外的字符串（错误原因）不算模式。
  deepEqual(
    scanSource(
      `${openImport}function requiredOpenFlags(kind: string, errorPath: string): number {\n  const noFollow: unknown = constants.O_NOFOLLOW;\n  if (typeof noFollow !== "number") fail("unsupported-platform", errorPath);\n  const nonBlocking = typeof constants.O_NONBLOCK === "number" ? constants.O_NONBLOCK : 0;\n  let directory = 0;\n  if (kind === "directory") {\n    const value: unknown = constants.O_DIRECTORY;\n    if (typeof value !== "number") fail("root-scope", errorPath);\n    directory = value;\n  }\n  return constants.O_RDONLY | noFollow | nonBlocking | directory;\n}\nawait openFileHandle(p, requiredOpenFlags("file", p));`,
    ),
    [],
  );
  // 作用域之内的合法写法不误报：两个函数各有自己的 `flags`（一个是声明、一个是不拿去打开的参数），内层
  // 块里的声明盖住同名参数，再赋值的右边出现它自己，类型断言，字符串里的 return。
  deepEqual(
    scanSource(
      `${openImport}function a(path: string) {\n  const flags = constants.O_RDONLY;\n  return openFileHandle(path, flags);\n}\nfunction b(flags: number): number {\n  return flags;\n}`,
    ),
    [],
  );
  deepEqual(
    scanSource(
      `${openImport}function c(flags: number) {\n  {\n    const flags = constants.O_RDONLY;\n    return openFileHandle(p, flags);\n  }\n}`,
    ),
    [],
  );
  deepEqual(
    scanSource(
      `${openImport}let flags = constants.O_RDONLY;\nif (noFollow) flags = flags | constants.O_NOFOLLOW;\nawait openFileHandle(p, flags);`,
    ),
    [],
  );
  deepEqual(
    scanSource(
      `${openImport}const READ = constants.O_RDONLY;\nawait openFileHandle(p, READ as number);\nawait openFileHandle(p, READ!);`,
    ),
    [],
  );
  deepEqual(
    scanSource(
      `${openImport}function readFlags(): number {\n  if (bad) fail("cannot return here");\n  return constants.O_RDONLY;\n}\nawait openFileHandle(p, readFlags());`,
    ),
    [],
  );
  // 注释里提到这个名字不算使用。
  deepEqual(
    scanSource(
      `${openImport}/** 用 \`openFileHandle\` 只读打开。 */\nawait openFileHandle(p, "r");`,
    ),
    [],
  );
});

test("接缝对象不冻结，测试可以替换成员", () => {
  equal(Object.isFrozen(filesystemMutation), false);
});
