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
import { WAKEFLOW_WINDOW_HOST_BINDING_REGISTRATION_RESULT_SCHEMA } from "../../../src/contracts/generated/entrypoints/wakeflow-window-host-binding-registration-result.generated.js";
import { computeDeliveryPromptDigest } from "../../../src/governance/delivery/delivery-envelope.js";
import type { WakeflowWindowRole } from "../../../src/contracts/vocabulary/wakeflow-role-tool-access.js";
import { WAKEFLOW_NODE_ENGINES } from "../../../src/contracts/vocabulary/wakeflow-runtime-engines.js";
import { computeSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import { parseJsonValue } from "../../../src/foundation/data/json-value.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { createRuntimeJsonSchemaValidator } from "../../../src/foundation/schema/runtime-json-schema.js";
import {
  CLAUDE_CODE_DESKTOP_ASSET_COMMAND,
  CLAUDE_CODE_DESKTOP_ASSET_CONTENT,
  CLAUDE_CODE_DESKTOP_ASSET_DIGEST,
  CLAUDE_CODE_DESKTOP_ASSET_REF,
  WAKEFLOW_CLAUDE_CODE_DESKTOP_PERMISSION_RULE,
} from "../../../src/hosts/claude-code/claude-code-desktop-asset.js";
import {
  CLAUDE_CODE_DESKTOP_ASSET_BLOCKER,
  CLAUDE_CODE_DESKTOP_ASSET_OPERATION_ID,
  CLAUDE_CODE_DESKTOP_ASSET_OPERATION_KIND,
  CLAUDE_CODE_DESKTOP_ASSET_OWNER_ID,
  executeClaudeCodeDesktopAssetOperation,
  planClaudeCodeDesktopAssetOperation,
} from "../../../src/hosts/claude-code/claude-code-desktop-asset-operation.js";
import { claudeCodeMcpPermissionRulesFor } from "../../../src/hosts/claude-code/claude-code-mcp-permission-rules.js";
import { hostWindowLocatorsRootRef } from "../../../src/kernel/layout.js";
import { createMinimalWakeflowConfig } from "../../configuration/wakeflow-config.fixture.js";
import { useDisposableDurability } from "../../support/disposable-durability.js";
import { writeFakeCli } from "../../support/fake-cli.js";
import { loadSensitive } from "../../support/load-sensitive.js";

useDisposableDurability();

/**
 * Claude 桌面会话助手资产（ADR-0025 D4；2 级能力测试）：资产由仓库测试用 node 直接执行，claude、script、ps 与
 * git 都是记录 argv 并按状态目录应答的桩，所以三步开窗的精确序列（prompt 在 --bg 之后、--name、意图参数、
 * --allowedTools 最后；没有 --session-id 与 --worktree）、每个拒绝码、stdout 的一行 JSON、退出码与"输出里没有
 * 绝对路径"都能精确断言，而不依赖机器上有没有桌面 app。hook 记录由桩按观察器的文件名约定写进一次性工作区。
 */

const PROGRAM_ID = "program_11111111-1111-4111-8111-111111111111";
const CONTROLLER_WINDOW_ID = "window_55555555-5555-4555-8555-555555555555";
const PRODUCT_WINDOW_ID = "window_88888888-8888-4888-8888-888888888888";
const INTENT_DIGEST = `sha256:${"ab".repeat(32)}`;
const PROMPT_DIGEST = `sha256:${"cd".repeat(32)}`;
/** 宿主分配的会话 id（hook 的 session_id）与 `claude --bg` 打印的短 id。 */
const SESSION_ID = "0f0f0f0f-1111-4222-8333-444444444444";
const SHORT_ID = "0f0f0f0f";
const CONTROLLER_SESSION_ID = "9c9c9c9c-2222-4333-8444-555555555555";
const BINDING_ID = "binding_77777777-7777-4777-8777-777777777777";
const LOCATOR_ID = "locator_99999999-9999-4999-8999-999999999999";
const RUNTIME = ".wakeflow-local/runtime/hosts/claude-code";
const SEPARATOR = "\u001f";

/**
 * claude 桩：--bg 记录 cwd、写首条 session-start 记录并打印 "backgrounded · <短 id> · <名字>"；agents 按状态目录里
 * 的 agents-<n>.json（第 n 次调用）或 agents.json 应答；--desktop --resume 写第二条 session-start 记录并打印
 * Opening session；各失败形态由状态目录里的标记文件触发。
 */
const CLAUDE_STUB = `#!/bin/bash
set -u
state="$WAKEFLOW_STUB_STATE"
log="$WAKEFLOW_STUB_LOG"
{ printf '%s' "claude"; for arg in "$@"; do printf '\\x1f%s' "$arg"; done; printf '\\n'; } >> "$log"
if [ -n "\${WAKEFLOW_STUB_ENV:-}" ]; then env > "$WAKEFLOW_STUB_ENV"; fi
if [ "\${WAKEFLOW_STUB_HANG:-}" = "\${1:-}" ]; then sleep 30; fi
sid="${SESSION_ID}"
if [ -f "$state/session-id.txt" ]; then sid="$(<"$state/session-id.txt")"; fi
hook() {
  if [ -n "\${WAKEFLOW_STUB_HOOKS:-}" ]; then
    cwd="$PWD"
    if [ -n "\${WAKEFLOW_STUB_SESSION_CWD:-}" ]; then cwd="$WAKEFLOW_STUB_SESSION_CWD"; fi
    n=0
    if [ -f "$state/hook-counter" ]; then n="$(<"$state/hook-counter")"; fi
    n=$((n + 1)); printf '%s\\n' "$n" > "$state/hook-counter"
    printf '{"kind":"stub","event":"session-start","sessionId":"%s","cwd":"%s","source":"%s"}\\n' "$sid" "$cwd" "$2" > "$WAKEFLOW_STUB_HOOKS/$1-session-start-0000000$n-0000-4000-8000-000000000000.json"
  fi
}
case "\${1:-}" in
  --version) echo "9.9.9 (Claude Code)" ;;
  --bg)
    printf '%s\\n' "$PWD" > "$state/bg-cwd.txt"
    if [ -e "$state/bg-not-trusted" ]; then echo "Workspace not trusted: run claude in $PWD once and accept the dialog" >&2; exit 1; fi
    if [ -e "$state/bg-fail" ]; then echo "stub: bg failed at /private/stub/path" >&2; exit 1; fi
    if [ -e "$state/bg-garbled" ]; then echo "started something"; exit 0; fi
    name=""; prev=""
    for arg in "$@"; do if [ "$prev" = "--name" ]; then name="$arg"; fi; prev="$arg"; done
    hook 20260924T000000000Z startup
    echo "backgrounded · ${SHORT_ID} · $name" ;;
  agents)
    if [ -e "$state/agents-fail" ]; then echo "stub: agents failed" >&2; exit 1; fi
    n=0
    if [ -f "$state/agents-counter" ]; then n="$(<"$state/agents-counter")"; fi
    n=$((n + 1)); printf '%s\\n' "$n" > "$state/agents-counter"
    if [ -f "$state/agents-$n.json" ]; then printf '%s\\n' "$(<"$state/agents-$n.json")"
    elif [ -f "$state/agents.json" ]; then printf '%s\\n' "$(<"$state/agents.json")"
    else echo "[]"; fi ;;
  stop)
    if [ -e "$state/stop-fail" ]; then echo "stub: stop failed" >&2; exit 1; fi
    : > "$state/stopped-\${2:-}" ;;
  --desktop)
    if [ -e "$state/desktop-not-running" ]; then echo "Claude Desktop is not running; start it and sign in" >&2; exit 1; fi
    if [ "\${2:-}" != "--resume" ]; then
      if [ -e "$state/desktop-open-fail" ]; then echo "stub: could not open the folder" >&2; exit 1; fi
      : > "$state/opened-folder"; printf '%s\\n' "$PWD" > "$state/opened-folder"
      echo "Opening $PWD in Claude Desktop"; exit 0
    fi
    if [ -e "$state/desktop-no-session" ]; then echo "No session found with id \${3:-} under /private/stub/sessions" >&2; exit 1; fi
    if [ -e "$state/desktop-silent" ]; then exit 0; fi
    if [ ! -e "$state/desktop-no-hook" ]; then hook 20260924T000001000Z resume; fi
    echo "Opening session \${3:-} in Claude Desktop" ;;
  *) echo "stub: unknown claude invocation" >&2; exit 2 ;;
esac
`;

/** script(1) 桩：记录 argv，丢掉 -q 与 typescript 文件参数后直接执行命令（真实的 script 多开一个伪终端）。 */
const SCRIPT_STUB = `#!/bin/bash
set -u
{ printf '%s' "script"; for arg in "$@"; do printf '\\x1f%s' "$arg"; done; printf '\\n'; } >> "$WAKEFLOW_STUB_LOG"
if [ "\${1:-}" = "-q" ]; then shift; fi
shift
exec "$@"
`;

/** 进程表来自 ps.txt（只用 bash 内建，PATH 里没有 coreutils 时也能应答）。 */
const PS_STUB = `#!/bin/bash
set -u
{ printf '%s' "ps"; for arg in "$@"; do printf '\\x1f%s' "$arg"; done; printf '\\n'; } >> "$WAKEFLOW_STUB_LOG"
if [ -f "$WAKEFLOW_STUB_STATE/ps.txt" ]; then printf '%s\\n' "$(<"$WAKEFLOW_STUB_STATE/ps.txt")"; fi
`;

const GIT_STUB = `#!/bin/bash
if [ -n "\${WAKEFLOW_REAL_GIT:-}" ]; then exec "$WAKEFLOW_REAL_GIT" "$@"; fi
case "$1 $2" in
  "worktree list") printf 'worktree %s\\nHEAD 0123456789abcdef0123456789abcdef01234567\\nbranch refs/heads/worktree-wakeflow-feature\\n\\n' "$PWD" ;;
  "rev-parse --git-common-dir") echo "/stub/common/.git" ;;
  *) exit 2 ;;
esac
`;

/** 桌面 app 在运行的进程表：主进程、一个 Helper 渲染进程与 app 内置的小写 claude 二进制（后两者不算 app）。 */
const PS_WITH_APP = [
  "  501 /Applications/Claude.app/Contents/MacOS/Claude",
  "  502 /Applications/Claude.app/Contents/Frameworks/Claude Helper (Renderer).app/Contents/MacOS/Claude Helper (Renderer) --type=renderer",
  "  503 /Volumes/stub/Application Support/Claude/claude-code/9.9.9/abc/claude.app/Contents/MacOS/claude --desktop-ipc",
].join("\n");
const PS_WITHOUT_APP = PS_WITH_APP.split("\n").slice(1).join("\n");

/** `claude agents --json --all` 的两种行（现场 L17 的字段）：--bg 起的后台作业与桌面侧栏里的 interactive 会话。 */
function backgroundRow(state: string, sessionId = SESSION_ID): Record<string, unknown> {
  return {
    id: SHORT_ID,
    cwd: "/stub/ProductA",
    kind: "background",
    startedAt: 1793320287562,
    sessionId,
    name: "Product A",
    state,
  };
}

function interactiveRow(
  sessionId: string,
  status: string,
  name = "Controller",
  pid = 4242,
): Record<string, unknown> {
  return {
    pid,
    cwd: "/stub/workspace",
    kind: "interactive",
    startedAt: 1793389527288,
    sessionId,
    name,
    status,
  };
}

interface Fixture {
  readonly parent: string;
  readonly root: string;
  readonly assetPath: string;
  readonly bin: string;
  readonly state: string;
  readonly log: string;
  readonly hooks: string;
}

async function fixture(t: TestContext, prefix = "wakeflow-desktop-asset-"): Promise<Fixture> {
  // realpath：助手从自身位置推导根时经过 ESM 加载器的符号链接解析，断言要比同一形态的路径。
  const parent = realpathSync(mkdtempSync(path.join(os.tmpdir(), prefix)));
  const root = path.join(parent, "workspace");
  mkdirSync(root, { recursive: true });
  mkdirSync(path.join(parent, "ProductA"), { recursive: true });
  const config = createMinimalWakeflowConfig();
  (config.storage as Record<string, unknown>).ledgerRoot = "Ledger";
  writeFileSync(path.join(root, "wakeflow.config.json"), `${JSON.stringify(config, null, 2)}\n`);
  for (const directory of [
    "identity/window-locators",
    "identity/window-bindings",
    "observations/hooks",
    "operations",
  ]) {
    mkdirSync(path.join(root, ...RUNTIME.split("/"), ...directory.split("/")), {
      recursive: true,
      mode: 0o700,
    });
  }
  const bin = path.join(parent, "bin");
  mkdirSync(bin);
  writeFakeCli(bin, "claude", CLAUDE_STUB);
  writeFakeCli(bin, "script", SCRIPT_STUB);
  writeFakeCli(bin, "ps", PS_STUB);
  writeFakeCli(bin, "git", GIT_STUB);
  const state = path.join(parent, "state");
  mkdirSync(state);
  writeFileSync(path.join(state, "ps.txt"), `${PS_WITH_APP}\n`);
  writeFileSync(
    path.join(state, "agents.json"),
    JSON.stringify([backgroundRow("done"), interactiveRow(CONTROLLER_SESSION_ID, "busy")]),
  );
  const log = path.join(parent, "calls.log");
  writeFileSync(log, "");
  const rooted = await RootedDirectory.open(root);
  try {
    const planned = await planClaudeCodeDesktopAssetOperation(rooted);
    ok(planned !== null, "missing asset must plan one operation");
    await executeClaudeCodeDesktopAssetOperation(rooted, {
      operation: planned.payload,
      recoveringAffectedOperation: false,
    });
  } finally {
    await rooted.close();
  }
  t.after(() => {
    rmSync(parent, { recursive: true, force: true });
  });
  return Object.freeze({
    parent,
    root,
    assetPath: path.join(root, ...CLAUDE_CODE_DESKTOP_ASSET_REF.split("/")),
    bin,
    state,
    log,
    hooks: path.join(root, ...RUNTIME.split("/"), "observations", "hooks"),
  });
}

interface HelperRun {
  readonly status: number | null;
  readonly json: Record<string, unknown>;
}

function runHelper(
  current: Fixture,
  args: readonly string[],
  options: {
    readonly input?: string;
    readonly env?: Readonly<Record<string, string>>;
    /** worktree 观察按合同原样携带 `git worktree list --porcelain`，其中有检出的绝对路径。 */
    readonly allowPaths?: boolean;
  } = {},
): HelperRun {
  // 环境从零构造：测试本身可能跑在 Claude Code 或 tmux 里，不能把宿主的会话变量漏给助手。
  const result = spawnSync(process.execPath, [current.assetPath, ...args], {
    cwd: os.tmpdir(),
    encoding: "utf8",
    input: options.input ?? "",
    env: {
      PATH: `${current.bin}${path.delimiter}${process.env.PATH ?? ""}`,
      HOME: process.env.HOME ?? current.parent,
      WAKEFLOW_STUB_STATE: current.state,
      WAKEFLOW_STUB_LOG: current.log,
      ...(options.env ?? {}),
    },
  });
  const lines = result.stdout.split("\n").filter((line) => line.length > 0);
  equal(lines.length, 1, `helper must print exactly one line: ${result.stdout} ${result.stderr}`);
  equal(result.stderr, "", "helper stderr must be empty");
  if (options.allowPaths !== true) {
    equal(lines[0]?.includes(current.parent), false, "helper output must not carry absolute paths");
  }
  return Object.freeze({
    status: result.status,
    json: JSON.parse(lines[0] ?? "null") as Record<string, unknown>,
  });
}

function callLog(current: Fixture): readonly (readonly string[])[] {
  return readFileSync(current.log, "utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => line.split(SEPARATOR));
}

function resetLog(current: Fixture): void {
  writeFileSync(current.log, "");
}

function marker(current: Fixture, name: string): void {
  writeFileSync(path.join(current.state, name), "");
}

function clearMarker(current: Fixture, name: string): void {
  rmSync(path.join(current.state, name), { force: true });
}

function setAgents(current: Fixture, rows: readonly Record<string, unknown>[]): void {
  writeFileSync(path.join(current.state, "agents.json"), JSON.stringify(rows));
  rmSync(path.join(current.state, "agents-counter"), { force: true });
}

/** 与桌面渲染器（claude-code-window-launch-instructions.ts）同形的意图：没有 --session-id，没有 --worktree。 */
function launchIntent(
  displayTitle: string,
  cwd: string,
  extraArguments: readonly string[] = [],
  role: WakeflowWindowRole = displayTitle === "Controller" ? "controller" : "product",
): Record<string, unknown> {
  return {
    intentDigest: INTENT_DIGEST,
    role,
    podId: "pod_99999999-9999-4999-8999-999999999999",
    podName: "main",
    podPlacement: "primary",
    displayTitle,
    root: { kind: "program", rootId: PROGRAM_ID, configuredPlacement: cwd },
    worktree: null,
    attachedWorktrees: [],
    execution: {
      kind: "claude-code-desktop",
      desktop: { title: displayTitle, cwd },
      command: "claude",
      arguments: [
        "--permission-mode",
        "auto",
        "--effort",
        "xhigh",
        "--add-dir",
        "<workspace root>",
        ...extraArguments,
      ],
      sessionIdPolicy: "host-assigned",
      registration:
        "report handle kind claude-session with the host-assigned session id read back from claude --bg, plus desktop.sessionId local_<that id>",
      worktree: null,
      attachedWorktrees: [],
    },
  };
}

/** 助手在 --bg 之后传的固定启动提示（脚本里的 startupPrompt；设计 §3.3，裁定 3）。 */
function startupPrompt(windowId: string, role: string, title: string): string {
  return `Wakeflow: this Claude Code session is the ${role} window ${windowId} (${title}) of a Wakeflow workspace, opened by the Wakeflow Controller through the desktop transport; its execution root is the current working directory. Do not load skills, call tools or start any work now: the Controller will send the first real prompt into this session. On this first turn reply with exactly: ok`;
}

function launch(
  current: Fixture,
  intent: Record<string, unknown>,
  args: readonly string[] = [],
  options: { readonly env?: Readonly<Record<string, string>>; readonly allowPaths?: boolean } = {},
): HelperRun {
  return runHelper(current, ["launch", "--window", PRODUCT_WINDOW_ID, "--wait", "1", ...args], {
    input: JSON.stringify(intent),
    env: { WAKEFLOW_STUB_HOOKS: current.hooks, ...(options.env ?? {}) },
    ...(options.allowPaths === undefined ? {} : { allowPaths: options.allowPaths }),
  });
}

function writeLocator(current: Fixture, windowId: string, sessionId: string): void {
  writeFileSync(
    path.join(
      current.root,
      ...RUNTIME.split("/"),
      "identity",
      "window-locators",
      `${windowId}.json`,
    ),
    JSON.stringify({
      kind: "WakeflowWindowLocator",
      schemaVersion: 1,
      locatorId: LOCATOR_ID,
      programId: PROGRAM_ID,
      hostId: "claude-code",
      windowId,
      bindingId: BINDING_ID,
      provider: "desktop",
      desktop: { sessionId: `local_${sessionId}` },
      registeredAt: "2026-09-24T00:00:00.000Z",
    }),
  );
}

function writeBinding(current: Fixture, windowId: string, sessionId: string): void {
  writeFileSync(
    path.join(
      current.root,
      ...RUNTIME.split("/"),
      "identity",
      "window-bindings",
      `${windowId}.json`,
    ),
    JSON.stringify({
      kind: "WakeflowWindowHostBinding",
      schemaVersion: 1,
      programId: PROGRAM_ID,
      hostId: "claude-code",
      windowId,
      bindingId: BINDING_ID,
      handle: { kind: "claude-session", value: sessionId },
    }),
  );
}

/** 观察器的记录文件名约定：`<时间紧凑形>-<事件>-<recordId>.json`，新记录在 UTC 日 / 摘要前缀分片下。 */
function writeHookRecord(
  directory: string,
  compact: string,
  event: string,
  record: Readonly<Record<string, unknown>>,
): string {
  mkdirSync(directory, { recursive: true });
  const recordId = record.recordId as string;
  const file = path.join(directory, `${compact}-${event}-${recordId}.json`);
  writeFileSync(file, JSON.stringify({ event, ...record }));
  return file;
}

/** launch 的启动命令以恰好一次 --allowedTools 结尾：该角色的 MCP 规则加助手的绝对路径规则。 */
function assertSessionPermissionRules(
  current: Fixture,
  words: readonly string[],
  role: WakeflowWindowRole = "product",
): void {
  const expected = [
    "--allowedTools",
    ...claudeCodeMcpPermissionRulesFor(role),
    `Bash(node ${current.assetPath} *)`,
  ];
  deepEqual(words.slice(-expected.length), expected);
  equal(words.filter((word) => word === "--allowedTools").length, 1, words.join(" "));
}

test("desktop asset is a fixed 0600 file whose command and permission rule agree, carries no paths or backticks, and its operation plans, publishes and recovers byte-exactly", async (t) => {
  const current = await fixture(t);
  equal(statSync(current.assetPath).mode & 0o777, 0o600);
  equal(computeSha256Digest(readFileSync(current.assetPath)), CLAUDE_CODE_DESKTOP_ASSET_DIGEST);
  equal(readFileSync(current.assetPath, "utf8"), CLAUDE_CODE_DESKTOP_ASSET_CONTENT);
  equal(CLAUDE_CODE_DESKTOP_ASSET_CONTENT.includes("`"), false);
  equal(CLAUDE_CODE_DESKTOP_ASSET_CONTENT.includes("${"), false);
  equal(CLAUDE_CODE_DESKTOP_ASSET_CONTENT.includes("/Users/"), false);
  equal(CLAUDE_CODE_DESKTOP_ASSET_CONTENT.endsWith("\n"), true);
  // 助手里的定位器目录字面量等于内核布局常量（资产是 String.raw，不能 import）。
  ok(
    CLAUDE_CODE_DESKTOP_ASSET_CONTENT.includes(
      `const LOCATORS = RUNTIME + "${hostWindowLocatorsRootRef("claude-code").slice(RUNTIME.length)}";`,
    ),
    "the helper reads locators from the kernel's locator directory",
  );
  // 助手永不 claude rm（L17 E6），并把 --session-id 与 --worktree 列为意图里禁止的旗标（E6、E7）。
  equal(CLAUDE_CODE_DESKTOP_ASSET_CONTENT.includes('"rm"'), false);
  ok(
    CLAUDE_CODE_DESKTOP_ASSET_CONTENT.includes(
      'const FORBIDDEN_ARGUMENTS = Object.freeze(["--session-id", "--worktree",',
    ),
    "the helper refuses intents that carry --session-id or --worktree",
  );
  equal(CLAUDE_CODE_DESKTOP_ASSET_COMMAND, `node ${CLAUDE_CODE_DESKTOP_ASSET_REF}`);
  equal(
    WAKEFLOW_CLAUDE_CODE_DESKTOP_PERMISSION_RULE,
    `Bash(${CLAUDE_CODE_DESKTOP_ASSET_COMMAND} *)`,
  );
  equal(CLAUDE_CODE_DESKTOP_ASSET_OPERATION_KIND, "desktop-asset");
  equal(CLAUDE_CODE_DESKTOP_ASSET_OWNER_ID, "claude-code-desktop-asset");
  equal(CLAUDE_CODE_DESKTOP_ASSET_BLOCKER, "claude-desktop-asset-unreadable");
  const rooted = await RootedDirectory.open(current.root);
  try {
    equal(await planClaudeCodeDesktopAssetOperation(rooted), null);
    writeFileSync(current.assetPath, `${CLAUDE_CODE_DESKTOP_ASSET_CONTENT}// drift\n`, {
      mode: 0o600,
    });
    const drifted = await planClaudeCodeDesktopAssetOperation(rooted);
    ok(drifted !== null, "byte drift must plan one operation");
    equal(drifted.operationId, CLAUDE_CODE_DESKTOP_ASSET_OPERATION_ID);
    equal(drifted.operationKind, CLAUDE_CODE_DESKTOP_ASSET_OPERATION_KIND);
    equal(drifted.ownerId, CLAUDE_CODE_DESKTOP_ASSET_OWNER_ID);
    equal(drifted.targetKey, "asset:claude-code:desktop");
    equal(drifted.sourceDigest, computeSha256Digest(readFileSync(current.assetPath)));
    equal(drifted.targetDigest, CLAUDE_CODE_DESKTOP_ASSET_DIGEST);
    deepEqual(drifted.payload, {
      fileName: "desktop.mjs",
      digest: CLAUDE_CODE_DESKTOP_ASSET_DIGEST,
    });
    const updated = await executeClaudeCodeDesktopAssetOperation(rooted, {
      operation: drifted.payload,
      recoveringAffectedOperation: false,
    });
    deepEqual(updated, {
      operationId: CLAUDE_CODE_DESKTOP_ASSET_OPERATION_ID,
      disposition: "updated",
      targetDigest: CLAUDE_CODE_DESKTOP_ASSET_DIGEST,
    });
    equal(computeSha256Digest(readFileSync(current.assetPath)), CLAUDE_CODE_DESKTOP_ASSET_DIGEST);
    equal(statSync(current.assetPath).mode & 0o777, 0o600);
    // affected 恢复：目标已是期望字节即 current，不再写。
    const recovered = await executeClaudeCodeDesktopAssetOperation(rooted, {
      operation: drifted.payload,
      recoveringAffectedOperation: true,
    });
    equal(recovered.disposition, "current");
  } finally {
    await rooted.close();
  }
});

test("the desktop launch intent fixture is the public launchIntent shape the server emits", () => {
  const schema = WAKEFLOW_WINDOW_HOST_BINDING_REGISTRATION_RESULT_SCHEMA as {
    readonly $id: string;
  };
  const validate = createRuntimeJsonSchemaValidator<unknown>(
    {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: "urn:wakeflow:test:desktop-asset:launch-intent",
      $ref: `${schema.$id}#/$defs/inspectionResult/properties/launchIntent`,
    },
    [WAKEFLOW_WINDOW_HOST_BINDING_REGISTRATION_RESULT_SCHEMA],
  );
  for (const intent of [
    launchIntent("Controller", "."),
    launchIntent("Product A", "../ProductA"),
  ]) {
    const admitted = validate(parseJsonValue(intent));
    equal(admitted.ok, true, JSON.stringify(admitted));
  }
});

test("preflight reports node, claude, the pseudo-terminal wrapper, the desktop app process and the session proof without touching anything", async (t) => {
  const current = await fixture(t);
  const run = runHelper(current, ["preflight"]);
  equal(run.status, 0, JSON.stringify(run.json));
  deepEqual(run.json.node, {
    available: true,
    version: process.version,
    path: process.execPath,
    engines: WAKEFLOW_NODE_ENGINES,
    supported: true,
  });
  deepEqual(run.json.claude, {
    available: true,
    version: "9.9.9 (Claude Code)",
    install: "wrapper",
  });
  deepEqual(run.json.script, { available: true });
  deepEqual(run.json.desktop, { appRunning: true, processTable: "available" });
  equal(run.json.sessionIdVisible, false);
  equal(run.json.sessionProven, null);
  deepEqual(
    callLog(current).map((entry) => entry.slice(0, 2)),
    [
      ["ps", "-axo"],
      ["claude", "--version"],
    ],
  );
  // 只有 Helper 渲染进程与 app 内置的小写 claude 二进制：app 不在运行。
  writeFileSync(path.join(current.state, "ps.txt"), `${PS_WITHOUT_APP}\n`);
  deepEqual(runHelper(current, ["preflight"]).json.desktop, {
    appRunning: false,
    processTable: "available",
  });
  // 本会话的 session-start 记录决定 sessionProven（§13.188）：没有记录的是引导会话。
  const own = { CLAUDE_CODE_SESSION_ID: CONTROLLER_SESSION_ID };
  equal(runHelper(current, ["preflight"], { env: own }).json.sessionProven, false);
  writeHookRecord(
    path.join(current.hooks, "20260924", "ee"),
    "20260924T000000000Z",
    "session-start",
    {
      recordId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      sessionId: CONTROLLER_SESSION_ID,
      recordedAt: "2026-09-24T00:00:00.000Z",
    },
  );
  const proven = runHelper(current, ["preflight"], { env: own });
  equal(proven.json.sessionIdVisible, true);
  equal(proven.json.sessionProven, true);
  // script(1) 不在 PATH 上：preflight 如实报告，launch 在碰任何宿主命令之前拒绝。
  rmSync(path.join(current.bin, "script"));
  const noScript = runHelper(current, ["preflight"], { env: { PATH: current.bin } });
  deepEqual(noScript.json.script, { available: false });
  resetLog(current);
  const refused = launch(current, launchIntent("Product A", "../ProductA"), [], {
    env: { PATH: current.bin },
  });
  equal(refused.status, 1);
  equal(refused.json.reason, "script-unavailable");
  deepEqual(callLog(current), []);
});

test("desktop helper admits only the current config version and refuses to run outside a workspace", async (t) => {
  const current = await fixture(t);
  const configPath = path.join(current.root, "wakeflow.config.json");
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  for (const version of [1, 3, "2"]) {
    writeFileSync(configPath, `${JSON.stringify({ ...config, schemaVersion: version })}\n`);
    const run = runHelper(current, ["preflight"]);
    equal(run.status, 1);
    equal(run.json.reason, "config-invalid");
  }
  writeFileSync(configPath, `${JSON.stringify(config)}\n`);
  // tmux 助手的子命令不属于桌面助手。
  const unknown = runHelper(current, ["teardown"]);
  equal(unknown.status, 1);
  equal(unknown.json.reason, "command-unknown");
  rmSync(configPath);
  const outside = runHelper(current, ["preflight"]);
  equal(outside.status, 1);
  equal(outside.json.reason, "root-unresolved");
  equal(existsSync(current.assetPath), true);
});

test("the helper strips every Claude session and host variable before running claude and keeps only the user's Claude configuration（§13.132）", async (t) => {
  const current = await fixture(t);
  const dump = path.join(current.state, "env.txt");
  const run = runHelper(current, ["preflight"], {
    env: {
      WAKEFLOW_STUB_ENV: dump,
      CLAUDE_CONFIG_DIR: "claude-config",
      CLAUDE_CODE_USE_BEDROCK: "1",
      CLAUDECODE: "1",
      CLAUDE_CODE_ENTRYPOINT: "cli",
      CLAUDE_CODE_SSE_PORT: "12345",
      CLAUDE_CODE_SESSION_ID: SESSION_ID,
      CLAUDE_PROJECT_DIR: "project",
      CLAUDE_EFFORT: "max",
      CLAUDE_CODE_DESKTOP_APP_VERSION: "9.9.9",
      CLAUDE_CODE_SKIP_BEDROCK_AUTH: "1",
      CLAUDE_CODE_OAUTH_TOKEN: "user-token",
      ANTHROPIC_BASE_URL: "https://example.invalid",
      TMUX: "/private/stub/tmux-501/default,1,0",
      TMUX_PANE: "%3",
      LANG: "C",
    },
  });
  equal(run.status, 0, JSON.stringify(run.json));
  const names = new Map(
    readFileSync(dump, "utf8")
      .split("\n")
      .filter((line) => line.includes("="))
      .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
  );
  equal(names.get("CLAUDE_CONFIG_DIR"), "claude-config");
  equal(names.get("CLAUDE_CODE_USE_BEDROCK"), "1");
  equal(names.get("CLAUDE_CODE_SKIP_BEDROCK_AUTH"), "1");
  equal(names.get("CLAUDE_CODE_OAUTH_TOKEN"), "user-token");
  equal(names.get("ANTHROPIC_BASE_URL"), "https://example.invalid");
  equal(names.get("LANG"), "en_US.UTF-8");
  equal(names.get("LC_ALL"), "en_US.UTF-8");
  for (const stripped of [
    "CLAUDECODE",
    "CLAUDE_CODE_ENTRYPOINT",
    "CLAUDE_CODE_SSE_PORT",
    "CLAUDE_CODE_SESSION_ID",
    "CLAUDE_PROJECT_DIR",
    "CLAUDE_EFFORT",
    "CLAUDE_CODE_DESKTOP_APP_VERSION",
    "TMUX",
    "TMUX_PANE",
  ]) {
    equal(names.has(stripped), false, stripped);
  }
});

test("launch runs the three steps in order: claude --bg with the prompt first and --allowedTools last, agents until done, stop, a pseudo-terminal --desktop --resume, then the new session-start record becomes the observation", async (t) => {
  const current = await fixture(t, "wakeflow desktop asset ");
  ok(current.assetPath.includes(" "));
  const run = launch(current, launchIntent("Product A", "../ProductA", ["--model", "opus"]));
  equal(run.status, 0, JSON.stringify(run.json));
  equal(run.json.ok, true);
  equal(run.json.windowId, PRODUCT_WINDOW_ID);
  equal(run.json.created, "launched");
  deepEqual(run.json.hook, { sessionStart: "observed" });
  deepEqual(run.json.window, { name: "Product A", cwd: "../ProductA" });
  deepEqual(run.json.background, { id: SHORT_ID, firstTurn: "done", stopped: true });
  equal(run.json.worktreePrepared, "not-requested");
  equal(run.json.worktreeObservation, undefined);
  const observation = run.json.observation as Record<string, unknown>;
  deepEqual(Object.keys(observation).sort(), [
    "desktop",
    "handle",
    "launchIntentDigest",
    "observedAt",
  ]);
  deepEqual(observation.handle, { kind: "claude-session", value: SESSION_ID });
  equal(observation.launchIntentDigest, INTENT_DIGEST);
  match(observation.observedAt as string, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u);
  deepEqual(observation.desktop, { sessionId: `local_${SESSION_ID}` });

  const log = callLog(current);
  // 准备：没有定位器就不查 agents；先看 app 在不在跑。
  deepEqual(log[0], ["ps", "-axo", "pid=,args="]);
  // 第一步：--bg、启动提示紧随其后、--name、意图参数、最后一次 --allowedTools；没有 --session-id 与 --worktree。
  const started = log[1] ?? [];
  equal(started[0], "claude");
  equal(started[1], "--bg");
  equal(started[2], startupPrompt(PRODUCT_WINDOW_ID, "product", "Product A"));
  deepEqual(started.slice(3, 5), ["--name", "Product A"]);
  deepEqual(started.slice(5, 15), [
    "--permission-mode",
    "auto",
    "--effort",
    "xhigh",
    "--add-dir",
    current.root,
    "--model",
    "opus",
    "--allowedTools",
    ...claudeCodeMcpPermissionRulesFor("product").slice(0, 1),
  ]);
  assertSessionPermissionRules(current, started.slice(1));
  equal(started.includes("--session-id"), false);
  equal(started.includes("--worktree"), false);
  equal(started.includes("<workspace root>"), false);
  equal(
    readFileSync(path.join(current.state, "bg-cwd.txt"), "utf8").trim(),
    path.join(current.parent, "ProductA"),
  );
  // 读回 id、首回合 done、stop。
  deepEqual(log[2], ["claude", "agents", "--json", "--all"]);
  deepEqual(log[3], ["claude", "stop", SHORT_ID]);
  equal(existsSync(path.join(current.state, `stopped-${SHORT_ID}`)), true);
  // 第三步：伪终端包装的 --desktop --resume <uuid>，claude 按绝对路径给出。
  deepEqual(log[4], [
    "script",
    "-q",
    "/dev/null",
    path.join(current.bin, "claude"),
    "--desktop",
    "--resume",
    SESSION_ID,
  ]);
  deepEqual(log[5], ["claude", "--desktop", "--resume", SESSION_ID]);
  equal(log.length, 6);

  // Controller 角色拿整服务器的 MCP 规则；意图里缺 role 时回退到 inspect 结果顶层的 role（§13.182 F-L1-8）。
  resetLog(current);
  const { role: _role, ...withoutRole } = launchIntent("Controller", ".");
  const controller = runHelper(
    current,
    ["launch", "--window", CONTROLLER_WINDOW_ID, "--wait", "1"],
    {
      input: JSON.stringify({
        kind: "WakeflowWindowBindingInspection",
        windowId: CONTROLLER_WINDOW_ID,
        role: "controller",
        launchIntent: withoutRole,
      }),
      env: { WAKEFLOW_STUB_HOOKS: current.hooks },
    },
  );
  equal(controller.status, 0, JSON.stringify(controller.json));
  const controllerStart = callLog(current)[1] ?? [];
  equal(controllerStart[2], startupPrompt(CONTROLLER_WINDOW_ID, "controller", "Controller"));
  assertSessionPermissionRules(current, controllerStart.slice(1), "controller");
  deepEqual(controller.json.window, { name: "Controller", cwd: "." });
  equal(readFileSync(path.join(current.state, "bg-cwd.txt"), "utf8").trim(), current.root);
});

test("launch keeps polling claude agents every two seconds until the first turn is done（裁定 3）", async (t) => {
  if (loadSensitive(t, "real stub subprocess polling with a two second wall-clock wait")) return;
  const current = await fixture(t);
  writeFileSync(
    path.join(current.state, "agents-1.json"),
    JSON.stringify([backgroundRow("running")]),
  );
  writeFileSync(
    path.join(current.state, "agents-2.json"),
    JSON.stringify([backgroundRow("running")]),
  );
  const started = Date.now();
  const run = launch(current, launchIntent("Product A", "../ProductA"), ["--wait", "10"]);
  equal(run.status, 0, JSON.stringify(run.json));
  deepEqual(run.json.background, { id: SHORT_ID, firstTurn: "done", stopped: true });
  equal(callLog(current).filter((entry) => entry[1] === "agents").length, 3);
  const elapsed = Date.now() - started;
  ok(elapsed >= 3_500 && elapsed < 20_000, `two polls of two seconds each: ${elapsed} ms`);
});

test("launch refuses each failure of the three steps with a stable code and never reaches the next step", async (t) => {
  const current = await fixture(t);
  const intent = launchIntent("Product A", "../ProductA");
  const calls = (): readonly string[] =>
    callLog(current).map((entry) =>
      entry[0] === "claude" ? `claude ${entry[1]}` : (entry[0] ?? ""),
    );

  // app 不在运行：在 --bg 之前拒绝，一个 claude 都不调。
  writeFileSync(path.join(current.state, "ps.txt"), `${PS_WITHOUT_APP}\n`);
  const noApp = launch(current, intent);
  equal(noApp.status, 1);
  equal(noApp.json.reason, "desktop-unavailable");
  equal(noApp.json.stage, "preflight");
  equal(noApp.json.appRunning, false);
  deepEqual(calls(), ["ps"]);
  writeFileSync(path.join(current.state, "ps.txt"), `${PS_WITH_APP}\n`);

  // 目录未信任：--bg 的 stderr 说 not trusted。
  resetLog(current);
  marker(current, "bg-not-trusted");
  const untrusted = launch(current, intent);
  equal(untrusted.status, 1);
  equal(untrusted.json.reason, "not-trusted");
  equal(untrusted.json.cwd, "../ProductA");
  // 桩 git 答不出顶层目录时，要信任的就是这个目录自己。
  equal(untrusted.json.trustRoot, "../ProductA");
  deepEqual(calls(), ["ps", "claude --bg"]);
  clearMarker(current, "bg-not-trusted");

  // --bg 以别的原因失败：有界 detail，不带绝对路径。
  resetLog(current);
  marker(current, "bg-fail");
  const failed = launch(current, intent);
  equal(failed.json.reason, "launch-start-failed");
  equal(failed.json.status, 1);
  equal(failed.json.detail, "stub: bg failed at <path>");
  clearMarker(current, "bg-fail");

  // --bg 的输出里读不出 id：不去问 agents。
  resetLog(current);
  marker(current, "bg-garbled");
  const garbled = launch(current, intent);
  equal(garbled.json.reason, "launch-id-unparsed");
  equal(garbled.json.detail, "started something");
  equal(calls().includes("claude agents"), false);
  clearMarker(current, "bg-garbled");

  // 清单里没有这个 id：等到 --wait 用完仍未出现。
  resetLog(current);
  setAgents(current, [interactiveRow(CONTROLLER_SESSION_ID, "busy")]);
  const unlisted = launch(current, intent, ["--wait", "0"]);
  equal(unlisted.json.reason, "launch-session-unlisted");
  equal(unlisted.json.id, SHORT_ID);
  equal(calls().includes("claude stop"), false);

  // 首回合超时：尽力 stop 掉后台会话后拒绝，不进入 --desktop。
  resetLog(current);
  setAgents(current, [backgroundRow("running")]);
  const timeout = launch(current, intent, ["--wait", "0"]);
  equal(timeout.status, 1);
  equal(timeout.json.reason, "launch-first-turn-timeout");
  equal(timeout.json.state, "running");
  equal(timeout.json.waitedSeconds, 0);
  deepEqual(timeout.json.handle, { kind: "claude-session", value: SESSION_ID });
  deepEqual(timeout.json.background, { id: SHORT_ID, stopped: true });
  deepEqual(calls(), ["ps", "claude --bg", "claude agents", "claude stop"]);

  // 首回合失败：会话已不在跑，不 stop 也不 --desktop。
  resetLog(current);
  setAgents(current, [backgroundRow("failed")]);
  const firstTurnFailed = launch(current, intent);
  equal(firstTurnFailed.json.reason, "launch-first-turn-failed");
  equal(firstTurnFailed.json.state, "failed");
  deepEqual(calls(), ["ps", "claude --bg", "claude agents"]);

  // agents 本身不可用：拒绝，带有界 detail。
  resetLog(current);
  setAgents(current, [backgroundRow("done")]);
  marker(current, "agents-fail");
  const agentsFailed = launch(current, intent);
  equal(agentsFailed.json.reason, "agents-unavailable");
  equal(agentsFailed.json.detail, "stub: agents failed");
  clearMarker(current, "agents-fail");

  // --desktop 说 app 不在运行 / 未登录：desktop-unavailable（resume 阶段），后台会话已 stop、对话保留。
  resetLog(current);
  marker(current, "desktop-not-running");
  const desktopDown = launch(current, intent);
  equal(desktopDown.status, 1);
  equal(desktopDown.json.reason, "desktop-unavailable");
  equal(desktopDown.json.stage, "resume");
  equal(desktopDown.json.status, 1);
  deepEqual(desktopDown.json.handle, { kind: "claude-session", value: SESSION_ID });
  deepEqual(calls(), [
    "ps",
    "claude --bg",
    "claude agents",
    "claude stop",
    "script",
    "claude --desktop",
  ]);
  clearMarker(current, "desktop-not-running");

  // --desktop 拒绝 resume（会话从未对话或仍在运行）：stderr 首行进 detail，路径换成占位符。
  resetLog(current);
  marker(current, "desktop-no-session");
  const noSession = launch(current, intent);
  equal(noSession.json.reason, "desktop-resume-refused");
  equal(noSession.json.status, 1);
  equal(noSession.json.detail, `No session found with id ${SESSION_ID} under <path>`);
  clearMarker(current, "desktop-no-session");

  // 退出 0 却没有 Opening session：同样不算打开。
  resetLog(current);
  marker(current, "desktop-silent");
  const silent = launch(current, intent);
  equal(silent.json.reason, "desktop-resume-refused");
  equal(silent.json.status, 0);
  equal(silent.json.detail, undefined);
  clearMarker(current, "desktop-silent");

  // Opening session 打印了，却没有新的 session-start 记录：--bg 时那一条不算。
  resetLog(current);
  marker(current, "desktop-no-hook");
  const noHook = launch(current, intent, ["--wait-session-start", "0"]);
  equal(noHook.status, 1);
  equal(noHook.json.reason, "desktop-session-start-missing");
  deepEqual(noHook.json.handle, { kind: "claude-session", value: SESSION_ID });
  deepEqual(noHook.json.desktop, { sessionId: `local_${SESSION_ID}` });
  equal(noHook.json.waitedSeconds, 0);
  clearMarker(current, "desktop-no-hook");

  // stop 失败不阻止 resume：结果如实报告 stopped false。
  resetLog(current);
  marker(current, "stop-fail");
  const stopFailed = launch(current, intent);
  equal(stopFailed.status, 0, JSON.stringify(stopFailed.json));
  deepEqual(stopFailed.json.background, { id: SHORT_ID, firstTurn: "done", stopped: false });
  clearMarker(current, "stop-fail");
});

test("launch refuses malformed or forbidden intents before touching any host command, and the prompt-position self-check holds", async (t) => {
  const current = await fixture(t);
  const refusal = (intent: Record<string, unknown>, args: readonly string[] = []): HelperRun => {
    resetLog(current);
    const run = launch(current, intent, args);
    equal(run.status, 1, JSON.stringify(run.json));
    deepEqual(callLog(current), [], "a refused intent never reaches ps or claude");
    return run;
  };
  const withArguments = (extra: readonly string[]): Record<string, unknown> =>
    launchIntent("Product A", "../ProductA", extra);
  for (const [flag, value] of [
    ["--session-id", "<uuid-v4 generated by the Agent>"],
    ["--worktree", "feature"],
    ["--resume", SESSION_ID],
    ["--allowedTools", "Bash(ls)"],
    ["--name", "other"],
  ] as const) {
    const run = refusal(withArguments([flag, value]));
    equal(run.json.reason, "intent-invalid");
    equal(run.json.field, "arguments");
    equal(run.json.argument, flag);
  }
  // tmux 意图交给桌面助手：执行种类不对。
  const tmuxIntent = launchIntent("Product A", "../ProductA");
  (tmuxIntent.execution as Record<string, unknown>).kind = "claude-code";
  deepEqual(refusal(tmuxIntent).json, {
    ok: false,
    command: "launch",
    reason: "intent-invalid",
    field: "execution",
  });
  const unknownRole = launchIntent("Product A", "../ProductA");
  unknownRole.role = "observer";
  equal(refusal(unknownRole).json.field, "role");
  const badDigest = launchIntent("Product A", "../ProductA");
  badDigest.intentDigest = "sha256:short";
  equal(refusal(badDigest).json.field, "intentDigest");
  const placeholder = withArguments(["--add-dir", "<ledger root>"]);
  equal(refusal(placeholder).json.reason, "placeholder-unresolved");
  const missingCwd = launchIntent("Product A", "../Missing");
  equal(refusal(missingCwd).json.reason, "cwd-missing");
  const badWorktree = launchIntent("Product A", "../ProductA");
  badWorktree.worktree = {
    repositoryId: "repository_12345678-1234-4123-8123-123456789abc",
    suggestedName: "Feature X",
    basePolicy: "local-head",
  };
  equal(refusal(badWorktree).json.field, "worktree");
  const badTitle = launchIntent("Product A", "../ProductA");
  (badTitle.execution as { desktop: Record<string, unknown> }).desktop.title = 7;
  equal(refusal(badTitle).json.field, "desktop.title");
  // 自检：意图参数里再出现一次启动提示，prompt 就不再是唯一的首个位置参数。
  const doubled = withArguments([startupPrompt(PRODUCT_WINDOW_ID, "product", "Product A")]);
  equal(refusal(doubled).json.reason, "prompt-position");
  // 没有 stdin、没有 --window、未知参数。
  const empty = runHelper(current, ["launch", "--window", PRODUCT_WINDOW_ID]);
  equal(empty.json.reason, "stdin-empty");
  const noWindow = runHelper(current, ["launch"], {
    input: JSON.stringify(launchIntent("Product A", "../ProductA")),
  });
  equal(noWindow.json.reason, "window-required");
  const unknownArgument = runHelper(current, [
    "launch",
    "--window",
    PRODUCT_WINDOW_ID,
    "--in-place",
  ]);
  equal(unknownArgument.json.reason, "argument-unknown");
  const badWait = runHelper(current, ["launch", "--window", PRODUCT_WINDOW_ID, "--wait", "601"]);
  equal(badWait.json.reason, "wait-invalid");
});

test("launch refuses while the window's desktop session is still listed, unless forced（locator-live）", async (t) => {
  const current = await fixture(t);
  writeLocator(current, PRODUCT_WINDOW_ID, SESSION_ID);
  setAgents(current, [backgroundRow("done"), interactiveRow(SESSION_ID, "idle", "Product A", 777)]);
  const live = launch(current, launchIntent("Product A", "../ProductA"));
  equal(live.status, 1);
  equal(live.json.reason, "locator-live");
  deepEqual(live.json.desktop, { sessionId: `local_${SESSION_ID}` });
  equal(live.json.status, "idle");
  deepEqual(
    callLog(current).map((entry) => entry.slice(0, 2)),
    [["claude", "agents"]],
  );
  // 会话已不在侧栏（归档或删除）：照常开。
  resetLog(current);
  setAgents(current, [backgroundRow("done")]);
  const gone = launch(current, launchIntent("Product A", "../ProductA"));
  equal(gone.status, 0, JSON.stringify(gone.json));
  // --force 跳过守卫。
  setAgents(current, [backgroundRow("done"), interactiveRow(SESSION_ID, "busy", "Product A", 777)]);
  const forced = launch(current, launchIntent("Product A", "../ProductA"), ["--force"]);
  equal(forced.status, 0, JSON.stringify(forced.json));
});

test("trust opens the window's folder in the desktop app only with --user-agreed, never starts a session, and refuses with stable codes（Q13，ADR-0025 D11）", async (t) => {
  const current = await fixture(t);
  const intent = launchIntent("Product A", "../ProductA");
  const trust = (args: readonly string[], input = JSON.stringify(intent)): HelperRun =>
    runHelper(current, ["trust", "--window", PRODUCT_WINDOW_ID, "--settle", "0", ...args], {
      input,
    });
  const calls = (): readonly string[] =>
    callLog(current).map((entry) =>
      entry[0] === "claude" ? `claude ${entry.slice(1).join(" ")}` : (entry[0] ?? ""),
    );

  // 没有 --user-agreed：信任是用户的决定，一个宿主命令都不调。
  const unasked = trust([]);
  equal(unasked.status, 1);
  equal(unasked.json.reason, "consent-required");
  equal(unasked.json.windowId, PRODUCT_WINDOW_ID);
  deepEqual(calls(), []);

  // 用户同意之后：先看 app 在不在，再经伪终端在该窗口的执行根里执行裸 claude --desktop；不 --bg、不 --resume、不 rm。
  const opened = trust(["--user-agreed"]);
  equal(opened.status, 0, JSON.stringify(opened.json));
  deepEqual(opened.json, {
    ok: true,
    command: "trust",
    windowId: PRODUCT_WINDOW_ID,
    cwd: "../ProductA",
    trustRoot: "../ProductA",
    opened: true,
  });
  deepEqual(calls(), ["ps", "script", "claude --desktop"]);
  equal(
    readFileSync(path.join(current.state, "opened-folder"), "utf8").trim(),
    path.join(current.parent, "ProductA"),
  );

  // app 没在运行：在打开目录之前拒绝。
  resetLog(current);
  writeFileSync(path.join(current.state, "ps.txt"), `${PS_WITHOUT_APP}\n`);
  const noApp = trust(["--user-agreed"]);
  equal(noApp.json.reason, "desktop-unavailable");
  equal(noApp.json.stage, "preflight");
  deepEqual(calls(), ["ps"]);
  writeFileSync(path.join(current.state, "ps.txt"), `${PS_WITH_APP}\n`);

  // claude --desktop 自己报 app 不可用，或没有报 Opening：各有稳定的拒绝码，都不带绝对路径。
  marker(current, "desktop-not-running");
  const refused = trust(["--user-agreed"]);
  equal(refused.json.reason, "desktop-unavailable");
  equal(refused.json.stage, "trust");
  equal(refused.json.cwd, "../ProductA");
  clearMarker(current, "desktop-not-running");
  marker(current, "desktop-open-fail");
  const failed = trust(["--user-agreed"]);
  equal(failed.status, 1);
  equal(failed.json.reason, "trust-open-failed");
  equal(failed.json.cwd, "../ProductA");
  clearMarker(current, "desktop-open-fail");

  // 意图不合文法、目录不在：与 launch 同一套准入，在任何宿主命令之前拒绝。
  resetLog(current);
  equal(
    trust(["--user-agreed"], JSON.stringify({ ...intent, role: "nobody" })).json.reason,
    "intent-invalid",
  );
  equal(
    trust(["--user-agreed"], JSON.stringify(launchIntent("Product A", "../Missing"))).json.reason,
    "cwd-missing",
  );
  deepEqual(calls(), []);
  equal(
    runHelper(current, ["trust", "--window", PRODUCT_WINDOW_ID, "--settle", "x"]).json.reason,
    "settle-invalid",
  );
});

test("a surface window's trust root is the workspace repository: not-trusted names it and trust opens it, not the surface folder（现场 L23）", async (t) => {
  if (loadSensitive(t, "real git repository to resolve the repository toplevel")) return;
  const current = await fixture(t);
  const gitPath = realGitPath();
  const isolation = {
    HOME: current.parent,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
  };
  // 工作区根是一个真实的 Git 仓库，Design 是它里面的普通子目录：信任记录按仓库顶层认（探针 E9）。
  equal(
    spawnSync(gitPath, ["init", "-q", "-b", "main"], {
      cwd: current.root,
      encoding: "utf8",
      env: { PATH: process.env.PATH ?? "", ...isolation },
    }).status,
    0,
  );
  mkdirSync(path.join(current.root, "Design"), { recursive: true });
  const intent = launchIntent("Design", "Design", [], "design");
  const environment = { WAKEFLOW_REAL_GIT: gitPath, ...isolation };

  marker(current, "bg-not-trusted");
  const untrusted = launch(current, intent, [], { env: environment });
  equal(untrusted.json.reason, "not-trusted");
  equal(untrusted.json.cwd, "Design");
  equal(untrusted.json.trustRoot, ".");
  clearMarker(current, "bg-not-trusted");

  const opened = runHelper(
    current,
    ["trust", "--window", PRODUCT_WINDOW_ID, "--settle", "0", "--user-agreed"],
    { input: JSON.stringify(intent), env: environment },
  );
  equal(opened.status, 0, JSON.stringify(opened.json));
  equal(opened.json.cwd, "Design");
  equal(opened.json.trustRoot, ".");
  equal(readFileSync(path.join(current.state, "opened-folder"), "utf8").trim(), current.root);
});

test("sessions maps the interactive rows of claude agents --json to the desktop-sessions observation, capped at 64 rows, and reports unobserved when the listing fails", async (t) => {
  const current = await fixture(t);
  const run = runHelper(current, ["sessions"]);
  equal(run.status, 0, JSON.stringify(run.json));
  deepEqual(run.json, {
    ok: true,
    command: "sessions",
    observation: {
      kind: "desktop-sessions",
      sessions: [
        {
          sessionId: CONTROLLER_SESSION_ID,
          status: "busy",
          cwd: "/stub/workspace",
          name: "Controller",
          pid: 4242,
        },
      ],
    },
    truncated: false,
    total: 1,
  });
  deepEqual(callLog(current), [["claude", "agents", "--json"]]);
  // 不是 busy 的都是 idle；缺字段为 null；非法会话 id 的行不算。
  setAgents(current, [
    interactiveRow(SESSION_ID, "idle", "Product A", 777),
    { kind: "interactive", sessionId: CONTROLLER_SESSION_ID, status: "working" },
    { kind: "interactive", sessionId: "not-a-uuid", status: "idle" },
    backgroundRow("running"),
  ]);
  const mapped = runHelper(current, ["sessions"]);
  deepEqual((mapped.json.observation as { sessions: unknown[] }).sessions, [
    { sessionId: SESSION_ID, status: "idle", cwd: "/stub/workspace", name: "Product A", pid: 777 },
    { sessionId: CONTROLLER_SESSION_ID, status: "idle", cwd: null, name: null, pid: null },
  ]);
  equal(mapped.json.total, 2);
  // 超过 64 行：截断并报总数。
  setAgents(
    current,
    Array.from({ length: 70 }, (_, index) =>
      interactiveRow(`a0000000-0000-4000-8000-${String(index).padStart(12, "0")}`, "idle"),
    ),
  );
  const capped = runHelper(current, ["sessions"]);
  equal((capped.json.observation as { sessions: unknown[] }).sessions.length, 64);
  equal(capped.json.truncated, true);
  equal(capped.json.total, 70);
  // 清单读不出来：unobserved，不是空清单。
  marker(current, "agents-fail");
  const unobserved = runHelper(current, ["sessions"]);
  equal(unobserved.status, 0);
  deepEqual(unobserved.json.observation, { kind: "unobserved" });
  clearMarker(current, "agents-fail");
  writeFileSync(path.join(current.state, "agents.json"), "not json");
  const invalid = runHelper(current, ["sessions"]);
  equal(invalid.status, 1);
  equal(invalid.json.reason, "agents-json-invalid");
});

test("landing --prompt-ref reads the permit file: a record with the same digest matches by digest, one that only carries the permit id matches by identity (ADR-0027)", async (t) => {
  const current = await fixture(t);
  writeBinding(current, PRODUCT_WINDOW_ID, SESSION_ID);
  const demandId = "demand_11111111-1111-4111-8111-111111111111";
  const permitId = "target-delivery_22222222-2222-4222-8222-222222222222";
  const promptRef = `.wakeflow-active/current/${demandId}/artifacts/permits/delivery/${permitId}.txt`;
  // 许可文本里有 @：摘要规则与内核同一条，全角 ＠ 折回后再算，文件里写哪一种都得到同一个摘要。
  const prompt = `不升级 @types/node。\n\n派发记录:\n- deliveryId: ${permitId}\n- permitId: ${permitId}`;
  const promptFile = path.join(current.root, ...promptRef.split("/"));
  mkdirSync(path.dirname(promptFile), { recursive: true });
  writeFileSync(promptFile, prompt);
  const digest = computeDeliveryPromptDigest(prompt);
  equal(computeDeliveryPromptDigest(prompt.replace("@", "＠")), digest);
  const landing = (args: readonly string[]): HelperRun =>
    runHelper(current, ["landing", "--window", PRODUCT_WINDOW_ID, "--wait-landing", "0", ...args]);
  // 还没有记录：未落地，报出从文件算出的摘要。
  deepEqual(landing(["--prompt-ref", promptRef]).json, {
    ok: true,
    command: "landing",
    windowId: PRODUCT_WINDOW_ID,
    landed: false,
    promptDigest: digest,
  });
  // 同时给了摘要：必须与文件一致。
  equal(
    landing(["--prompt-ref", promptRef, "--prompt-digest", PROMPT_DIGEST]).json.reason,
    "prompt-digest-mismatch",
  );
  equal(landing(["--prompt-ref", promptRef, "--prompt-digest", digest]).json.landed, false);
  // 宿主改动了文本：摘要不同，记录带着许可标识——按身份落地。只给摘要的旧用法认不出它。
  writeHookRecord(
    path.join(current.hooks, "20261109", "aa"),
    "20261109T000001000Z",
    "user-prompt-submit",
    {
      recordId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      sessionId: SESSION_ID,
      recordedAt: "2026-11-09T00:00:01.000Z",
      promptDigest: `sha256:${"ef".repeat(32)}`,
      promptPermitIds: [permitId],
      promptCharacters: prompt.length,
    },
  );
  deepEqual(landing(["--prompt-ref", promptRef]).json, {
    ok: true,
    command: "landing",
    windowId: PRODUCT_WINDOW_ID,
    landed: true,
    match: "identity",
    recordId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    recordedAt: "2026-11-09T00:00:01.000Z",
  });
  equal(landing(["--prompt-digest", digest]).json.landed, false);
  // 别的会话带着同一个标识的记录不算；别的许可的标识也不算。
  // 原样落地的一条随后出现：摘要相符的优先。
  writeHookRecord(
    path.join(current.hooks, "20261109", "bb"),
    "20261109T000002000Z",
    "user-prompt-submit",
    {
      recordId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      sessionId: SESSION_ID,
      recordedAt: "2026-11-09T00:00:02.000Z",
      promptDigest: digest,
      promptPermitIds: [permitId],
      promptCharacters: prompt.length,
    },
  );
  const intact = landing(["--prompt-ref", promptRef]).json;
  equal(intact.match, "digest");
  equal(intact.recordId, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
  // 路径只认许可目录；文件不在是 prompt-ref-missing。landing 从不调用宿主命令。
  equal(landing(["--prompt-ref", "wakeflow.config.json"]).json.reason, "prompt-ref-invalid");
  equal(
    landing([
      "--prompt-ref",
      promptRef.replace(permitId, "target-delivery_33333333-3333-4333-8333-333333333333"),
    ]).json.reason,
    "prompt-ref-missing",
  );
  deepEqual(callLog(current), []);
});

test("landing reports the bound session's user-prompt-submit record for the given digest and never sends anything", async (t) => {
  const current = await fixture(t);
  const landing = (args: readonly string[]): HelperRun =>
    runHelper(current, ["landing", "--window", PRODUCT_WINDOW_ID, "--wait-landing", "0", ...args]);
  // 没有绑定：拒绝。
  const unbound = landing(["--prompt-digest", PROMPT_DIGEST]);
  equal(unbound.status, 1);
  equal(unbound.json.reason, "binding-missing");
  writeBinding(current, PRODUCT_WINDOW_ID, SESSION_ID);
  // 还没有记录：landed false，带上等待的摘要。
  const pending = landing(["--prompt-digest", PROMPT_DIGEST]);
  equal(pending.status, 0, JSON.stringify(pending.json));
  deepEqual(pending.json, {
    ok: true,
    command: "landing",
    windowId: PRODUCT_WINDOW_ID,
    landed: false,
    promptDigest: PROMPT_DIGEST,
  });
  // 别的会话、别的摘要的记录都不算；本会话本摘要的记录在分片目录里也找得到。
  writeHookRecord(
    path.join(current.hooks, "20260924", "cc"),
    "20260924T000002000Z",
    "user-prompt-submit",
    {
      recordId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      sessionId: CONTROLLER_SESSION_ID,
      recordedAt: "2026-09-24T00:00:02.000Z",
      promptDigest: PROMPT_DIGEST,
    },
  );
  writeHookRecord(
    path.join(current.hooks, "20260924", "dd"),
    "20260924T000003000Z",
    "user-prompt-submit",
    {
      recordId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      sessionId: SESSION_ID,
      recordedAt: "2026-09-24T00:00:03.000Z",
      promptDigest: `sha256:${"ef".repeat(32)}`,
    },
  );
  // 本会话有一条别的摘要的 prompt 记录：仍是未落地，但把它报出来（现场 L22）——发送改动了文本与什么都没到是
  // 两回事，Controller 凭它的时间判断是不是这次发送，而不是再发一遍。
  deepEqual(landing(["--prompt-digest", PROMPT_DIGEST]).json, {
    ok: true,
    command: "landing",
    windowId: PRODUCT_WINDOW_ID,
    landed: false,
    promptDigest: PROMPT_DIGEST,
    latestPrompt: {
      recordId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      recordedAt: "2026-09-24T00:00:03.000Z",
      promptDigest: `sha256:${"ef".repeat(32)}`,
    },
  });
  writeHookRecord(
    path.join(current.hooks, "20260924", "ab"),
    "20260924T000004000Z",
    "user-prompt-submit",
    {
      recordId: "abababab-abab-4aba-8aba-abababababab",
      sessionId: SESSION_ID,
      recordedAt: "2026-09-24T00:00:04.000Z",
      promptDigest: PROMPT_DIGEST,
    },
  );
  deepEqual(landing(["--prompt-digest", PROMPT_DIGEST]).json, {
    ok: true,
    command: "landing",
    windowId: PRODUCT_WINDOW_ID,
    landed: true,
    match: "digest",
    recordId: "abababab-abab-4aba-8aba-abababababab",
    recordedAt: "2026-09-24T00:00:04.000Z",
  });
  // 摘要是必填且要合文法；landing 从不调用任何宿主命令。
  equal(landing([]).json.reason, "prompt-digest-required");
  equal(landing(["--prompt-digest", "sha256:nope"]).json.reason, "prompt-digest-invalid");
  deepEqual(callLog(current), []);
  // 不可读的候选记录不能被当作未落地。
  writeFileSync(
    path.join(
      current.hooks,
      "20260924",
      "ab",
      "20260924T000005000Z-user-prompt-submit-abababab-abab-4aba-8aba-000000000000.json",
    ),
    "not JSON",
  );
  const broken = landing(["--prompt-digest", PROMPT_DIGEST]);
  equal(broken.status, 1);
  equal(broken.json.reason, "hook-observations-unavailable");
});

function realGitPath(): string {
  const found = spawnSync("which", ["git"], { encoding: "utf8" }).stdout.trim();
  ok(found.length > 0, "the worktree preparation test needs a real git on PATH");
  return found;
}

test("launch prepares a worktree pod's checkout from the local HEAD, starts claude --bg inside it without --worktree, and observes the checkout's git facts（§13.130 H4，L17 E6/E8）", async (t) => {
  if (loadSensitive(t, "real git repository and worktree operations")) return;
  const current = await fixture(t);
  const gitPath = realGitPath();
  const repository = path.join(current.parent, "ProductA");
  const isolation = {
    HOME: current.parent,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
  };
  const gitEnvironment = {
    PATH: process.env.PATH ?? "",
    ...isolation,
    GIT_AUTHOR_NAME: "Wakeflow",
    GIT_AUTHOR_EMAIL: "wakeflow@example.invalid",
    GIT_COMMITTER_NAME: "Wakeflow",
    GIT_COMMITTER_EMAIL: "wakeflow@example.invalid",
  };
  const git = (args: readonly string[], cwd = repository, allowFailure = false): string => {
    const result = spawnSync(gitPath, args, { cwd, encoding: "utf8", env: gitEnvironment });
    if (!allowFailure) equal(result.status, 0, `git ${args.join(" ")}: ${result.stderr}`);
    return result.stdout;
  };
  git(["init", "-q", "-b", "main"]);
  writeFileSync(path.join(repository, "README.md"), "product\n");
  git(["add", "README.md"]);
  git(["commit", "-q", "-m", "init"]);
  const head = git(["rev-parse", "HEAD"]).trim();
  const helperEnvironment = { WAKEFLOW_REAL_GIT: gitPath, ...isolation };
  const intentFor = (name: string, placement = "../ProductA"): Record<string, unknown> => {
    const intent = launchIntent("Product A", placement);
    intent.worktree = {
      repositoryId: "repository_12345678-1234-4123-8123-123456789abc",
      suggestedName: name,
      basePolicy: "local-head",
    };
    return intent;
  };
  const launchPod = (
    name: string,
    extraEnvironment: Record<string, string> = {},
    placement?: string,
  ): HelperRun => {
    resetLog(current);
    return launch(current, intentFor(name, placement), [], {
      env: { ...helperEnvironment, ...extraEnvironment },
      allowPaths: true,
    });
  };
  const checkout = path.join(repository, ".claude", "worktrees", "feature-x");
  const excludeLines = (): number =>
    readFileSync(path.join(repository, ".git", "info", "exclude"), "utf8")
      .split("\n")
      .filter((line) => line === ".claude/worktrees/").length;
  // 创建：从本地 HEAD 建 worktree-feature-x 分支与检出；--bg 的 cwd 就是检出；参数里没有 --worktree。
  const created = launchPod("feature-x");
  equal(created.status, 0, JSON.stringify(created.json));
  equal(created.json.worktreePrepared, "created");
  equal(created.json.worktreeBranch, "worktree-feature-x");
  equal(created.json.worktreeExclude, "appended");
  deepEqual(created.json.window, {
    name: "Product A",
    cwd: "../ProductA/.claude/worktrees/feature-x",
  });
  equal(readFileSync(path.join(current.state, "bg-cwd.txt"), "utf8").trim(), checkout);
  const started = callLog(current).find((entry) => entry[1] === "--bg") ?? [];
  equal(started.includes("--worktree"), false);
  equal(git(["rev-parse", "HEAD"], checkout).trim(), head);
  equal(git(["rev-parse", "--abbrev-ref", "HEAD"], checkout).trim(), "worktree-feature-x");
  equal(excludeLines(), 1);
  equal(git(["status", "--porcelain"]).trim(), "");
  const observed = created.json.observation as {
    readonly worktree?: { readonly porcelain: string; readonly commonDir: string };
    readonly desktop: unknown;
  };
  equal(observed.worktree?.porcelain.includes("refs/heads/worktree-feature-x"), true);
  // --git-common-dir 从链接检出里可能给相对路径：按检出解析后就是主仓库的 .git。
  equal(
    realpathSync(path.resolve(checkout, observed.worktree?.commonDir ?? "")),
    path.join(repository, ".git"),
  );
  deepEqual(observed.desktop, { sessionId: `local_${SESSION_ID}` });
  // 复用：检出已在就不再 add；exclude 不重复。
  const reused = launchPod("feature-x");
  equal(reused.status, 0, JSON.stringify(reused.json));
  equal(reused.json.worktreePrepared, "reused");
  equal(reused.json.worktreeExclude, "present");
  equal(excludeLines(), 1);
  // A8：会话的 hook 记录 cwd 不是准备好的检出就拒绝，仍报告留下的检出与分支。
  const elsewhere = launchPod("feature-x", { WAKEFLOW_STUB_SESSION_CWD: repository });
  equal(elsewhere.status, 1, JSON.stringify(elsewhere.json));
  equal(elsewhere.json.reason, "worktree-cwd-mismatch");
  equal(elsewhere.json.observedCwd, ".");
  equal(elsewhere.json.worktreePrepared, "reused");
  equal(elsewhere.json.worktreeBranch, "worktree-feature-x");
  // 分支已在、检出不在：不复用旧分支，拒绝且不起会话。
  git(["worktree", "remove", "--force", checkout]);
  const leftover = launchPod("feature-x");
  equal(leftover.status, 1);
  equal(leftover.json.reason, "worktree-branch-exists");
  equal(leftover.json.branch, "worktree-feature-x");
  equal(
    callLog(current).some((entry) => entry[1] === "--bg"),
    false,
  );
  // 检出建好之后 --bg 失败：失败结果仍带 worktreePrepared 与分支。
  marker(current, "bg-fail");
  const stranded = launchPod("feature-w");
  equal(stranded.status, 1);
  equal(stranded.json.reason, "launch-start-failed");
  equal(stranded.json.worktreePrepared, "created");
  equal(stranded.json.worktreeBranch, "worktree-feature-w");
  clearMarker(current, "bg-fail");
  // 落点是仓库的子目录而不是顶层：任何 git 写入之前拒绝。
  mkdirSync(path.join(repository, "sub"));
  const nested = launchPod("feature-u", {}, "../ProductA/sub");
  equal(nested.status, 1);
  equal(nested.json.reason, "worktree-root-not-toplevel");
  equal(existsSync(path.join(repository, "sub", ".claude")), false);
});

test("a hung host command is refused as host-command-timeout instead of being read as a missing session（复审 T11）", async (t) => {
  if (
    loadSensitive(t, "real stub subprocess timing: the hung command must be the one that times out")
  )
    return;
  const current = await fixture(t);
  const started = Date.now();
  const run = launch(current, launchIntent("Product A", "../ProductA"), [], {
    env: { WAKEFLOW_STUB_HANG: "agents", WAKEFLOW_DESKTOP_COMMAND_TIMEOUT_MS: "3000" },
  });
  equal(run.status, 1);
  equal(run.json.reason, "host-command-timeout");
  equal(run.json.command, "claude");
  equal(run.json.subcommand, "agents");
  equal(run.json.timeoutMs, 3000);
  ok(
    Date.now() - started < 20_000,
    "the refusal arrives at the timeout, not after the stub's 30 s sleep",
  );
  equal(
    callLog(current).some((entry) => entry[1] === "--desktop" || entry[1] === "stop"),
    false,
  );
});
