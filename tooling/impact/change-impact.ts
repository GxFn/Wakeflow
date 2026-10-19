import path from "node:path";
import {
  assertRevision,
  changedFiles,
  type ImpactedTestSelection,
  selectImpactedTests,
} from "../testing/impacted-tests.js";

/**
 * Wakeflow Tooling / Change impact：把一个 Git 变更集按仓库的所有权规则分类，说明它触及哪些
 * 来源、是否要重新生成 Schema 与制品、哪些测试受影响，以及按顺序该跑哪些命令。
 *
 * 分类规则直接对应 CLAUDE.md 的 Source Ownership：`src/contracts/schemas/` 由 `schema:build` 派生
 * 生成文件；运行时、宿主与 agent-text 进入两份制品；`tooling/` 与 `tests/` 不进制品；`plugins/` 与
 * `src/contracts/generated/` 不能手改。它是开发建议，不替代完整门；静态图说明不了的影响（动态装配、
 * Schema `$ref`、占位符）仍由 `fullGateRecommended` 兜底（开发工具规划 §4.6）。
 */

export type ImpactCategory =
  | "schemas"
  | "generated-edited"
  | "runtime"
  | "hosts"
  | "entrypoints"
  | "agent-text"
  | "release-metadata"
  | "tooling"
  | "tests"
  | "docs"
  | "ci"
  | "toolchain"
  | "artifacts-edited"
  | "repository"
  | "unclassified";

export interface ChangeImpactReport {
  readonly kind: "WakeflowChangeImpact";
  readonly schemaVersion: 1;
  readonly status: "passed";
  readonly since: string;
  readonly changed: number;
  readonly categories: Readonly<Record<ImpactCategory, readonly string[]>>;
  /** 运行时按六层归 owner：foundation、contracts、kernel、capabilities/<slice>、governance、configuration、workspace。 */
  readonly owners: Readonly<Record<string, readonly string[]>>;
  readonly schemaBuildRequired: boolean;
  readonly artifactsAffected: boolean;
  readonly warnings: readonly string[];
  readonly tests: Readonly<{
    count: number;
    sample: readonly string[];
    fullGateRecommended: boolean;
    fullGateReasons: readonly string[];
  }>;
  readonly recommended: readonly string[];
  /** 分级验证（CLAUDE.md Verification，§13.181）：0 只改文档，1 提交前的聚焦验证，2 完整门。 */
  readonly tier: Readonly<{ level: 0 | 1 | 2; reasons: readonly string[] }>;
}

const TIER_TWO_OWNERS: ReadonlySet<string> = new Set(["foundation", "kernel", "contracts"]);
const TIER_TWO_FILE_PATTERN =
  /^(?:tests\/scenarios\/|tooling\/testing\/|biome\.json$|knip\.json$|tsconfig[^/]*\.json$|tests\/tsconfig\.json$|tooling\/tsconfig\.json$)/u;
const TIER_ONE_CATEGORIES: readonly ImpactCategory[] = [
  "runtime",
  "hosts",
  "entrypoints",
  "agent-text",
  "release-metadata",
  "tooling",
  "tests",
  "generated-edited",
  "artifacts-edited",
];

/** 变更集需要的验证级：完整门只在公共形状、场景链、运行器或门配置变动时强制。 */
function verificationTier(
  categories: Readonly<Record<ImpactCategory, readonly string[]>>,
  owners: Readonly<Record<string, readonly string[]>>,
  tests: Readonly<ImpactedTestSelection>,
  changed: readonly string[],
): Readonly<{ level: 0 | 1 | 2; reasons: readonly string[] }> {
  const reasons: string[] = [];
  for (const owner of Object.keys(owners).sort()) {
    if (TIER_TWO_OWNERS.has(owner)) reasons.push(`owner ${owner} changed`);
  }
  if (categories.schemas.length > 0) reasons.push("schemas changed");
  if (categories.toolchain.length > 0) reasons.push("toolchain changed");
  if (categories.ci.length > 0) reasons.push("ci workflow changed");
  for (const file of changed) {
    if (TIER_TWO_FILE_PATTERN.test(file)) reasons.push(`${file} is gate infrastructure`);
  }
  if (tests.fullGateRecommended) reasons.push(...tests.fullGateReasons.map((r) => `tests: ${r}`));
  if (reasons.length > 0) return Object.freeze({ level: 2, reasons: Object.freeze(reasons) });
  const touched = TIER_ONE_CATEGORIES.filter((category) => categories[category].length > 0);
  if (touched.length > 0) {
    return Object.freeze({ level: 1, reasons: Object.freeze(touched.map((c) => `${c} changed`)) });
  }
  return Object.freeze({
    level: 0,
    reasons: Object.freeze(["only docs or repository files changed"]),
  });
}

const RULES: readonly Readonly<{ pattern: RegExp; category: ImpactCategory }>[] = [
  { pattern: /^plugins\//u, category: "artifacts-edited" },
  { pattern: /^src\/contracts\/generated\//u, category: "generated-edited" },
  { pattern: /^src\/contracts\/schemas\//u, category: "schemas" },
  { pattern: /^src\/hosts\//u, category: "hosts" },
  { pattern: /^src\/entrypoints\//u, category: "entrypoints" },
  { pattern: /^src\//u, category: "runtime" },
  { pattern: /^assets\/agent-text\//u, category: "agent-text" },
  {
    pattern:
      /^(?:assets\/release\/|\.claude-plugin\/marketplace\.json$|\.agents\/plugins\/marketplace\.json$)/u,
    category: "release-metadata",
  },
  { pattern: /^tooling\//u, category: "tooling" },
  { pattern: /^tests\//u, category: "tests" },
  { pattern: /^docs\//u, category: "docs" },
  { pattern: /^\.github\//u, category: "ci" },
  {
    pattern:
      /^(?:package(?:-lock)?\.json|tsconfig[^/]*\.json|biome\.json|knip\.json|\.dependency-cruiser\.cjs)$/u,
    category: "toolchain",
  },
  {
    pattern: /^(?:CLAUDE\.md|AGENTS\.md|README[^/]*\.md|LICENSE[^/]*|\.gitignore)$/u,
    category: "repository",
  },
];

const ARTIFACT_CATEGORIES: readonly ImpactCategory[] = [
  "schemas",
  "runtime",
  "hosts",
  "entrypoints",
  "agent-text",
  "release-metadata",
];

function classify(file: string): ImpactCategory {
  return RULES.find((rule) => rule.pattern.test(file))?.category ?? "unclassified";
}

function ownerOf(file: string): string | null {
  const match =
    /^src\/(foundation|contracts|kernel|governance|configuration|workspace|hosts|entrypoints)\//u.exec(
      file,
    );
  if (match !== null) return match[1] as string;
  const slice = /^src\/capabilities\/([^/]+)\//u.exec(file);
  return slice === null ? null : `capabilities/${slice[1] as string}`;
}

function recommendations(
  categories: Readonly<Record<ImpactCategory, readonly string[]>>,
  tests: Readonly<ImpactedTestSelection>,
  artifactsAffected: boolean,
): readonly string[] {
  const steps: string[] = [];
  if (categories.schemas.length > 0) steps.push("npm run schema:build", "npm run schema:check");
  if (artifactsAffected) steps.push("npm run build:artifacts:committed");
  if (tests.tests.length > 0 && !tests.fullGateRecommended)
    steps.push("npm run wf -- verify quick --changed");
  if (tests.fullGateRecommended || artifactsAffected || categories.toolchain.length > 0)
    steps.push("npm run locked -- npm test");
  else if (tests.tests.length > 0) steps.push("npm run locked -- npm test (before handoff)");
  if (artifactsAffected) steps.push("npm run smoke:artifacts");
  if (categories.docs.length > 0 || categories.repository.length > 0)
    steps.push("check docs/README.md pointers (wf handoff covers it)");
  steps.push("npm run wf -- handoff");
  return Object.freeze([...new Set(steps)]);
}

export function reportChangeImpact(
  rootInput: string,
  options: Readonly<{ since?: string }> = {},
): Readonly<ChangeImpactReport> {
  const root = path.resolve(rootInput);
  const since = assertRevision(options.since ?? "HEAD");
  const changed = changedFiles(root, since);
  const categories = Object.fromEntries(
    [
      "schemas",
      "generated-edited",
      "runtime",
      "hosts",
      "entrypoints",
      "agent-text",
      "release-metadata",
      "tooling",
      "tests",
      "docs",
      "ci",
      "toolchain",
      "artifacts-edited",
      "repository",
      "unclassified",
    ].map((category) => [category, [] as string[]]),
  ) as Record<ImpactCategory, string[]>;
  const owners: Record<string, string[]> = {};
  for (const file of changed) {
    categories[classify(file)].push(file);
    const owner = ownerOf(file);
    if (owner !== null) {
      const files = owners[owner] ?? [];
      files.push(file);
      owners[owner] = files;
    }
  }
  const tests = selectImpactedTests(root, { since });
  const artifactsAffected =
    ARTIFACT_CATEGORIES.some((category) => categories[category].length > 0) ||
    categories.toolchain.includes("package-lock.json");
  const warnings: string[] = [];
  if (categories["artifacts-edited"].length > 0)
    warnings.push(
      "plugins/ is generated: rebuild with npm run build:artifacts:committed instead of editing it",
    );
  if (categories["generated-edited"].length > 0)
    warnings.push(
      "src/contracts/generated/ is derived: change the schema and run npm run schema:build",
    );
  if (categories.unclassified.length > 0)
    warnings.push(
      "unclassified paths are outside the documented ownership; decide where they belong",
    );
  return Object.freeze({
    kind: "WakeflowChangeImpact",
    schemaVersion: 1,
    status: "passed",
    since,
    changed: changed.length,
    categories: Object.freeze(
      Object.fromEntries(
        Object.entries(categories).map(([key, value]) => [key, Object.freeze(value)]),
      ) as Record<ImpactCategory, readonly string[]>,
    ),
    owners: Object.freeze(
      Object.fromEntries(Object.entries(owners).sort(([left], [right]) => (left < right ? -1 : 1))),
    ),
    schemaBuildRequired: categories.schemas.length > 0,
    artifactsAffected,
    warnings: Object.freeze(warnings),
    tests: {
      count: tests.tests.length,
      sample: tests.tests.slice(0, 20),
      fullGateRecommended: tests.fullGateRecommended,
      fullGateReasons: tests.fullGateReasons,
    },
    recommended: recommendations(categories, tests, artifactsAffected),
    tier: verificationTier(categories, owners, tests, changed),
  });
}
