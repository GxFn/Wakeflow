import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { initSync, parse } from "es-module-lexer";
import { isMainModule } from "../main-module.js";

/**
 * Wakeflow Tooling / Codegen：把 Claude Code 宿主脚本的源文件装配成自包含脚本，写成运行时读取的生成模块。
 *
 * Wakeflow 发布进工作区的三段脚本（tmux 助手、桌面助手、状态栏脚本）每个都是一份不依赖任何相邻文件的
 * `.mjs`；源码却要按片段共用——prompt 规则、hook 记录查询、有界读取只写一份——并经过 `tsc` 的 `checkJs`
 * 与 Biome。本生成器是两者之间唯一的一步：从入口文件出发，把它静态导入的片段按 ESM 的求值顺序（导入序
 * 的后序遍历）内联进来，去掉片段的 `export` 与片段之间的导入，把 `node:` 导入合并成每个模块一条。它不是
 * 通用打包器，只接受下面这套收窄的写法，其余一律报错而不是猜：
 *
 * - 导入只有两种：`node:` 内置模块（默认导入或具名导入，不带 `as`），与源目录之内的相对 `.mjs` 片段
 *   （只许具名导入，不带 `as`）。导入语句排在文件其他语句之前。
 * - 片段只导出顶层声明（`export function` / `export const` / `export class`），一条语句一个名字；
 *   入口不导出任何东西。
 * - 内联之后所有顶层名字共处一个模块作用域：重名是语法错误，脚本的进程级测试第一条就会失败。
 *
 * 模板里的 `__WAKEFLOW_…__` 是构建期记号：取值来自运行时自己的常量（按角色的许可规则、Node 引擎范围
 * ……），由宿主的资产模块在装配发布字节时替换，所以改那些常量不需要重新生成。生成模块同时导出记号清单，
 * 资产模块的取值表按它定型，漏一个记号过不了类型检查。
 *
 * `build` 写生成模块；`check` 只比对：提交的生成模块与当前源文件装配出来的不一致就失败（与
 * `schema:check` 同一做法）。
 */

/** 助手源文件的根；片段的相对导入不许走出这里。 */
export const HELPER_ASSET_SOURCE_ROOT = "src/hosts/claude-code/assets";
/** 生成模块的根；不参与 Biome 与 knip。 */
export const HELPER_ASSET_GENERATED_ROOT = "src/hosts/claude-code/generated";

interface HelperAssetDefinition {
  /** 入口文件，相对源根。 */
  readonly entry: string;
  /** 生成模块里两个导出常量的前缀。 */
  readonly constantPrefix: string;
  /** 生成模块的文件名，相对生成根。 */
  readonly output: string;
}

export const HELPER_ASSET_DEFINITIONS: readonly HelperAssetDefinition[] = Object.freeze([
  Object.freeze({
    entry: "tmux.mjs",
    constantPrefix: "CLAUDE_CODE_TMUX_HELPER",
    output: "claude-code-tmux-helper.generated.ts",
  }),
  Object.freeze({
    entry: "desktop.mjs",
    constantPrefix: "CLAUDE_CODE_DESKTOP_HELPER",
    output: "claude-code-desktop-helper.generated.ts",
  }),
  Object.freeze({
    entry: "statusline.mjs",
    constantPrefix: "CLAUDE_CODE_STATUSLINE_SCRIPT",
    output: "claude-code-statusline-script.generated.ts",
  }),
]);

type HelperAssetCodegenErrorCode =
  | "wakeflow-helper-assets-argv"
  | "wakeflow-helper-assets-source"
  | "wakeflow-helper-assets-drift";

export class HelperAssetCodegenError extends Error {
  override readonly name = "HelperAssetCodegenError";
  readonly code: HelperAssetCodegenErrorCode;

  constructor(code: HelperAssetCodegenErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

function fail(code: HelperAssetCodegenErrorCode, message: string): never {
  throw new HelperAssetCodegenError(code, message);
}

const NODE_SPECIFIER = /^node:[a-z_/]+$/u;
const FRAGMENT_SPECIFIER = /^\.{1,2}\/(?:[a-z0-9-]+\/)*[a-z0-9-]+\.mjs$/u;
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/u;
const IMPORT_STATEMENT =
  /^import\s+(?:(?<defaultName>[A-Za-z_$][\w$]*)\s*)?(?:,\s*)?(?:\{(?<named>[^}]*)\}\s*)?from\s*"(?<specifier>[^"]+)"$/su;
const EXPORTED_DECLARATION = /^export (?=(?:async function\*?|function\*?|const|class) )/u;
const BUILD_TOKEN = /__WAKEFLOW_[A-Z0-9_]+__/gu;

interface ParsedImport {
  readonly specifier: string;
  readonly defaultName: string | null;
  readonly names: readonly string[];
}

interface SourceModule {
  readonly file: string;
  /** 第一条导入之前的文本（入口的 shebang 与文件头注释；片段的文件头注释）。 */
  readonly head: string;
  /** 导入之后的正文，片段的 `export` 已去掉。 */
  readonly body: string;
  readonly nodeImports: readonly ParsedImport[];
  /** 导入的片段，相对源根，按导入语句的顺序。 */
  readonly fragments: readonly string[];
}

export interface AssembledHelperAsset {
  /** 自包含脚本的模板：记号尚未替换，以换行结尾。 */
  readonly template: string;
  /** 模板里出现的构建期记号，去重并排序。 */
  readonly tokens: readonly string[];
  /** 装配进来的源文件，相对源根，按装配顺序（片段在前，入口最后）。 */
  readonly sources: readonly string[];
}

/** 按相对源根的 posix 路径读一个源文件；读不到时抛错。 */
export type HelperAssetSourceReader = (file: string) => string;

function parseImportClause(file: string, statement: string): ParsedImport {
  const match = IMPORT_STATEMENT.exec(statement);
  const groups = match?.groups;
  if (groups === undefined) {
    fail("wakeflow-helper-assets-source", `${file}: unsupported import form: ${statement}`);
  }
  const specifier = groups.specifier ?? "";
  const defaultName = groups.defaultName ?? null;
  const names = (groups.named ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
  for (const name of names) {
    if (!IDENTIFIER.test(name)) {
      fail(
        "wakeflow-helper-assets-source",
        `${file}: import binding must be a plain name: ${name}`,
      );
    }
  }
  if (defaultName === null && names.length === 0) {
    fail("wakeflow-helper-assets-source", `${file}: import binds nothing: ${statement}`);
  }
  return Object.freeze({ specifier, defaultName, names: Object.freeze(names) });
}

function resolveFragment(file: string, specifier: string): string {
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier));
  if (resolved.startsWith("../") || path.posix.isAbsolute(resolved)) {
    fail("wakeflow-helper-assets-source", `${file}: import leaves the source root: ${specifier}`);
  }
  return resolved;
}

/** 去掉片段声明前的 `export`；入口不许有导出，片段的每个导出都必须是一条顶层声明。 */
function stripExports(file: string, text: string, exportCount: number, entry: boolean): string {
  const lines = text.split("\n");
  let stripped = 0;
  for (const [index, line] of lines.entries()) {
    if (!line.startsWith("export")) continue;
    if (!EXPORTED_DECLARATION.test(line)) {
      fail(
        "wakeflow-helper-assets-source",
        `${file}:${index + 1}: only top-level declarations may be exported`,
      );
    }
    lines[index] = line.slice("export ".length);
    stripped += 1;
  }
  if (stripped !== exportCount) {
    fail(
      "wakeflow-helper-assets-source",
      `${file}: ${exportCount} exported name(s) but ${stripped} exported declaration(s); export one name per statement`,
    );
  }
  if (entry && stripped > 0) {
    fail("wakeflow-helper-assets-source", `${file}: a helper entry exports nothing`);
  }
  return lines.join("\n");
}

function parseSourceModule(file: string, source: string, entry: boolean): SourceModule {
  let parsed: ReturnType<typeof parse>;
  try {
    parsed = parse(source, file);
  } catch {
    fail("wakeflow-helper-assets-source", `${file}: not a parseable ES module`);
  }
  const [imports, exports] = parsed;
  const nodeImports: ParsedImport[] = [];
  const fragments: string[] = [];
  let head: string | null = null;
  let cursor = 0;
  for (const record of imports) {
    // `import.meta` 不是导入语句；动态导入不接受。
    if (record.d === -2) continue;
    if (record.d !== -1 || record.n === undefined) {
      fail("wakeflow-helper-assets-source", `${file}: dynamic imports are not supported`);
    }
    const between = source.slice(cursor, record.ss);
    if (head === null) head = between;
    else if (between.trim().length > 0) {
      fail(
        "wakeflow-helper-assets-source",
        `${file}: imports must come before any other statement`,
      );
    }
    const lineStart = record.ss === 0 || source[record.ss - 1] === "\n";
    const terminated = source.slice(record.se, record.se + 2) === ";\n";
    if (!lineStart || !terminated) {
      fail(
        "wakeflow-helper-assets-source",
        `${file}: each import is one statement on its own line(s)`,
      );
    }
    const clause = parseImportClause(file, source.slice(record.ss, record.se));
    if (NODE_SPECIFIER.test(clause.specifier)) {
      nodeImports.push(clause);
    } else if (FRAGMENT_SPECIFIER.test(clause.specifier)) {
      if (clause.defaultName !== null) {
        fail("wakeflow-helper-assets-source", `${file}: fragments have no default export`);
      }
      fragments.push(resolveFragment(file, clause.specifier));
    } else {
      fail(
        "wakeflow-helper-assets-source",
        `${file}: unsupported import source: ${clause.specifier}`,
      );
    }
    cursor = record.se + 2;
  }
  const rest = source.slice(cursor);
  if (head === null) {
    // 没有任何导入：整个文件就是正文。
    return Object.freeze({
      file,
      head: "",
      body: stripExports(file, rest, exports.length, entry),
      nodeImports: Object.freeze(nodeImports),
      fragments: Object.freeze(fragments),
    });
  }
  return Object.freeze({
    file,
    head,
    body: stripExports(file, rest.replace(/^\n+/u, ""), exports.length, entry),
    nodeImports: Object.freeze(nodeImports),
    fragments: Object.freeze(fragments),
  });
}

function mergeNodeImports(modules: readonly SourceModule[]): string {
  const merged = new Map<string, { defaultName: string | null; names: Set<string> }>();
  for (const module of modules) {
    for (const clause of module.nodeImports) {
      const entry = merged.get(clause.specifier) ?? { defaultName: null, names: new Set<string>() };
      if (clause.defaultName !== null) {
        if (entry.defaultName !== null && entry.defaultName !== clause.defaultName) {
          fail(
            "wakeflow-helper-assets-source",
            `${module.file}: ${clause.specifier} is imported under two default names`,
          );
        }
        entry.defaultName = clause.defaultName;
      }
      for (const name of clause.names) entry.names.add(name);
      merged.set(clause.specifier, entry);
    }
  }
  return [...merged.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([specifier, entry]) => {
      const named = entry.names.size === 0 ? null : `{ ${[...entry.names].sort().join(", ")} }`;
      const bindings = [entry.defaultName, named].filter((part) => part !== null).join(", ");
      return `import ${bindings} from "${specifier}";\n`;
    })
    .join("");
}

/**
 * 把一个入口装配成自包含脚本的模板。
 *
 * 产物的次序：入口的文件头（shebang 与头注释）、合并后的 `node:` 导入、各片段（导入序的后序遍历，
 * 每个只出现一次）、入口正文。
 */
export function assembleHelperAsset(
  read: HelperAssetSourceReader,
  entry: string,
): Readonly<AssembledHelperAsset> {
  initSync();
  const modules = new Map<string, SourceModule>();
  const order: SourceModule[] = [];
  const visiting = new Set<string>();

  function visit(file: string, isEntry: boolean): void {
    if (modules.has(file)) return;
    if (visiting.has(file)) {
      fail("wakeflow-helper-assets-source", `${file}: fragments import each other in a cycle`);
    }
    visiting.add(file);
    let source: string;
    try {
      source = read(file);
    } catch {
      fail("wakeflow-helper-assets-source", `${file}: source file cannot be read`);
    }
    if (source.includes("\r") || !source.endsWith("\n")) {
      fail(
        "wakeflow-helper-assets-source",
        `${file}: sources use LF line endings and end with one`,
      );
    }
    const module = parseSourceModule(file, source, isEntry);
    for (const fragment of module.fragments) visit(fragment, false);
    visiting.delete(file);
    modules.set(file, module);
    order.push(module);
  }

  visit(entry, true);
  const entryModule = order.at(-1);
  if (entryModule === undefined)
    fail("wakeflow-helper-assets-source", `${entry}: nothing to assemble`);
  const fragments = order.slice(0, -1);
  const template = [
    entryModule.head,
    mergeNodeImports(order),
    "\n",
    ...fragments.map((fragment) => `${fragment.head}${fragment.body}\n`),
    entryModule.body,
  ].join("");
  if (
    /^(?:import|export)\s/mu.test(
      template
        .slice(entryModule.head.length)
        .replace(/^import [^\n]+ from "node:[^\n]+";\n/gmu, ""),
    )
  ) {
    fail("wakeflow-helper-assets-source", `${entry}: an import or export survived the assembly`);
  }
  const tokens = [...new Set(template.match(BUILD_TOKEN) ?? [])].sort();
  return Object.freeze({
    template,
    tokens: Object.freeze(tokens),
    sources: Object.freeze(order.map((module) => module.file)),
  });
}

/** 生成模块的源文本：记号清单与按行写出的模板（逐行一个字符串字面量，diff 按行可读）。 */
export function renderHelperAssetModule(
  definition: Readonly<HelperAssetDefinition>,
  assembled: Readonly<AssembledHelperAsset>,
): string {
  const lines = assembled.template.split("\n");
  return [
    `// 由 \`npm run helpers:build\` 生成，不要手改：源文件在 ${HELPER_ASSET_SOURCE_ROOT}/，`,
    "// 生成器是 tooling/codegen/helper-assets.ts，`npm run helpers:check` 核对两者没有漂移。",
    `// 装配顺序：${assembled.sources.join("、")}。`,
    "",
    "/** 模板里的构建期记号：装配发布字节时每个都要有取值。 */",
    `export const ${definition.constantPrefix}_TOKENS = [`,
    ...assembled.tokens.map((token) => `  ${JSON.stringify(token)},`),
    "] as const;",
    "",
    "/** 自包含的助手脚本模板，记号尚未替换。 */",
    `export const ${definition.constantPrefix}_TEMPLATE: string = [`,
    ...lines.map((line) => `  ${JSON.stringify(line)},`),
    '].join("\\n");',
    "",
  ].join("\n");
}

function sourceReader(repoRoot: string): HelperAssetSourceReader {
  return (file) =>
    readFileSync(path.join(repoRoot, HELPER_ASSET_SOURCE_ROOT, ...file.split("/")), "utf8");
}

export interface HelperAssetCodegenResult {
  readonly mode: "build" | "check";
  readonly helpers: readonly Readonly<{
    entry: string;
    output: string;
    sources: number;
    tokens: number;
    lines: number;
  }>[];
}

function generate(repoRoot: string): readonly Readonly<{
  definition: Readonly<HelperAssetDefinition>;
  assembled: Readonly<AssembledHelperAsset>;
  rendered: string;
}>[] {
  const read = sourceReader(repoRoot);
  return HELPER_ASSET_DEFINITIONS.map((definition) => {
    const assembled = assembleHelperAsset(read, definition.entry);
    return { definition, assembled, rendered: renderHelperAssetModule(definition, assembled) };
  });
}

function summarize(
  mode: "build" | "check",
  generated: ReturnType<typeof generate>,
): Readonly<HelperAssetCodegenResult> {
  return Object.freeze({
    mode,
    helpers: Object.freeze(
      generated.map(({ definition, assembled }) =>
        Object.freeze({
          entry: `${HELPER_ASSET_SOURCE_ROOT}/${definition.entry}`,
          output: `${HELPER_ASSET_GENERATED_ROOT}/${definition.output}`,
          sources: assembled.sources.length,
          tokens: assembled.tokens.length,
          lines: assembled.template.split("\n").length - 1,
        }),
      ),
    ),
  });
}

/** 从源文件重新生成两个助手的生成模块。 */
export function buildHelperAssets(repoRoot: string): Readonly<HelperAssetCodegenResult> {
  const generated = generate(repoRoot);
  const outputRoot = path.join(repoRoot, ...HELPER_ASSET_GENERATED_ROOT.split("/"));
  mkdirSync(outputRoot, { recursive: true });
  for (const { definition, rendered } of generated) {
    writeFileSync(path.join(outputRoot, definition.output), rendered);
  }
  return summarize("build", generated);
}

/** 只读核对：提交的生成模块必须逐字节等于当前源文件装配出来的结果。 */
export function checkHelperAssets(repoRoot: string): Readonly<HelperAssetCodegenResult> {
  const generated = generate(repoRoot);
  for (const { definition, rendered } of generated) {
    const output = `${HELPER_ASSET_GENERATED_ROOT}/${definition.output}`;
    let committed: string | null = null;
    try {
      committed = readFileSync(path.join(repoRoot, ...output.split("/")), "utf8");
    } catch {
      committed = null;
    }
    if (committed !== rendered) {
      fail(
        "wakeflow-helper-assets-drift",
        `${output} ${committed === null ? "is missing" : `does not match ${HELPER_ASSET_SOURCE_ROOT}/`}; run npm run helpers:build`,
      );
    }
  }
  return summarize("check", generated);
}

function parseCli(
  args: readonly string[],
): Readonly<{ mode: "build" | "check"; repoRoot: string }> {
  const [mode, flag, repoRoot, ...extra] = args;
  if (mode !== "build" && mode !== "check") {
    fail("wakeflow-helper-assets-argv", "first argument must be build or check");
  }
  if (
    flag !== "--repo-root" ||
    repoRoot === undefined ||
    repoRoot.length === 0 ||
    extra.length > 0
  ) {
    fail("wakeflow-helper-assets-argv", "usage: helper-assets <build|check> --repo-root <path>");
  }
  return Object.freeze({ mode, repoRoot });
}

function main(): void {
  try {
    const cli = parseCli(process.argv.slice(2));
    const result =
      cli.mode === "build" ? buildHelperAssets(cli.repoRoot) : checkHelperAssets(cli.repoRoot);
    console.log(JSON.stringify({ ok: true, ...result }, null, 2));
  } catch (error: unknown) {
    const code =
      error instanceof HelperAssetCodegenError ? error.code : "wakeflow-helper-assets-unexpected";
    const message = error instanceof Error ? error.message : String(error);
    console.error(JSON.stringify({ ok: false, error: { code, message } }, null, 2));
    process.exitCode = 1;
  }
}

// 被导入时只提供纯 API；只有直接执行本编译入口时才运行 CLI。
if (isMainModule(import.meta.url)) main();
