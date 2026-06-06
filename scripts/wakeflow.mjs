#!/usr/bin/env node

import {
  addTask,
  initDemand,
  prepareDelivery,
  recordDelivery,
  review,
  status,
  submitResult,
} from "../lib/wakeflow-state.mjs";

const rawArgs = process.argv.slice(2);
const command = rawArgs[0] && !rawArgs[0].startsWith("--") ? rawArgs[0] : "status";
const options = rawArgs[0] && !rawArgs[0].startsWith("--") ? rawArgs.slice(1) : rawArgs;
const write = hasFlag("--write");
const json = hasFlag("--json");

function hasFlag(name) {
  return options.includes(name);
}

function getValue(name, fallback = undefined) {
  const eq = options.find((arg) => arg.startsWith(`${name}=`));
  if (eq) return eq.slice(name.length + 1);
  const index = options.indexOf(name);
  if (index >= 0 && options[index + 1] && !options[index + 1].startsWith("--")) {
    return options[index + 1];
  }
  return fallback;
}

function getAllValues(name) {
  const values = [];
  for (let index = 0; index < options.length; index += 1) {
    const option = options[index];
    if (option === name && options[index + 1] && !options[index + 1].startsWith("--")) {
      values.push(options[index + 1]);
      index += 1;
    } else if (option.startsWith(`${name}=`)) {
      values.push(option.slice(name.length + 1));
    }
  }
  return values;
}

function output(payload) {
  const complete = {
    scriptComplete: true,
    command,
    ...payload,
  };
  if (json) {
    console.log(JSON.stringify(complete, null, 2));
    return;
  }
  if (!complete.ok) {
    console.error(`Wakeflow ${command} failed: ${complete.error}`);
    return;
  }
  console.log(`Wakeflow ${command}: ok`);
  if (complete.stateRoot) console.log(`stateRoot: ${complete.stateRoot}`);
  if (complete.intent?.prompt) console.log(`prompt:\n${complete.intent.prompt}`);
  if (complete.agentNext) console.log(`agentNext: ${complete.agentNext}`);
}

function root() {
  return getValue("--root", process.cwd());
}

try {
  let result;
  if (command === "status") {
    result = status({ root: root() });
  } else if (command === "init") {
    result = initDemand({
      root: root(),
      demandKey: getValue("--demand-key"),
      title: getValue("--title"),
      goal: getValue("--goal"),
      completionDefinition: getValue("--completion-definition"),
      controllerWindow: getValue("--controller-window", "controller"),
      write,
    });
  } else if (command === "add-task") {
    result = addTask({
      root: root(),
      stateRoot: getValue("--state-root"),
      taskId: getValue("--task-id"),
      targetWindow: getValue("--target-window"),
      summary: getValue("--summary"),
      packageId: getValue("--package-id"),
      write,
    });
  } else if (command === "prepare-delivery") {
    result = prepareDelivery({
      root: root(),
      stateRoot: getValue("--state-root"),
      taskId: getValue("--task-id"),
      dispatchGroup: getValue("--dispatch-group"),
      controllerWindow: getValue("--controller-window"),
      write,
    });
  } else if (command === "record-delivery") {
    result = recordDelivery({
      root: root(),
      stateRoot: getValue("--state-root"),
      deliveryId: getValue("--delivery-id"),
      status: getValue("--status"),
      evidence: getValue("--evidence", ""),
      write,
    });
  } else if (command === "submit-result") {
    result = submitResult({
      root: root(),
      stateRoot: getValue("--state-root"),
      taskId: getValue("--task-id"),
      targetWindow: getValue("--target-window"),
      status: getValue("--status"),
      summary: getValue("--summary", ""),
      evidenceRefs: getAllValues("--evidence-ref"),
      write,
    });
  } else if (command === "review") {
    result = review({
      root: root(),
      stateRoot: getValue("--state-root"),
    });
  } else {
    throw new Error(`Unknown command: ${command}`);
  }
  output(result);
} catch (error) {
  output({ ok: false, error: error.message });
  process.exitCode = 1;
}
