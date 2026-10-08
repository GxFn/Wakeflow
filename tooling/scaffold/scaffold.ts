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
