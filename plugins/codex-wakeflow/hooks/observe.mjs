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
try {
  const observer = await import("../lib/entrypoints/wakeflow-hook-observer.js");
  if (typeof observer.main !== "function") throw new TypeError("main");
  removeLauncherGuards();
  await observer.main();
} catch {
  reportFixedCode("launcher");
}
process.exitCode = 0;
