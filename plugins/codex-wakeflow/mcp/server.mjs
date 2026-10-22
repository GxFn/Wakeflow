#!/usr/bin/env node
// 此文件由 Wakeflow 插件制品构建器生成，禁止手工修改。
import { randomUUID } from "node:crypto";
const WAKEFLOW_NODE_ENGINES = ">=24.19.0 <25";
function wakeflowNodeSupported() {
  const parts = /^v?(\d+)\.(\d+)\.(\d+)/u.exec(process.versions.node);
  if (parts === null) return false;
  const [major, minor, patch] = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
  if (major >= 25) return false;
  if (major !== 24) return major > 24;
  if (minor !== 19) return minor > 19;
  return patch >= 0;
}
if (!wakeflowNodeSupported()) {
  try {
    process.stderr.write("wakeflow: node " + process.versions.node + " is outside the supported range " + WAKEFLOW_NODE_ENGINES + "\n");
  } catch {
    // stderr 不可用时退出码仍说明问题。
  }
  process.exit(1);
}
let reported = false;
function reportIncident(stage, error) {
  if (reported) return;
  reported = true;
  const name = error !== null && typeof error === "object" && typeof error.name === "string" ? error.name : "unknown";
  try {
    process.stderr.write("wakeflow: incident incident_" + randomUUID() + " (" + stage + ": " + name + ")\n");
  } catch {
    // stderr 不可用时也不改变退出码。
  }
  process.exit(1);
}
process.on("uncaughtException", (error) => reportIncident("uncaught-exception", error));
process.on("unhandledRejection", (error) => reportIncident("unhandled-rejection", error));
try {
  const server = await import("../lib/entrypoints/codex-wakeflow-mcp.js");
  if (typeof server.runCodexWakeflowMcpStdio !== "function") throw new TypeError("runCodexWakeflowMcpStdio");
  await server.runCodexWakeflowMcpStdio("1.2.0");
} catch (error) {
  reportIncident("launcher", error);
}
