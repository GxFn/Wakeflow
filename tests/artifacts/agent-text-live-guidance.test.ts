import { deepEqual, equal, ok } from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { planEvidenceLocator } from "../../src/capabilities/result-review/decide.js";
import {
  CLAUDE_CODE_AGENT_TEXT_PLACEHOLDERS,
  renderClaudeCodeAgentText,
} from "../../src/hosts/claude-code/claude-code-agent-text-profile.js";
import { CLAUDE_CODE_TMUX_ASSET_COMMAND } from "../../src/hosts/claude-code/claude-code-tmux-asset.js";
import {
  CODEX_AGENT_TEXT_PLACEHOLDERS,
  renderCodexAgentText,
} from "../../src/hosts/codex/codex-agent-text-profile.js";

/**
 * 默认安装现场（gate-log §13.133）暴露的出厂文本缺口的回归（§13.134）。
 *
 * 现场里被引导的 Agent 四次不得不去读插件实现或让用户动手：Controller 为 `server-outdated`
 * 翻插件目录、用带变量的 shell 循环批量调用助手（C16）；Controller 自己的窗口只能靠用户
 * `/mcp` 或手敲 tmux 换代（C8）；引导会话关早后 tmux 里的 Controller 接不回其他窗口（I6）；
 * Test 窗口不知道证据引用的形式、第一次导入被拒（I8）。另有两条说明：权限模式缺省 auto
 * （用户裁决 Q4），证据的 `recordedBy` 是登记权威而不是采集窗口（F10）。
 *
 * 换代顺序是 Controller 先、其他窗口后（主会话裁决）：过期服务 inspect 给出的启动意图来自旧代码，
 * 维护也不能从它跑，所以本窗口先就地重启、verify、必要时对账，才轮到其他窗口。
 *
 * 这里按两个宿主各渲染一遍源文本，断言那几句关键指令还在、顺序还对；证据引用的例子交给
 * 导入路径真正用的定位符解析器去解析，文字与代码一旦分叉就是红灯。纯文件读取加渲染，
 * 不跑构建。
 */

const AGENT_TEXT_ROOT = path.join(process.cwd(), "assets", "agent-text");

const CONTROLLER = "skills/wakeflow-controller/SKILL.md";
const WINDOWS = "skills/wakeflow-controller/references/workspace-and-windows.md";
const EVIDENCE = "skills/wakeflow-controller/references/evidence.md";
const TARGET = "skills/wakeflow-target/SKILL.md";
const TEST = "skills/wakeflow-test/SKILL.md";
const TEST_EXECUTION = "skills/wakeflow-test/references/test-execution.md";

const PLUGIN_UPDATE_HEADING = "## After a plugin update";
const CITATION_FORM = "artifacts/managed-evidence/<evidenceId>/payload/content";
const SAMPLE_EVIDENCE_ID = "evidence_00000000-0000-4000-8000-000000000000";

function source(relative: string): string {
  return readFileSync(path.join(AGENT_TEXT_ROOT, relative), "utf8");
}

/** 渲染后按空白归一：断言只看句子，不受换行落在哪里影响。 */
function flat(text: string): string {
  return text.replace(/\s+/gu, " ");
}

function claude(relative: string, language: "en" | "zh" = "en"): string {
  return flat(renderClaudeCodeAgentText(source(relative), language));
}

function codex(relative: string): string {
  return flat(renderCodexAgentText(source(relative), "en"));
}

/** 源目录里的全部出厂文本（与构建器同一条规则：隐藏项不算），路径相对源根。 */
function shippedSources(directory = ""): readonly string[] {
  const found: string[] = [];
  for (const entry of readdirSync(path.join(AGENT_TEXT_ROOT, directory), { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const relative = directory === "" ? entry.name : `${directory}/${entry.name}`;
    if (entry.isDirectory()) found.push(...shippedSources(relative));
    else found.push(relative);
  }
  return found;
}

/** 一份源文本按两个宿主渲染；中文 README 按中文面渲染。 */
function renderedForBothHosts(relative: string): readonly string[] {
  const language = relative.endsWith(".zh-CN.md") ? "zh" : "en";
  return [
    flat(renderClaudeCodeAgentText(source(relative), language)),
    flat(renderCodexAgentText(source(relative), language)),
  ];
}

/** 从一个二级标题取到下一个二级标题之前的正文。 */
function section(text: string, heading: string): string {
  const start = text.indexOf(heading);
  ok(start >= 0, `missing section: ${heading}`);
  const end = text.indexOf(" ## ", start + heading.length);
  return end < 0 ? text.slice(start) : text.slice(start, end);
}

function includesAll(text: string, phrases: readonly string[], label: string): void {
  for (const phrase of phrases) ok(text.includes(phrase), `${label} lacks: ${phrase}`);
}

function indexOfRequired(text: string, phrase: string): number {
  const index = text.indexOf(phrase);
  ok(index >= 0, `missing: ${phrase}`);
  return index;
}

test("C16：Controller 技能把 server-outdated 与 windows-stale 直接路由到更新一节，不读插件实现", () => {
  for (const rendered of [claude(CONTROLLER), codex(CONTROLLER)]) {
    includesAll(
      rendered,
      [
        "`server-outdated` and `windows-stale:<n>`",
        "`runtime-artifact-outdated` and `window-artifact-stale`",
        'Go straight to "After a plugin update" in `references/workspace-and-windows.md`',
        "do not read the plugin's implementation",
      ],
      CONTROLLER,
    );
  }
  ok(source(WINDOWS).includes(`\n${PLUGIN_UPDATE_HEADING}\n`));
});

test("C16：Claude 的助手调用每次独占一条 Bash 命令、参数是字面值；Codex 的取值不提助手", () => {
  const rule =
    "Make every helper call its own Bash command with literal arguments - no shell loop, " +
    "variable or chain of helper calls: only such a plain call matches the helper's allow rule";
  ok(claude(CONTROLLER).includes(rule), "the Controller skill must carry the one-call rule");
  ok(claude(WINDOWS).includes(rule), "the windows reference must carry the one-call rule");
  ok(claude(WINDOWS).includes("one helper call per Bash command"));
  for (const value of Object.values(CODEX_AGENT_TEXT_PLACEHOLDERS)) {
    equal(value.en.includes("Bash"), false, "a Codex value must not teach the Claude helper");
  }
});

test("C8：更新后先告诉用户再就地重启 Controller 自己，verify 与对账之后才逐个就地重启其他过期窗口", () => {
  const update = section(claude(WINDOWS), PLUGIN_UPDATE_HEADING);
  includesAll(
    update,
    [
      "Never run maintenance from an outdated server",
      "the launch intents its `wakeflow_register_window_binding` inspect returns",
      "So this window goes first.",
      "if a gate other than `runtime-artifact` fails - `host-settings-assets` does",
      "preview and apply a reconcile as in step 0",
      "resume --window <windowId> --in-place`",
      "each only while it sits idle at an empty prompt",
      "`window-busy`",
      "`--force` does not override it",
      "`resume-exited`",
      "register it with `replace`",
      "`self: true`, `scheduled: true`",
      "no `/mcp` reconnect is needed",
      "call `wakeflow_verify`",
    ],
    "Claude plugin-update section",
  );
  const tell = indexOfRequired(update, "tell the user in one sentence");
  const self = indexOfRequired(update, "resume --window <this windowId> --in-place`");
  const others = indexOfRequired(update, "take them one at a time");
  const othersRestart = indexOfRequired(update, "`resume --window <windowId> --in-place`");
  ok(
    tell < self && self < others && others < othersRestart,
    "tell the user, restart this window, and only then restart the other windows",
  );
  // 本窗口的重启是完整的一条助手调用；其他窗口沿用同一前缀。
  ok(
    update.includes(
      `\`${CLAUDE_CODE_TMUX_ASSET_COMMAND} resume --window <this windowId> --in-place\``,
    ),
  );
  // 用户的 `/mcp` 重连只剩一种情形：工作区里还是就地重启之前的旧助手（`argument-unknown`）。
  const reconnect = update.split("reconnect `wakeflow`");
  equal(reconnect.length - 1, 1, "the user is sent to /mcp at most once");
  ok(
    (reconnect[0] ?? "").endsWith(
      "`argument-unknown`: then ask the user to run `/mcp` in this window and ",
    ),
  );
  ok(update.includes("run a reconcile as in step 0, which installs the current helper"));

  const codexUpdate = section(codex(WINDOWS), PLUGIN_UPDATE_HEADING);
  includesAll(
    codexUpdate,
    [
      "Never run maintenance from an outdated server",
      "So this window goes first.",
      "replace the binding with that thread's id",
      "only the user can reconnect its Wakeflow server or resume the session",
    ],
    "Codex plugin-update section",
  );
  ok(
    indexOfRequired(codexUpdate, "only the user can reconnect") <
      indexOfRequired(codexUpdate, "replace the binding with that thread's id"),
    "on Codex too this thread is refreshed before the other windows",
  );
  equal(codexUpdate.includes("--in-place"), false);
  equal(codexUpdate.includes("tmux"), false);

  // windowResume 只服务这一节；窗格没了的续接（新窗格加 relocate）留在 windowLaunch。
  equal(source(WINDOWS).split("{{windowResume}}").length - 1, 1);
  ok(claude(WINDOWS).includes("`locator-live`; a live window on an older plugin is restarted"));
  ok(codex(WINDOWS).includes("relocate does not apply on this host"));
});

test("I6：tmux 里的 Controller 用 launch 收编引导会话没登记的窗口；收编被拒就按 hint 引导用户，不开第二个窗口", () => {
  const bootstrap = flat(CLAUDE_CODE_AGENT_TEXT_PLACEHOLDERS.windowBootstrap.en);
  includesAll(
    bootstrap,
    [
      "register it with `self`",
      "the helper adopts it instead of opening a second one (`adopted: true`)",
      "run `mark --all` once every window is registered",
      "`adopt-unproven`, `window-ambiguous`, `window-present-not-claude`",
      "never open a second window and never `teardown` from inside tmux",
      // 与助手拒绝里的 hint 一致：让用户在多出来或无从证明的窗口里退出 claude，再 launch。
      "what the refusal's `hint` asks of them - exit `claude` there with `/exit`",
      "`launch` again once they have",
      "to keep this session open until you have registered the windows",
    ],
    "windowBootstrap",
  );
  ok(
    indexOfRequired(bootstrap, "`adopted: true`") <
      indexOfRequired(bootstrap, "When `insideTmux` is false"),
    "adoption belongs to the inside-tmux branch",
  );
});

test("Q4：窗口缺省以 auto 权限模式启动；没有 auto 的账号经维护改成 acceptEdits", () => {
  includesAll(
    claude("README.md"),
    [
      "runs in Claude Code's `auto` permission mode",
      "a one-time question the first time",
      "the Controller tells you which window is asking",
      "set `hosts.claude-code.launch.permissionMode` to `acceptEdits` through maintenance",
    ],
    "Claude README",
  );
  includesAll(
    claude("README.zh-CN.md", "zh"),
    [
      "`auto` 权限模式",
      "一次性的问题",
      "`hosts.claude-code.launch.permissionMode` 设为 `acceptEdits`",
    ],
    "Claude README.zh-CN",
  );
  includesAll(
    claude(WINDOWS),
    [
      "launch in Claude Code's `auto` permission mode by default",
      "tell the user which window is asking",
      "set that value to `acceptEdits` with a reconfigure",
    ],
    WINDOWS,
  );
  const defaultAcceptEdits = /acceptEdits`? (?:is|as) (?:the )?default|default[^.]*`acceptEdits`/iu;
  for (const text of [claude("README.md"), claude(WINDOWS), claude(CONTROLLER)]) {
    equal(defaultAcceptEdits.test(text), false, "no shipped text may call acceptEdits the default");
  }
});

test("I8：技能写明的证据引用形式正是导入路径解析的定位符", () => {
  for (const relative of [TARGET, TEST_EXECUTION, EVIDENCE]) {
    ok(claude(relative).includes(CITATION_FORM), `${relative} must state ${CITATION_FORM}`);
  }
  deepEqual(planEvidenceLocator(CITATION_FORM.replace("<evidenceId>", SAMPLE_EVIDENCE_ID)), {
    evidenceId: SAMPLE_EVIDENCE_ID,
    member: "payload",
    memberRef: "content",
  });

  const testSkill = claude(TEST);
  const example = /"ref": "(artifacts\/managed-evidence\/evidence_<uuid>\/payload\/content)"/u.exec(
    testSkill,
  );
  ok(example !== null, "the Test skill must show one citation example");
  const plan = planEvidenceLocator(
    (example?.[1] ?? "").replace("evidence_<uuid>", SAMPLE_EVIDENCE_ID),
  );
  deepEqual(plan, { evidenceId: SAMPLE_EVIDENCE_ID, member: "payload", memberRef: "content" });
  includesAll(
    testSkill,
    [
      '"digest": "sha256:<64 lowercase hex of the saved file>"',
      "`payloadArtifactDigest` and `manifestDigest` are not what you cite",
      'list it once more in `evidenceLocators` with `"kind": "test-output"`',
    ],
    TEST,
  );
  ok(claude(TARGET).includes("List each pair once in `evidenceLocators` with the record's kind"));
  // 导入拒绝点名第一条解析不了的引用与原因类；退役的 `evidence-unresolved` 不再出现在出厂文本里。
  ok(
    claude(TARGET).includes(
      "An evidence refusal's `path` points at the first citation it could not resolve, its " +
        "`reason` says why (for example `evidence-digest-mismatch`), and " +
        "`details.unresolvedCitations` counts them all.",
    ),
  );
  for (const relative of shippedSources()) {
    for (const rendered of renderedForBothHosts(relative)) {
      equal(rendered.includes("evidence-unresolved"), false, `${relative} names a retired reason`);
    }
  }

  // record_evidence 的结果只给 evidenceId 与记录级摘要，不给可直接引用的定位符。
  for (const relative of [TARGET, TEST, TEST_EXECUTION, EVIDENCE, CONTROLLER]) {
    equal(/returns the locator/u.test(claude(relative)), false, `${relative} overclaims`);
  }
});

test("G12：证据种类与来源的配对与 kind-source-mismatch 写在 Controller 的证据参考里", () => {
  includesAll(
    claude(EVIDENCE),
    [
      "a file or tree is `test-output`, `diff` or `document`",
      "a hook observation is `hook-observation`, or `transcript` when that record carries a transcript",
      "a link is `link`; a commit is `commit`",
      "refused as `kind-source-mismatch`",
    ],
    EVIDENCE,
  );
});

test("被引导的用户：出厂文本只让用户按键、回答对话框或用斜杠命令，从不让他敲 shell 命令", () => {
  // `ask the user to run` 之后只能是 Claude Code 的斜杠命令（如 `/mcp`）；`git init` 由 Agent 征得同意后自己跑。
  const shellAsk = /ask (?:the user|them) to run `(?!\/)/u;
  for (const relative of shippedSources()) {
    for (const rendered of renderedForBothHosts(relative)) {
      equal(shellAsk.test(rendered), false, `${relative} asks the user to type a command`);
    }
  }
  ok(claude("commands/init.md").includes("run `git init` there yourself once they agree"));
});

test("F10：recordedBy 是登记权威（Controller 窗口与配置），不是采集来源的窗口", () => {
  includesAll(
    claude(EVIDENCE),
    [
      "`recordedBy` names the configured Controller window and the config digest",
      "not the window that captured the source",
    ],
    EVIDENCE,
  );
  includesAll(
    claude(TEST),
    [
      "`recordedBy` names the Controller window and config under which Wakeflow admitted it",
      "your report is what says which window captured it",
    ],
    TEST,
  );
});
