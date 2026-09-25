import { deepEqual, equal, match, ok } from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { type TestContext, test } from "node:test";
import { fileURLToPath } from "node:url";

import { renderWakeflowConfig } from "../../src/configuration/wakeflow-config-document.js";
import {
  type HookObserverCode,
  type HookObserverOutcome,
  type HookObserverStderrCode,
  registerProcessGuards,
  runWakeflowHookObserver,
  unwrapHostPrompt,
  WAKEFLOW_HOOK_OBSERVER_HOST_ARGUMENT,
  WAKEFLOW_HOOK_OBSERVER_MARKER,
  WAKEFLOW_HOOK_OBSERVER_STDIN_MAXIMUM_BYTES,
} from "../../src/entrypoints/wakeflow-hook-observer.js";
import { computeSha256Digest } from "../../src/foundation/crypto/sha256.js";
import { RootedDirectory } from "../../src/foundation/filesystem/rooted-directory.js";
import { encodeUtf8 } from "../../src/foundation/text/utf8.js";
import { computeDeliveryPromptDigest } from "../../src/governance/delivery/delivery-envelope.js";
import { claudeCodeWorkspaceHostResourceProfile } from "../../src/hosts/claude-code/wakeflow-workspace-host-resource-profile.js";
import { codexWorkspaceHostResourceProfile } from "../../src/hosts/codex/wakeflow-workspace-host-resource-profile.js";
import {
  type HostHookEvent,
  type HostHookObservationInventory,
  readHostHookObservations,
} from "../../src/kernel/hook-observations.js";
import { hostHookObservationsRootRef } from "../../src/kernel/layout.js";
import { wakeflowWindowHostBindingRootRef } from "../../src/workspace/window-runtime/wakeflow-window-runtime-paths.js";
import { createMinimalWakeflowConfig } from "../configuration/wakeflow-config.fixture.js";

/**
 * hook 观察脚本（gate-log §13.97 D1–D4、D9）：进程内经 `runWakeflowHookObserver` 覆盖定位、映射、
 * 扇出与失败策略；spawn 编译后的入口经 D1 形状的 launcher 覆盖进程合同（退出 0、stdout 空、stderr
 * 至多一行固定代码且不含私有值）。夹具由手工搭起：`wakeflow.config.json` 用配置渲染器写出，
 * 兄弟仓库与两种 worktree 检出用真实 git 造出，绑定记录按 Window Host Binding 的形状写入。
 */

type HostId = "codex" | "claude-code";
type HostEventName = "SessionStart" | "UserPromptSubmit" | "Stop" | "SessionEnd";

const HOSTS: readonly HostId[] = ["codex", "claude-code"];
const EVENTS: readonly (readonly [HostEventName, HostHookEvent])[] = [
  ["SessionStart", "session-start"],
  ["UserPromptSubmit", "user-prompt-submit"],
  ["Stop", "stop"],
  ["SessionEnd", "session-end"],
];
const FIXED_INSTANT = "2026-09-18T08:00:00.000Z";
const PROMPT = "  Implement the hook observer per gate-log 13.97.\n";
const LAST_ASSISTANT_MESSAGE = "Done: the record landed in every matched workspace.";
const SESSION_IDS: Readonly<Record<HostId, string>> = Object.freeze({
  codex: "019924aa-0000-7000-8000-00000000c0de",
  "claude-code": "c1a0de00-1111-4222-8333-444455556666",
});
const PROFILES: Readonly<Record<HostId, unknown>> = Object.freeze({
  codex: codexWorkspaceHostResourceProfile,
  "claude-code": claudeCodeWorkspaceHostResourceProfile,
});
const RECORD_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const MILLISECOND_INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

function temporaryDirectory(t: TestContext, prefix: string): string {
  const directory = realpathSync(mkdtempSync(path.join(os.tmpdir(), prefix)));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function git(cwd: string, ...args: readonly string[]): void {
  const result = spawnSync("git", [...args], {
    cwd,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@example.invalid",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@example.invalid",
    },
  });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
}

/** 一个只有配置与两个支持面目录的工作区：仓库按最小配置声明为兄弟目录 `../ProductA`。 */
function createWorkspace(base: string, name: string): string {
  const workspace = path.join(base, name);
  mkdirSync(path.join(workspace, "Design"), { recursive: true });
  mkdirSync(path.join(workspace, "Test"), { recursive: true });
  writeFileSync(
    path.join(workspace, "wakeflow.config.json"),
    renderWakeflowConfig(createMinimalWakeflowConfig()),
    { mode: 0o644 },
  );
  return workspace;
}

interface Fixture {
  readonly base: string;
  readonly workspace: string;
  readonly repository: string;
  readonly transcriptPath: string;
}

function createFixture(t: TestContext): Fixture {
  const base = temporaryDirectory(t, "wakeflow-hook-observer-");
  const workspace = createWorkspace(base, "Wakeflow");
  const repository = path.join(base, "ProductA");
  mkdirSync(path.join(repository, "src"), { recursive: true });
  git(repository, "init", "--quiet", "--initial-branch=main");
  git(repository, "commit", "--quiet", "--allow-empty", "-m", "c1");
  return Object.freeze({
    base,
    workspace,
    repository,
    transcriptPath: path.join(base, "transcripts", "session.jsonl"),
  });
}

function addWorktree(repository: string, checkout: string): string {
  mkdirSync(path.dirname(checkout), { recursive: true });
  git(repository, "worktree", "add", "--quiet", "--detach", checkout);
  return checkout;
}

function hookPayload(
  event: string,
  sessionId: string,
  cwd: string,
  transcriptPath: string | null,
  extra: Readonly<Record<string, unknown>> = {},
): string {
  return JSON.stringify({
    session_id: sessionId,
    cwd,
    transcript_path: transcriptPath,
    hook_event_name: event,
    ...extra,
  });
}

function argvFor(host: string): readonly string[] {
  return [WAKEFLOW_HOOK_OBSERVER_MARKER, WAKEFLOW_HOOK_OBSERVER_HOST_ARGUMENT, host];
}

interface ObserveOptions {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly argv?: readonly string[];
  readonly artifactManifestDigest?: string;
}

function observe(
  host: HostId,
  stdin: string | Uint8Array,
  options: ObserveOptions = {},
): Promise<HookObserverOutcome> {
  return runWakeflowHookObserver({
    argv: options.argv ?? argvFor(host),
    env: options.env ?? {},
    stdin,
    clock: () => new Date(FIXED_INSTANT),
    ...(options.artifactManifestDigest === undefined
      ? {}
      : { artifactManifestDigest: options.artifactManifestDigest as never }),
  });
}

function writtenRoots(outcome: HookObserverOutcome): readonly string[] {
  return outcome.written.map((entry) => entry.workspaceRoot);
}

/** 绑定目录从内核布局派生：入口里的字面量必须与之一致，布局移动时本测试报错。 */
function bindingsDirectory(workspace: string, host: HostId): string {
  return path.join(workspace, ...wakeflowWindowHostBindingRootRef(PROFILES[host]).split("/"));
}

function writeBinding(workspace: string, host: HostId, sessionId: string): void {
  const directory = bindingsDirectory(workspace, host);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const windowId = "window_88888888-8888-4888-8888-888888888888";
  const record = {
    kind: "WakeflowWindowHostBinding",
    schemaVersion: 1,
    programId: "program_11111111-1111-4111-8111-111111111111",
    hostId: host,
    windowId,
    bindingId: "window_binding_a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1",
    handle: { kind: host === "codex" ? "codex-thread" : "claude-session", value: sessionId },
    source: {
      kind: "agent-host-create-result",
      launchIntentDigest: `sha256:${"1".repeat(64)}`,
      observedAt: "2026-09-18T07:59:00.000Z",
    },
    registeredAt: "2026-09-18T07:59:01.000Z",
  };
  writeFileSync(path.join(directory, `${windowId}.json`), `${JSON.stringify(record, null, 2)}\n`, {
    mode: 0o600,
  });
}

async function readBack(workspace: string, host: HostId): Promise<HostHookObservationInventory> {
  const root = await RootedDirectory.open(workspace);
  try {
    return await readHostHookObservations(root, host, { limit: 1024 });
  } finally {
    await root.close();
  }
}

function observationsDirectory(workspace: string, host: HostId): string {
  return path.join(workspace, ...hostHookObservationsRootRef(host).split("/"));
}

/** 把观察目录的路径换成普通文件（已有目录先删掉）：内核的目录物化必然失败，且写入器不会删掉它重建。 */
function breakObservationsDirectory(workspace: string, host: HostId): void {
  const directory = observationsDirectory(workspace, host);
  rmSync(directory, { recursive: true, force: true });
  mkdirSync(path.dirname(directory), { recursive: true, mode: 0o700 });
  writeFileSync(directory, "not a directory\n", { mode: 0o600 });
}

/** 往目录里塞 count 个无关的普通文件：既不是候选子目录，也不是绑定记录，只占列举的条目数。 */
function fillDirectory(directory: string, count: number): void {
  for (let index = 0; index < count; index += 1) {
    writeFileSync(path.join(directory, `noise-${index}.txt`), "", { mode: 0o600 });
  }
}

test("两宿主 × 四事件：从工作区根提交的宿主 payload 各落一条记录，字段映射同形，读回 skipped 为 0，重复的 session-start 报 current", async (t) => {
  const fixture = createFixture(t);
  for (const host of HOSTS) {
    const sessionId = SESSION_IDS[host];
    writeBinding(fixture.workspace, host, sessionId);
    // Codex 的回合事件带 turn_id，Claude 带 prompt_id；脚本宿主无关地读 turn_id ?? prompt_id（D3）。
    const turn = host === "codex" ? { turn_id: "turn-0001" } : { prompt_id: "prompt-0001" };
    const extras: Readonly<Record<HostEventName, Readonly<Record<string, unknown>>>> = {
      SessionStart: {},
      UserPromptSubmit: { prompt: PROMPT, ...turn },
      Stop: { last_assistant_message: LAST_ASSISTANT_MESSAGE, ...turn },
      SessionEnd: {},
    };
    for (const [name] of EVENTS) {
      const outcome = await observe(
        host,
        hookPayload(name, sessionId, fixture.workspace, fixture.transcriptPath, extras[name]),
      );
      equal(outcome.code, null, `${host} ${name}`);
      equal(outcome.written.length, 1, `${host} ${name}`);
      equal(outcome.written[0]?.workspaceRoot, fixture.workspace);
      equal(outcome.written[0]?.disposition, "created");
      match(outcome.written[0]?.recordId ?? "", RECORD_ID_PATTERN);
    }

    const inventory = await readBack(fixture.workspace, host);
    equal(inventory.skipped, 0);
    equal(inventory.records.length, 4);
    const byEvent = new Map(inventory.records.map((record) => [record.event, record]));
    for (const [, event] of EVENTS) {
      const record = byEvent.get(event);
      ok(record !== undefined, `${host} ${event} must read back`);
      equal(record.hostId, host);
      equal(record.sessionId, sessionId);
      equal(record.cwd, fixture.workspace);
      equal(record.recordedAt, FIXED_INSTANT);
      equal(record.transcriptRef, fixture.transcriptPath);
    }
    equal(byEvent.get("session-start")?.turnId, null);
    equal(byEvent.get("session-end")?.turnId, null);
    equal(
      byEvent.get("user-prompt-submit")?.turnId,
      host === "codex" ? "turn-0001" : "prompt-0001",
    );
    equal(byEvent.get("stop")?.turnId, host === "codex" ? "turn-0001" : "prompt-0001");
    // D3：promptDigest 是投递侧同一内核函数的结果——trim 后 UTF-8 sha256；其他事件为 null。
    equal(byEvent.get("user-prompt-submit")?.promptDigest, computeDeliveryPromptDigest(PROMPT));
    equal(
      byEvent.get("user-prompt-submit")?.promptDigest,
      computeSha256Digest(encodeUtf8(PROMPT.trim())),
    );
    equal(byEvent.get("stop")?.promptDigest, null);
    equal(byEvent.get("session-start")?.promptDigest, null);
    // D3：lastAssistantMessageDigest 是 last_assistant_message 原文的 UTF-8 sha256，只在 stop 上。
    equal(
      byEvent.get("stop")?.lastAssistantMessageDigest,
      computeSha256Digest(encodeUtf8(LAST_ASSISTANT_MESSAGE)),
    );
    equal(byEvent.get("user-prompt-submit")?.lastAssistantMessageDigest, null);

    // 同一事实重复触发（resume、compact 的 SessionStart）：内核派生同一 recordId，第二次为 current。
    const repeated = await observe(
      host,
      hookPayload("SessionStart", sessionId, fixture.workspace, fixture.transcriptPath),
    );
    equal(repeated.code, null);
    equal(repeated.written[0]?.disposition, "current");
    equal((await readBack(fixture.workspace, host)).records.length, 4);
  }
});

test("窗口位置：支持面、兄弟仓库、仓库子目录、嵌套检出、外部检出及其子目录都定位到声明它们的工作区；非 Wakeflow 的 cwd 静默不写", {
  timeout: 60_000,
}, async (t) => {
  const fixture = createFixture(t);
  const external = temporaryDirectory(t, "wakeflow-hook-observer-external-");
  const nested = addWorktree(
    fixture.repository,
    path.join(fixture.repository, ".claude", "worktrees", "feature-x"),
  );
  const checkout = addWorktree(fixture.repository, path.join(external, "checkout"));
  mkdirSync(path.join(checkout, "src", "deep"), { recursive: true });
  // 外部检出只经 `.git` 指针文件找回主仓库：指针必须真的指向 <主仓库>/.git/worktrees/<name>。
  ok(readFileSync(path.join(checkout, ".git"), "utf8").startsWith("gitdir: "));

  const positions: readonly (readonly [string, string])[] = [
    ["support-surface", path.join(fixture.workspace, "Design")],
    ["repository", fixture.repository],
    ["repository-subdirectory", path.join(fixture.repository, "src")],
    ["nested-checkout", nested],
    ["external-checkout", checkout],
    ["external-checkout-subdirectory", path.join(checkout, "src", "deep")],
  ];
  for (const [label, cwd] of positions) {
    const outcome = await observe(
      "claude-code",
      hookPayload("SessionStart", `session-${label}`, cwd, fixture.transcriptPath),
    );
    equal(outcome.code, null, label);
    deepEqual(writtenRoots(outcome), [fixture.workspace], label);
  }

  // 后三类事件同样按包含匹配，只是再过一道绑定门：cd 到外部检出的子目录后 stop 仍落地（D2 c/d）。
  writeBinding(fixture.workspace, "claude-code", SESSION_IDS["claude-code"]);
  const stop = await observe(
    "claude-code",
    hookPayload(
      "Stop",
      SESSION_IDS["claude-code"],
      path.join(checkout, "src", "deep"),
      fixture.transcriptPath,
      { last_assistant_message: LAST_ASSISTANT_MESSAGE },
    ),
  );
  deepEqual(writtenRoots(stop), [fixture.workspace]);
  const inventory = await readBack(fixture.workspace, "claude-code");
  equal(inventory.skipped, 0);
  equal(inventory.records.length, positions.length + 1);

  // 非 Wakeflow 的 cwd：同一父目录下的兄弟目录既不是根、支持面、仓库，也不是检出。
  const elsewhere = path.join(fixture.base, "Elsewhere", "src");
  mkdirSync(elsewhere, { recursive: true });
  const silent = await observe(
    "claude-code",
    hookPayload("SessionStart", "session-elsewhere", elsewhere, fixture.transcriptPath),
  );
  equal(silent.code, null);
  deepEqual(silent.written, []);
  equal((await readBack(fixture.workspace, "claude-code")).records.length, positions.length + 1);
});

test("列举上限只截断收集、不作废结果：兄弟仓库的父目录与绑定目录塞满无关条目后，工作区仍被定位、stop 仍过绑定门", {
  timeout: 120_000,
}, async (t) => {
  const fixture = createFixture(t);
  const sessionId = SESSION_IDS.codex;
  const cwd = path.join(fixture.repository, "src");
  // 候选子目录的收集上限是 1,024：父目录里的无关条目不占这份预算，超过上限也不能让工作区
  // 整体消失——那会让 hook 通道对这个会话永久静默且无迹可寻。
  fillDirectory(fixture.base, 1_100);

  const started = await observe(
    "codex",
    hookPayload("SessionStart", sessionId, cwd, fixture.transcriptPath),
  );
  equal(started.code, null);
  deepEqual(writtenRoots(started), [fixture.workspace]);

  // 绑定记录的收集上限是 4,096：同一条规则也决定后三类事件能不能过绑定门。
  writeBinding(fixture.workspace, "codex", sessionId);
  fillDirectory(bindingsDirectory(fixture.workspace, "codex"), 4_200);
  const stopped = await observe(
    "codex",
    hookPayload("Stop", sessionId, cwd, fixture.transcriptPath, {
      last_assistant_message: LAST_ASSISTANT_MESSAGE,
    }),
  );
  equal(stopped.code, null);
  deepEqual(writtenRoots(stopped), [fixture.workspace]);

  const inventory = await readBack(fixture.workspace, "codex");
  equal(inventory.skipped, 0);
  deepEqual(inventory.records.map((record) => record.event).sort(), ["session-start", "stop"]);
});

test("cwd 已被删除时经 CLAUDE_PROJECT_DIR 定位：session-end 仍落地且记录保留 payload 的 cwd；没有它或它不是绝对路径则静默", {
  timeout: 60_000,
}, async (t) => {
  const fixture = createFixture(t);
  const checkout = addWorktree(
    fixture.repository,
    path.join(fixture.repository, ".claude", "worktrees", "feature-y"),
  );
  writeBinding(fixture.workspace, "claude-code", SESSION_IDS["claude-code"]);
  // Claude 在会话结束时删除干净的 --worktree 检出，随后仍触发 SessionEnd（D2 a）。
  rmSync(checkout, { recursive: true, force: true });
  equal(existsSync(checkout), false);
  const payload = hookPayload(
    "SessionEnd",
    SESSION_IDS["claude-code"],
    checkout,
    fixture.transcriptPath,
  );

  const silent = await observe("claude-code", payload);
  equal(silent.code, null);
  deepEqual(silent.written, []);
  const relative = await observe("claude-code", payload, {
    env: { CLAUDE_PROJECT_DIR: "relative/project" },
  });
  equal(relative.code, null);
  deepEqual(relative.written, []);

  const landed = await observe("claude-code", payload, {
    env: { CLAUDE_PROJECT_DIR: fixture.repository },
  });
  equal(landed.code, null);
  deepEqual(writtenRoots(landed), [fixture.workspace]);
  const inventory = await readBack(fixture.workspace, "claude-code");
  equal(inventory.skipped, 0);
  equal(inventory.records.length, 1);
  equal(inventory.records[0]?.event, "session-end");
  equal(inventory.records[0]?.cwd, checkout);
});

test("扇出：session-start 写进两个声明同一仓库的工作区；user-prompt-submit、stop、session-end 只写进持有该句柄绑定的那个", async (t) => {
  const fixture = createFixture(t);
  const second = createWorkspace(fixture.base, "Wakeflow-2");
  const roots = [fixture.workspace, second].sort();
  const cwd = path.join(fixture.repository, "src");
  for (const host of HOSTS) {
    const sessionId = SESSION_IDS[host];
    // 第二个工作区持有另一个会话的绑定：绑定门看的是句柄相等，不是目录存在。
    writeBinding(second, host, `other-${sessionId}`);

    const start = await observe(
      host,
      hookPayload("SessionStart", sessionId, cwd, fixture.transcriptPath),
    );
    equal(start.code, null);
    deepEqual(writtenRoots(start), roots);

    // 登记发生在 session-start 之后：绑定还不存在时后三类事件一个都不写（D2 d）。
    const unbound = await observe(
      host,
      hookPayload("UserPromptSubmit", sessionId, cwd, fixture.transcriptPath, { prompt: PROMPT }),
    );
    equal(unbound.code, null);
    deepEqual(unbound.written, []);

    writeBinding(fixture.workspace, host, sessionId);
    const later: readonly (readonly [HostEventName, Readonly<Record<string, unknown>>])[] = [
      ["UserPromptSubmit", { prompt: PROMPT }],
      ["Stop", { last_assistant_message: LAST_ASSISTANT_MESSAGE }],
      ["SessionEnd", {}],
    ];
    for (const [name, extra] of later) {
      const outcome = await observe(
        host,
        hookPayload(name, sessionId, cwd, fixture.transcriptPath, extra),
      );
      equal(outcome.code, null, `${host} ${name}`);
      deepEqual(writtenRoots(outcome), [fixture.workspace], `${host} ${name}`);
    }
    const bound = await readBack(fixture.workspace, host);
    equal(bound.skipped, 0);
    equal(bound.records.length, 4);
    const other = await readBack(second, host);
    equal(other.skipped, 0);
    equal(other.records.length, 1);
    equal(other.records[0]?.event, "session-start");
  }
});

test("退化输入：非法 JSON、超限 stdin、缺标记、未知宿主、未知事件、缺字段各自给出固定代码且不写入；恰好到上限的 stdin 照常落地", async (t) => {
  const fixture = createFixture(t);
  const valid = hookPayload(
    "SessionStart",
    SESSION_IDS.codex,
    fixture.workspace,
    fixture.transcriptPath,
  );
  const expectCode = async (
    label: string,
    pending: Promise<HookObserverOutcome>,
    code: HookObserverCode,
  ): Promise<void> => {
    const outcome = await pending;
    equal(outcome.code, code, label);
    deepEqual(outcome.written, [], label);
  };

  await expectCode("invalid json", observe("codex", "{ not json"), "stdin-invalid");
  await expectCode("json array", observe("codex", "[]"), "stdin-invalid");
  await expectCode("empty stdin", observe("codex", ""), "stdin-invalid");
  await expectCode(
    "invalid utf-8",
    observe("codex", new Uint8Array([0x7b, 0xff, 0x7d])),
    "stdin-invalid",
  );
  await expectCode(
    "missing session_id",
    observe("codex", JSON.stringify({ cwd: fixture.workspace, hook_event_name: "SessionStart" })),
    "stdin-invalid",
  );
  await expectCode(
    "missing hook_event_name",
    observe("codex", JSON.stringify({ session_id: SESSION_IDS.codex, cwd: fixture.workspace })),
    "stdin-invalid",
  );
  await expectCode(
    "relative cwd",
    observe("codex", hookPayload("SessionStart", SESSION_IDS.codex, "relative/cwd", null)),
    "stdin-invalid",
  );
  // 记录合同之外的句柄（内核标识符文法）也在写入前拒绝：写入阶段只剩 I/O 失败。
  await expectCode(
    "session_id outside the kernel identifier grammar",
    observe("codex", hookPayload("SessionStart", "has space", fixture.workspace, null)),
    "stdin-invalid",
  );
  await expectCode(
    "cwd with a control character",
    observe(
      "codex",
      hookPayload("SessionStart", SESSION_IDS.codex, `${fixture.workspace}\u0007`, null),
    ),
    "stdin-invalid",
  );
  // D4：超限先于解析判定，即使内容是合法 JSON。
  const oversized = JSON.stringify({
    ...(JSON.parse(valid) as Record<string, unknown>),
    padding: "x".repeat(WAKEFLOW_HOOK_OBSERVER_STDIN_MAXIMUM_BYTES),
  });
  await expectCode("oversized stdin", observe("codex", oversized), "stdin-too-large");
  await expectCode(
    "missing marker",
    observe("codex", valid, { argv: [WAKEFLOW_HOOK_OBSERVER_HOST_ARGUMENT, "codex"] }),
    "argv-invalid",
  );
  await expectCode(
    "marker only",
    observe("codex", valid, { argv: [WAKEFLOW_HOOK_OBSERVER_MARKER] }),
    "argv-invalid",
  );
  await expectCode(
    "extra argument",
    observe("codex", valid, { argv: [...argvFor("codex"), "--verbose"] }),
    "argv-invalid",
  );
  await expectCode(
    "unknown host",
    observe("codex", valid, { argv: argvFor("cursor") }),
    "host-unknown",
  );
  await expectCode(
    "unknown event",
    observe("codex", hookPayload("PreToolUse", SESSION_IDS.codex, fixture.workspace, null)),
    "event-unknown",
  );
  // 被打断的回合没有 stop：Codex 的 Interrupt 与 Claude 的 StopFailure 都不是本脚本的事件（D3）。
  await expectCode(
    "interrupt is not a stop",
    observe("codex", hookPayload("Interrupt", SESSION_IDS.codex, fixture.workspace, null)),
    "event-unknown",
  );
  await expectCode(
    "stop failure is not a stop",
    observe(
      "claude-code",
      hookPayload("StopFailure", SESSION_IDS["claude-code"], fixture.workspace, null),
    ),
    "event-unknown",
  );
  for (const host of HOSTS) {
    equal(existsSync(observationsDirectory(fixture.workspace, host)), false, host);
  }

  // 上限是 4 MiB 的字节数而不是字符数：恰好到上限的 payload 照常落地。
  const skeleton = JSON.stringify({
    ...(JSON.parse(valid) as Record<string, unknown>),
    padding: "",
  });
  const exact = JSON.stringify({
    ...(JSON.parse(valid) as Record<string, unknown>),
    padding: "x".repeat(WAKEFLOW_HOOK_OBSERVER_STDIN_MAXIMUM_BYTES - Buffer.byteLength(skeleton)),
  });
  equal(Buffer.byteLength(exact), WAKEFLOW_HOOK_OBSERVER_STDIN_MAXIMUM_BYTES);
  const landed = await observe("codex", exact);
  equal(landed.code, null);
  deepEqual(writtenRoots(landed), [fixture.workspace]);
});

test("输入对象在取值时抛错：纯函数入口不抛出、报 internal 而不是冒充 write-failed，且没有写入", async () => {
  const input = {
    argv: argvFor("codex"),
    env: {},
    stdin: "{}",
    clock: (): Date => new Date(FIXED_INSTANT),
  };
  // stdin 在 argv 解析之后、任何文件系统动作之前取值：这一故障发生在尝试写入之前。
  Object.defineProperty(input, "stdin", {
    get(): never {
      throw new Error("input getter fault");
    },
  });
  const outcome = await runWakeflowHookObserver(input);
  equal(outcome.code, "internal");
  deepEqual(outcome.written, []);
});

test("可选字段降级：turn_id 含空格、transcript_path 超长或含控制字符、last_assistant_message 不是字符串时只把该字段记为 null，记录照常落地且其他字段不受影响", async (t) => {
  const fixture = createFixture(t);
  const sessionId = SESSION_IDS.codex;
  writeBinding(fixture.workspace, "codex", sessionId);
  // 内核文本上限是 4096 个字符：恰好到上限照记，超过一个字符即降级为 null。
  const overlongTranscript = `/${"x".repeat(4096)}`;
  const exactTranscript = `/${"x".repeat(4095)}`;
  const submissions: readonly (readonly [
    string,
    string,
    HostEventName,
    string,
    Readonly<Record<string, unknown>>,
  ])[] = [
    [
      "turn_id with a space",
      sessionId,
      "UserPromptSubmit",
      fixture.transcriptPath,
      { prompt: PROMPT, turn_id: "turn 0001" },
    ],
    [
      "last_assistant_message not a string",
      sessionId,
      "Stop",
      fixture.transcriptPath,
      { last_assistant_message: 42, turn_id: "turn-0002" },
    ],
    [
      "transcript_path with a control character",
      sessionId,
      "SessionEnd",
      `${fixture.transcriptPath}\n`,
      {},
    ],
    [
      "transcript_path over 4096 characters",
      "session-overlong",
      "SessionStart",
      overlongTranscript,
      {},
    ],
    [
      "transcript_path at exactly 4096 characters",
      "session-exact",
      "SessionStart",
      exactTranscript,
      {},
    ],
  ];
  for (const [label, session, event, transcript, extra] of submissions) {
    const outcome = await observe(
      "codex",
      hookPayload(event, session, fixture.workspace, transcript, extra),
    );
    equal(outcome.code, null, label);
    deepEqual(writtenRoots(outcome), [fixture.workspace], label);
    equal(outcome.written[0]?.disposition, "created", label);
  }

  const inventory = await readBack(fixture.workspace, "codex");
  equal(inventory.skipped, 0);
  equal(inventory.records.length, submissions.length);
  const find = (session: string, event: HostHookEvent) =>
    inventory.records.find((record) => record.sessionId === session && record.event === event);
  const submit = find(sessionId, "user-prompt-submit");
  equal(submit?.turnId, null);
  equal(submit?.promptDigest, computeDeliveryPromptDigest(PROMPT));
  equal(submit?.transcriptRef, fixture.transcriptPath);
  const stop = find(sessionId, "stop");
  equal(stop?.turnId, "turn-0002");
  equal(stop?.lastAssistantMessageDigest, null);
  equal(stop?.transcriptRef, fixture.transcriptPath);
  equal(find(sessionId, "session-end")?.transcriptRef, null);
  equal(find("session-overlong", "session-start")?.transcriptRef, null);
  equal(find("session-exact", "session-start")?.transcriptRef, exactTranscript);
});

test("写失败：观察目录被普通文件顶替的工作区报 write-failed，其他匹配工作区照写，顶替的文件原样保留", async (t) => {
  const fixture = createFixture(t);
  const second = createWorkspace(fixture.base, "Wakeflow-2");
  breakObservationsDirectory(fixture.workspace, "codex");
  const outcome = await observe(
    "codex",
    hookPayload("SessionStart", SESSION_IDS.codex, fixture.repository, fixture.transcriptPath),
  );
  equal(outcome.code, "write-failed");
  deepEqual(writtenRoots(outcome), [second]);
  const other = await readBack(second, "codex");
  equal(other.skipped, 0);
  equal(other.records.length, 1);
  ok(statSync(observationsDirectory(fixture.workspace, "codex")).isFile());
});

/**
 * 与制品 `hooks/observe.mjs` 同形（D1）：只调用 main()，动态 import 放在 try/catch 里，导入失败只打
 * 一行固定代码；进程级守卫由 main() 经 registerProcessGuards 登记，launcher 自己不登记。`afterMain`
 * 让故障测试在 main() 返回后注入一次进程级故障。
 */
function launcherSource(moduleUrl: string, afterMain: readonly string[] = []): string {
  return [
    "#!/usr/bin/env node",
    "process.exitCode = 0;",
    "try {",
    `  const observer = await import(${JSON.stringify(moduleUrl)});`,
    "  await observer.main();",
    ...afterMain.map((line) => `  ${line}`),
    "} catch {",
    '  process.stderr.write("wakeflow-hook-observer: launcher\\n");',
    "  process.exitCode = 0;",
    "}",
    "process.exitCode = 0;",
    "",
  ].join("\n");
}

interface SpawnedRun {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** 与宿主一样：node 进程、stdin 一段 JSON、进程 cwd 不是工作区（定位只看 payload 的 cwd）。 */
function spawnLauncher(launcher: string, argv: readonly string[], input: string): SpawnedRun {
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => key !== "CLAUDE_PROJECT_DIR"),
  );
  const result = spawnSync(process.execPath, [launcher, ...argv], {
    input,
    encoding: "utf8",
    cwd: os.tmpdir(),
    env: environment,
    shell: false,
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  });
  return Object.freeze({ status: result.status, stdout: result.stdout, stderr: result.stderr });
}

/** stderr 上可能出现的全部代码（D4）：入口导出的闭集，加上只有 launcher 会打的 `launcher`。 */
const STDERR_CODES: readonly HookObserverStderrCode[] = Object.freeze([
  "argv-invalid",
  "host-unknown",
  "stdin-too-large",
  "stdin-invalid",
  "event-unknown",
  "write-failed",
  "internal",
  "launcher",
]);
const STDERR_VOCABULARY: ReadonlySet<string> = new Set<string>(STDERR_CODES);
const FIXED_CODE_LINE = /^wakeflow-hook-observer: ([a-z-]+)\n$/u;

/** 退出 0、stdout 空、stderr 恰好一行，且那一行的代码属于导出的词汇表（D4）。 */
function assertFixedCode(run: SpawnedRun, code: HookObserverStderrCode, label: string): void {
  equal(run.status, 0, label);
  equal(run.stdout, "", label);
  equal(run.stderr, `wakeflow-hook-observer: ${code}\n`, label);
  ok(STDERR_VOCABULARY.has(FIXED_CODE_LINE.exec(run.stderr)?.[1] ?? ""), `${label}: ${run.stderr}`);
}

const COMPILED_OBSERVER_URL = import.meta.resolve(
  "../../src/entrypoints/wakeflow-hook-observer.js",
);

test("编译后的入口经 D1 形状的 launcher 以 node 执行：正常 payload 退出 0、stdout 与 stderr 皆空并落地；异常只在 stderr 打一行固定代码且不含根、cwd、句柄、提示与 transcript 路径", {
  timeout: 60_000,
}, async (t) => {
  const fixture = createFixture(t);
  const launcherDirectory = temporaryDirectory(t, "wakeflow-hook-observer-launcher-");
  const launcher = path.join(launcherDirectory, "observe.mjs");
  writeFileSync(launcher, launcherSource(COMPILED_OBSERVER_URL), { mode: 0o755 });
  const spawn = (argv: readonly string[], input: string): SpawnedRun =>
    spawnLauncher(launcher, argv, input);
  const cwd = path.join(fixture.repository, "src");
  const sessionId = SESSION_IDS["claude-code"];

  const started = spawn(
    argvFor("claude-code"),
    hookPayload("SessionStart", sessionId, cwd, fixture.transcriptPath),
  );
  deepEqual(started, { status: 0, stdout: "", stderr: "" });
  const inventory = await readBack(fixture.workspace, "claude-code");
  equal(inventory.skipped, 0);
  equal(inventory.records.length, 1);
  equal(inventory.records[0]?.event, "session-start");
  equal(inventory.records[0]?.sessionId, sessionId);
  equal(inventory.records[0]?.cwd, cwd);
  // recordedAt 来自脚本本地时钟的 ISO 毫秒形（D3；D7 a 的文件名模式要求恰好 3 位小数）。
  match(inventory.records[0]?.recordedAt ?? "", MILLISECOND_INSTANT_PATTERN);

  // D4：写失败退出 0、stdout 空、stderr 恰好一行固定代码，且不含任何私有值。
  writeBinding(fixture.workspace, "claude-code", sessionId);
  breakObservationsDirectory(fixture.workspace, "claude-code");
  const failed = spawn(
    argvFor("claude-code"),
    hookPayload("UserPromptSubmit", sessionId, cwd, fixture.transcriptPath, { prompt: PROMPT }),
  );
  assertFixedCode(failed, "write-failed", "write failure");
  for (const value of [fixture.workspace, cwd, sessionId, PROMPT.trim(), fixture.transcriptPath]) {
    equal(failed.stderr.includes(value), false, `stderr leaked ${value}`);
  }

  assertFixedCode(
    spawn([WAKEFLOW_HOOK_OBSERVER_HOST_ARGUMENT, "claude-code"], "{}"),
    "argv-invalid",
    "missing marker",
  );
  assertFixedCode(spawn(argvFor("codex"), "{ not json"), "stdin-invalid", "invalid json");

  // launcher 自己的代码：模块缺失时它打 `launcher`，这也是词汇表里进程侧独有的那一个。
  const missing = path.join(launcherDirectory, "missing-module.mjs");
  writeFileSync(
    missing,
    launcherSource(new URL("./missing-module.js", COMPILED_OBSERVER_URL).href),
    { mode: 0o755 },
  );
  assertFixedCode(spawnLauncher(missing, argvFor("codex"), "{}"), "launcher", "module missing");
});

test("进程级故障（D4）：main() 返回后的未捕获异常与未处理拒绝各只在 stderr 打一行固定代码、退出 0、stdout 空；launcher 再次登记守卫也不会多打一行，故障前的记录已落地", {
  timeout: 60_000,
}, async (t) => {
  const fixture = createFixture(t);
  const launcherDirectory = temporaryDirectory(t, "wakeflow-hook-observer-guards-");
  const faults: readonly (readonly [string, string])[] = [
    ["uncaught-exception", 'setImmediate(() => { throw new Error("late fault"); });'],
    ["unhandled-rejection", 'Promise.reject(new Error("late fault"));'],
  ];
  for (const [label, fault] of faults) {
    const launcher = path.join(launcherDirectory, `${label}.mjs`);
    // 一个自己也登记守卫的 launcher：registerProcessGuards 幂等，一次故障仍恰好一行。
    const afterMain = [
      "observer.registerProcessGuards();",
      "observer.registerProcessGuards();",
      fault,
    ];
    writeFileSync(launcher, launcherSource(COMPILED_OBSERVER_URL, afterMain), { mode: 0o755 });
    const run = spawnLauncher(
      launcher,
      argvFor("codex"),
      hookPayload("SessionStart", `session-${label}`, fixture.workspace, fixture.transcriptPath),
    );
    assertFixedCode(run, "internal", label);
  }
  const inventory = await readBack(fixture.workspace, "codex");
  equal(inventory.skipped, 0);
  for (const [label] of faults) {
    const records = inventory.records.filter((record) => record.sessionId === `session-${label}`);
    equal(records.length, 1, label);
    equal(records[0]?.event, "session-start", label);
  }
});

test("registerProcessGuards 幂等：首次为两个进程事件各登记一个守卫，再次调用不再增加监听器", (t) => {
  // 两个事件各用字面量调用：process.listeners / removeListener 的重载按事件名定型，不接受联合。
  const uncaughtBefore = process.listenerCount("uncaughtException");
  const unhandledBefore = process.listenerCount("unhandledRejection");
  const knownUncaught = new Set(process.listeners("uncaughtException"));
  const knownUnhandled = new Set(process.listeners("unhandledRejection"));
  registerProcessGuards();
  const addedUncaught = process
    .listeners("uncaughtException")
    .filter((listener) => !knownUncaught.has(listener));
  const addedUnhandled = process
    .listeners("unhandledRejection")
    .filter((listener) => !knownUnhandled.has(listener));
  // 测试进程里不留守卫：它会吞掉未捕获异常并把退出码钉在 0。
  t.after(() => {
    for (const listener of addedUncaught) process.removeListener("uncaughtException", listener);
    for (const listener of addedUnhandled) process.removeListener("unhandledRejection", listener);
  });
  registerProcessGuards();
  equal(addedUncaught.length, 1, "uncaughtException");
  equal(addedUnhandled.length, 1, "unhandledRejection");
  equal(process.listenerCount("uncaughtException"), uncaughtBefore + 1);
  equal(process.listenerCount("unhandledRejection"), unhandledBefore + 1);
});

test("入口的闭包限于 foundation 与 kernel（D1）：编译产物只引用 node:fs、node:fs/promises、node:path 与这两层的模块，从不 spawn 子进程", () => {
  const source = readFileSync(
    fileURLToPath(import.meta.resolve("../../src/entrypoints/wakeflow-hook-observer.js")),
    "utf8",
  );
  // 便宜的绊线，层边界本身由架构门（tooling/architecture）保证：这里只在编译产物上再拦一道
  // 明显的越界。`import … from`、`export … from` 与副作用形 `import "x";` 三种写法都算说明符。
  const specifiers = [
    ...source.matchAll(/^(?:import|export)\s[^;]*?\sfrom\s+"([^"]+)";$/gmu),
    ...source.matchAll(/^import\s+"([^"]+)";$/gmu),
  ].map((found) => found[1] ?? "");
  ok(specifiers.length > 0, "the compiled entrypoint must have static imports");
  for (const specifier of specifiers) {
    ok(
      ["node:fs", "node:fs/promises", "node:path"].includes(specifier) ||
        specifier.startsWith("../foundation/") ||
        specifier.startsWith("../kernel/"),
      `unexpected import ${specifier}`,
    );
  }
  // stdout 的三种写法一起拦：直接写流、console 的任一方法、按文件描述符 1 同步写。
  for (const forbidden of ["child_process", "process.stdout", "console.", "writeSync(1"]) {
    equal(source.includes(forbidden), false, forbidden);
  }
});

test("Claude Code 的传输外壳不进摘要：粘贴块与跨会话消息剥壳后与信封 prompt 同摘要，Codex 原样计算（§13.119）", async (t) => {
  const fixture = createFixture(t);
  const cwd = path.join(fixture.repository, "src");
  const pasted = `\n\n<pasted_content id="976a">\n${PROMPT}\n</pasted_content id="976a">\n`;
  const pastedPlainClose = `<pasted_content id="1">\n${PROMPT}\n</pasted_content>`;
  const crossSession = `<cross-session-message from="uds:/tmp/cc-socks/1.sock" from-name="alembicplugin-11" from-mode="bypass">\n${PROMPT}\n</cross-session-message>`;
  equal(unwrapHostPrompt("claude-code", pasted), PROMPT.trim());
  equal(unwrapHostPrompt("claude-code", pastedPlainClose), PROMPT.trim());
  equal(unwrapHostPrompt("claude-code", crossSession), PROMPT.trim());
  equal(unwrapHostPrompt("claude-code", PROMPT), PROMPT.trim());
  equal(unwrapHostPrompt("codex", pasted), pasted);
  for (const host of HOSTS) {
    const sessionId = SESSION_IDS[host];
    // 先落 session-start（建观察目录），再登记绑定，后两条 prompt 事件才会写入。
    equal(
      (await observe(host, hookPayload("SessionStart", sessionId, cwd, fixture.transcriptPath)))
        .code,
      null,
    );
    writeBinding(fixture.workspace, host, sessionId);
    // 固定时钟下记录标识由 turnId 区分：同一毫秒的两条 prompt 记录各带自己的 turn_id。
    for (const [index, prompt] of [pasted, crossSession].entries()) {
      const outcome = await observe(
        host,
        hookPayload("UserPromptSubmit", sessionId, cwd, fixture.transcriptPath, {
          prompt,
          turn_id: `turn-${index}`,
        }),
      );
      equal(outcome.code, null, host);
    }
    const digests = (await readBack(fixture.workspace, host)).records
      .filter((record) => record.event === "user-prompt-submit")
      .map((record) => record.promptDigest)
      .sort();
    const expected =
      host === "claude-code"
        ? [computeDeliveryPromptDigest(PROMPT), computeDeliveryPromptDigest(PROMPT)]
        : [computeDeliveryPromptDigest(pasted), computeDeliveryPromptDigest(crossSession)].sort();
    deepEqual(digests, expected, host);
  }
});

test("launcher 交来的制品 manifest 摘要原样进记录，没交时为 null（§13.127）", async (t) => {
  const fixture = createFixture(t);
  const host: HostId = "claude-code";
  const sessionId = SESSION_IDS[host];
  writeBinding(fixture.workspace, host, sessionId);
  const artifact = `sha256:${"f".repeat(64)}`;
  const started = await observe(
    host,
    hookPayload("SessionStart", sessionId, fixture.workspace, fixture.transcriptPath, {}),
    { artifactManifestDigest: artifact },
  );
  equal(started.code, null);
  const stopped = await observe(
    host,
    hookPayload("Stop", sessionId, fixture.workspace, fixture.transcriptPath, {
      last_assistant_message: LAST_ASSISTANT_MESSAGE,
      prompt_id: "prompt-0002",
    }),
  );
  equal(stopped.code, null);
  const inventory = await readBack(fixture.workspace, host);
  const byEvent = new Map(inventory.records.map((record) => [record.event, record]));
  equal(byEvent.get("session-start")?.artifactManifestDigest, artifact);
  equal(byEvent.get("stop")?.artifactManifestDigest, null);
});
