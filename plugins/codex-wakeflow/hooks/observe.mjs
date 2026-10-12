#!/usr/bin/env node
// 此文件由 Wakeflow 插件制品构建器生成，禁止手工修改。
process.exitCode = 0;
let reported = false;
function launcherGuard() {
  reportFixedCode("internal");
}
function removeLauncherGuards() {
  process.off("uncaughtException", launcherGuard);
  process.off("unhandledRejection", launcherGuard);
}
// 只报一次，并且报完仍留着守卫：第二次故障不能落到 Node 默认处理器（会打出带路径的堆栈并以非 0 退出）。
function reportFixedCode(code) {
  if (reported) return;
  reported = true;
  try {
    process.stderr.write("wakeflow-hook-observer: " + code + "\n");
  } catch {
    // stderr 不可用时也不改变退出码。
  }
  process.exitCode = 0;
}
process.on("uncaughtException", launcherGuard);
process.on("unhandledRejection", launcherGuard);
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
// 范围外的 Node 只打一行固定代码（D4 的词汇表里有 node-version），不 import 观察器，退出码仍为 0。
if (!wakeflowNodeSupported()) {
  reportFixedCode("node-version");
} else {
  try {
    const observer = await import("../lib/entrypoints/wakeflow-hook-observer.js");
    if (typeof observer.main !== "function") throw new TypeError("main");
    removeLauncherGuards();
    await observer.main();
  } catch {
    reportFixedCode("launcher");
  }
}
process.exitCode = 0;
