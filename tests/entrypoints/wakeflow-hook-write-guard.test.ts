import { deepEqual, equal, ok } from "node:assert/strict";
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { type TestContext, test } from "node:test";
import { fileURLToPath } from "node:url";

import { renderWakeflowConfig } from "../../src/configuration/wakeflow-config-document.js";
import {
  renderWriteGuardDenial,
  runWakeflowWriteGuard,
  WAKEFLOW_WRITE_GUARD_DENIAL_REASON,
  WAKEFLOW_WRITE_GUARD_HOST_ARGUMENT,
  WAKEFLOW_WRITE_GUARD_MANAGED_PATHS,
  WAKEFLOW_WRITE_GUARD_MARKER,
  WAKEFLOW_WRITE_GUARD_STDIN_MAXIMUM_BYTES,
  type WriteGuardCode,
  type WriteGuardOutcome,
} from "../../src/entrypoints/wakeflow-hook-write-guard.js";
import { CLAUDE_CODE_MANAGED_WRITE_DENY } from "../../src/hosts/claude-code/claude-code-helper-asset-template.js";
import { claudeCodeWorkspaceHostResourceProfile } from "../../src/hosts/claude-code/wakeflow-workspace-host-resource-profile.js";
import { codexWorkspaceHostResourceProfile } from "../../src/hosts/codex/wakeflow-workspace-host-resource-profile.js";
import { wakeflowWindowHostBindingRootRef } from "../../src/workspace/window-runtime/wakeflow-window-runtime-paths.js";
import { createMinimalWakeflowConfig } from "../configuration/wakeflow-config.fixture.js";
import { disposableRoot } from "../support/temp-root.js";

/**
 * 级别 1（组件）：受管路径的写守卫（ADR-0020 决定 6 的 2026-11-16 补充，open-items X30）。
 *
 * 进程内经 `runWakeflowWriteGuard` 在一次性根目录上覆盖判定：只有"已绑定、每个绑定窗口都是 Controller 之外
 * 的已知角色、路径在受管表里"三件事同时成立才拒绝，其余——别的路径、Controller、没有绑定、角色认不出、
 * 输入不合形状——一律放行。夹具与观察器测试同法：配置用渲染器写出，绑定记录按 Window Host Binding 的形状
 * 写入。进程合同（拒绝时 stdout 的那一行 JSON）在观察器测试里经 launcher 覆盖，因为那是同一个进程入口。
 */

type HostId = "codex" | "claude-code";

const PROFILES: Readonly<Record<HostId, unknown>> = Object.freeze({
  codex: codexWorkspaceHostResourceProfile,
  "claude-code": claudeCodeWorkspaceHostResourceProfile,
});
const SESSION_ID = "c1a0de00-1111-4222-8333-444455556666";
/** 最小配置里四个窗口的标识（`wakeflow-config.fixture.ts`）。 */
const WINDOWS = Object.freeze({
  controller: "window_55555555-5555-4555-8555-555555555555",
  design: "window_66666666-6666-4666-8666-666666666666",
  test: "window_77777777-7777-4777-8777-777777777777",
  product: "window_88888888-8888-4888-8888-888888888888",
});

interface Fixture {
  readonly base: string;
  readonly workspace: string;
  readonly repository: string;
}

function writeConfig(workspace: string, config: Record<string, unknown>): void {
  writeFileSync(path.join(workspace, "wakeflow.config.json"), renderWakeflowConfig(config), {
    mode: 0o644,
  });
}

/** 配置校验器不收的文档（守卫只做结构化读取，认不出的地方要放行）：绕过渲染器原样写出。 */
function writeUnvalidatedConfig(workspace: string, config: Record<string, unknown>): void {
  writeFileSync(
    path.join(workspace, "wakeflow.config.json"),
    `${JSON.stringify(config, null, 2)}\n`,
    { mode: 0o644 },
  );
}

/** 工作区、两个支持面、兄弟仓库 `../ProductA`；账本根按最小配置在 `../wakeflow-ledger`（没有建出来）。 */
function createFixture(t: TestContext): Fixture {
  const base = disposableRoot(t, "wakeflow-write-guard-");
  const workspace = path.join(base, "Wakeflow");
  mkdirSync(path.join(workspace, "Design"), { recursive: true });
  mkdirSync(path.join(workspace, "Test"), { recursive: true });
  mkdirSync(path.join(workspace, ".wakeflow-local", "runtime"), { recursive: true });
  writeConfig(workspace, createMinimalWakeflowConfig());
  const repository = path.join(base, "ProductA");
  mkdirSync(path.join(repository, "src"), { recursive: true });
  return Object.freeze({ base, workspace, repository });
}

/** 绑定目录从工作区层的布局派生：入口里的字面量必须与之一致。 */
function bind(
  workspace: string,
  windowId: string,
  sessionId = SESSION_ID,
  host: HostId = "claude-code",
) {
  const directory = path.join(
    workspace,
    ...wakeflowWindowHostBindingRootRef(PROFILES[host]).split("/"),
  );
  mkdirSync(directory, { recursive: true, mode: 0o700 });
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
      observedAt: "2026-11-16T07:59:00.000Z",
    },
    registeredAt: "2026-11-16T07:59:01.000Z",
  };
  writeFileSync(path.join(directory, `${windowId}.json`), `${JSON.stringify(record, null, 2)}\n`, {
    mode: 0o600,
  });
}

interface CallOptions {
  readonly tool?: string;
  readonly pathKey?: "file_path" | "notebook_path";
  readonly sessionId?: string;
  readonly host?: string;
  readonly event?: string;
}

function payload(cwd: string, target: string | null, options: CallOptions = {}): string {
  return JSON.stringify({
    session_id: options.sessionId ?? SESSION_ID,
    cwd,
    hook_event_name: options.event ?? "PreToolUse",
    permission_mode: "auto",
    tool_name: options.tool ?? "Write",
    tool_input:
      target === null
        ? { command: "ls" }
        : { [options.pathKey ?? "file_path"]: target, content: "x" },
    tool_use_id: "toolu_01",
  });
}

function guard(
  cwd: string,
  target: string | null,
  options: CallOptions = {},
): Promise<WriteGuardOutcome> {
  return runWakeflowWriteGuard({
    argv: [
      WAKEFLOW_WRITE_GUARD_MARKER,
      WAKEFLOW_WRITE_GUARD_HOST_ARGUMENT,
      options.host ?? "claude-code",
    ],
    env: {},
    stdin: payload(cwd, target, options),
  });
}

const ALLOW: WriteGuardOutcome = { decision: "allow", code: null };
const DENY: WriteGuardOutcome = { decision: "deny", code: null };

function allowWith(code: WriteGuardCode): WriteGuardOutcome {
  return { decision: "allow", code };
}

test("受管表与宿主层的写拒绝表逐项相等：角色、目录、文件（ADR-0020 决定 6）", () => {
  // 守卫的闭包不含宿主层，表在入口里是字面量；tmux 助手启动时带的 deny 规则用的是宿主层那一张。
  deepEqual(
    [...WAKEFLOW_WRITE_GUARD_MANAGED_PATHS.roles],
    [...CLAUDE_CODE_MANAGED_WRITE_DENY.roles],
  );
  deepEqual(
    [...WAKEFLOW_WRITE_GUARD_MANAGED_PATHS.directories],
    [...CLAUDE_CODE_MANAGED_WRITE_DENY.directories],
  );
  deepEqual(
    [...WAKEFLOW_WRITE_GUARD_MANAGED_PATHS.files],
    [...CLAUDE_CODE_MANAGED_WRITE_DENY.files],
  );
});

test("已绑定的产品窗口写受管路径即拒绝：运行时目录、活动目录、配置、两份 settings 与账本，文件存在与否都认", async (t) => {
  const fixture = createFixture(t);
  bind(fixture.workspace, WINDOWS.product);
  const managed = [
    path.join(fixture.workspace, ".wakeflow-local", "runtime", "new-record.json"),
    path.join(fixture.workspace, ".wakeflow-local", "not-yet", "deep", "file.json"),
    path.join(fixture.workspace, ".wakeflow-active", "current", "index.md"),
    path.join(fixture.workspace, "wakeflow.config.json"),
    path.join(fixture.workspace, ".claude", "settings.json"),
    path.join(fixture.workspace, ".claude", "settings.local.json"),
    path.join(fixture.base, "wakeflow-ledger", "demands", "journal.jsonl"),
  ];
  for (const target of managed) {
    deepEqual(await guard(fixture.repository, target), DENY, target);
    deepEqual(await guard(fixture.repository, target, { tool: "Edit" }), DENY, target);
  }
  // NotebookEdit 的路径键是 notebook_path；相对路径按会话 cwd 解析。
  deepEqual(
    await guard(fixture.workspace, ".wakeflow-local/runtime/n.ipynb", {
      tool: "NotebookEdit",
      pathKey: "notebook_path",
    }),
    DENY,
  );
  deepEqual(await guard(fixture.repository, "../Wakeflow/wakeflow.config.json"), DENY);
});

test("Design 与 Test 窗口同样被拒；Controller 窗口不受这一层约束", async (t) => {
  const target = (fixture: Fixture) =>
    path.join(fixture.workspace, ".wakeflow-local", "runtime", "x.json");
  for (const role of ["design", "test"] as const) {
    const fixture = createFixture(t);
    bind(fixture.workspace, WINDOWS[role]);
    const cwd = path.join(fixture.workspace, role === "design" ? "Design" : "Test");
    deepEqual(await guard(cwd, target(fixture)), DENY, role);
  }
  const fixture = createFixture(t);
  bind(fixture.workspace, WINDOWS.controller);
  deepEqual(await guard(fixture.workspace, target(fixture)), ALLOW);
  deepEqual(
    await guard(fixture.workspace, path.join(fixture.workspace, "wakeflow.config.json")),
    ALLOW,
  );
});

test("受管表之外的路径放行：自己的仓库、支持面、`.claude/` 下的其余内容，以及只是名字开头相同的路径", async (t) => {
  const fixture = createFixture(t);
  bind(fixture.workspace, WINDOWS.product);
  const free = [
    path.join(fixture.repository, "src", "feature.ts"),
    path.join(fixture.workspace, "Design", "draft.md"),
    path.join(fixture.workspace, ".claude", "worktrees", "pod-a", "src", "a.ts"),
    path.join(fixture.workspace, ".claude", "settings.json.bak"),
    path.join(fixture.workspace, "wakeflow.config.json.bak"),
    path.join(fixture.workspace, ".wakeflow-local-notes", "x.md"),
    path.join(fixture.base, "wakeflow-ledger-export", "x.jsonl"),
    path.join(fixture.base, "elsewhere.txt"),
  ];
  for (const target of free) deepEqual(await guard(fixture.repository, target), ALLOW, target);
  // 不带路径的工具调用（matcher 被旧宿主当成正则时会放进来别的工具）没有可判的东西。
  deepEqual(await guard(fixture.repository, null, { tool: "TodoWrite" }), ALLOW);
});

test("没有绑定的会话、绑定在别的会话上的窗口、非 Wakeflow 目录里的会话都放行", async (t) => {
  const fixture = createFixture(t);
  const target = path.join(fixture.workspace, ".wakeflow-local", "runtime", "x.json");
  // 工作区里一个没有绑定的会话（用户自己开的、或还没登记的窗口）。
  deepEqual(await guard(fixture.repository, target), ALLOW);
  bind(fixture.workspace, WINDOWS.product, "0ther000-1111-4222-8333-444455556666");
  deepEqual(await guard(fixture.repository, target), ALLOW);
  // 会话 cwd 不在任何工作区的声明拓扑里：定位不到工作区，绑定也就无从查起。
  bind(fixture.workspace, WINDOWS.test);
  const outside = disposableRoot(t, "wakeflow-write-guard-outside-");
  deepEqual(await guard(outside, target), ALLOW);
});

test("拿不准就放行：绑定的窗口不在配置里、角色认不出、同一会话还绑着 Controller、配置读不出", async (t) => {
  const target = (fixture: Fixture) =>
    path.join(fixture.workspace, ".wakeflow-local", "runtime", "x.json");

  const unknownWindow = createFixture(t);
  bind(unknownWindow.workspace, "window_99999999-9999-4999-8999-999999999999");
  deepEqual(await guard(unknownWindow.repository, target(unknownWindow)), ALLOW);

  const unknownRole = createFixture(t);
  const config = createMinimalWakeflowConfig();
  const windows = (config.topology as { windows: { windowId: string; role: string }[] }).windows;
  for (const window of windows) if (window.windowId === WINDOWS.product) window.role = "observer";
  writeUnvalidatedConfig(unknownRole.workspace, config);
  bind(unknownRole.workspace, WINDOWS.product);
  deepEqual(await guard(unknownRole.repository, target(unknownRole)), ALLOW);

  const alsoController = createFixture(t);
  bind(alsoController.workspace, WINDOWS.product);
  bind(alsoController.workspace, WINDOWS.controller);
  deepEqual(await guard(alsoController.repository, target(alsoController)), ALLOW);

  // 配置在绑定之后坏掉：这个候选根不再是工作区，定位不到它。
  const brokenConfig = createFixture(t);
  bind(brokenConfig.workspace, WINDOWS.product);
  writeFileSync(path.join(brokenConfig.workspace, "wakeflow.config.json"), "{ not json", {
    mode: 0o644,
  });
  deepEqual(await guard(brokenConfig.repository, target(brokenConfig)), ALLOW);
});

test("符号链接两头都认：经链接写进受管目录、受管目录本身是链接、会话 cwd 经链接进入工作区", async (t) => {
  const fixture = createFixture(t);
  bind(fixture.workspace, WINDOWS.product);
  // 工具给的路径穿过一个指向工作区的链接。
  const alias = path.join(fixture.base, "alias");
  symlinkSync(fixture.workspace, alias, "dir");
  deepEqual(
    await guard(fixture.repository, path.join(alias, ".wakeflow-local", "runtime", "x")),
    DENY,
  );
  deepEqual(await guard(fixture.repository, path.join(alias, "wakeflow.config.json")), DENY);
  deepEqual(await guard(path.join(alias, "Design"), path.join(alias, "Design", "d.md")), ALLOW);
  // 受管目录是指向别处的链接：按字面路径写、按真实位置写都拒绝。
  const realActive = path.join(fixture.base, "active-store");
  mkdirSync(realActive, { recursive: true });
  symlinkSync(realActive, path.join(fixture.workspace, ".wakeflow-active"), "dir");
  deepEqual(
    await guard(fixture.repository, path.join(fixture.workspace, ".wakeflow-active", "a.md")),
    DENY,
  );
  deepEqual(await guard(fixture.repository, path.join(realActive, "a.md")), DENY);
});

test("账本根按配置解析；包着工作区根的账本根不当作受管路径，其余受管路径照拦", async (t) => {
  const inside = createFixture(t);
  const config = createMinimalWakeflowConfig();
  config.storage = { ledgerRoot: "ledger" };
  writeConfig(inside.workspace, config);
  bind(inside.workspace, WINDOWS.product);
  deepEqual(
    await guard(inside.repository, path.join(inside.workspace, "ledger", "a", "b.jsonl")),
    DENY,
  );
  // 账本搬进工作区之后，缺省位置不再受管。
  deepEqual(
    await guard(inside.repository, path.join(inside.base, "wakeflow-ledger", "b.jsonl")),
    ALLOW,
  );

  const enclosing = createFixture(t);
  const wide = createMinimalWakeflowConfig();
  wide.storage = { ledgerRoot: ".." };
  writeUnvalidatedConfig(enclosing.workspace, wide);
  bind(enclosing.workspace, WINDOWS.product);
  deepEqual(
    await guard(enclosing.repository, path.join(enclosing.repository, "src", "a.ts")),
    ALLOW,
  );
  deepEqual(
    await guard(enclosing.repository, path.join(enclosing.workspace, "Design", "d.md")),
    ALLOW,
  );
  deepEqual(
    await guard(enclosing.repository, path.join(enclosing.workspace, ".wakeflow-local", "x")),
    DENY,
  );
});

test("宿主标识只决定去哪个绑定目录找：别的宿主的绑定不算数", async (t) => {
  const fixture = createFixture(t);
  const target = path.join(fixture.workspace, ".wakeflow-local", "runtime", "x.json");
  bind(fixture.workspace, WINDOWS.product, SESSION_ID, "codex");
  deepEqual(await guard(fixture.repository, target), ALLOW, "claude-code 的守卫不读 codex 的绑定");
  deepEqual(await guard(fixture.repository, target, { host: "codex" }), DENY);
});

test("调用不合形状时放行并报固定代码：argv、宿主、stdin、事件；从不抛出", async (t) => {
  const fixture = createFixture(t);
  bind(fixture.workspace, WINDOWS.product);
  const target = path.join(fixture.workspace, ".wakeflow-local", "runtime", "x.json");
  const valid = payload(fixture.repository, target);
  const marker = WAKEFLOW_WRITE_GUARD_MARKER;
  const hostArgument = WAKEFLOW_WRITE_GUARD_HOST_ARGUMENT;
  const run = (argv: readonly string[], stdin: string | Uint8Array) =>
    runWakeflowWriteGuard({ argv, env: {}, stdin });

  deepEqual(
    await run([marker, hostArgument, "claude-code"], valid),
    DENY,
    "对照：同一输入本来会拒绝",
  );
  deepEqual(await run([], valid), allowWith("argv-invalid"));
  deepEqual(await run([marker, "--hosts", "claude-code"], valid), allowWith("argv-invalid"));
  deepEqual(
    await run(["--wakeflow-hook-observer-v1", hostArgument, "claude-code"], valid),
    allowWith("argv-invalid"),
  );
  deepEqual(await run([marker, hostArgument, "cursor"], valid), allowWith("host-unknown"));
  deepEqual(
    await run([marker, hostArgument, "claude-code"], "not json"),
    allowWith("stdin-invalid"),
  );
  deepEqual(await run([marker, hostArgument, "claude-code"], "[]"), allowWith("stdin-invalid"));
  deepEqual(
    await run([marker, hostArgument, "claude-code"], JSON.stringify({ session_id: SESSION_ID })),
    allowWith("stdin-invalid"),
  );
  deepEqual(
    await run([marker, hostArgument, "claude-code"], payload("relative/cwd", target)),
    allowWith("stdin-invalid"),
  );
  deepEqual(
    await run(
      [marker, hostArgument, "claude-code"],
      payload(fixture.repository, target, { event: "PostToolUse" }),
    ),
    allowWith("event-unknown"),
  );
  // 超限的 stdin（一次很大的 Write）读不出路径：放行。
  const oversized = JSON.stringify({
    ...JSON.parse(valid),
    tool_input: {
      file_path: target,
      content: "x".repeat(WAKEFLOW_WRITE_GUARD_STDIN_MAXIMUM_BYTES),
    },
  });
  deepEqual(
    await run([marker, hostArgument, "claude-code"], oversized),
    allowWith("stdin-too-large"),
  );
  // 取值时抛错的输入对象：内部故障也放行。
  const hostile = {
    get argv(): readonly string[] {
      throw new Error("boom");
    },
    env: {},
    stdin: valid,
  };
  deepEqual(await runWakeflowWriteGuard(hostile), allowWith("internal"));
});

test("拒绝决定是宿主认的那一行 JSON：PreToolUse、deny 与一段不含路径的说明", () => {
  const rendered = renderWriteGuardDenial();
  equal(rendered.includes("\n"), false, "恰好一行");
  deepEqual(JSON.parse(rendered), {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: WAKEFLOW_WRITE_GUARD_DENIAL_REASON,
    },
  });
  deepEqual(Object.keys(JSON.parse(rendered).hookSpecificOutput), [
    "hookEventName",
    "permissionDecision",
    "permissionDecisionReason",
  ]);
  equal(WAKEFLOW_WRITE_GUARD_DENIAL_REASON.includes("/"), false, "说明里没有路径");
  ok(WAKEFLOW_WRITE_GUARD_DENIAL_REASON.includes("Do not retry through another tool"));
});

test("两个 hook 模块守观察器的闭包规则（D1）：只引用 node:fs、node:fs/promises、node:path、foundation、kernel 与彼此；只有写守卫写 stdout", () => {
  const read = (name: string) =>
    readFileSync(fileURLToPath(import.meta.resolve(`../../src/entrypoints/${name}`)), "utf8");
  const specifiersOf = (source: string) =>
    [
      ...source.matchAll(/^(?:import|export)\s[^;]*?\sfrom\s+"([^"]+)";$/gmu),
      ...source.matchAll(/^import\s+"([^"]+)";$/gmu),
    ].map((found) => found[1] ?? "");
  const workspaces = read("wakeflow-hook-workspaces.js");
  const writeGuard = read("wakeflow-hook-write-guard.js");
  for (const [name, source, siblings] of [
    ["workspaces", workspaces, []],
    ["write-guard", writeGuard, ["./wakeflow-hook-workspaces.js"]],
  ] as const) {
    const specifiers = specifiersOf(source);
    ok(specifiers.length > 0, `${name}: the compiled module must have static imports`);
    for (const specifier of specifiers) {
      ok(
        ["node:fs", "node:fs/promises", "node:path"].includes(specifier) ||
          specifier.startsWith("../foundation/") ||
          specifier.startsWith("../kernel/") ||
          (siblings as readonly string[]).includes(specifier),
        `${name}: unexpected import ${specifier}`,
      );
    }
    // 两个模块都不起子进程，也不写文件。
    for (const forbidden of ["child_process", "writeFile", "appendFile", "console."]) {
      equal(source.includes(forbidden), false, `${name}: ${forbidden}`);
    }
  }
  equal(workspaces.includes("process."), false, "定位模块不碰 process");
  equal(writeGuard.match(/process\.stdout\.write\(/gu)?.length, 1, "stdout 只有拒绝决定那一处");
});
