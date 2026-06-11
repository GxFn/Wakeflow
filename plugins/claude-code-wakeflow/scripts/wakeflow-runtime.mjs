#!/usr/bin/env node

import { listWakeflowRuntimeScripts, runWakeflowRuntime } from "../lib/wakeflow-runtime.mjs";

const parsed = takeValueOption(process.argv.slice(2), "--wakeflow-cwd");
const args = parsed.args;
const cwd = parsed.value || process.cwd();
const command = args[0] && !args[0].startsWith("--") ? args[0] : "list";
const scriptArgs = command === "list" ? [] : args.slice(1);
const json = args.includes("--wakeflow-json");

try {
  if (command === "list") {
    console.log(JSON.stringify({ ok: true, scripts: listWakeflowRuntimeScripts() }, null, 2));
  } else {
    const cleanArgs = scriptArgs.filter((arg) => arg !== "--wakeflow-json");
    const result = await runWakeflowRuntime({ script: command, args: cleanArgs, cwd });
    if (json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      process.stdout.write(result.stdout);
      process.stderr.write(result.stderr);
    }
    if (!result.ok) process.exitCode = result.exitCode || 1;
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

function takeValueOption(inputArgs, name) {
  const out = [];
  let value = null;
  for (let index = 0; index < inputArgs.length; index += 1) {
    const arg = inputArgs[index];
    if (arg === name) {
      value = inputArgs[index + 1] || null;
      index += 1;
    } else if (arg.startsWith(`${name}=`)) {
      value = arg.slice(name.length + 1);
    } else {
      out.push(arg);
    }
  }
  return { args: out, value };
}
