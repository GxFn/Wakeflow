import { spawnSync } from "node:child_process";
import { lstatSync, opendirSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Wakeflow Tooling / Testing：从 Git 变更集推导受影响的测试文件。
 *
 * 规则只看静态导入：`src/**`、`tooling/**` 与 `tests/**` 的 `.ts` 文件各自解析 `import ... from "…"`
 * 的相对说明符，建立反向边，再从变更文件出发反向传播，落到 `.test.ts` 的就是候选。代码之外的
 * 输入靠声明的资源边（`RESOURCE_EDGES`）接进图里：`assets/agent-text/` 的改动从读取它的模块和
 * 点名它的测试出发传播，而不是整门。它是开发时的聚焦建议，不是完整门：动态装配、Schema `$ref`
 * 和共享底层的影响不在静态图里，所以这些路径或过大的选择集会额外给出 `fullGateRecommended`
 * （开发工具规划 §4.6）。未选中的测试不能被说成通过。
 */

export interface ImpactedTestSelection {
  readonly kind: "WakeflowImpactedTests";
  readonly schemaVersion: 1;
  readonly since: string;
  /** 变更文件（仓库相对路径，含未跟踪文件），按路径排序。 */
  readonly changed: readonly string[];
  /** 受影响的 `.test.ts` 源文件，按路径排序。 */
  readonly tests: readonly string[];
  /** 每个测试被选中的第一条原因：导致它的变更文件。 */
  readonly reasons: Readonly<Record<string, string>>;
  readonly fullGateRecommended: boolean;
  readonly fullGateReasons: readonly string[];
}

const MAXIMUM_FOCUSED_SELECTION = 80;
const MAXIMUM_SOURCE_BYTES = 4 * 1024 * 1024;
const IMPORT_PATTERN =
  /(?:^|\n)\s*(?:import|export)\b[^"'\n]*?from\s*["']([^"'\n]+)["']|(?:^|\n)\s*import\s*["']([^"'\n]+)["']/gu;
const SOURCE_ROOTS = ["src", "tooling", "tests"] as const;

/** 这些输入改变时静态图说明不了影响范围，直接建议完整门。 */
const FULL_GATE_PATTERNS: readonly Readonly<{ pattern: RegExp; reason: string }>[] = [
  { pattern: /^src\/contracts\/(?:schemas|generated)\//u, reason: "schema-or-generated-contract" },
  {
    pattern: /^(?:package(?:-lock)?\.json|tsconfig[^/]*\.json|biome\.json|knip\.json)$/u,
    reason: "toolchain-input",
  },
  { pattern: /^\.dependency-cruiser\.cjs$/u, reason: "architecture-rules" },
  {
    pattern:
      /^tooling\/testing\/(?:run-typescript-tests|test-event-reporter|test-recording|impacted-tests)\.ts$/u,
    reason: "test-runner",
  },
  { pattern: /^tooling\/testing\/test-durations\.json$/u, reason: "test-schedule" },
];

/**
 * 代码之外的输入与读取它们的代码之间的边。`owners` 是读取该资源的模块，它们的导入者沿静态图
 * 传播；源文本里出现 `mention` 的 `tests/**` 文件也入选，覆盖不经任何模块、直接按路径读资源的
 * 测试（例如按 `assets/agent-text/skills/…` 读技能正文的入口测试）。agent-text 本身不被运行时
 * 读取：它由制品构建渲染进两份插件，所以它的影响面就是构建与制品测试，不是整门。
 */
const RESOURCE_EDGES: readonly Readonly<{
  pattern: RegExp;
  owners: readonly string[];
  mention: string;
}>[] = [
  {
    pattern: /^assets\/agent-text\//u,
    owners: [
      "src/hosts/claude-code/claude-code-agent-text-profile.ts",
      "src/hosts/codex/codex-agent-text-profile.ts",
      "tooling/artifacts/build-plugin-artifacts.ts",
    ],
    mention: "agent-text",
  },
];

export function assertRevision(since: string): string {
  if (!/^[A-Za-z0-9_./~^-]{1,128}$/u.test(since) || since.startsWith("-"))
    throw new Error("The change baseline must be one Git revision.");
  return since;
}

function git(root: string, args: readonly string[]): string {
  const result = spawnSync("git", [...args], {
    cwd: root,
    encoding: "utf8",
    shell: false,
    timeout: 20_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error !== undefined || result.status !== 0)
    throw new Error("Git change inspection failed.");
  return result.stdout;
}

/** 变更集：相对 `since` 的 tracked 改动加未跟踪文件，仓库相对路径，排序去重。 */
export function changedFiles(root: string, since: string): readonly string[] {
  const tracked = git(root, ["diff", "--name-only", "--diff-filter=ACMRD", since, "--"]).split(
    "\n",
  );
  const untracked = git(root, ["ls-files", "--others", "--exclude-standard"]).split("\n");
  return Object.freeze(
    [
      ...new Set(
        [...tracked, ...untracked].map((line) => line.trim()).filter((line) => line !== ""),
      ),
    ].sort(),
  );
}

function collectTypeScript(root: string, relativeRoot: string): string[] {
  const files: string[] = [];
  const visit = (directory: string): void => {
    const handle = opendirSync(directory);
    try {
      for (;;) {
        const entry = handle.readSync();
        if (entry === null) break;
        if (entry.isSymbolicLink()) continue;
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) visit(absolute);
        else if (entry.isFile() && entry.name.endsWith(".ts")) {
          files.push(path.relative(root, absolute).split(path.sep).join("/"));
        }
      }
    } finally {
      handle.closeSync();
    }
  };
  const start = path.join(root, relativeRoot);
  const stat = lstatSync(start, { throwIfNoEntry: false });
  if (stat?.isDirectory()) visit(start);
  return files;
}

/** 相对说明符解析成仓库相对 `.ts` 路径；包说明符与 `node:` 不是本仓库的边。 */
function resolveSpecifier(from: string, specifier: string): string | null {
  if (!specifier.startsWith(".")) return null;
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(from), specifier));
  if (resolved.endsWith(".js")) return `${resolved.slice(0, -3)}.ts`;
  if (resolved.endsWith(".ts") || resolved.endsWith(".json")) return resolved;
  return `${resolved}.ts`;
}

function sourceText(root: string, file: string): string | null {
  try {
    const stat = lstatSync(path.join(root, file));
    if (!stat.isFile() || stat.size > MAXIMUM_SOURCE_BYTES) return null;
    return readFileSync(path.join(root, file), "utf8");
  } catch {
    return null;
  }
}

function importsOf(file: string, text: string): readonly string[] {
  const targets: string[] = [];
  for (const match of text.matchAll(IMPORT_PATTERN)) {
    const specifier = match[1] ?? match[2];
    if (specifier === undefined) continue;
    const target = resolveSpecifier(file, specifier);
    if (target !== null) targets.push(target);
  }
  return targets;
}

interface SourceGraph {
  /** 被导入文件 → 导入它的文件。 */
  readonly importers: ReadonlyMap<string, ReadonlySet<string>>;
  /** 资源提及词 → 源文本里出现它的 `tests/**` 文件。 */
  readonly mentioners: ReadonlyMap<string, ReadonlySet<string>>;
}

function buildSourceGraph(
  root: string,
  sources: readonly string[],
  mentions: readonly string[],
): SourceGraph {
  const importers = new Map<string, Set<string>>();
  const mentioners = new Map<string, Set<string>>(mentions.map((mention) => [mention, new Set()]));
  for (const file of sources) {
    const text = sourceText(root, file);
    if (text === null) continue;
    for (const target of importsOf(file, text)) {
      let set = importers.get(target);
      if (set === undefined) {
        set = new Set();
        importers.set(target, set);
      }
      set.add(file);
    }
    if (!file.startsWith("tests/")) continue;
    for (const mention of mentions) {
      if (text.includes(mention)) mentioners.get(mention)?.add(file);
    }
  }
  return { importers, mentioners };
}

/** 从种子出发沿反向导入边传播；返回到达的 `.test.ts` 与各自的第一条来源。 */
function propagate(
  graph: SourceGraph,
  seeds: readonly (readonly [file: string, origin: string])[],
): ReadonlyMap<string, string> {
  const reasons = new Map<string, string>();
  const queue = [...seeds];
  const seen = new Set<string>();
  while (queue.length > 0) {
    const [file, origin] = queue.shift() as readonly [string, string];
    if (seen.has(file)) continue;
    seen.add(file);
    if (file.startsWith("tests/") && file.endsWith(".test.ts") && !reasons.has(file)) {
      reasons.set(file, origin);
    }
    for (const importer of graph.importers.get(file) ?? []) queue.push([importer, origin]);
  }
  return reasons;
}

/**
 * 静态导入链最终到达 `target` 的测试文件，含经由夹具或 `src/`、`tooling/` 模块的间接依赖；`target`
 * 不存在或没有人导入时为空集。运行器用它把带负载敏感标签的文件放进自己的道（run-typescript-tests.ts）。
 */
export function testSourcesDependingOn(rootInput: string, target: string): ReadonlySet<string> {
  const root = path.resolve(rootInput);
  const graph = buildSourceGraph(
    root,
    SOURCE_ROOTS.flatMap((sourceRoot) => collectTypeScript(root, sourceRoot)),
    [],
  );
  return new Set(propagate(graph, [[target, target]]).keys());
}

export function selectImpactedTests(
  rootInput: string,
  options: Readonly<{ since?: string }> = {},
): Readonly<ImpactedTestSelection> {
  const root = path.resolve(rootInput);
  const since = assertRevision(options.since ?? "HEAD");
  const changed = changedFiles(root, since);
  const edges = RESOURCE_EDGES.filter((edge) => changed.some((file) => edge.pattern.test(file)));
  const graph = buildSourceGraph(
    root,
    SOURCE_ROOTS.flatMap((sourceRoot) => collectTypeScript(root, sourceRoot)),
    edges.map((edge) => edge.mention),
  );
  const seeds: Array<readonly [string, string]> = [];
  for (const file of changed) {
    if (/^(?:src|tooling|tests)\/.*\.(?:ts|json)$/u.test(file)) seeds.push([file, file]);
    for (const edge of edges) {
      if (!edge.pattern.test(file)) continue;
      for (const owner of edge.owners) seeds.push([owner, file]);
      for (const mentioner of graph.mentioners.get(edge.mention) ?? [])
        seeds.push([mentioner, file]);
    }
  }
  const reasons = propagate(graph, seeds);
  const tests = [...reasons.keys()].sort();
  const fullGateReasons = new Set<string>();
  for (const file of changed) {
    for (const rule of FULL_GATE_PATTERNS)
      if (rule.pattern.test(file)) fullGateReasons.add(rule.reason);
  }
  if (tests.length > MAXIMUM_FOCUSED_SELECTION) fullGateReasons.add("selection-too-large");
  return Object.freeze({
    kind: "WakeflowImpactedTests",
    schemaVersion: 1,
    since,
    changed,
    tests: Object.freeze(tests),
    reasons: Object.freeze(
      Object.fromEntries([...reasons].sort(([left], [right]) => (left < right ? -1 : 1))),
    ),
    fullGateRecommended: fullGateReasons.size > 0,
    fullGateReasons: Object.freeze([...fullGateReasons].sort()),
  });
}
