#!/usr/bin/env node
// 此文件由 Wakeflow 插件制品构建器生成，禁止手工修改。
import { randomUUID } from "node:crypto";
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
  const server = await import("../lib/entrypoints/claude-code-wakeflow-mcp.js");
  if (typeof server.runClaudeCodeWakeflowMcpStdio !== "function") throw new TypeError("runClaudeCodeWakeflowMcpStdio");
  await server.runClaudeCodeWakeflowMcpStdio("1.1.0-rc.5");
} catch (error) {
  reportIncident("launcher", error);
}
