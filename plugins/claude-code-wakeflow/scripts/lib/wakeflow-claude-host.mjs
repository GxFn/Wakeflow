#!/usr/bin/env node

import { readSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ensureClaudeActivityMonitor,
  inspectClaudeActivity,
  inspectClaudePromptTemp,
  stopClaudeActivityMonitor,
  sweepClaudePromptTemp,
} from "./wakeflow-claude-activity.mjs";
import {
  inspectClaudeHostActivationScope,
} from "./wakeflow-claude-activation-scope.mjs";
import {
  executeClaudeWindowDecommission,
  planClaudeWindowDecommission,
  recoverClaudeWindowDecommission,
} from "./wakeflow-claude-decommission.mjs";
import {
  arrangeClaudeWindows,
  defaultClaudeLifecycleHostAdapter,
  inspectClaudeHostPreflight,
  inspectClaudeWindowFleet,
  launchClaudeWindow,
  resumeClaudeWindow,
  retitleClaudeWindow,
} from "./wakeflow-claude-lifecycle.mjs";
import {
  executeClaudePodMaterialization,
  normalizeClaudePodCreationObservation,
  planClaudePodMaterializationOperation,
} from "./wakeflow-claude-pod-host.mjs";
import {
  inspectClaudeSettingsAssets,
  planClaudeSettingsAssets,
} from "./wakeflow-claude-settings.mjs";
import {
  executeClaudeControllerReturn,
  executeClaudeTargetDelivery,
  recoverClaudeTransportOperation,
} from "./wakeflow-claude-transport.mjs";

// Claude host facade只拥有四项职责：闭集命令解析、无行为输入快照、现行owner路由和单行JSON CLI投影。
// lifecycle、transport、settings/activity、Pod和decommission的领域校验与状态转换仍由各自owner负责。
// 本文件不得重新拥有已退役的聚合宿主记录、隔离流、版本戳或任何第二套持久状态。

const MAX_STDIN_BYTES = 1024 * 1024;
const UTF8_FATAL = new TextDecoder("utf-8", { fatal: true });
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]/u;

export const WAKEFLOW_CLAUDE_HOST_COMMANDS = Object.freeze([
  "activation-scope",
  "activity-ensure",
  "activity-inspect",
  "activity-stop",
  "arrange-windows",
  "controller-return",
  "decommission-execute",
  "decommission-plan",
  "decommission-recover",
  "launch-window",
  "pod-materialize",
  "pod-normalize-observation",
  "pod-plan",
  "preflight",
  "prompt-temp-inspect",
  "prompt-temp-sweep",
  "resume-window",
  "retitle-window",
  "settings-inspect",
  "settings-plan",
  "target-delivery",
  "transport-recover",
  "window-status",
]);

const COMMAND_SET = new Set(WAKEFLOW_CLAUDE_HOST_COMMANDS);

class WakeflowClaudeHostFacadeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "WakeflowClaudeHostFacadeError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new WakeflowClaudeHostFacadeError(code, message);
}

function plainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

// 对in-process调用同样执行JSON对象的数据属性约束，避免getter在命令选择后改变已准入事实。
function passiveObjectSnapshot(value, label) {
  if (!plainObject(value)) fail("wakeflow-claude-host-contract", `${label} must be one plain JSON object`);
  const snapshot = {};
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") {
      fail("wakeflow-claude-host-contract", `${label} has an unsupported field`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail("wakeflow-claude-host-contract", `${label}.${key} must be an enumerable data field`);
    }
    snapshot[key] = descriptor.value;
  }
  return Object.freeze(snapshot);
}

function exactObject(value, required, optional, label) {
  const snapshot = passiveObjectSnapshot(value, label);
  const allowed = new Set([...required, ...optional]);
  if (
    Object.keys(snapshot).some((key) => !allowed.has(key))
    || required.some((key) => !Object.hasOwn(snapshot, key))
  ) {
    fail("wakeflow-claude-host-contract", `${label} has the wrong closed field set`);
  }
  return snapshot;
}

function commandToken(value) {
  if (
    typeof value !== "string"
    || !COMMAND_SET.has(value)
    || value !== value.trim()
    || CONTROL_RE.test(value)
  ) {
    fail("wakeflow-claude-host-command", "unsupported Claude host command");
  }
  return value;
}

function normalizeFacadeAdapters(value = {}) {
  return exactObject(
    value,
    [],
    ["lifecycle", "pod", "decommission", "activation"],
    "Claude host facade adapters",
  );
}

function exactDecommissionHostAdapters() {
  const inspect = async ({ target }) => {
    const observations = await defaultClaudeLifecycleHostAdapter.listPanes({
      context: {
        socketName: target.socketName,
        sessionName: target.sessionName,
      },
    });
    return observations.filter((entry) => (
      entry.socketName === target.socketName
      && (
        entry.windowId === target.windowId
        || entry.paneId === target.paneId
        || entry.metadata?.locatorId === target.locatorId
      )
    ));
  };
  return Object.freeze({
    inspect,
    close: (endpoint) => defaultClaudeLifecycleHostAdapter.closeWindow({ endpoint }),
  });
}

function requirePodAdapters(adapters) {
  const pod = adapters.pod;
  if (!plainObject(pod)) {
    fail(
      "wakeflow-claude-host-adapter-required",
      "pod-materialize requires the current in-process Claude Pod host adapter",
    );
  }
  let snapshot;
  try {
    snapshot = exactObject(
      pod,
      ["inspectExisting", "create"],
      [],
      "Claude Pod facade adapter",
    );
  } catch (cause) {
    if (cause instanceof WakeflowClaudeHostFacadeError) {
      fail(
        "wakeflow-claude-host-adapter-required",
        "pod-materialize requires the current in-process Claude Pod host adapter",
      );
    }
    throw cause;
  }
  if (typeof snapshot.inspectExisting !== "function" || typeof snapshot.create !== "function") {
    fail(
      "wakeflow-claude-host-adapter-required",
      "pod-materialize requires the current in-process Claude Pod host adapter",
    );
  }
  return snapshot;
}

// 公共路由只选择唯一现行owner；它不解释领域字段，也不把owner结果改写成另一种状态语言。
export async function routeClaudeHostCommand(commandValue, payloadValue = {}, adapterValue = {}) {
  const command = commandToken(commandValue);
  const payload = passiveObjectSnapshot(payloadValue, "command payload");
  const adapters = normalizeFacadeAdapters(adapterValue);
  switch (command) {
    case "preflight":
      return inspectClaudeHostPreflight(payload, adapters.lifecycle);
    case "launch-window":
      return launchClaudeWindow(payload, adapters.lifecycle);
    case "resume-window":
      return resumeClaudeWindow(payload, adapters.lifecycle);
    case "retitle-window":
      return retitleClaudeWindow(payload, adapters.lifecycle);
    case "arrange-windows":
      return arrangeClaudeWindows(payload, adapters.lifecycle);
    case "window-status":
      return inspectClaudeWindowFleet(payload, adapters.lifecycle);
    case "target-delivery":
      return executeClaudeTargetDelivery(payload);
    case "controller-return":
      return executeClaudeControllerReturn(payload);
    case "transport-recover":
      return recoverClaudeTransportOperation(payload);
    case "activity-ensure":
      return ensureClaudeActivityMonitor(payload);
    case "activity-inspect":
      return inspectClaudeActivity(payload);
    case "activity-stop":
      return stopClaudeActivityMonitor(payload);
    case "prompt-temp-inspect":
      return inspectClaudePromptTemp(payload);
    case "prompt-temp-sweep":
      return sweepClaudePromptTemp(payload);
    case "settings-plan":
      return planClaudeSettingsAssets(payload);
    case "settings-inspect":
      return inspectClaudeSettingsAssets(payload);
    case "pod-plan":
      return planClaudePodMaterializationOperation(payload);
    case "pod-normalize-observation": {
      const observation = exactObject(
        payload,
        ["plan", "response"],
        [],
        "Pod observation payload",
      );
      return normalizeClaudePodCreationObservation(observation.plan, observation.response);
    }
    case "pod-materialize":
      return executeClaudePodMaterialization(payload, requirePodAdapters(adapters));
    case "decommission-plan":
      return planClaudeWindowDecommission(payload);
    case "decommission-execute": {
      const selected = adapters.decommission === undefined
        ? exactDecommissionHostAdapters()
        : exactObject(
            adapters.decommission,
            ["inspect", "close"],
            ["clock"],
            "Claude decommission facade adapter",
          );
      return executeClaudeWindowDecommission(payload, selected);
    }
    case "decommission-recover": {
      const selected = adapters.decommission === undefined
        ? exactDecommissionHostAdapters()
        : exactObject(
            adapters.decommission,
            ["inspect"],
            ["close", "clock"],
            "Claude decommission recovery facade adapter",
          );
      return recoverClaudeWindowDecommission(payload, {
        inspect: selected.inspect,
        ...(typeof selected.clock === "function" ? { clock: selected.clock } : {}),
      });
    }
    case "activation-scope":
      return inspectClaudeHostActivationScope(payload, adapters.activation);
    default:
      fail("wakeflow-claude-host-command", "unsupported Claude host command");
  }
}

// stdin在读取过程中即执行size+1上限，拒绝请求时不会先把任意长度的pipe完整装入内存。
function readStdinPayload() {
  const buffer = Buffer.alloc(MAX_STDIN_BYTES + 1);
  let length = 0;
  try {
    while (length < buffer.length) {
      const count = readSync(0, buffer, length, buffer.length - length, null);
      if (count === 0) break;
      length += count;
    }
  } catch {
    fail("wakeflow-claude-host-stdin", "cannot read Claude host request from stdin");
  }
  if (length === 0 || length > MAX_STDIN_BYTES) {
    fail("wakeflow-claude-host-stdin", "Claude host request must be between 1 byte and 1 MiB");
  }
  const bytes = buffer.subarray(0, length);
  let text;
  try {
    text = UTF8_FATAL.decode(bytes);
  } catch {
    fail("wakeflow-claude-host-stdin", "Claude host request must be strict UTF-8");
  }
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    fail("wakeflow-claude-host-stdin", "Claude host request must be valid JSON");
  }
  if (!plainObject(payload)) fail("wakeflow-claude-host-stdin", "Claude host request root must be one JSON object");
  return payload;
}

function publicError(command, cause) {
  return {
    ok: false,
    command,
    code: typeof cause?.code === "string" ? cause.code : "wakeflow-claude-host-failed",
    error: typeof cause?.message === "string" && cause.message
      ? cause.message
      : "Claude host command failed closed",
  };
}

async function main() {
  const command = process.argv[2] ?? "";
  if (process.argv.length !== 3) {
    process.stdout.write(`${JSON.stringify(publicError(command, new WakeflowClaudeHostFacadeError(
      "wakeflow-claude-host-argv",
      "usage: wakeflow-claude-host.mjs <closed-command> with one JSON request on stdin",
    )))}\n`);
    process.exitCode = 1;
    return;
  }
  try {
    const result = await routeClaudeHostCommand(command, readStdinPayload());
    process.stdout.write(`${JSON.stringify({ ok: true, command, result })}\n`);
  } catch (cause) {
    process.stdout.write(`${JSON.stringify(publicError(command, cause))}\n`);
    process.exitCode = 1;
  }
}

const direct = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (direct) await main();
