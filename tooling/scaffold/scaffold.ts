import { lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { proposeTestDurations } from "../testing/test-duration-report.js";

/**
 * Wakeflow Tooling / Scaffold：三种小型脚手架——回归用例骨架、开发日志节点、耗时表写回。
 *
 * 骨架只给出位置、导入与一个会失败的占位用例，内容仍由人写；生成从不触碰 `src/contracts/generated/`
 * 与 `plugins/`。日志节点只追加小节头并把 docs/README 的"最新节点"指针挪过去，结论由人填。耗时表
 * 写回用 `timings export` 的同一套核验，写回后它是新的仓库输入，旧回执不再证明新字节。
 */

export interface ScaffoldResult {
  readonly kind: "WakeflowScaffold";
  readonly schemaVersion: 1;
  readonly status: "passed";
  readonly target: string;
  readonly preview: string;
  readonly changesApplied: boolean;
  readonly nextSteps: readonly string[];
}

const GATE_LOG = "docs/progress/consolidation-gate-log.md";
const DOCS_INDEX = "docs/README.md";
const DURATIONS = "tooling/testing/test-durations.json";

function finish(
  target: string,
  preview: string,
  apply: boolean,
  nextSteps: readonly string[],
): Readonly<ScaffoldResult> {
  return Object.freeze({
    kind: "WakeflowScaffold",
    schemaVersion: 1,
    status: "passed",
    target,
    preview,
    changesApplied: apply,
    nextSteps,
  });
}

function repositoryRelative(root: string, value: string): string {
  const resolved = path.resolve(root, value);
  const relative = path.relative(root, resolved);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative))
    throw new Error("The path must lie inside the repository.");
  return relative.split(path.sep).join("/");
}

/** `wf scaffold test --for src/<path>.ts [--apply]`：镜像到 `tests/<path>.test.ts`。 */
export function scaffoldTest(
  rootInput: string,
  request: Readonly<{ for: string; apply?: boolean }>,
): Readonly<ScaffoldResult> {
  const root = path.resolve(rootInput);
  const subject = repositoryRelative(root, request.for);
  if (!/^src\/.+\.ts$/u.test(subject) || subject.startsWith("src/contracts/generated/"))
    throw new Error("--for must name one hand-written src/ module.");
  if (lstatSync(path.join(root, subject), { throwIfNoEntry: false })?.isFile() !== true)
    throw new Error("--for must name an existing module.");
  const target = `tests/${subject.slice("src/".length, -".ts".length)}.test.ts`;
  if (lstatSync(path.join(root, target), { throwIfNoEntry: false }) !== undefined)
    throw new Error(`${target} already exists.`);
  const importPath = path.posix
    .relative(path.posix.dirname(target), subject)
    .replace(/\.ts$/u, ".js");
  const moduleName = path.posix.basename(subject, ".ts");
  const content = `import { equal } from "node:assert/strict";
import { test } from "node:test";
import * as subject from "${importPath.startsWith(".") ? importPath : `./${importPath}`}";

// 脚手架生成（wf scaffold test）：写下测试名、夹具、行为前提、应观察的证据、错误路径与清理。
// 占位用例会失败，直到它被真正的断言替换；生成的内容不能自动通过。
test("${moduleName}：待补充的行为与应观察的证据", () => {
  equal(typeof subject, "object");
  throw new Error("scaffold: replace this body with the real assertions");
});
`;
  if (request.apply === true) {
    mkdirSync(path.dirname(path.join(root, target)), { recursive: true });
    writeFileSync(path.join(root, target), content, { flag: "wx" });
  }
  return finish(target, content, request.apply === true, [
    request.apply === true
      ? `fill in ${target}, then run npm run test:typescript:focused -- ${target}`
      : "re-run with --apply to write the skeleton",
  ]);
}

function lastGateLogSection(text: string): string | null {
  const sections = [...text.matchAll(/^### (13\.\d+)\b/gmu)].map((match) => match[1] ?? "");
  return sections.at(-1) ?? null;
}

/** `wf scaffold node --section 13.N --title TITLE [--apply]`：gate-log 新节点与 docs/README 指针。 */
export function scaffoldGateLogNode(
  rootInput: string,
  request: Readonly<{ section: string; title: string; apply?: boolean }>,
): Readonly<ScaffoldResult> {
  const root = path.resolve(rootInput);
  if (!/^13\.\d{1,4}$/u.test(request.section)) throw new Error("--section must look like 13.N.");
  if (!/^[^\n`|]{2,80}$/u.test(request.title)) throw new Error("--title must be one short line.");
  const gateLog = readFileSync(path.join(root, GATE_LOG), "utf8");
  const index = readFileSync(path.join(root, DOCS_INDEX), "utf8");
  const last = lastGateLogSection(gateLog);
  if (last === null) throw new Error("The gate log has no 13.N section.");
  const expected = `13.${Number(last.slice(3)) + 1}`;
  if (request.section !== expected) throw new Error(`The next section is ${expected}.`);
  const pointer = /最新节点 §(13\.\d+)；/u.exec(index);
  if (pointer === null || pointer[1] !== last)
    throw new Error(`${DOCS_INDEX} must point at §${last} before a new node is added.`);
  const date = new Date().toLocaleDateString("sv-SE");
  const section = `
### ${request.section} ${request.title}（${date}）

<!-- 背景、改了什么、为什么与当前实现一致 -->

验证与观察：

- <!-- 聚焦测试、完整门、smoke、未运行项 -->
`;
  const nextGateLog = `${gateLog.replace(/\n*$/u, "\n")}${section}`;
  const nextIndex = index.replace(
    `最新节点 §${last}；`,
    `最新节点 §${request.section}；${request.title}（待填）。§${last} `,
  );
  const preview = `${GATE_LOG}:\n${section}\n${DOCS_INDEX}: 最新节点 §${last} -> §${request.section}\n`;
  if (request.apply === true) {
    writeFileSync(path.join(root, GATE_LOG), nextGateLog);
    writeFileSync(path.join(root, DOCS_INDEX), nextIndex);
  }
  return finish(GATE_LOG, preview, request.apply === true, [
    request.apply === true
      ? "write the section body and the validation paragraph"
      : "re-run with --apply to append the section and move the pointer",
  ]);
}

/** `wf timings apply --receipt R`：把完整门回执导出的耗时表写回跟踪文件。 */
export function applyTestDurations(rootInput: string, receipt: string): Readonly<ScaffoldResult> {
  const root = path.resolve(rootInput);
  const table = proposeTestDurations(root, path.resolve(root, receipt));
  const content = `${JSON.stringify(table, null, 2)}\n`;
  mkdirSync(path.dirname(path.join(root, DURATIONS)), { recursive: true });
  writeFileSync(path.join(root, DURATIONS), content);
  return finish(
    DURATIONS,
    `${Object.keys(table.durationsMs).length} files measured ${table.measuredAt}`,
    true,
    [
      "the duration table is a new repository input: the receipt no longer certifies the new bytes; run the gate again before handoff",
    ],
  );
}

const DESIGN_REFERENCE =
  "assets/agent-text/skills/wakeflow-design/references/requirement-package.md";

/** 从 Design 技能参考里取出 `requirement.md` 与 `landing.md` 两个骨架代码块：技能文本是唯一来源。 */
function designSkeletons(
  repositoryRoot: string,
): Readonly<{ requirement: string; landing: string }> {
  const reference = readFileSync(path.join(repositoryRoot, DESIGN_REFERENCE), "utf8");
  const block = (label: string): string => {
    const start = reference.indexOf(`\`${label}\`:\n\n\`\`\`markdown\n`);
    if (start < 0) throw new Error(`${DESIGN_REFERENCE} has no ${label} skeleton.`);
    const bodyStart = reference.indexOf("```markdown\n", start) + "```markdown\n".length;
    const end = reference.indexOf("\n```", bodyStart);
    if (end < 0) throw new Error(`${DESIGN_REFERENCE} has an unterminated ${label} skeleton.`);
    return `${reference.slice(bodyStart, end)}\n`;
  };
  return { requirement: block("requirement.md"), landing: block("landing.md") };
}

function designSurfaceOf(workspace: string): string {
  const parsed: unknown = JSON.parse(
    readFileSync(path.join(workspace, "wakeflow.config.json"), "utf8"),
  );
  const topology =
    parsed !== null && typeof parsed === "object"
      ? (parsed as Record<string, unknown>).topology
      : null;
  const surfaces =
    topology !== null && typeof topology === "object"
      ? (topology as Record<string, unknown>).supportSurfaces
      : null;
  const design = Array.isArray(surfaces)
    ? surfaces.find(
        (entry: unknown) =>
          entry !== null &&
          typeof entry === "object" &&
          (entry as Record<string, unknown>).capability === "design",
      )
    : undefined;
  const surfacePath = design === undefined ? undefined : (design as Record<string, unknown>).path;
  if (typeof surfacePath !== "string")
    throw new Error("The workspace config names no design surface.");
  return path.resolve(workspace, surfacePath);
}

/**
 * `wf scaffold requirement --root WORKSPACE | --design DIR --name NAME --title TITLE [--apply]`：
 * 在 Design 支持面的 `drafts/<name>/` 写 `requirement.md` 与 `landing.md` 骨架（只限 `requirement`
 * 类型；bug/supplement/research 的节换法见技能参考）。不填用户确认，不发明验收锚点，不发布。
 */
export function scaffoldRequirement(
  repositoryRoot: string,
  request: Readonly<{
    workspace?: string;
    design?: string;
    name: string;
    title: string;
    apply?: boolean;
  }>,
): Readonly<ScaffoldResult> {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/u.test(request.name))
    throw new Error("--name must be a short kebab-case name.");
  if (!/^[^\n`|]{2,80}$/u.test(request.title)) throw new Error("--title must be one short line.");
  if ((request.workspace === undefined) === (request.design === undefined))
    throw new Error("Give exactly one of --root WORKSPACE or --design DIR.");
  const design =
    request.design === undefined
      ? designSurfaceOf(path.resolve(request.workspace ?? "."))
      : path.resolve(request.design);
  if (lstatSync(design, { throwIfNoEntry: false })?.isDirectory() !== true)
    throw new Error("The design surface directory does not exist.");
  const directory = path.join(design, "drafts", request.name);
  if (lstatSync(directory, { throwIfNoEntry: false }) !== undefined)
    throw new Error(`drafts/${request.name} already exists in the design surface.`);
  const skeletons = designSkeletons(path.resolve(repositoryRoot));
  const requirement = skeletons.requirement.replace("<Title>", request.title);
  const landing = skeletons.landing.replace("<Title>", request.title);
  if (request.apply === true) {
    mkdirSync(directory, { recursive: true });
    writeFileSync(path.join(directory, "requirement.md"), requirement, { flag: "wx" });
    writeFileSync(path.join(directory, "landing.md"), landing, { flag: "wx" });
  }
  const relative = `drafts/${request.name}`;
  return finish(
    directory,
    `${relative}/requirement.md:\n${requirement}\n${relative}/landing.md:\n${landing}`,
    request.apply === true,
    [
      request.apply === true
        ? `replace every prompt line, then preview with wakeflow_publish_requirement using requirementPath "${relative}/requirement.md" and landingPath "${relative}/landing.md"`
        : "re-run with --apply to write the two drafts",
      "the skeleton carries no user confirmation and no acceptance anchors; preview refuses it until they are written",
    ],
  );
}
