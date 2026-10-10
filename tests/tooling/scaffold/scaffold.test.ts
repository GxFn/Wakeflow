import { equal, match, throws } from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { type TestContext, test } from "node:test";
import {
  scaffoldGateLogNode,
  scaffoldRequirement,
  scaffoldTest,
} from "../../../tooling/scaffold/scaffold.js";

function write(root: string, relative: string, text: string): void {
  mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
  writeFileSync(path.join(root, relative), text);
}

function fixture(t: TestContext): string {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "wakeflow-scaffold-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  write(root, "src/kernel/foo.ts", "export const foo = 1;\n");
  write(root, "src/contracts/generated/x.ts", "export const x = 1;\n");
  write(root, "docs/progress/consolidation-gate-log.md", "### 13.1 first（2026-10-01）\n\nbody\n");
  write(root, "docs/README.md", "| gate-log | active，最新节点 §13.1；first done | x |\n");
  return root;
}

test("回归用例骨架：镜像到 tests/ 下，导入路径正确，占位用例会失败；已存在、生成目录与不存在的模块被拒", (t) => {
  const root = fixture(t);
  const preview = scaffoldTest(root, { for: "src/kernel/foo.ts" });
  equal(preview.target, "tests/kernel/foo.test.ts");
  equal(preview.changesApplied, false);
  match(preview.preview, /from "\.\.\/\.\.\/src\/kernel\/foo\.js"/u);
  match(preview.preview, /throw new Error\("scaffold: replace this body/u);
  equal(existsSync(path.join(root, preview.target)), false);
  const applied = scaffoldTest(root, { for: "src/kernel/foo.ts", apply: true });
  equal(applied.changesApplied, true);
  equal(readFileSync(path.join(root, "tests/kernel/foo.test.ts"), "utf8"), preview.preview);
  throws(() => scaffoldTest(root, { for: "src/kernel/foo.ts" }), /already exists/u);
  throws(() => scaffoldTest(root, { for: "src/contracts/generated/x.ts" }), /hand-written/u);
  throws(() => scaffoldTest(root, { for: "src/kernel/missing.ts" }), /existing module/u);
  throws(() => scaffoldTest(root, { for: "../outside.ts" }), /inside the repository/u);
});

test("日志节点骨架：只接受下一个节号，追加小节头并挪动 docs/README 指针；指针不一致时拒绝", (t) => {
  const root = fixture(t);
  throws(
    () => scaffoldGateLogNode(root, { section: "13.3", title: "skip" }),
    /next section is 13\.2/u,
  );
  throws(() => scaffoldGateLogNode(root, { section: "13.2", title: "bad|title" }), /short line/u);
  const preview = scaffoldGateLogNode(root, { section: "13.2", title: "second batch" });
  equal(preview.changesApplied, false);
  match(preview.preview, /### 13\.2 second batch（\d{4}-\d{2}-\d{2}）/u);
  equal(readFileSync(path.join(root, "docs/README.md"), "utf8").includes("13.2"), false);
  scaffoldGateLogNode(root, { section: "13.2", title: "second batch", apply: true });
  const gateLog = readFileSync(path.join(root, "docs/progress/consolidation-gate-log.md"), "utf8");
  match(
    gateLog,
    /### 13\.1 first（2026-10-01）\n\nbody\n\n### 13\.2 second batch（\d{4}-\d{2}-\d{2}）\n\n<!-- /u,
  );
  // README 的单元格只挪指针与日期，不再写"待填"（wf handoff 会点名过期标记）。
  match(
    readFileSync(path.join(root, "docs/README.md"), "utf8"),
    /最新节点 §13\.2（\d{4}-\d{2}-\d{2}）；first done/u,
  );
  // 现在指针指向 13.2，再要 13.3 必须先让 README 指向 13.2：这里已经是，所以可以继续。
  equal(scaffoldGateLogNode(root, { section: "13.3", title: "third" }).changesApplied, false);
  write(root, "docs/README.md", "| gate-log | active，最新节点 §13.1（2026-10-01）；stale | x |\n");
  throws(
    () => scaffoldGateLogNode(root, { section: "13.3", title: "third" }),
    /must point at §13\.2/u,
  );
});

test("需求包骨架：从 Design 技能参考取两个骨架写进 Design 支持面的 drafts/<name>/，标题替换，已存在与参数错误被拒", (t) => {
  const repository = process.cwd();
  const workspace = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "wakeflow-scaffold-requirement-")),
  );
  t.after(() => rmSync(workspace, { recursive: true, force: true }));
  write(
    workspace,
    "wakeflow.config.json",
    `${JSON.stringify({ kind: "WakeflowConfig", topology: { supportSurfaces: [{ capability: "design", path: "Design" }] } })}\n`,
  );
  mkdirSync(path.join(workspace, "Design", "drafts"), { recursive: true });
  const preview = scaffoldRequirement(repository, {
    workspace,
    name: "smoke-file",
    title: "Smoke file",
  });
  equal(preview.changesApplied, false);
  match(preview.preview, /# Smoke file\n\n## Goal\n/u);
  match(preview.preview, /## Acceptance criteria\n1\. /u);
  match(preview.preview, /# Smoke file - landing\n\n## Code facts\n/u);
  match(preview.preview, /## Testing decision\n/u);
  equal(existsSync(path.join(workspace, "Design/drafts/smoke-file")), false);
  const applied = scaffoldRequirement(repository, {
    workspace,
    name: "smoke-file",
    title: "Smoke file",
    apply: true,
  });
  equal(applied.changesApplied, true);
  match(
    readFileSync(path.join(workspace, "Design/drafts/smoke-file/requirement.md"), "utf8"),
    /## User confirmation\n/u,
  );
  match(
    readFileSync(path.join(workspace, "Design/drafts/smoke-file/landing.md"), "utf8"),
    /## Landing plan\n/u,
  );
  match(applied.nextSteps[0] ?? "", /requirementPath "drafts\/smoke-file\/requirement\.md"/u);
  throws(
    () => scaffoldRequirement(repository, { workspace, name: "smoke-file", title: "Smoke file" }),
    /already exists/u,
  );
  throws(
    () => scaffoldRequirement(repository, { workspace, name: "Bad Name", title: "x y" }),
    /kebab-case/u,
  );
  throws(() => scaffoldRequirement(repository, { name: "other", title: "x y" }), /exactly one of/u);
  throws(
    () =>
      scaffoldRequirement(repository, {
        workspace,
        design: path.join(workspace, "Design"),
        name: "other",
        title: "x y",
      }),
    /exactly one of/u,
  );
  // 显式 --design 不读配置。
  const explicit = scaffoldRequirement(repository, {
    design: path.join(workspace, "Design"),
    name: "second",
    title: "Second",
  });
  equal(explicit.target, path.join(workspace, "Design", "drafts", "second"));
});
