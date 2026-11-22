import { deepEqual, doesNotMatch, equal, ok } from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";

import {
  WAKEFLOW_HOOK_OBSERVER_HOST_ARGUMENT,
  WAKEFLOW_HOOK_OBSERVER_MARKER,
} from "../../../src/entrypoints/wakeflow-hook-observer.js";
import {
  WAKEFLOW_WRITE_GUARD_EVENT,
  WAKEFLOW_WRITE_GUARD_HOST_ARGUMENT,
  WAKEFLOW_WRITE_GUARD_MARKER,
} from "../../../src/entrypoints/wakeflow-hook-write-guard.js";
import { computeSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import {
  CLAUDE_CODE_HOOK_FRAGMENT,
  CLAUDE_CODE_HOOK_FRAGMENT_DIGEST,
  CLAUDE_CODE_HOOK_OBSERVER_HOST_ARGUMENT,
  CLAUDE_CODE_HOOK_OBSERVER_HOST_ID,
  CLAUDE_CODE_HOOK_OBSERVER_MARKER,
  CLAUDE_CODE_HOOK_OBSERVER_SCRIPT_PATH,
  CLAUDE_CODE_WRITE_GUARD_MARKER,
  CLAUDE_CODE_WRITE_GUARD_MATCHER,
  type ClaudeCodeHookEventName,
  renderClaudeCodeHooksJson,
} from "../../../src/hosts/claude-code/claude-code-hook-fragment.js";
import { parseWakeflowHostId } from "../../../src/kernel/layout.js";

/**
 * 级别 1（纯函数）：Claude Code 插件级 hook 片段（gate-log §13.97 D5、D6）——事件集合、exec 形处理器、
 * 同步异步、字节稳定与摘要；以及 `PreToolUse` 上的写守卫组（ADR-0020 的 2026-11-16 补充）。
 */

/** 五个观察事件：共用观察器的 argv，不设 matcher。 */
const EVENTS: readonly ClaudeCodeHookEventName[] = [
  "SessionStart",
  "UserPromptSubmit",
  "Notification",
  "Stop",
  "SessionEnd",
];
/** 片段的键序（渲染字节的一部分）：写守卫的 `PreToolUse` 排在提示之后、通知之前。 */
const FRAGMENT_KEYS: readonly ClaudeCodeHookEventName[] = [
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "Notification",
  "Stop",
  "SessionEnd",
];
// biome-ignore lint/suspicious/noTemplateCurlyInString: 宿主在运行时展开该占位符
const PLUGIN_ROOT_PLACEHOLDER = "${CLAUDE_PLUGIN_ROOT}";
// biome-ignore lint/suspicious/noTemplateCurlyInString: Codex 的占位符，本片段不得使用
const CODEX_PLUGIN_ROOT_PLACEHOLDER = "${PLUGIN_ROOT}";
const EXPECTED_ARGS: readonly string[] = [
  `${PLUGIN_ROOT_PLACEHOLDER}/hooks/observe.mjs`,
  "--wakeflow-hook-observer-v1",
  "--host",
  "claude-code",
];

/**
 * 渲染字节的期望形状写成字面量，不由片段或 `JSON.stringify` 推导：缩进、键序、args 数组的换行
 * 与尾随换行都是宿主读取的定义字节，必须由测试而不是实现表达式钉住。
 */
// biome-ignore lint/suspicious/noTemplateCurlyInString: 宿主在运行时展开该占位符
const EXPECTED_SCRIPT_ARG_LINE = '              "${CLAUDE_PLUGIN_ROOT}/hooks/observe.mjs",';
const EXPECTED_ARGS_LINES: readonly string[] = [
  '            "args": [',
  EXPECTED_SCRIPT_ARG_LINE,
  '              "--wakeflow-hook-observer-v1",',
  '              "--host",',
  '              "claude-code"',
  "            ],",
];
const EXPECTED_PREFIX: string = [
  "{",
  '  "hooks": {',
  '    "SessionStart": [',
  "      {",
  '        "hooks": [',
  "          {",
  '            "type": "command",',
  '            "command": "node",',
  ...EXPECTED_ARGS_LINES,
  '            "timeout": 5',
  "          }",
  "        ]",
  "      }",
  "    ],",
  '    "UserPromptSubmit": [',
  "",
].join("\n");
const EXPECTED_ASYNC_HANDLER: string = [
  "          {",
  '            "type": "command",',
  '            "command": "node",',
  ...EXPECTED_ARGS_LINES,
  '            "async": true,',
  '            "timeout": 5',
  "          }",
].join("\n");
const EXPECTED_WRITE_GUARD_BLOCK: string = [
  '    "PreToolUse": [',
  "      {",
  '        "matcher": "Edit|Write|MultiEdit|NotebookEdit",',
  '        "hooks": [',
  "          {",
  '            "type": "command",',
  '            "command": "node",',
  '            "args": [',
  EXPECTED_SCRIPT_ARG_LINE,
  '              "--wakeflow-write-guard-v1",',
  '              "--host",',
  '              "claude-code"',
  "            ],",
  '            "timeout": 5,',
  '            "onFailure": "continue"',
  "          }",
  "        ]",
  "      }",
  "    ],",
  '    "Notification": [',
  "",
].join("\n");
const EXPECTED_SUFFIX: string = [
  '    "SessionEnd": [',
  "      {",
  '        "hooks": [',
  "          {",
  '            "type": "command",',
  '            "command": "node",',
  ...EXPECTED_ARGS_LINES,
  '            "timeout": 3',
  "          }",
  "        ]",
  "      }",
  "    ]",
  "  }",
  "}",
  "",
].join("\n");

function handlerOf(event: ClaudeCodeHookEventName) {
  const groups = CLAUDE_CODE_HOOK_FRAGMENT.hooks[event];
  equal(groups.length, 1, event);
  const group = groups[0];
  ok(group !== undefined);
  equal(group.hooks.length, 1, event);
  const handler = group.hooks[0];
  ok(handler !== undefined);
  return handler;
}

test("片段恰好覆盖五个观察事件与写守卫的 PreToolUse（键序固定）；观察事件各一个无 matcher 的组、组里恰好一个 exec 形 command 处理器", () => {
  // D3/D6：五个观察事件同名同形（Notification 为 §13.167 A7 所加）；键序是渲染字节的一部分，所以按顺序比较而不是按集合。
  deepEqual(Object.keys(CLAUDE_CODE_HOOK_FRAGMENT.hooks), [...FRAGMENT_KEYS]);
  deepEqual(Object.keys(CLAUDE_CODE_HOOK_FRAGMENT), ["hooks"]);
  for (const event of EVENTS) {
    const groups = CLAUDE_CODE_HOOK_FRAGMENT.hooks[event];
    const group = groups[0];
    ok(group !== undefined);
    deepEqual(Object.keys(group), ["hooks"], `${event} 组不设 matcher`);
    const handler = handlerOf(event);
    equal(handler.type, "command");
    equal(handler.command, "node", "exec 形：command 是可执行名，不经 shell");
    equal("matcher" in handler, false);
    // onFailure 只在写守卫上：异步处理器上它不起作用，其余观察事件的缺省就是继续。
    equal("onFailure" in handler, false, event);
  }
});

test("同步与异步按 D5：SessionStart 5 秒同步、UserPromptSubmit 与 Notification 异步 5 秒、Stop 5 秒同步、SessionEnd 3 秒同步；async 键只在异步处理器上出现且键序固定", () => {
  // 异步处理器的 5 秒当前宿主不执行（只对仍执行它的宿主有效），钉住的是字节，不是上限。
  equal(handlerOf("SessionStart").timeout, 5);
  equal(handlerOf("UserPromptSubmit").timeout, 5);
  equal(handlerOf("Notification").timeout, 5);
  equal(handlerOf("Stop").timeout, 5);
  equal(handlerOf("SessionEnd").timeout, 3);
  for (const event of EVENTS) {
    const handler = handlerOf(event);
    if (event === "UserPromptSubmit" || event === "Notification") {
      equal(handler.async, true);
      deepEqual(Object.keys(handler), ["type", "command", "args", "async", "timeout"]);
    } else {
      // 同步处理器没有 async 键——不是 async: false。
      equal("async" in handler, false, event);
      deepEqual(Object.keys(handler), ["type", "command", "args", "timeout"]);
    }
  }
});

test("args 是插件根占位符脚本路径加入口约定的固定 argv，占位符在 args 里由宿主展开，五个事件共用，不含工作区根", () => {
  for (const event of EVENTS) {
    deepEqual(handlerOf(event).args, EXPECTED_ARGS, event);
  }
  // D1：标记与 --host 参数是与入口约定的字面量，宿主层不能反向导入入口，这里核对两处相等。
  equal(CLAUDE_CODE_HOOK_OBSERVER_MARKER, WAKEFLOW_HOOK_OBSERVER_MARKER);
  equal(CLAUDE_CODE_HOOK_OBSERVER_HOST_ARGUMENT, WAKEFLOW_HOOK_OBSERVER_HOST_ARGUMENT);
  equal(parseWakeflowHostId(CLAUDE_CODE_HOOK_OBSERVER_HOST_ID), "claude-code");
  equal(CLAUDE_CODE_HOOK_OBSERVER_SCRIPT_PATH, "hooks/observe.mjs");
});

test("写守卫的组：PreToolUse 上只对编辑工具、同步 5 秒、onFailure 为 continue、带守卫的标记启动同一个脚本；matcher 是精确名字的列表", () => {
  const groups = CLAUDE_CODE_HOOK_FRAGMENT.hooks.PreToolUse;
  equal(groups.length, 1);
  const group = groups[0];
  ok(group !== undefined);
  deepEqual(Object.keys(group), ["matcher", "hooks"], "键序：matcher 在前");
  equal(group.matcher, "Edit|Write|MultiEdit|NotebookEdit");
  equal(group.matcher, CLAUDE_CODE_WRITE_GUARD_MATCHER);
  // 宿主把只含字母、数字、`_`、`-`、空格、逗号与 `|` 的 matcher 当精确名字的列表，别的字符才当正则。
  ok(/^[A-Za-z|]+$/u.test(CLAUDE_CODE_WRITE_GUARD_MATCHER), "不含会让宿主把它当正则的字符");
  const handler = handlerOf("PreToolUse");
  equal(handler.type, "command");
  equal(handler.command, "node");
  // 同步：异步 hook 的决定宿主不认，拒绝就不作数了。
  equal("async" in handler, false);
  // onFailure 排在最后；continue 让守卫的故障与超时在 Code Mode 里也放行（ADR-0020 决定 6 补记的"拿不准就放行"）。
  deepEqual(Object.keys(handler), ["type", "command", "args", "timeout", "onFailure"]);
  equal(handler.timeout, 5);
  equal(handler.onFailure, "continue");
  deepEqual(handler.args, [
    `${PLUGIN_ROOT_PLACEHOLDER}/hooks/observe.mjs`,
    "--wakeflow-write-guard-v1",
    "--host",
    "claude-code",
  ]);
  // 标记、事件名与 --host 参数是与入口约定的字面量：两处相等。
  equal(CLAUDE_CODE_WRITE_GUARD_MARKER, WAKEFLOW_WRITE_GUARD_MARKER);
  equal(CLAUDE_CODE_HOOK_OBSERVER_HOST_ARGUMENT, WAKEFLOW_WRITE_GUARD_HOST_ARGUMENT);
  equal(WAKEFLOW_WRITE_GUARD_EVENT, "PreToolUse");
});

test("渲染是 2 空格缩进、尾随单个换行的确定性 JSON，解析回片段本身，摘要等于渲染字节的 sha256", () => {
  const rendered = renderClaudeCodeHooksJson();
  equal(renderClaudeCodeHooksJson(), rendered, "渲染只由片段数据决定");
  // 字面量前缀、异步处理器块与后缀钉住字节形状：2 空格缩进、键序、args 每项一行、
  // 结尾的三层收束与单个尾随换行；实现改用别的缩进或键序时这三条都会失败。
  ok(rendered.startsWith(EXPECTED_PREFIX), "SessionStart 块的字节形状");
  ok(rendered.includes(EXPECTED_ASYNC_HANDLER), "异步处理器块的字节形状");
  ok(rendered.includes(EXPECTED_WRITE_GUARD_BLOCK), "写守卫组的字节形状");
  ok(rendered.endsWith(EXPECTED_SUFFIX), "SessionEnd 块与收尾的字节形状");
  equal(rendered.endsWith("\n\n"), false);
  equal(rendered.includes("\t"), false);
  equal(rendered.includes("\r"), false);
  deepEqual(JSON.parse(rendered), CLAUDE_CODE_HOOK_FRAGMENT);

  const bytes = new TextEncoder().encode(rendered);
  equal(CLAUDE_CODE_HOOK_FRAGMENT_DIGEST, computeSha256Digest(bytes));
  equal(
    CLAUDE_CODE_HOOK_FRAGMENT_DIGEST,
    `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
  );
});

test("渲染文本跨版本字节稳定：只含占位符，不含版本号、构建标识、摘要或绝对路径（D6）", () => {
  const rendered = renderClaudeCodeHooksJson();
  ok(rendered.includes(`"${PLUGIN_ROOT_PLACEHOLDER}/hooks/observe.mjs"`));
  doesNotMatch(rendered, /\d+\.\d+\.\d+/u, "不含版本号");
  equal(rendered.includes("technical-skeleton"), false);
  equal(rendered.includes("sha256"), false);
  equal(rendered.includes(CODEX_PLUGIN_ROOT_PLACEHOLDER), false, "Claude 片段只用 Claude 的占位符");
  // 去掉占位符脚本路径后不再有任何路径分隔符或占位符起始：没有绝对路径与工作区根。
  const remainder = rendered.split(`${PLUGIN_ROOT_PLACEHOLDER}/hooks/observe.mjs`).join("");
  equal(remainder.includes("/"), false);
  equal(remainder.includes("$"), false);
});
