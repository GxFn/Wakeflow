import { deepEqual, equal, ok } from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  STALE_WINDOW_RELAUNCH,
  STALE_WINDOW_RESUME,
} from "../../src/capabilities/observation/decide.js";
import { planEvidenceLocator } from "../../src/capabilities/result-review/decide.js";
import {
  CLAUDE_CODE_AGENT_TEXT_PLACEHOLDERS,
  renderClaudeCodeAgentText,
} from "../../src/hosts/claude-code/claude-code-agent-text-profile.js";
import {
  CLAUDE_CODE_DESKTOP_ASSET_COMMAND,
  CLAUDE_CODE_DESKTOP_ASSET_CONTENT,
} from "../../src/hosts/claude-code/claude-code-desktop-asset.js";
import {
  CLAUDE_CODE_TMUX_ASSET_COMMAND,
  CLAUDE_CODE_TMUX_ASSET_CONTENT,
} from "../../src/hosts/claude-code/claude-code-tmux-asset.js";
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
const FIRST_RUN = "skills/wakeflow-controller/references/first-run.md";
const DELIVERY = "skills/wakeflow-controller/references/delivery-and-review.md";
const DESKTOP = "skills/wakeflow-controller/references/desktop-transport.md";
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

test("Codex 项目创建合同：一个外层项目、明确执行目录、项目回读与失败处理", () => {
  const windows = codex(WINDOWS);
  includesAll(
    windows,
    [
      "list_projects",
      "target.type project",
      "environment.type local for every role",
      "Never register role directories as projects",
      "codex exec sessions",
      "clientThreadId is not a binding handle",
      "cwd and title alone do not prove project membership",
      "Do not retry creation after an ambiguous result",
      "Keep requested role chats visible",
      "worktree.executionRoot",
      "git worktree add",
      "source-maintenance chat in another project",
    ],
    WINDOWS,
  );
  equal(claude(WINDOWS).includes("target.type project"), false);
  equal(windows.includes("create_thread using a worktree environment"), false);
});

test("C16：Controller 技能把 server-outdated 与 windows-stale 直接路由到更新一节，不读插件实现", () => {
  for (const rendered of [claude(CONTROLLER), codex(CONTROLLER)]) {
    includesAll(
      rendered,
      [
        "`server-outdated` (`runtime-artifact-outdated` in `next`)",
        "`window-runtime-unverified:<n>` means peer runtime evidence is missing",
        'Follow "After a plugin update" in `references/workspace-and-windows.md`',
        "do not loop restarts or read plugin implementation",
      ],
      CONTROLLER,
    );
  }
  ok(source(WINDOWS).includes(`\n${PLUGIN_UPDATE_HEADING}\n`));
});

test("现场 L21：目标窗格不在空输入框时，技能、参考与助手提示给同一个做法——用户处理后重发同一个 permit，三种 observed 都列出", () => {
  const reference = flat(source(DELIVERY));
  includesAll(
    reference,
    [
      "`menu-cursor`, `input-box-unseen` or `input-not-empty`",
      "or that box holds typed text - a draft on any of its lines",
      "then send the same permit again",
      "Record a refusal and re-arm only when the window cannot be brought back to its prompt",
    ],
    "delivery reference",
  );
  equal(reference.includes("then record the outcome as reported and re-arm the delivery"), false);
  const action = flat(CLAUDE_CODE_AGENT_TEXT_PLACEHOLDERS.deliveryAction.en);
  ok(
    action.includes(
      "or that box holds typed text (nothing was sent: the user answers or clears it in that window, then you send the same permit again",
    ),
  );
  ok(
    CLAUDE_CODE_TMUX_ASSET_CONTENT.includes(
      "have the user answer or clear it in that window, then send the same permit again",
    ),
  );
  equal(CLAUDE_CODE_TMUX_ASSET_CONTENT.includes("then rearm"), false);
});

test("W41：更新一节按 status 的逐窗口路线处理过期窗口——从未对话的直接重开、不先试 resume，码与观察切片同一份", () => {
  for (const rendered of [claude(WINDOWS), codex(WINDOWS)]) {
    includesAll(
      section(rendered, PLUGIN_UPDATE_HEADING),
      [
        "Status `nextActions` routes each stale window, so do not probe them:",
        `\`${STALE_WINDOW_RESUME}\` (its session holds a prompt record: restart it in place)`,
        `\`${STALE_WINDOW_RELAUNCH}\` (it never conversed: close, launch, \`replace\`, \`mark\`)`,
        "Where the host restarts a session on its next turn they are `windows-refresh-pending:<n>` on a passing gate.",
      ],
      "plugin-update section",
    );
  }
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
      "MCP server serving this call",
      "SessionStart can occur on resume or compaction",
      "`windows-stale:<n>`",
      "Restart the stale windows with the host's procedure",
      "preview and apply reconcile for repairable workspace gates",
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
  const others = indexOfRequired(update, "take the `stale-window-resume` ones one at a time");
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
      "MCP server serving this call",
      "ask the user to restart the Codex app",
      "resumes that existing chat through the host",
      "user authorizes a replacement chat",
    ],
    "Codex plugin-update section",
  );
  ok(
    indexOfRequired(codexUpdate, "when this serving MCP is outdated") <
      indexOfRequired(codexUpdate, "Replace its binding only"),
    "on Codex too this thread is refreshed before the other windows",
  );
  equal(codexUpdate.includes("--in-place"), false);
  equal(codexUpdate.includes("tmux"), false);
  // §13.161 B6-1：只有重启 Codex 应用才会重载 MCP；resume/continue 不会。
  ok(codexUpdate.includes("only an app restart reloads Wakeflow's MCP server"));
  equal(codexUpdate.includes("reload its Wakeflow server"), false);

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
  // §13.188：引导会话靠 sessionProven 判定，不靠 insideTmux；先讲两条分支，再讲收养。
  includesAll(
    bootstrap,
    [
      "read `sessionProven` and `insideTmux`",
      "`sessionProven: true` means this session's own session-start record exists",
      "`sessionProven: false` or `null` means this session started before the workspace's hooks existed",
      "it only bootstraps and must never register itself or mark its pane",
      "`attach` when they are outside tmux, `switch` when this session already runs inside it",
      "show the handover card from `references/first-run.md`",
      "close this session with `/exit`",
    ],
    "windowBootstrap",
  );
  ok(
    indexOfRequired(bootstrap, "`sessionProven: true`") <
      indexOfRequired(bootstrap, "`sessionProven: false`") &&
      indexOfRequired(bootstrap, "`sessionProven: false`") <
        indexOfRequired(bootstrap, "`adopted: true`"),
    "the proven branch, the bootstrap branch, then adoption",
  );
  equal(
    bootstrap.includes("When `insideTmux` is false"),
    false,
    "insideTmux no longer decides who bootstraps",
  );
});

test("§13.188 首次引导与日常使用分开：first-run 参考只在新工作区读，交接卡来自宿主占位符，README 分成首次与日常，status 对空闲工作区只说一句", () => {
  const controller = claude(CONTROLLER);
  ok(controller.includes("`references/first-run.md` - a fresh workspace only"));
  ok(controller.includes("never in daily use"));
  const firstRun = flat(claude("skills/wakeflow-controller/references/first-run.md"));
  includesAll(
    firstRun,
    [
      "It never becomes the Controller window",
      "A setup session cannot prove itself, whether or not it runs inside the container already",
      "do not start the workspace conversation until the preflight is clean",
      "Recommend `owner-managed`",
      "show one card and nothing else",
      "`/wakeflow:status` in the Controller answers",
      "This file is not read again",
    ],
    "first-run reference (Claude)",
  );
  ok(firstRun.includes("`Ctrl-b n` next window"), "the Claude handover card teaches the keys once");
  const codexFirstRun = flat(codex("skills/wakeflow-controller/references/first-run.md"));
  ok(codexFirstRun.includes("the workspace project in the Codex app and its threads"));
  equal(codexFirstRun.includes("Ctrl-b"), false, "Codex gets no tmux keys");
  // R3（W18）：Codex 不发 slash 命令，交接卡让用户用人话问 Controller，而不是教他敲 `/wakeflow:status`。
  ok(codexFirstRun.includes('ask the Controller thread "what is next" in plain words'));
  equal(codexFirstRun.includes("/wakeflow:"), false, "the Codex card names no slash command");
  for (const readme of [claude("README.md"), codex("README.md")]) {
    ok(readme.includes("## First run") && readme.includes("## Daily use"));
    ok(
      flat(readme).includes(
        "an idle workspace answers with the Design window and a new requirement",
      ),
    );
  }
  ok(
    flat(claude("README.zh-CN.md", "zh")).includes("## 第一次使用") &&
      flat(claude("README.zh-CN.md", "zh")).includes("## 日常使用"),
  );
  ok(
    flat(source("commands/init.md")).includes(
      "the session you are in only bootstraps and never becomes the Controller",
    ),
  );
  ok(
    flat(source("commands/status.md")).includes(
      "names `requirement-authoring` with the user as owner",
    ),
  );
  // 连续 `/next`（V3，§13.208；I21，2026-11-09 用户裁决）：owner 是 Controller 就连续；停点只剩 owner 变化
  // 且无自有工作、用户决定点、阻塞；记录决定与投递结局是步骤边界不是停点。旧的"一步即停"与"每次决定停一次"
  // 的措辞都不再出现。
  const next = flat(source("commands/next.md"));
  ok(next.includes("Keep going while the owner of `next` is the Controller"));
  ok(next.includes("the owner changes and nothing you own is ready"));
  ok(next.includes("is a step boundary, not a stop"));
  ok(next.includes("asks for the user's confirmation or decision"));
  equal(next.includes("do that one step, and stop"), false);
  equal(next.includes("you recorded a review decision"), false);
  // 技能正文宿主中立（R3，W18）：停点那句不点名 `/wakeflow:next`，两个宿主渲染出同一句。
  ok(
    flat(source("skills/wakeflow-controller/SKILL.md")).includes(
      "A recorded decision is a step boundary, not a stop: re-read `wakeflow_status` and go on while it names you",
    ),
  );
  // Agent 侧的四条引导：临时文件、逐条列出用例、环境前置、Controller 核对文件的位置。
  ok(flat(source(TARGET)).includes("never write into the workspace root or another repository"));
  ok(flat(source(TEST_EXECUTION)).includes("names each case in the output"));
  ok(
    flat(source("skills/wakeflow-controller/references/delivery-and-review.md")).includes(
      "an environment prerequisite the checkout cannot satisfy alone",
    ),
  );
  ok(flat(source(EVIDENCE)).includes("`controller-checks/<demandId>/`"));
  ok(flat(source(WINDOWS)).includes("cannot resolve it inside a worktree"));
});

test("F-L1-9：权限显式——只预放行自己的工具与助手，信任对话框只列这些；仓库根带 broad-permission 残留时先让用户删再开窗（§13.183）", () => {
  // 现场：五个产品克隆带着 0.9.x 写进去的 Bash(git *)/Bash(node *)/Bash(tmux *) 与 `..`，信任对话框要把它们一并生效。
  const windows = flat(claude(WINDOWS));
  includesAll(
    windows,
    [
      "Permissions are explicit: Wakeflow pre-approves only its own tools, per role, and its helper",
      "never a shell-wide rule or a parent-directory grant",
      "Do not launch into a root that `legacyResidue` lists with `broad-permission` or `additional-directories` until the user has deleted those entries or chosen to keep them",
      "The window starts with `--allowedTools` for its role's Wakeflow tools and the helper",
      "a product repository's `.claude/settings.json` is never written",
      "so a trust dialog for a Wakeflow-written root lists only those rules",
      "so the user deletes or confirms them before you launch, never you",
    ],
    "windows reference",
  );
  // 规则在开窗步骤之前，Controller 读到它时还没有调用助手。
  ok(
    indexOfRequired(windows, "Permissions are explicit") <
      indexOfRequired(windows, "Launching and registering:"),
  );
  const readme = flat(claude("README.md"));
  includesAll(
    readme,
    [
      "nothing broader such as `Bash(tmux *)` is written",
      "A trust dialog for a root Wakeflow wrote therefore lists only those rules",
      "delete or review it before accepting, because accepting activates it",
      "they are deleted before a window is launched there",
    ],
    "README",
  );
  includesAll(
    flat(claude("README.zh-CN.md", "zh")),
    [
      "不会写 `Bash(tmux *)` 之类更宽的规则",
      "其信任对话框只会列出这几条",
      "往那里开窗口之前先删掉",
    ],
    "README.zh-CN",
  );
  ok(
    flat(source("commands/init.md")).includes(
      "Residue listed under a repository root is removed by the user before a window is launched there",
    ),
  );
  // Codex 没有 settings.json 与信任对话框：它的窗口文本不提 --allowedTools。
  equal(codex(WINDOWS).includes("--allowedTools"), false);
  // 任何一面的文本都不得把三条宽规则说成 Wakeflow 现在写的东西（否定句"不会写"、"is never written"是在陈述现状）。
  for (const relative of shippedSources()) {
    for (const text of renderedForBothHosts(relative)) {
      equal(
        /(?:\bwrites?\b|(?<![不没])(?:写入|写进|会写))[^.。\n]{0,80}`Bash\((git|node|tmux) \*\)`/u.test(
          flat(text),
        ),
        false,
        `${relative} claims Wakeflow writes a broad rule`,
      );
    }
  }
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

test("§13.190 I12/I13：引导会话先登记、按 hook-evidence-missing 判断谁在等对话框；selection 只从工具 Schema 构造，不读别的工作区", () => {
  const bootstrap = flat(CLAUDE_CODE_AGENT_TEXT_PLACEHOLDERS.windowBootstrap.en);
  includesAll(
    bootstrap,
    [
      "register each window from the observation you kept, in launch order, without waiting for the user",
      "A registration refused `hook-evidence-missing` means that window has not started",
      "A trusted directory shows no dialog",
      "ask them to accept the dialog where one is shown",
      "register those windows again when they say so",
    ],
    "windowBootstrap",
  );
  equal(
    bootstrap.includes("accept the trust dialog in every window"),
    false,
    "the trust dialog is no longer a step every window goes through",
  );
  ok(
    indexOfRequired(bootstrap, "without waiting for the user") <
      indexOfRequired(bootstrap, "`hook-evidence-missing`"),
    "register first; the refusal names who is waiting",
  );
  // 共享的 bootstrap 一节是宿主中立的：launch、信任对话框、mark 只在 Claude 的占位符里；两个宿主渲染出同一段。
  const firstRun = flat(claude("skills/wakeflow-controller/references/first-run.md"));
  const codexFirstRunBootstrap = flat(codex("skills/wakeflow-controller/references/first-run.md"));
  for (const [rendered, label] of [
    [firstRun, "first-run reference (Claude)"],
    [codexFirstRunBootstrap, "first-run reference (Codex)"],
  ] as const) {
    includesAll(
      rendered,
      [
        "register each window from the observation you kept as soon as the host has started it",
        "answer a host prompt where one is shown",
        "Only a window whose registration is refused for a missing record is waiting",
        "finish the host procedure's last step before the card",
        "`hosts.claude-code.tmux.sessionName`",
        "never from another workspace's config or from plugin files",
      ],
      label,
    );
    for (const claudeOnly of [
      "accept each window's trust dialog",
      "exactly two things",
      "trust dialog",
      "launch has returned",
      "Mark the windows",
      "with the one command",
    ]) {
      equal(rendered.includes(claudeOnly), false, `${label} must not say "${claudeOnly}"`);
    }
  }
  ok(
    claude(WINDOWS).includes("never from plugin files on disk or another workspace's config"),
    "the daily reference forbids reading another workspace's config too",
  );
});

test("ADR-0023：交接卡与 windows 参考把窗口列表标记说成提示、从不是证据；Codex 不提标记；两家都提醒长跑前保持机器不睡眠", () => {
  const claudeCard = flat(CLAUDE_CODE_AGENT_TEXT_PLACEHOLDERS.firstRunHandover.en);
  const codexCard = flat(CODEX_AGENT_TEXT_PLACEHOLDERS.firstRunHandover.en);
  const keepAwake = "keep the machine awake yourself, Wakeflow runs no background process";
  includesAll(
    claudeCard,
    [
      "a green `+` after a window name means it is working, a red `?` means it is waiting for you, nothing means idle",
      "the hooks write them, a hint and never evidence",
      keepAwake,
    ],
    "Claude handover card",
  );
  ok(codexCard.includes(keepAwake), "the Codex card carries the same host-neutral advice");
  for (const claudeOnly of ["`+`", "`?`", "hooks", "tmux"]) {
    equal(codexCard.includes(claudeOnly), false, `Codex card must not say "${claudeOnly}"`);
  }
  includesAll(
    claude(WINDOWS),
    [
      "other than an idle prompt",
      "green `+` working, red `?` waiting for you, nothing when idle",
      "a hint, never evidence",
      "their action there clears it, no tool does",
    ],
    "windows reference",
  );
  // 更新一节在 Codex 渲染里仍不提 tmux：标记那句不点名宿主工具。
  equal(section(codex(WINDOWS), PLUGIN_UPDATE_HEADING).includes("tmux"), false);
});

/**
 * ADR-0025 D4、D5、D7 与双传输规划原则 1：Claude 宿主的两种窗口传输（tmux、桌面会话）在每个触及窗口层的
 * 取值里各有一段，顺序是配置缺省的 tmux 在前；桌面的分步在新参考 `desktop-transport.md` 里，共享参考只指
 * 路；README 两种语言、init 命令与 first-run 参考说清传输怎样选（引导会话按环境提议，用户可改）；投递参考
 * 对两种传输用同一个 sendReturn 措辞；Target 技能不再把跨会话消息工具一概排除——桌面上的回调正是它。
 */
test("ADR-0025：两种传输并列——取值表各写 tmux 与桌面两段，桌面参考齐全，README、init 与 first-run 说清选择方式", () => {
  const launch = flat(CLAUDE_CODE_AGENT_TEXT_PLACEHOLDERS.windowLaunch.en);
  includesAll(
    launch,
    [
      `\`${CLAUDE_CODE_TMUX_ASSET_COMMAND} launch --window <windowId>\` under the tmux transport`,
      `\`${CLAUDE_CODE_DESKTOP_ASSET_COMMAND} launch --window <windowId>\` under desktop sessions`,
      "The workspace's transport is `hosts.claude-code.windowTransport`",
      "Under the tmux transport the helper opens the window in the tmux session the intent names",
      "Under desktop sessions the helper starts the session in the background with `claude --bg`",
      "prints the observation with `desktop.sessionId`",
      "`--wait-session-start <seconds>` (default 30)",
      'After each registration set the session\'s permission mode with the desktop `set_session_permission_mode` tool to `"auto"`',
      "the user approves its card once per folder",
      "and its title with the desktop `set_session_title` tool",
      "liveness is the desktop-sessions observation built from the desktop `list_sessions` tool, the helper's `sessions` is only the process view",
      "`not-trusted` for a folder without Claude Code's trust record",
      "the refusal's `trustRoot` is the folder that needs it: collect the distinct ones, ask the user once, and with their agreement run `trust --window <windowId> --user-agreed` once per `trustRoot` and `launch` the refused windows again",
      "closed with the desktop `archive_session` tool only on the user's authorization - never with `claude rm`",
      "so relocate does not apply",
      "`references/desktop-transport.md`",
    ],
    "windowLaunch",
  );
  ok(
    indexOfRequired(launch, "Under the tmux transport the helper") <
      indexOfRequired(launch, "Under desktop sessions the helper"),
    "the configured default transport is described first",
  );

  const bootstrap = flat(CLAUDE_CODE_AGENT_TEXT_PLACEHOLDERS.windowBootstrap.en);
  includesAll(
    bootstrap,
    [
      `\`${CLAUDE_CODE_TMUX_ASSET_COMMAND} preflight\` under the tmux transport, \`${CLAUDE_CODE_DESKTOP_ASSET_COMMAND} preflight\` under desktop sessions`,
      "Under desktop sessions `preflight` reports `desktop.appRunning`",
      "`script.available`",
      "the same `sessionProven`",
      "`not-trusted` means Claude Code has no trust record for that window's `trustRoot`",
      "opens each folder in the desktop app (a new session there) or runs `claude` in a terminal there and accepts the trust dialog",
      "the workspace root, whose record covers the surfaces inside it, or a product repository; opening a folder in the desktop app does not always write it, so the root can be among them",
      "Do not stop there: launch the remaining windows, then name every distinct `trustRoot` to the user in one question",
      "After their yes run `trust --window <windowId> --user-agreed` once per `trustRoot`",
      "Never pass `--user-agreed` without their word",
      'set its permission mode with the desktop `set_session_permission_mode` tool to `"auto"`',
      "never try to work around a classifier refusal - start a new session in the workspace root (with `start_session` when the host offers it, otherwise ask the user to open one)",
      "file the sessions into one sidebar group named after the program with the desktop `create_group` and `move_sessions` tools",
      "There is no adoption on this transport",
      "continue in the Controller session in the sidebar and to archive this one",
    ],
    "windowBootstrap",
  );

  const resume = flat(CLAUDE_CODE_AGENT_TEXT_PLACEHOLDERS.windowResume.en);
  includesAll(
    resume,
    [
      "under the tmux transport, if this serving MCP is outdated",
      "`close --window <windowId>` (the binding stays; this is not a decommission), `launch --window <windowId> --wait 60`",
      'with `operation: "replace"`',
      "Under desktop sessions nothing restarts in place",
      "an outdated server refuses writes (`runtime-artifact-outdated`), and the desktop app reloads the MCP server on its own within a few turns",
      "check `wakeflow_status` on your next turns until it shows the runtime artifact current, then call `wakeflow_verify` and preview and apply reconcile",
      "if it has not reloaded after a few turns, ask the user to archive and unarchive this Controller session and message it",
      "relocate does not apply on this transport",
    ],
    "windowResume",
  );

  const delivery = flat(CLAUDE_CODE_AGENT_TEXT_PLACEHOLDERS.deliveryAction.en);
  includesAll(
    delivery,
    [
      `\`${CLAUDE_CODE_TMUX_ASSET_COMMAND} deliver --window <windowId> --handle-digest <the permit's handleDigest> --prompt-ref <the permit's promptRef> --prompt-digest <the permit's promptDigest>\``,
      "landing is proven by the hook record alone",
      "Under desktop sessions send the `promptRef` file's text, unchanged and once, with the desktop `send_message` tool",
      "the `desktop.sessionId` its `launch` printed",
      "a callback goes with `SendMessage` to the Controller's desktop id that the delivery prompt names",
      "keep the tool's return unchanged as `attempt.sendReturn`",
      '`"failed-before-send"` when nothing was sent',
      "before recording the outcome",
      `\`${CLAUDE_CODE_DESKTOP_ASSET_COMMAND} landing --window <windowId> --prompt-ref <the permit's promptRef>\``,
      "only the target's `user-prompt-submit` record proves landing",
    ],
    "deliveryAction",
  );

  const worktree = flat(CLAUDE_CODE_AGENT_TEXT_PLACEHOLDERS.worktreeLaunch.en);
  includesAll(
    worktree,
    [
      "under the tmux transport in a tmux session named `<configured session>-<pod name>`",
      "under desktop sessions as further sessions in the app's sidebar",
      "under desktop sessions it starts with the checkout as its working directory and never with `--worktree`",
    ],
    "worktreeLaunch",
  );

  const card = flat(CLAUDE_CODE_AGENT_TEXT_PLACEHOLDERS.firstRunHandover.en);
  includesAll(
    card,
    [
      "for the transport this workspace uses",
      "Under the tmux transport:",
      "Under desktop sessions:",
      "click a session in the sidebar",
      "filed in one group named after the program (a worktree pod gets its own group, `<program> · <pod>`)",
      "no Wakeflow mark is added",
      "On either transport:",
    ],
    "firstRunHandover",
  );
  includesAll(
    flat(CLAUDE_CODE_AGENT_TEXT_PLACEHOLDERS.resendGuard.en),
    ["refuses with `already-landed`", "under desktop sessions run the helper's `landing` first"],
    "resendGuard",
  );
  includesAll(
    flat(CLAUDE_CODE_AGENT_TEXT_PLACEHOLDERS.hostEffectRule.en),
    [
      "`tmux.mjs` under the tmux transport, `desktop.mjs` under desktop sessions",
      "its `launch` prints the observation you register",
    ],
    "hostEffectRule",
  );

  const trust = CLAUDE_CODE_AGENT_TEXT_PLACEHOLDERS.hostTrustSteps;
  includesAll(
    flat(trust.en),
    [
      "`hosts.claude-code.windowTransport` - one transport per workspace",
      "proposes the transport its surroundings support (desktop sessions when it runs in the desktop app and has the app's session tools, tmux otherwise), you may choose the other one",
      "sign in to the desktop app with your Claude subscription",
      "decide once about the folders Claude Code does not trust yet - the workspace root, whose trust also covers the Design and Test surfaces inside it, and each product repository",
      "the setup session lists them, says what trusting them means and, with your agreement, opens each in the desktop app",
      "nothing is trusted without your word",
      "approve the one card per folder the app may show when the Controller switches a window there to the `auto` permission mode",
      "Under desktop sessions no status line is written",
    ],
    "hostTrustSteps (en)",
  );
  includesAll(
    flat(trust.zh ?? ""),
    [
      "`hosts.claude-code.windowTransport`",
      "时是桌面会话，否则是 tmux），你可以选另一种",
      "用 Claude 订阅登录桌面 app",
      "对 Claude Code 还不信任的目录只需决定一次——工作区根（它的信任同时覆盖工作区内的 Design、Test 面）与每个产品仓库",
      "引导会话把它们列出来、说明信任意味着什么",
      "你同意后由它在桌面 app 里逐个打开，app 随即记下信任（当前版本不再弹窗）",
      "没有你的同意，不会信任任何目录",
      "app 可能每个目录弹一次确认卡",
    ],
    "hostTrustSteps (zh)",
  );
  const update = CLAUDE_CODE_AGENT_TEXT_PLACEHOLDERS.pluginUpdateSteps;
  ok(
    flat(update.en).includes(
      "under desktop sessions the desktop app reloads each session's Wakeflow server on its own within a few turns - if the Controller's does not, archive and unarchive it and " +
        "message it, which restarts its process on the current artifact -",
    ),
  );
  ok(flat(update.zh ?? "").includes("桌面 app 会在几个回合内自行重载各会话的 Wakeflow 服务"));
  for (const text of [flat(update.en), flat(resume), flat(source(DESKTOP))]) {
    equal(
      text.includes("quit and reopen"),
      false,
      "X20: the desktop app reloads the server itself",
    );
  }

  includesAll(
    claude("README.md"),
    [
      "the windows live in tmux panes or as sessions in the desktop app's Code tab - one window transport per workspace, chosen on the first run",
      "`tmux.mjs` under the tmux transport, `desktop.mjs` under desktop sessions",
      "under desktop sessions the folders to open once so Claude Code trusts them and the one card per folder that confirms the `auto` permission mode",
      "either `tmux` or the Claude desktop app signed in with a subscription",
    ],
    "README",
  );
  includesAll(
    claude("README.zh-CN.md", "zh"),
    ["tmux 窗格里，或是桌面 app Code 标签里的会话", "`tmux.mjs`，桌面会话传输下是 `desktop.mjs`"],
    "README.zh-CN",
  );

  includesAll(
    flat(source("commands/init.md")),
    [
      "`hosts.claude-code.windowTransport` is the window transport",
      "propose the one this session's surroundings support (desktop when it has the desktop app's session tools, tmux otherwise)",
      "let the user pick the other one if they prefer; one transport per workspace",
      "A later `reconfigure` can switch the transport when no Demand is active and no worktree pod is open; afterwards you relaunch and register every window with the new transport's helper",
    ],
    "init.md",
  );
  for (const rendered of [claude(FIRST_RUN), codex(FIRST_RUN)]) {
    ok(rendered.includes("`hosts.claude-code.windowTransport` is the window transport"));
    ok(rendered.includes("the desktop app running and signed in for desktop sessions"));
    includesAll(
      flat(rendered),
      [
        "On Claude Code under desktop sessions, right after apply this session's permission classifier may refuse the helper",
        "Never try to work around a classifier refusal",
        "with `start_session` when the host offers it, otherwise ask the user to open one there",
      ],
      FIRST_RUN,
    );
  }

  includesAll(
    claude(WINDOWS),
    [
      "the steps below name both, and `references/desktop-transport.md` details desktop sessions",
      "on Claude Code also `windowTransport`, `tmux` or `desktop`",
      "a later `reconfigure` can switch the transport when no Demand is active and no worktree pod is open",
      "`tmux.mjs` or `desktop.mjs`, and under tmux the status line",
      "the desktop helper returns once the session has started",
    ],
    WINDOWS,
  );
  // 四步换代序列从共享参考移进 tmux 取值：共享源里不再有它，Codex 渲染也就不再读到 tmux 的分步。
  equal(source(WINDOWS).includes("the complete sequence on Claude Code is four calls"), false);
  equal(codex(WINDOWS).includes("--wait 60"), false);

  const desktop = source(DESKTOP);
  for (const heading of [
    "## What the transport is",
    "## One-time prerequisites (the user's)",
    "## The helper and its five subcommands",
    "## Refusals and what to tell the user",
    "## Step 1 on this transport",
    "## Step 8 - delivering on this transport",
    "## The callback",
    "## Marking, closing and replacing a window",
    "## Pods",
    "## After a plugin update",
    "## What this transport does not have",
  ]) {
    ok(desktop.includes(`\n${heading}\n`), `desktop reference lacks the section ${heading}`);
  }
  includesAll(
    flat(desktop),
    [
      "never runs `claude rm`",
      "It never starts with `--worktree`",
      "**Close** is `archive_session`, only when the user authorizes retiring that window",
      "`relocate` does not apply on this transport",
      "with the `SendMessage` tool, once",
      "The delivery prompt's return section names that id as `- controller desktop session: local_<id>`",
      "your three paragraphs carry no desktop id",
      "Liveness is the `desktop-sessions` observation you build from the desktop `list_sessions` tool",
      "A session whose process ended after its turn is still in the sidebar and still present",
      "The helper's `sessions` is only the process view",
      'Right after each registration call the desktop `set_session_permission_mode` tool with the window\'s `desktop.sessionId` and `"auto"`',
      "`permission-mode-mismatch:<windowId>` means the landing record shows that window in another permission mode than `auto`",
      "Opening a folder in the desktop app does not always write the record, so the root can lack it too",
      "collect the refusals, ask the user once about each distinct `trustRoot`, and with their agreement record the trust with `trust` (below)",
      "never open one with `claude --desktop` yourself and never pass `--user-agreed` without their word",
      "Without `--user-agreed` it refuses `consent-required`",
      "Never work around a classifier refusal",
      "`<program>` for the primary pod, `<program> · <pod>` for a worktree pod",
      "after a reconcile you recreate a missing group the same way",
      "the desktop app reloads the MCP server on its own within a few turns",
      "archive and unarchive this Controller session, then message it: that message",
      "`wakeflow_verify` reports them as `windows-refresh-pending:<n>` on a passing gate",
      "Restart none of them and send none a message to clear the state",
      "A `reconfigure` can switch the transport when no Demand is active and no worktree pod is open",
      "find the session by its title with the desktop `list_sessions` tool",
      '`attempt: { status: "sent", sendReturn: <the return, unchanged> }`',
      "Right after the send returns, before any other step, run `landing --window",
      "the outcome carries no `readback`",
      "`closeResult.status` is `closed` when the archive tool reported success",
      "the two transports are equals",
      "asks the session to load nothing and reply only `ok`; the first real prompt is yours, sent later",
    ],
    DESKTOP,
  );
  // 每个子命令一节，标题即用法：子命令名与旗标逐字对齐 desktop.mjs 的解析器（ADR-0025 D4）。
  for (const usage of [
    "### `preflight`",
    "### `launch --window <windowId> [--wait <seconds>] [--wait-session-start <seconds>] [--force]`",
    "### `sessions`",
    "### `landing --window <windowId> --prompt-ref <promptRef> [--wait-landing <seconds>]`",
  ]) {
    ok(desktop.includes(`\n${usage}\n`), `desktop reference lacks the usage heading ${usage}`);
  }
  ok(
    desktop.includes("| `reason` | What it means | What you do |"),
    "refusals are keyed by `reason`",
  );
  for (const code of [
    "desktop-session-required",
    "locator-kind-mismatch",
    "relocate-not-applicable",
  ]) {
    ok(desktop.includes(`\`${code}\``), `desktop reference lacks the registration refusal ${code}`);
  }
  for (const code of [
    "not-trusted",
    "consent-required",
    "trust-open-failed",
    "desktop-unavailable",
    "script-unavailable",
    "launch-first-turn-timeout",
    "launch-first-turn-failed",
    "desktop-resume-refused",
    "desktop-session-start-missing",
    "locator-live",
    "worktree-cwd-mismatch",
    "intent-invalid",
    "prompt-position",
  ]) {
    ok(desktop.includes(`| \`${code}\` |`), `desktop reference lacks the refusal row ${code}`);
  }
  // Q13（ADR-0025 D11）：助手的 not-trusted 提示与参考同一做法——不打断这一轮，把被拒的目录收齐后只问用户一次，
  // 同意后 trust --user-agreed 再 launch，不同意则由用户自己打开；没有同意标志时 trust 拒绝。
  ok(
    CLAUDE_CODE_DESKTOP_ASSET_CONTENT.includes(
      "go on launching the other windows, then name every distinct trustRoot to the user in one question and say what trusting it means; with their agreement run trust --window <windowId> --user-agreed once per trustRoot and launch the refused windows again, otherwise they open that folder in the Claude desktop app or run claude in a terminal there and accept the trust dialog",
    ),
    "the helper's not-trusted hint names the one-question trust flow",
  );
  ok(
    CLAUDE_CODE_DESKTOP_ASSET_CONTENT.includes(
      "pass --user-agreed only after the user agrees to that list",
    ),
    "the helper's consent-required hint ties the flag to the user's agreement",
  );
  equal(
    desktop.includes("{{"),
    false,
    "the desktop reference is literal host text and needs no placeholder",
  );

  includesAll(
    claude(DELIVERY),
    [
      "Under the tmux transport on Claude Code the helper's `deliver` output carries that lookup",
      "Under desktop sessions the send is your own `send_message` call: its return value is `attempt.sendReturn`",
      "the rendered prompt's return section already names the Controller's desktop session as the callback's destination",
      "the helper's landing lookup and `panes` or `sessions`",
      "under desktop sessions there is no nudge",
    ],
    DELIVERY,
  );
  ok(
    flat(source(TARGET)).includes("not a messaging tool the permit's host action did not name"),
    "the Target skill admits the messaging route the permit names (the desktop callback)",
  );
  equal(flat(source(TARGET)).includes("not a cross-session messaging tool"), false);
});
