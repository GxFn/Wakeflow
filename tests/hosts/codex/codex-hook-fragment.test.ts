import { createHash } from "node:crypto";
import { deepEqual, doesNotMatch, equal, ok } from "node:assert/strict";
import { test } from "node:test";

import {
  WAKEFLOW_HOOK_OBSERVER_HOST_ARGUMENT,
  WAKEFLOW_HOOK_OBSERVER_MARKER,
} from "../../../src/entrypoints/wakeflow-hook-observer.js";
import { computeSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import {
  CODEX_HOOK_FRAGMENT,
  CODEX_HOOK_FRAGMENT_DIGEST,
  CODEX_HOOK_OBSERVER_COMMAND,
  CODEX_HOOK_OBSERVER_HOST_ARGUMENT,
  CODEX_HOOK_OBSERVER_HOST_ID,
  CODEX_HOOK_OBSERVER_MARKER,
  CODEX_HOOK_OBSERVER_SCRIPT_PATH,
  type CodexHookEventName,
  renderCodexHooksJson,
} from "../../../src/hosts/codex/codex-hook-fragment.js";
import { parseWakeflowHostId } from "../../../src/kernel/layout.js";

/** Codex 插件级 hook 片段（gate-log §13.97 D5、D6）：事件集合、处理器形状、同步异步、字节稳定与摘要。 */

const EVENTS: readonly CodexHookEventName[] = ["SessionStart", "UserPromptSubmit", "Stop", "SessionEnd"];
// biome-ignore lint/suspicious/noTemplateCurlyInString: 宿主在运行时展开该占位符
const PLUGIN_ROOT_PLACEHOLDER = "${PLUGIN_ROOT}";
const EXPECTED_COMMAND = `node "${PLUGIN_ROOT_PLACEHOLDER}/hooks/observe.mjs" --wakeflow-hook-observer-v1 --host codex`;

/**
 * 渲染字节的期望形状写成字面量，不由片段或 `JSON.stringify` 推导：Codex 的信任按定义哈希记录，
 * 缩进、键序、命令串的 JSON 转义与尾随换行都是哈希的输入，必须由测试而不是实现表达式钉住。
 */
// biome-ignore lint/suspicious/noTemplateCurlyInString: 宿主在运行时展开该占位符
const EXPECTED_COMMAND_LINE = '            "command": "node \\"${PLUGIN_ROOT}/hooks/observe.mjs\\" --wakeflow-hook-observer-v1 --host codex",';
const EXPECTED_PREFIX: string = [
  "{",
  '  "hooks": {',
  '    "SessionStart": [',
  "      {",
  '        "hooks": [',
  "          {",
  '            "type": "command",',
  EXPECTED_COMMAND_LINE,
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
  EXPECTED_COMMAND_LINE,
  '            "async": true,',
  '            "timeout": 5',
  "          }",
].join("\n");
const EXPECTED_SUFFIX: string = [
  '    "SessionEnd": [',
  "      {",
  '        "hooks": [',
  "          {",
  '            "type": "command",',
  EXPECTED_COMMAND_LINE,
  '            "timeout": 3',
  "          }",
  "        ]",
  "      }",
  "    ]",
  "  }",
  "}",
  "",
].join("\n");

function handlerOf(event: CodexHookEventName) {
  const groups = CODEX_HOOK_FRAGMENT.hooks[event];
  equal(groups.length, 1, event);
  const group = groups[0];
  ok(group !== undefined);
  equal(group.hooks.length, 1, event);
  const handler = group.hooks[0];
  ok(handler !== undefined);
  return handler;
}

test("片段恰好覆盖四个生命周期事件（键序固定），每个事件一个无 matcher 的组、组里恰好一个 command 处理器", () => {
  // D3/D6：四个事件同名同形；键序是渲染字节的一部分，所以按顺序比较而不是按集合。
  deepEqual(Object.keys(CODEX_HOOK_FRAGMENT.hooks), [...EVENTS]);
  deepEqual(Object.keys(CODEX_HOOK_FRAGMENT), ["hooks"]);
  for (const event of EVENTS) {
    const groups = CODEX_HOOK_FRAGMENT.hooks[event];
    const group = groups[0];
    ok(group !== undefined);
    deepEqual(Object.keys(group), ["hooks"], `${event} 组不设 matcher`);
    const handler = handlerOf(event);
    equal(handler.type, "command");
    equal("matcher" in handler, false);
    equal("args" in handler, false, "Codex 只有命令串形式");
  }
});

test("同步与异步按 D5：SessionStart 5 秒同步、UserPromptSubmit 异步、Stop 5 秒同步、SessionEnd 3 秒同步；async 键只在异步处理器上出现且键序固定", () => {
  equal(handlerOf("SessionStart").timeout, 5);
  equal(handlerOf("UserPromptSubmit").timeout, 5);
  equal(handlerOf("Stop").timeout, 5);
  equal(handlerOf("SessionEnd").timeout, 3);
  for (const event of EVENTS) {
    const handler = handlerOf(event);
    if (event === "UserPromptSubmit") {
      equal(handler.async, true);
      deepEqual(Object.keys(handler), ["type", "command", "async", "timeout"]);
    } else {
      // 同步处理器没有 async 键——不是 async: false，Codex 的信任哈希按定义字节记录。
      equal("async" in handler, false, event);
      deepEqual(Object.keys(handler), ["type", "command", "timeout"]);
    }
  }
});

test("命令串是 node 加双引号的插件根占位符脚本路径与入口约定的固定 argv，四个事件共用同一串，不含工作区根", () => {
  equal(CODEX_HOOK_OBSERVER_COMMAND, EXPECTED_COMMAND);
  for (const event of EVENTS) {
    equal(handlerOf(event).command, EXPECTED_COMMAND, event);
  }
  // D1：标记与 --host 参数是与入口约定的字面量，宿主层不能反向导入入口，这里核对两处相等。
  equal(CODEX_HOOK_OBSERVER_MARKER, WAKEFLOW_HOOK_OBSERVER_MARKER);
  equal(CODEX_HOOK_OBSERVER_HOST_ARGUMENT, WAKEFLOW_HOOK_OBSERVER_HOST_ARGUMENT);
  equal(parseWakeflowHostId(CODEX_HOOK_OBSERVER_HOST_ID), "codex");
  equal(CODEX_HOOK_OBSERVER_SCRIPT_PATH, "hooks/observe.mjs");
});

test("渲染是 2 空格缩进、尾随单个换行的确定性 JSON，解析回片段本身，摘要等于渲染字节的 sha256", () => {
  const rendered = renderCodexHooksJson();
  equal(renderCodexHooksJson(), rendered, "渲染只由片段数据决定");
  // 字面量前缀、异步处理器块与后缀钉住字节形状：2 空格缩进、键序、命令串的 JSON 转义、
  // 结尾的三层收束与单个尾随换行；实现改用别的缩进或键序时这三条都会失败。
  ok(rendered.startsWith(EXPECTED_PREFIX), "SessionStart 块的字节形状");
  ok(rendered.includes(EXPECTED_ASYNC_HANDLER), "异步处理器块的字节形状");
  ok(rendered.endsWith(EXPECTED_SUFFIX), "SessionEnd 块与收尾的字节形状");
  equal(rendered.endsWith("\n\n"), false);
  equal(rendered.includes("\t"), false);
  equal(rendered.includes("\r"), false);
  deepEqual(JSON.parse(rendered), CODEX_HOOK_FRAGMENT);

  const bytes = new TextEncoder().encode(rendered);
  equal(CODEX_HOOK_FRAGMENT_DIGEST, computeSha256Digest(bytes));
  equal(CODEX_HOOK_FRAGMENT_DIGEST, `sha256:${createHash("sha256").update(bytes).digest("hex")}`);
});

test("渲染文本跨版本字节稳定：只含占位符，不含版本号、构建标识、摘要或绝对路径（D6）", () => {
  const rendered = renderCodexHooksJson();
  // 命令串里的脚本路径带双引号，渲染成 JSON 后以转义形出现：核对的是命令串的 JSON 编码整体。
  ok(rendered.includes(JSON.stringify(EXPECTED_COMMAND)));
  ok(rendered.includes(`${PLUGIN_ROOT_PLACEHOLDER}/hooks/observe.mjs`));
  doesNotMatch(rendered, /\d+\.\d+\.\d+/u, "不含版本号");
  equal(rendered.includes("technical-skeleton"), false);
  equal(rendered.includes("sha256"), false);
  equal(rendered.includes("CLAUDE_PLUGIN_ROOT"), false, "Codex 片段只用 Codex 的占位符");
  // 去掉占位符脚本路径后不再有任何路径分隔符或占位符起始：没有绝对路径与工作区根。
  const remainder = rendered.split(`${PLUGIN_ROOT_PLACEHOLDER}/hooks/observe.mjs`).join("");
  equal(remainder.includes("/"), false);
  equal(remainder.includes("$"), false);
});
