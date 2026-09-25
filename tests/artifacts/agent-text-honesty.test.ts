import { deepEqual, equal, ok } from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { DELIVERY_REQUIRED_SKILLS } from "../../src/capabilities/delivery/decide.js";
import { WAKEFLOW_PUBLIC_TOOL_CATALOG } from "../../src/entrypoints/wakeflow-public-mcp-catalog.js";
import { CLAUDE_CODE_AGENT_TEXT_PLACEHOLDERS } from "../../src/hosts/claude-code/claude-code-agent-text-profile.js";
import { CODEX_AGENT_TEXT_PLACEHOLDERS } from "../../src/hosts/codex/codex-agent-text-profile.js";

/**
 * agent 面文本的诚实性门（gate-log §13.99 D4、D5、D7）。
 *
 * 文本是唯一没有编译器的公共面：工具一改名它就静默说谎，重写前 31 个记号里有 22 个点名的
 * 工具已经不存在。本文件把说谎变成红灯——正向白名单、反向覆盖、退役词汇、技能路径闭合、
 * 命令闭合五条（D4），主流程每一步的唯一归属（D5），以及体积上限（D7）。
 *
 * 纯文件读取加两个常量导入：没有夹具、没有网络、不跑构建。宿主取值表也一并纳入前两条
 * 检查——占位符渲染出来的句子同样是出厂文本，里面点名假工具一样是说谎。
 */

const AGENT_TEXT_ROOT = path.join(process.cwd(), "assets", "agent-text");
/** 代码里点名技能名的另一处入口表（Design 与 Test 的支撑面记忆）。 */
const SUPPORT_MEMORY_AUTHORITY_SOURCE = path.join(
  process.cwd(),
  "src",
  "workspace",
  "support",
  "wakeflow-support-memory-authority.ts",
);

const SKILLS_PREFIX = "skills/";
const COMMANDS_PREFIX = "commands/";

/** 最长记号匹配：`wakeflow_pod_open` 整体被取出，不会被 `wakeflow_pod` 放行。 */
const TOOL_TOKEN_PATTERN = /wakeflow_[a-z_]+/gu;
const SKILL_NAME_PATTERN = /`wakeflow-([a-z]+)`/gu;

/**
 * 退役词汇（D4 c）：只收已经消失的工具名、对象名与操作词。仍在册的操作词一律不进表——
 * `inspect` 是 `wakeflow_register_window_binding` 与 `wakeflow_pod` 今天的操作，列进去会与
 * "每个工具都要被教到"直接相撞。匹配带字母边界，`review pack` 因此不会误伤 `review package`。
 */
const RETIRED_VOCABULARY: readonly string[] = Object.freeze([
  "operation=group",
  "operation=target-preview",
  "dispatch group",
  "review pack",
  "TODO row",
  "window lease",
  "next work",
  "keep-live",
  "unattended",
]);

const MAXIMUM_SKILL_LINES = 200;
const MAXIMUM_SKILL_BYTES = 12 * 1024;
const MAXIMUM_DESCRIPTION_CHARACTERS = 1024;
const MAXIMUM_REFERENCE_LINES = 400;
const MAXIMUM_COMMAND_LINES = 40;

interface SourceFile {
  readonly path: string;
  readonly text: string;
}

function collectSources(root: string): readonly Readonly<SourceFile>[] {
  const files: SourceFile[] = [];
  const pending: string[] = [""];
  while (pending.length > 0) {
    const directory = pending.pop() ?? "";
    for (const entry of readdirSync(path.join(root, directory), { withFileTypes: true })) {
      // 与构建器同一条规则：隐藏项不是出厂文本，不进检查面。
      if (entry.name.startsWith(".")) continue;
      const relative = directory === "" ? entry.name : `${directory}/${entry.name}`;
      if (entry.isDirectory()) {
        pending.push(relative);
        continue;
      }
      files.push({ path: relative, text: readFileSync(path.join(root, relative), "utf8") });
    }
  }
  files.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  return Object.freeze(files);
}

const SOURCES = collectSources(AGENT_TEXT_ROOT);

/** 两个宿主取值表里的全部文本：渲染后它们就是出厂文本的一部分。 */
const HOST_VALUE_TEXTS: readonly string[] = Object.freeze(
  [
    ...Object.values(CODEX_AGENT_TEXT_PLACEHOLDERS),
    ...Object.values(CLAUDE_CODE_AGENT_TEXT_PLACEHOLDERS),
  ].flatMap((value) => (value.zh === undefined ? [value.en] : [value.en, value.zh])),
);

const CATALOG_TOOL_NAMES: readonly string[] = Object.freeze(
  WAKEFLOW_PUBLIC_TOOL_CATALOG.tools.map((tool) => tool.name),
);

function toolTokens(text: string): readonly string[] {
  return [...text.matchAll(TOOL_TOKEN_PATTERN)].map((match) => match[0]);
}

function sourcesUnder(prefix: string): readonly Readonly<SourceFile>[] {
  return SOURCES.filter((source) => source.path.startsWith(prefix));
}

function skillDirectoryOf(relative: string): string {
  return relative.slice(SKILLS_PREFIX.length).split("/")[0] ?? "";
}

function skillNames(): readonly string[] {
  return [...new Set(sourcesUnder(SKILLS_PREFIX).map((source) => skillDirectoryOf(source.path)))]
    .sort()
    .filter((name) => name.length > 0);
}

/** 一份技能教到的工具：它的 `SKILL.md` 与它的 references 正文的并集。 */
function skillTokens(skill: string): ReadonlySet<string> {
  const tokens = new Set<string>();
  for (const source of sourcesUnder(`${SKILLS_PREFIX}${skill}/`)) {
    for (const token of toolTokens(source.text)) tokens.add(token);
  }
  return tokens;
}

function lineCount(text: string): number {
  const lines = text.split("\n");
  return text.endsWith("\n") ? lines.length - 1 : lines.length;
}

function frontmatterDescription(text: string): string {
  const match = /^---\n([\s\S]*?)\n---\n/u.exec(text);
  ok(match !== null, "SKILL.md must open with one frontmatter block");
  return /\ndescription:([^\n]*)/u.exec(`\n${match?.[1] ?? ""}`)?.[1]?.trim() ?? "";
}

test("源目录与宿主取值表点名的每个工具都在公共目录里（D4 a：最长记号匹配的正向白名单）", () => {
  const admitted = new Set(CATALOG_TOOL_NAMES);
  for (const source of SOURCES) {
    for (const token of toolTokens(source.text)) {
      ok(admitted.has(token), `${source.path} names a tool that does not exist: ${token}`);
    }
  }
  for (const value of HOST_VALUE_TEXTS) {
    for (const token of toolTokens(value)) {
      ok(admitted.has(token), `a host value names a tool that does not exist: ${token}`);
    }
  }
});

test("公共目录的 20 个工具每一个都至少被一份技能教到（D4 b：反向覆盖，无人教的工具清零）", () => {
  const taught = new Set<string>();
  for (const source of sourcesUnder(SKILLS_PREFIX)) {
    for (const token of toolTokens(source.text)) taught.add(token);
  }
  equal(CATALOG_TOOL_NAMES.length, 20);
  deepEqual([...taught].sort(), [...CATALOG_TOOL_NAMES].sort());
});

test("退役词汇不出现在任何源文件或宿主取值里（D4 c：黑名单只收已消失的词）", () => {
  for (const phrase of RETIRED_VOCABULARY) {
    const pattern = new RegExp(
      `(?<![A-Za-z])${phrase.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}(?![A-Za-z])`,
      "iu",
    );
    for (const source of SOURCES) {
      equal(pattern.test(source.text), false, `${source.path} keeps retired vocabulary: ${phrase}`);
    }
    for (const value of HOST_VALUE_TEXTS) {
      equal(pattern.test(value), false, `a host value keeps retired vocabulary: ${phrase}`);
    }
  }
});

test("代码点名的技能路径都存在，源目录里也没有孤儿技能（D4 d：技能路径闭合）", () => {
  const present = new Set(SOURCES.map((source) => source.path));
  const referenced = new Set<string>();
  for (const paths of Object.values(DELIVERY_REQUIRED_SKILLS)) {
    for (const relative of paths) {
      ok(present.has(relative), `code names a skill path that does not exist: ${relative}`);
      referenced.add(skillDirectoryOf(relative));
    }
  }
  const entryTexts = [
    readFileSync(SUPPORT_MEMORY_AUTHORITY_SOURCE, "utf8"),
    ...sourcesUnder(COMMANDS_PREFIX).map((source) => source.text),
  ];
  for (const text of entryTexts) {
    for (const match of text.matchAll(SKILL_NAME_PATTERN)) referenced.add(`wakeflow-${match[1]}`);
  }
  for (const skill of referenced) {
    ok(present.has(`${SKILLS_PREFIX}${skill}/SKILL.md`), `entry names a missing skill: ${skill}`);
  }
  deepEqual(
    skillNames().filter((skill) => !referenced.has(skill)),
    [],
  );
});

test("命令不引入它所指技能之外的工具（D4 e：命令闭合）", () => {
  const commands = sourcesUnder(COMMANDS_PREFIX);
  equal(commands.length, 4);
  for (const command of commands) {
    const skill = /Load the `wakeflow-([a-z]+)` skill/u.exec(command.text)?.[1];
    ok(skill !== undefined, `${command.path} must name the skill it points at`);
    const taught = skillTokens(`wakeflow-${skill ?? ""}`);
    for (const token of toolTokens(command.text)) {
      ok(taught.has(token), `${command.path} names ${token}, which its skill does not teach`);
    }
  }
});

/**
 * 主流程 0 到 13 步的唯一归属（D5），表取自需求总览 §3 的那张表。第 6 步只点名
 * `wakeflow_plan_target_task`：实现任务包与测试任务包由同一件工具追加，§3 旧行里的
 * `plan_test_card` 不在公共目录里。第 9 步是唯一被两份技能共同拥有的一步。
 */
const STEP_OWNERSHIP: readonly Readonly<{
  step: number;
  skills: readonly string[];
  tools: readonly string[];
}>[] = Object.freeze([
  { step: 0, skills: ["wakeflow-controller"], tools: ["wakeflow_maintain_workspace"] },
  { step: 1, skills: ["wakeflow-controller"], tools: ["wakeflow_register_window_binding"] },
  { step: 2, skills: ["wakeflow-design"], tools: [] },
  { step: 3, skills: ["wakeflow-design"], tools: ["wakeflow_publish_requirement"] },
  { step: 4, skills: ["wakeflow-design"], tools: ["wakeflow_publish_requirement"] },
  {
    step: 5,
    skills: ["wakeflow-controller"],
    tools: ["wakeflow_inspect_board", "wakeflow_create_demand"],
  },
  { step: 6, skills: ["wakeflow-controller"], tools: ["wakeflow_plan_target_task"] },
  { step: 7, skills: ["wakeflow-controller"], tools: ["wakeflow_prepare_delivery"] },
  { step: 8, skills: ["wakeflow-controller"], tools: ["wakeflow_record_delivery_outcome"] },
  {
    step: 9,
    skills: ["wakeflow-target", "wakeflow-test"],
    tools: ["wakeflow_import_target_result"],
  },
  { step: 10, skills: ["wakeflow-controller"], tools: ["wakeflow_inspect_target_result_review"] },
  {
    step: 11,
    skills: ["wakeflow-controller"],
    tools: [
      "wakeflow_record_implementation_review_decision",
      "wakeflow_record_test_review_decision",
    ],
  },
  { step: 12, skills: ["wakeflow-controller"], tools: ["wakeflow_complete_demand"] },
  { step: 13, skills: ["wakeflow-controller"], tools: ["wakeflow_pod"] },
]);

test("主流程每一步都有唯一 owner 技能，且该技能点名该步的工具（D5：步到工具的归属表）", () => {
  deepEqual(
    STEP_OWNERSHIP.map((entry) => entry.step),
    Array.from({ length: 14 }, (_value, index) => index),
  );
  const owned = new Map<string, number[]>();
  for (const entry of STEP_OWNERSHIP) {
    for (const skill of entry.skills) {
      owned.set(skill, [...(owned.get(skill) ?? []), entry.step]);
      const taught = skillTokens(skill);
      for (const tool of entry.tools) {
        ok(taught.has(tool), `${skill} owns step ${entry.step} but never names ${tool}`);
      }
    }
  }
  deepEqual(Object.fromEntries(owned), {
    "wakeflow-controller": [0, 1, 5, 6, 7, 8, 10, 11, 12, 13],
    "wakeflow-design": [2, 3, 4],
    "wakeflow-target": [9],
    "wakeflow-test": [9],
  });
});

test("每份技能、reference 与命令都在行数、字节与 description 上限内（D7：体积与优先级预算）", () => {
  for (const source of SOURCES) {
    const lines = lineCount(source.text);
    const bytes = Buffer.byteLength(source.text, "utf8");
    if (source.path.endsWith("/SKILL.md")) {
      ok(lines <= MAXIMUM_SKILL_LINES, `${source.path} has ${lines} lines`);
      ok(bytes <= MAXIMUM_SKILL_BYTES, `${source.path} has ${bytes} bytes`);
      const description = frontmatterDescription(source.text);
      ok(description.length > 0, `${source.path} must carry one description`);
      ok(
        description.length <= MAXIMUM_DESCRIPTION_CHARACTERS,
        `${source.path} description has ${description.length} characters`,
      );
      continue;
    }
    if (source.path.includes("/references/")) {
      ok(lines <= MAXIMUM_REFERENCE_LINES, `${source.path} has ${lines} lines`);
      continue;
    }
    if (source.path.startsWith(COMMANDS_PREFIX)) {
      ok(lines <= MAXIMUM_COMMAND_LINES, `${source.path} has ${lines} lines`);
    }
  }
});

/**
 * 技能面闭合（§13.126，对齐第五轮移植自旧实现的 skill-surface 测试）：frontmatter 只有 name 与
 * description，每份 reference 都被自己的 SKILL.md 点名，技能文本点名的每份 reference 都存在。
 * 一份没人读的 reference 与一句指向不存在文件的话，都是文本在说谎。
 */
const REFERENCE_MENTION_PATTERN = /`references\/([a-z0-9-]+\.md)`/gu;

test("每份 SKILL.md 的 frontmatter 恰好是 name 与 description，且 name 等于目录名", () => {
  for (const skill of skillNames()) {
    const source = SOURCES.find((entry) => entry.path === `${SKILLS_PREFIX}${skill}/SKILL.md`);
    ok(source !== undefined, `${skill} must carry a SKILL.md`);
    const match = /^---\n([\s\S]*?)\n---\n/u.exec(source?.text ?? "");
    ok(match !== null, `${skill}/SKILL.md must open with one frontmatter block`);
    const keys = (match?.[1] ?? "")
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => line.slice(0, line.indexOf(":")).trim());
    deepEqual([...keys].sort(), ["description", "name"], `${skill}/SKILL.md frontmatter keys`);
    equal(/^name:\s*(.*)$/mu.exec(match?.[1] ?? "")?.[1]?.trim(), skill);
  }
});

test("每份 reference 都被自己的 SKILL.md 点名，技能文本点名的 reference 都存在（链接闭合，无孤儿）", () => {
  for (const skill of skillNames()) {
    const prefix = `${SKILLS_PREFIX}${skill}/`;
    const files = sourcesUnder(prefix);
    const references = files
      .filter((source) => source.path.startsWith(`${prefix}references/`))
      .map((source) => source.path.slice(`${prefix}references/`.length));
    const present = new Set(references);
    const entry = files.find((source) => source.path === `${prefix}SKILL.md`);
    const mentionedByEntry = new Set(
      [...(entry?.text ?? "").matchAll(REFERENCE_MENTION_PATTERN)].map((match) => match[1] ?? ""),
    );
    for (const reference of references) {
      ok(mentionedByEntry.has(reference), `${skill}/SKILL.md never names references/${reference}`);
    }
    for (const source of files) {
      for (const match of source.text.matchAll(REFERENCE_MENTION_PATTERN)) {
        ok(present.has(match[1] ?? ""), `${source.path} names a missing reference: ${match[0]}`);
      }
    }
  }
});

test("源目录恰好是四份技能、四个命令与两份 README，且只有中文 README 用中文（D3、D6）", () => {
  deepEqual(skillNames(), [
    "wakeflow-controller",
    "wakeflow-design",
    "wakeflow-target",
    "wakeflow-test",
  ]);
  deepEqual(
    sourcesUnder(COMMANDS_PREFIX).map((source) => source.path),
    ["commands/init.md", "commands/next.md", "commands/pod.md", "commands/status.md"],
  );
  for (const source of SOURCES) {
    if (source.path === "README.zh-CN.md") continue;
    equal(/[一-鿿]/u.test(source.text), false, `${source.path} must be English only (D6)`);
  }
});
