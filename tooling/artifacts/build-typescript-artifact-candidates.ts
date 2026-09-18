import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import type { Stats } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { initSync, parse } from "es-module-lexer";

/**
 * Wakeflow Tooling / Artifacts：TypeScript 技术骨干的双宿主候选制品装配器。
 *
 * 本工具以已编译宿主入口为根，使用成熟ES module lexer求取真实静态依赖闭包，
 * 只把可达 JavaScript、精确 npm 依赖和最小启动资产写入 `.build`。每个候选有两个
 * launcher（gate-log §13.97 D8）：`mcp/server.mjs`（宿主 MCP 入口）与 `hooks/observe.mjs`
 * （hook 观察脚本，闭包必须全是 shared 范围）；闭包取两个根的并集，按路径去重后每个文件
 * 只写一次。`hooks/hooks.json` 在运行时动态 import 该宿主编译后的 hook 片段模块渲染，并按
 * 该模块导出的摘要核对渲染字节——tooling 对编译产物没有静态类型边。它不会读取旧 JS
 * 运行时来补能力，也不会更新 `plugins/`、安装缓存或任何发布版本来源。
 *
 * 候选制品明确标记为不可发布；它只验证 TS 单一源码能够形成 Codex 与 Claude Code
 * 两个隔离闭包。完整 Skills、模板、业务工具和最终插件 manifest 留到整体切换阶段。
 */

const DEFAULT_OUTPUT_ROOT = ".build/artifacts";
const COMPILED_SOURCE_ROOT = ".build/src";
const MAXIMUM_MODULE_BYTES = 8 * 1024 * 1024;
const MAXIMUM_COMPILED_MODULES = 1024;
const CANDIDATE_VERSION = "0.0.0-technical-skeleton";
const CANDIDATE_SCOPE = "typescript-public-technical-skeleton";

type CandidateHostId = "codex" | "claude-code";
type CompiledFileScope = "shared" | "current-host" | "peer-profile";
type LauncherKind = "mcp" | "hook-observer";
type RuntimeEntrypointPath = "mcp/server.mjs" | "hooks/observe.mjs";

interface LauncherDefinition {
  readonly kind: LauncherKind;
  /** 制品根下的启动文件路径。 */
  readonly runtimeEntrypoint: RuntimeEntrypointPath;
  /** 编译根下的入口模块（闭包的根）。 */
  readonly entrypoint: string;
  readonly runExport: string;
}

interface HookFragmentDefinition {
  /** 编译根下的宿主 hook 片段模块；只在运行时动态 import，不进任何闭包。 */
  readonly module: string;
  readonly renderExport: string;
  /** 片段自己声明的渲染字节摘要；构建器写出 `hooks/hooks.json` 前按它核对（§13.97 D6）。 */
  readonly digestExport: string;
}

/**
 * 宿主隔离规则：一个候选制品里编译文件的范围只由这四项决定（§13.97 D8）。它与候选的其余
 * 定义（launcher、片段、包元数据）分开，所以范围守卫可以被单独调用与回归。导出供回归测试。
 */
export interface CandidateHostIsolationRule {
  readonly hostId: CandidateHostId;
  readonly currentHostDirectory: string;
  readonly peerHostDirectory: string;
  /**
   * 对端宿主目录里唯一准入的纯数据模块：资源 profile 与窗口宿主身份 profile。观察
   * 读每个宿主的绑定与 hook 通道需要它们（§13.94 D1）；对端的执行内容（维护、
   * 设置、状态栏资产）一律不进本宿主制品。
   */
  readonly admittedPeerModules: readonly string[];
}

interface CandidateDefinition extends CandidateHostIsolationRule {
  readonly directoryName: "codex-wakeflow" | "claude-code-wakeflow";
  readonly referencePackagePath: string;
  /** 第一个是 MCP 入口（清单的 `runtimeEntrypoint` 仍指向它），第二个是 hook 观察脚本。 */
  readonly launchers: readonly [
    Readonly<LauncherDefinition & { readonly kind: "mcp" }>,
    Readonly<LauncherDefinition & { readonly kind: "hook-observer" }>,
  ];
  readonly hookFragment: Readonly<HookFragmentDefinition>;
}

const HOOK_OBSERVER_LAUNCHER = Object.freeze({
  kind: "hook-observer",
  runtimeEntrypoint: "hooks/observe.mjs",
  entrypoint: "entrypoints/wakeflow-hook-observer.js",
  runExport: "main",
} as const satisfies Readonly<LauncherDefinition>);

const CANDIDATES = Object.freeze([
  Object.freeze({
    hostId: "codex",
    directoryName: "codex-wakeflow",
    referencePackagePath: "plugins/codex-wakeflow/package.json",
    launchers: Object.freeze([
      Object.freeze({
        kind: "mcp",
        runtimeEntrypoint: "mcp/server.mjs",
        entrypoint: "entrypoints/codex-wakeflow-mcp.js",
        runExport: "runCodexWakeflowMcpStdio",
      } as const),
      HOOK_OBSERVER_LAUNCHER,
    ] as const),
    hookFragment: Object.freeze({
      module: "hosts/codex/codex-hook-fragment.js",
      renderExport: "renderCodexHooksJson",
      digestExport: "CODEX_HOOK_FRAGMENT_DIGEST",
    }),
    currentHostDirectory: "hosts/codex/",
    peerHostDirectory: "hosts/claude-code/",
    admittedPeerModules: Object.freeze([
      "hosts/claude-code/claude-code-window-host-identity-profile.js",
      "hosts/claude-code/wakeflow-workspace-host-resource-profile.js",
    ]),
  }),
  Object.freeze({
    hostId: "claude-code",
    directoryName: "claude-code-wakeflow",
    referencePackagePath: "plugins/claude-code-wakeflow/package.json",
    launchers: Object.freeze([
      Object.freeze({
        kind: "mcp",
        runtimeEntrypoint: "mcp/server.mjs",
        entrypoint: "entrypoints/claude-code-wakeflow-mcp.js",
        runExport: "runClaudeCodeWakeflowMcpStdio",
      } as const),
      HOOK_OBSERVER_LAUNCHER,
    ] as const),
    hookFragment: Object.freeze({
      module: "hosts/claude-code/claude-code-hook-fragment.js",
      renderExport: "renderClaudeCodeHooksJson",
      digestExport: "CLAUDE_CODE_HOOK_FRAGMENT_DIGEST",
    }),
    currentHostDirectory: "hosts/claude-code/",
    peerHostDirectory: "hosts/codex/",
    admittedPeerModules: Object.freeze([
      "hosts/codex/codex-window-host-identity-profile.js",
      "hosts/codex/wakeflow-workspace-host-resource-profile.js",
    ]),
  }),
] as const satisfies readonly Readonly<CandidateDefinition>[]);

interface JsonRecord {
  readonly [key: string]: unknown;
}

interface CompiledClosure {
  readonly files: readonly string[];
  readonly externalPackages: readonly string[];
}

interface TypescriptArtifactCandidateBuildRecord {
  readonly hostId: CandidateHostId;
  readonly outputDirectory: string;
  readonly compiledFileCount: number;
  readonly externalPackages: readonly string[];
  readonly manifestDigest: string;
}

interface TypescriptArtifactCandidatesBuildResult {
  readonly kind: "WakeflowTypescriptArtifactCandidatesBuildResult";
  readonly schemaVersion: 1;
  readonly releaseEligible: false;
  readonly outputRoot: string;
  readonly artifacts: readonly Readonly<TypescriptArtifactCandidateBuildRecord>[];
}

/** 候选制品输入、闭包或物理输出不满足约束时返回的稳定工具错误。 */
class TypescriptArtifactCandidateBuildError extends Error {
  override readonly name = "TypescriptArtifactCandidateBuildError";
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

function fail(code: string, message: string): never {
  throw new TypescriptArtifactCandidateBuildError(code, message);
}

function isPlainRecord(value: unknown): value is JsonRecord {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function lstatOrNull(target: string): Stats | null {
  try {
    return lstatSync(target);
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function repositoryRelative(repositoryRoot: string, absolute: string): string {
  return path.relative(repositoryRoot, absolute).split(path.sep).join("/") || ".";
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function assertBelow(parent: string, child: string, code: string): void {
  const relative = path.relative(parent, child);
  if (
    relative.length === 0 ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    fail(code, "artifact path escaped its declared parent");
  }
}

function assertRealDirectory(directory: string, label: string): void {
  const stat = lstatOrNull(directory);
  if (stat === null || stat.isSymbolicLink() || !stat.isDirectory()) {
    fail("wakeflow-artifact-directory", `${label} must be one real directory`);
  }
}

function ensureRealDirectoryPath(root: string, directory: string): void {
  const relative = path.relative(root, directory);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    fail("wakeflow-artifact-output-scope", "output directory escaped repository root");
  }
  let current = root;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    const stat = lstatOrNull(current);
    if (stat === null) {
      mkdirSync(current, { mode: 0o755 });
    } else if (stat.isSymbolicLink() || !stat.isDirectory()) {
      fail(
        "wakeflow-artifact-directory",
        `${repositoryRelative(root, current)} must be one real directory`,
      );
    }
  }
}

function readBoundedRegularFile(file: string): Buffer {
  const stat = lstatOrNull(file);
  if (
    stat === null ||
    stat.isSymbolicLink() ||
    !stat.isFile() ||
    stat.nlink !== 1 ||
    stat.size > MAXIMUM_MODULE_BYTES
  ) {
    fail("wakeflow-artifact-source-file", "artifact source must be one bounded regular file");
  }
  return readFileSync(file);
}

function readJsonRecord(file: string): JsonRecord {
  let value: unknown;
  try {
    value = JSON.parse(readBoundedRegularFile(file).toString("utf8"));
  } catch {
    fail("wakeflow-artifact-json", "artifact metadata input is not valid JSON");
  }
  if (!isPlainRecord(value)) {
    fail("wakeflow-artifact-json", "artifact metadata input must be one JSON object");
  }
  return value;
}

function packageRoot(specifier: string): string {
  if (specifier.startsWith("@")) {
    const segments = specifier.split("/");
    if (segments.length < 2 || segments[1]?.length === 0) {
      fail("wakeflow-artifact-dependency", "scoped package specifier is invalid");
    }
    return `${segments[0]}/${segments[1]}`;
  }
  const root = specifier.split("/")[0];
  if (root === undefined || root.length === 0) {
    fail("wakeflow-artifact-dependency", "package specifier is invalid");
  }
  return root;
}

/** 从若干根出发的静态依赖闭包；`visited` 按路径去重，多个根共享的模块只出现一次。 */
function compiledModuleClosure(
  compiledRoot: string,
  entrypoints: readonly string[],
): Readonly<CompiledClosure> {
  initSync();
  const pending = [...entrypoints];
  const visited = new Set<string>();
  const externalPackages = new Set<string>();

  while (pending.length > 0) {
    const relative = pending.pop();
    if (relative === undefined || visited.has(relative)) continue;
    if (visited.size >= MAXIMUM_COMPILED_MODULES) {
      fail(
        "wakeflow-artifact-module-count",
        `compiled closure exceeds ${MAXIMUM_COMPILED_MODULES} modules`,
      );
    }
    const absolute = path.resolve(compiledRoot, relative);
    assertBelow(compiledRoot, absolute, "wakeflow-artifact-module-scope");
    if (path.extname(absolute) !== ".js") {
      fail("wakeflow-artifact-module-type", "compiled closure may contain only JavaScript modules");
    }
    const source = readBoundedRegularFile(absolute).toString("utf8");
    visited.add(relative);

    const [imports] = parse(source, relative);
    for (const imported of imports) {
      if (imported.d === -2) continue;
      const specifier = imported.n;
      if (specifier === undefined) {
        fail(
          "wakeflow-artifact-dynamic-import",
          "compiled closure contains a non-literal dynamic import",
        );
      }
      if (specifier.startsWith("node:")) continue;
      if (!specifier.startsWith(".")) {
        externalPackages.add(packageRoot(specifier));
        continue;
      }
      const resolved = path.resolve(path.dirname(absolute), specifier);
      assertBelow(compiledRoot, resolved, "wakeflow-artifact-module-scope");
      const importedRelative = repositoryRelative(compiledRoot, resolved);
      if (!visited.has(importedRelative)) pending.push(importedRelative);
    }
  }

  return Object.freeze({
    files: Object.freeze([...visited].sort()),
    externalPackages: Object.freeze([...externalPackages].sort()),
  });
}

function compiledFileScope(
  rule: Readonly<CandidateHostIsolationRule>,
  relative: string,
): CompiledFileScope {
  if (relative.startsWith(rule.currentHostDirectory)) {
    return "current-host";
  }
  if (relative.startsWith(rule.peerHostDirectory)) {
    if (!rule.admittedPeerModules.includes(relative)) {
      fail(
        "wakeflow-artifact-host-isolation",
        `${rule.hostId} closure reached a peer-host execution module`,
      );
    }
    return "peer-profile";
  }
  return "shared";
}

/**
 * hook 观察脚本的闭包限于 foundation 与 kernel（§13.97 D1）：任何宿主目录的模块——包括对端
 * 准入的纯数据 profile——都不得进入，否则一份宿主中立的脚本会带着宿主实现进制品。只读文件
 * 列表，导出供回归测试用手搭的闭包核对稳定错误码。
 */
export function assertSharedClosure(
  rule: Readonly<CandidateHostIsolationRule>,
  files: readonly string[],
): void {
  for (const relative of files) {
    if (compiledFileScope(rule, relative) !== "shared") {
      fail(
        "wakeflow-artifact-hook-observer-scope",
        `${rule.hostId} hook observer closure reached a host module`,
      );
    }
  }
}

/** 两个 launcher 的闭包并集：文件按路径去重排序，外部包同样去重排序。 */
function mergeClosures(closures: readonly Readonly<CompiledClosure>[]): Readonly<CompiledClosure> {
  const files = new Set<string>();
  const externalPackages = new Set<string>();
  for (const closure of closures) {
    for (const file of closure.files) files.add(file);
    for (const name of closure.externalPackages) externalPackages.add(name);
  }
  return Object.freeze({
    files: Object.freeze([...files].sort(compareCodeUnits)),
    externalPackages: Object.freeze([...externalPackages].sort(compareCodeUnits)),
  });
}

function directDependencyVersions(rootPackage: JsonRecord): Readonly<Record<string, string>> {
  if (!isPlainRecord(rootPackage.dependencies)) {
    fail("wakeflow-artifact-dependency", "root package dependencies are missing");
  }
  const result: Record<string, string> = {};
  for (const [name, version] of Object.entries(rootPackage.dependencies)) {
    if (typeof version !== "string" || version.length === 0) {
      fail("wakeflow-artifact-dependency", "root runtime dependency version is invalid");
    }
    result[name] = version;
  }
  return Object.freeze(result);
}

function dependenciesForClosure(
  closure: Readonly<CompiledClosure>,
  directDependencies: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const name of closure.externalPackages) {
    const version = directDependencies[name];
    if (version === undefined) {
      fail("wakeflow-artifact-dependency", `compiled runtime imports undeclared package ${name}`);
    }
    result[name] = version;
  }
  return Object.freeze(result);
}

function sha256(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function writeExclusive(
  outputRoot: string,
  relative: string,
  bytes: Uint8Array,
  mode: 0o644 | 0o755 = 0o644,
): void {
  const destination = path.resolve(outputRoot, relative);
  assertBelow(outputRoot, destination, "wakeflow-artifact-output-scope");
  ensureRealDirectoryPath(outputRoot, path.dirname(destination));
  writeFileSync(destination, bytes, { flag: "wx", mode });
  chmodSync(destination, mode);
}

function jsonBytes(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function compiledArtifactBytes(source: Buffer): Buffer {
  const text = source
    .toString("utf8")
    .replace(/\n\/\/# sourceMappingURL=[^\r\n]+(?:\r?\n)?$/u, "\n");
  return Buffer.from(text, "utf8");
}

const GENERATED_FILE_NOTICE = "// 此文件由 Wakeflow TypeScript 候选制品装配器生成，禁止手工修改。";

function mcpLauncherBytes(launcher: Readonly<LauncherDefinition>): Buffer {
  return Buffer.from(
    [
      "#!/usr/bin/env node",
      GENERATED_FILE_NOTICE,
      `import { ${launcher.runExport} } from "../lib/${launcher.entrypoint}";`,
      "",
      `${launcher.runExport}(${JSON.stringify(CANDIDATE_VERSION)});`,
      "",
    ].join("\n"),
    "utf8",
  );
}

/**
 * hook 观察脚本的 launcher（§13.97 D1）：动态 import 放在 try/catch 里，退出码钉在 0，任何失败——
 * 模块缺失或入口缺 `main` 打 `launcher`，未捕获异常与未处理拒绝打 `internal`——只向 stderr 打一行
 * 固定代码，从不打堆栈或路径。静态 import 失败会打出带绝对路径的堆栈并以 1 退出，被 Claude 显示
 * 给用户，所以不用它。入口的 `main()` 登记自己的进程守卫，launcher 在调用它之前卸下自己的守卫：
 * 任一时刻恰好一组守卫在位。报告固定代码本身也先卸下守卫——成功路径之外的失败（import 抛出、
 * 守卫自己触发）之后守卫必须不在位，否则同一次运行的第二次故障会打出第二行，违反"一次故障恰好
 * 一行"（D4）；卸下之后的故障落回 Node 默认处理，不可能再打出固定代码行。
 */
function hookObserverLauncherBytes(launcher: Readonly<LauncherDefinition>): Buffer {
  const runExport = launcher.runExport;
  return Buffer.from(
    [
      "#!/usr/bin/env node",
      GENERATED_FILE_NOTICE,
      "process.exitCode = 0;",
      "let reported = false;",
      "function launcherGuard() {",
      '  reportFixedCode("internal");',
      "}",
      "function removeLauncherGuards() {",
      '  process.off("uncaughtException", launcherGuard);',
      '  process.off("unhandledRejection", launcherGuard);',
      "}",
      "// 只报一次，并且报完仍留着守卫：第二次故障不能落到 Node 默认处理器（会打出带路径的堆栈并以非 0 退出）。",
      "function reportFixedCode(code) {",
      "  if (reported) return;",
      "  reported = true;",
      "  try {",
      '    process.stderr.write("wakeflow-hook-observer: " + code + "\\n");',
      "  } catch {",
      "    // stderr 不可用时也不改变退出码。",
      "  }",
      "  process.exitCode = 0;",
      "}",
      'process.on("uncaughtException", launcherGuard);',
      'process.on("unhandledRejection", launcherGuard);',
      "try {",
      `  const observer = await import(${JSON.stringify(`../lib/${launcher.entrypoint}`)});`,
      `  if (typeof observer.${runExport} !== "function") throw new TypeError(${JSON.stringify(runExport)});`,
      "  removeLauncherGuards();",
      `  await observer.${runExport}();`,
      "} catch {",
      '  reportFixedCode("launcher");',
      "}",
      "process.exitCode = 0;",
      "",
    ].join("\n"),
    "utf8",
  );
}

function launcherBytes(launcher: Readonly<LauncherDefinition>): Buffer {
  return launcher.kind === "mcp" ? mcpLauncherBytes(launcher) : hookObserverLauncherBytes(launcher);
}

function isModuleNamespace(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null;
}

/** 动态 import 该宿主编译后的 hook 片段模块（§13.97 D8）：tooling 对编译产物没有静态类型边。 */
async function importHookFragmentModule(
  compiledRoot: string,
  definition: Readonly<CandidateDefinition>,
): Promise<Readonly<Record<string, unknown>>> {
  const modulePath = path.resolve(compiledRoot, definition.hookFragment.module);
  assertBelow(compiledRoot, modulePath, "wakeflow-artifact-module-scope");
  readBoundedRegularFile(modulePath);
  let loaded: unknown;
  try {
    loaded = await import(pathToFileURL(modulePath).href);
  } catch {
    fail("wakeflow-artifact-hook-fragment", "compiled hook fragment module could not be loaded");
  }
  if (!isModuleNamespace(loaded)) {
    fail("wakeflow-artifact-hook-fragment", "compiled hook fragment module is not a namespace");
  }
  return loaded;
}

/**
 * 调用片段的渲染函数并只核对形状（字符串、尾随换行、顶层 `hooks` 对象）：片段是纯数据，
 * 渲染结果只由它决定，这里不复制片段的任何内容。
 */
function renderHookFragment(
  namespace: Readonly<Record<string, unknown>>,
  definition: Readonly<CandidateDefinition>,
): string {
  const render = namespace[definition.hookFragment.renderExport];
  if (typeof render !== "function") {
    fail("wakeflow-artifact-hook-fragment", "hook fragment module lacks its render export");
  }
  const rendered: unknown = render();
  if (typeof rendered !== "string" || !rendered.endsWith("\n")) {
    fail(
      "wakeflow-artifact-hook-fragment",
      "hook fragment render must return newline-terminated text",
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rendered);
  } catch {
    fail("wakeflow-artifact-hook-fragment", "hook fragment render is not valid JSON");
  }
  if (!isPlainRecord(parsed) || !isPlainRecord(parsed.hooks)) {
    fail("wakeflow-artifact-hook-fragment", "hook fragment must render one hooks object");
  }
  return rendered;
}

/** 渲染字节与片段自己声明的摘要不一致时的稳定错误码。 */
const HOOK_FRAGMENT_DIGEST_ERROR_CODE = "wakeflow-artifact-hook-fragment-digest";

/**
 * 写出 `hooks/hooks.json` 前核对渲染字节等于片段模块导出的摘要（§13.97 D6）：Codex 的信任按
 * 定义哈希记录，摘要是片段对"这就是我渲染的字节"的声明；两者不一致说明片段的数据与摘要脱节，
 * 构建器以稳定错误码失败，而不是把一份没有任何生产消费者核对过的字节写进制品。导出供回归测试。
 */
export function assertRenderedHookFragmentDigest(rendered: string, declared: unknown): void {
  if (typeof declared !== "string") {
    fail(HOOK_FRAGMENT_DIGEST_ERROR_CODE, "hook fragment module lacks its rendered-bytes digest");
  }
  if (declared !== sha256(Buffer.from(rendered, "utf8"))) {
    fail(
      HOOK_FRAGMENT_DIGEST_ERROR_CODE,
      "hook fragment render disagrees with its declared digest",
    );
  }
}

/** `hooks/hooks.json` 的字节：片段渲染，经形状与自声明摘要两道核对后原样写出。 */
async function hooksJsonBytes(
  compiledRoot: string,
  definition: Readonly<CandidateDefinition>,
): Promise<Buffer> {
  const namespace = await importHookFragmentModule(compiledRoot, definition);
  const rendered = renderHookFragment(namespace, definition);
  assertRenderedHookFragmentDigest(rendered, namespace[definition.hookFragment.digestExport]);
  return Buffer.from(rendered, "utf8");
}

function mcpConfiguration(definition: Readonly<CandidateDefinition>): JsonRecord {
  return definition.hostId === "codex"
    ? {
        mcpServers: {
          wakeflow: {
            command: "node",
            args: ["./mcp/server.mjs"],
            cwd: ".",
          },
        },
      }
    : {
        mcpServers: {
          wakeflow: {
            command: "node",
            // biome-ignore lint/suspicious/noTemplateCurlyInString: 宿主在运行时展开该占位符
            args: ["${CLAUDE_PLUGIN_ROOT}/mcp/server.mjs"],
          },
        },
      };
}

function packageMetadata(
  referencePackage: JsonRecord,
  dependencies: Readonly<Record<string, string>>,
): JsonRecord {
  if (typeof referencePackage.name !== "string") {
    fail("wakeflow-artifact-package", "reference package name is invalid");
  }
  if (typeof referencePackage.version !== "string" || referencePackage.version.length === 0) {
    fail("wakeflow-artifact-package", "reference package version is invalid");
  }
  return {
    name: referencePackage.name,
    version: CANDIDATE_VERSION,
    private: true,
    type: "module",
    description: "Non-release Wakeflow TypeScript technical-skeleton artifact candidate.",
    license: referencePackage.license,
    homepage: referencePackage.homepage,
    repository: referencePackage.repository,
    bin: {
      "wakeflow-mcp": "./mcp/server.mjs",
    },
    scripts: {
      mcp: "node ./mcp/server.mjs",
    },
    engines: {
      node: ">=24.19.0 <25",
    },
    dependencies,
  };
}

interface GeneratedFile {
  readonly path: string;
  readonly bytes: Buffer;
  readonly mode: 0o644 | 0o755;
  readonly scope: CompiledFileScope | "entrypoint" | "metadata";
}

/** 两个 launcher 各自的闭包：hook 观察脚本的闭包必须全是 shared 范围，随后取并集写入。 */
function candidateClosure(
  compiledRoot: string,
  definition: Readonly<CandidateDefinition>,
): Readonly<CompiledClosure> {
  const [mcp, hookObserver] = definition.launchers;
  const hookObserverClosure = compiledModuleClosure(compiledRoot, [hookObserver.entrypoint]);
  assertSharedClosure(definition, hookObserverClosure.files);
  return mergeClosures([
    compiledModuleClosure(compiledRoot, [mcp.entrypoint]),
    hookObserverClosure,
  ]);
}

function sourceEntrypoint(launcher: Readonly<LauncherDefinition>): string {
  return `src/${launcher.entrypoint.replace(/\.js$/u, ".ts")}`;
}

interface ManifestRuntimeEntrypoint {
  readonly kind: LauncherKind;
  readonly runtimeEntrypoint: RuntimeEntrypointPath;
  readonly sourceEntrypoint: string;
}

/** 清单的 `runtimeEntrypoints[]`：两个 launcher 按定义顺序，MCP 在前（§13.97 D8）。 */
function manifestRuntimeEntrypoints(
  definition: Readonly<CandidateDefinition>,
): readonly Readonly<ManifestRuntimeEntrypoint>[] {
  return Object.freeze(
    definition.launchers.map((launcher) =>
      Object.freeze({
        kind: launcher.kind,
        runtimeEntrypoint: launcher.runtimeEntrypoint,
        sourceEntrypoint: sourceEntrypoint(launcher),
      }),
    ),
  );
}

async function assembleCandidate(
  repositoryRoot: string,
  compiledRoot: string,
  stageRoot: string,
  definition: Readonly<CandidateDefinition>,
  directDependencies: Readonly<Record<string, string>>,
): Promise<Readonly<TypescriptArtifactCandidateBuildRecord>> {
  const closure = candidateClosure(compiledRoot, definition);
  const dependencies = dependenciesForClosure(closure, directDependencies);
  const [mcpLauncher, hookObserverLauncher] = definition.launchers;
  const hooksJson = await hooksJsonBytes(compiledRoot, definition);
  const referencePackage = readJsonRecord(
    path.join(repositoryRoot, definition.referencePackagePath),
  );
  const candidateRoot = path.join(stageRoot, definition.directoryName);
  mkdirSync(candidateRoot, { mode: 0o755 });

  const payload: Array<
    Readonly<{
      path: string;
      bytes: number;
      sha256: string;
      mode: "0644" | "0755";
      scope: CompiledFileScope | "entrypoint" | "metadata";
    }>
  > = [];

  for (const relative of closure.files) {
    const bytes = compiledArtifactBytes(readBoundedRegularFile(path.join(compiledRoot, relative)));
    const destination = `lib/${relative}`;
    writeExclusive(candidateRoot, destination, bytes);
    payload.push(
      Object.freeze({
        path: destination,
        bytes: bytes.byteLength,
        sha256: sha256(bytes),
        mode: "0644",
        scope: compiledFileScope(definition, relative),
      }),
    );
  }

  const generatedFiles: readonly Readonly<GeneratedFile>[] = [
    Object.freeze({
      path: mcpLauncher.runtimeEntrypoint,
      bytes: launcherBytes(mcpLauncher),
      mode: 0o755 as const,
      scope: "entrypoint" as const,
    }),
    // hook 观察脚本是第二个 launcher（`runtimeEntrypoints[]` 如此列出），范围与 MCP launcher
    // 同为 `entrypoint`：按 `entrypoint` 选 launcher 的消费者必须两个都看得见。它的闭包是不是
    // shared 由 `assertSharedClosure` 断言，那是 `lib/` 下文件的范围，不是这份生成文件的范围。
    Object.freeze({
      path: hookObserverLauncher.runtimeEntrypoint,
      bytes: launcherBytes(hookObserverLauncher),
      mode: 0o755 as const,
      scope: "entrypoint" as const,
    }),
    // `hooks/hooks.json` 与 `.mcp.json` 同类：由构建器生成、供宿主读取的该 launcher 的宿主
    // 配置，字节随宿主不同（占位符与处理器形式），所以不是 `shared`，是 `metadata`。
    Object.freeze({
      path: "hooks/hooks.json",
      bytes: hooksJson,
      mode: 0o644 as const,
      scope: "metadata" as const,
    }),
    Object.freeze({
      path: ".mcp.json",
      bytes: jsonBytes(mcpConfiguration(definition)),
      mode: 0o644 as const,
      scope: "metadata" as const,
    }),
    Object.freeze({
      path: "package.json",
      bytes: jsonBytes(packageMetadata(referencePackage, dependencies)),
      mode: 0o644 as const,
      scope: "metadata" as const,
    }),
  ];
  for (const file of generatedFiles) {
    writeExclusive(candidateRoot, file.path, file.bytes, file.mode);
    payload.push(
      Object.freeze({
        path: file.path,
        bytes: file.bytes.byteLength,
        sha256: sha256(file.bytes),
        mode: file.mode === 0o755 ? "0755" : "0644",
        scope: file.scope,
      }),
    );
  }

  payload.sort((left, right) => compareCodeUnits(left.path, right.path));
  const manifest = {
    kind: "WakeflowTypescriptArtifactCandidateManifest",
    schemaVersion: 1,
    releaseEligible: false,
    scope: CANDIDATE_SCOPE,
    hostId: definition.hostId,
    candidateVersion: CANDIDATE_VERSION,
    referenceArtifactVersion: referencePackage.version,
    sourceEntrypoint: sourceEntrypoint(mcpLauncher),
    runtimeEntrypoint: mcpLauncher.runtimeEntrypoint,
    runtimeEntrypoints: manifestRuntimeEntrypoints(definition),
    externalPackages: closure.externalPackages,
    files: payload,
  } as const;
  const manifestBytes = jsonBytes(manifest);
  writeExclusive(candidateRoot, "artifact-manifest.json", manifestBytes);

  return Object.freeze({
    hostId: definition.hostId,
    outputDirectory: definition.directoryName,
    compiledFileCount: closure.files.length,
    externalPackages: closure.externalPackages,
    manifestDigest: sha256(manifestBytes),
  });
}

function removeRealDirectory(directory: string): void {
  const stat = lstatOrNull(directory);
  if (stat === null) return;
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    fail("wakeflow-artifact-output-type", "artifact output must be one real directory");
  }
  rmSync(directory, { recursive: true, force: false });
}

function replaceOutputAtomically(repositoryRoot: string, stage: string, output: string): void {
  const backup = path.join(
    path.dirname(output),
    `.${path.basename(output)}.backup-${process.pid}-${randomUUID()}`,
  );
  const previous = lstatOrNull(output);
  if (previous !== null) {
    if (previous.isSymbolicLink() || !previous.isDirectory()) {
      fail("wakeflow-artifact-output-type", "artifact output must be one real directory");
    }
    renameSync(output, backup);
  }
  try {
    renameSync(stage, output);
  } catch (error: unknown) {
    if (lstatOrNull(backup) !== null && lstatOrNull(output) === null) {
      renameSync(backup, output);
    }
    throw error;
  }
  if (lstatOrNull(backup) !== null) removeRealDirectory(backup);
  assertBelow(repositoryRoot, output, "wakeflow-artifact-output-scope");
}

/**
 * 从一次共享 TS 编译结果装配两份隔离、不可发布的宿主候选制品。异步只因 `hooks/hooks.json`
 * 要动态 import 编译后的片段模块（D8）；文件系统写入本身仍是同步且排他的。
 */
export async function buildTypescriptArtifactCandidates(
  repositoryRootInput: string,
  outputRootInput = DEFAULT_OUTPUT_ROOT,
): Promise<Readonly<TypescriptArtifactCandidatesBuildResult>> {
  const repositoryRoot = path.resolve(repositoryRootInput);
  assertRealDirectory(repositoryRoot, "repository root");
  const rootPackage = readJsonRecord(path.join(repositoryRoot, "package.json"));
  if (rootPackage.name !== "wakeflow-repo") {
    fail("wakeflow-artifact-repository", "current directory is not the Wakeflow source repository");
  }
  const compiledRoot = path.join(repositoryRoot, COMPILED_SOURCE_ROOT);
  assertRealDirectory(compiledRoot, COMPILED_SOURCE_ROOT);

  const output = path.resolve(repositoryRoot, outputRootInput);
  const buildRoot = path.join(repositoryRoot, ".build");
  assertBelow(buildRoot, output, "wakeflow-artifact-output-scope");
  ensureRealDirectoryPath(repositoryRoot, path.dirname(output));
  const stage = path.join(
    path.dirname(output),
    `.${path.basename(output)}.stage-${process.pid}-${randomUUID()}`,
  );
  assertBelow(buildRoot, stage, "wakeflow-artifact-output-scope");
  if (lstatOrNull(stage) !== null) {
    fail("wakeflow-artifact-stage", "artifact stage already exists");
  }
  mkdirSync(stage, { mode: 0o755 });

  const directDependencies = directDependencyVersions(rootPackage);
  const artifacts: TypescriptArtifactCandidateBuildRecord[] = [];
  try {
    for (const definition of CANDIDATES) {
      artifacts.push(
        await assembleCandidate(
          repositoryRoot,
          compiledRoot,
          stage,
          definition,
          directDependencies,
        ),
      );
    }
    replaceOutputAtomically(repositoryRoot, stage, output);
  } catch (error: unknown) {
    if (lstatOrNull(stage) !== null) removeRealDirectory(stage);
    throw error;
  }

  return Object.freeze({
    kind: "WakeflowTypescriptArtifactCandidatesBuildResult",
    schemaVersion: 1,
    releaseEligible: false,
    outputRoot: repositoryRelative(repositoryRoot, output),
    artifacts: Object.freeze(artifacts),
  });
}

function isMainModule(): boolean {
  const invoked = process.argv[1];
  return invoked !== undefined && path.resolve(invoked) === fileURLToPath(import.meta.url);
}

async function runAsMain(): Promise<void> {
  try {
    const result = await buildTypescriptArtifactCandidates(process.cwd());
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error: unknown) {
    if (error instanceof TypescriptArtifactCandidateBuildError) {
      process.stderr.write(`${error.code}: ${error.message}\n`);
    } else {
      process.stderr.write("wakeflow-artifact-unexpected: candidate build failed\n");
    }
    process.exitCode = 1;
  }
}

if (isMainModule()) await runAsMain();
