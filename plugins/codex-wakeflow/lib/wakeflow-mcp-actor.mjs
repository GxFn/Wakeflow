import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import path from "node:path";

const APPLY_ONLY_TOOLS = new Set([
  "wakeflow_initialize_workspace",
  "wakeflow_register_window",
  "wakeflow_adopt_demand_host",
  "wakeflow_render_progress",
  "wakeflow_release_window_lock",
  "wakeflow_view",
  "wakeflow_reduce_results",
  "wakeflow_decide_review",
  "wakeflow_complete_demand",
  "wakeflow_archive",
  "wakeflow_intake_test_card",
  "wakeflow_deliver",
  "wakeflow_next_work",
  "wakeflow_claim_next",
  "wakeflow_create_demand",
  "wakeflow_cancel_demand",
  "wakeflow_prune_runtime",
]);

const ALWAYS_WRITE_TOOLS = new Set([
  "wakeflow_add_task",
  "wakeflow_prepare_delivery",
  "wakeflow_record_delivery",
  "wakeflow_record_target_result",
  "wakeflow_pod_open",
  "wakeflow_pod_close",
]);

const CONTROLLER_TOOLS = new Set([
  "wakeflow_initialize_workspace",
  "wakeflow_register_window",
  "wakeflow_adopt_demand_host",
  "wakeflow_render_progress",
  "wakeflow_release_window_lock",
  "wakeflow_add_task",
  "wakeflow_reduce_results",
  "wakeflow_decide_review",
  "wakeflow_complete_demand",
  "wakeflow_archive",
  "wakeflow_intake_test_card",
  "wakeflow_next_work",
  "wakeflow_claim_next",
  "wakeflow_create_demand",
  "wakeflow_cancel_demand",
  "wakeflow_pod_open",
  "wakeflow_pod_close",
  "wakeflow_prune_runtime",
]);

export function authorizeMcpToolCall({
  toolName,
  args = {},
  context = {},
  defaultRoot,
  hostProfile,
} = {}) {
  if (!context.enforceActor || !requiresActorAuthorization(toolName, args)) {
    return { enforced: false };
  }

  const workspaceRoot = resolveWorkspaceRoot({ args, defaultRoot, context });
  const config = readWorkspaceConfig(workspaceRoot);
  if (!config) {
    // A first installation has no role map or registry yet. Setup remains the
    // bootstrap authority; normal managed-workspace writes are guarded once
    // wakeflow.config.json exists.
    return { enforced: false, bootstrap: true };
  }

  const inventory = readActorInventory({ workspaceRoot, config, hostProfile });
  if (toolName === "wakeflow_register_window" && inventory.registrationCount === 0) {
    if (args.window !== config.controllerWindow) {
      failAuthorization(
        toolName,
        `an empty registry may bootstrap only by registering controller ${config.controllerWindow} first`,
      );
    }
    return safeActorResult(actorForWindow(config.controllerWindow, config, "controller-self-bootstrap"));
  }
  const actor = resolveActor({
    callerHandle: context.callerHandle,
    callerProjectDir: context.callerProjectDir,
    inventory,
    workspaceRoot,
    config,
  });
  if (!actor) {
    failAuthorization(toolName, "caller is not a registered Wakeflow window in this workspace");
  }

  if (toolName === "wakeflow_deliver") {
    requireWindow(toolName, actor, config.designWindow, "Design");
    return safeActorResult(actor);
  }

  if (toolName === "wakeflow_record_target_result") {
    requireWindow(toolName, actor, args.targetWindow, "the result target");
    return safeActorResult(actor);
  }

  if (toolName === "wakeflow_prepare_delivery") {
    if (args.direction === "controller-return") {
      requireWindow(toolName, actor, args.triggerTarget, "the controller-return trigger target");
    } else {
      requireController(toolName, actor, expectedControllerWindow({ workspaceRoot, config, args }));
    }
    return safeActorResult(actor);
  }

  if (toolName === "wakeflow_record_delivery") {
    const envelope = readWorkspaceJson(workspaceRoot, args.deliveryFile, "delivery envelope");
    if (envelope.kind === "ControllerReturnEnvelope") {
      requireWindow(toolName, actor, envelope.triggerTarget, "the controller-return trigger target");
    } else {
      requireController(toolName, actor, expectedControllerWindow({
        workspaceRoot,
        config,
        args: { ...args, stateRoot: envelope.stateRef?.stateRoot, controllerWindow: envelope.controllerWindow },
      }));
    }
    return safeActorResult(actor);
  }

  if (toolName === "wakeflow_view") {
    requireController(toolName, actor, expectedControllerWindow({ workspaceRoot, config, args }));
    return safeActorResult(actor);
  }

  if (CONTROLLER_TOOLS.has(toolName)) {
    requireController(toolName, actor, expectedControllerWindow({ workspaceRoot, config, args }));
    return safeActorResult(actor);
  }

  return safeActorResult(actor);
}

function requiresActorAuthorization(toolName, args) {
  if (ALWAYS_WRITE_TOOLS.has(toolName)) return true;
  if (APPLY_ONLY_TOOLS.has(toolName)) return Boolean(args.apply);
  return false;
}

function resolveWorkspaceRoot({ args, defaultRoot, context }) {
  const candidate = args.root || defaultRoot || workspaceRootFromArtifact(args.deliveryFile) || context.callerProjectDir;
  if (!candidate) {
    throw new Error("Wakeflow actor authorization requires a workspace root.");
  }
  return path.resolve(candidate);
}

function workspaceRootFromArtifact(value) {
  if (!value || !path.isAbsolute(value)) return "";
  const normalized = path.normalize(value);
  for (const marker of [`.wakeflow-local${path.sep}`, `.wakeflow-active${path.sep}`]) {
    const index = normalized.indexOf(marker);
    if (index > 0) return normalized.slice(0, index - 1);
  }
  return "";
}

function readWorkspaceConfig(workspaceRoot) {
  for (const name of ["wakeflow.config.json", "workspace.config.json"]) {
    const file = path.join(workspaceRoot, name);
    if (!existsSync(file)) continue;
    return JSON.parse(readFileSync(file, "utf8"));
  }
  return null;
}

function readActorInventory({ workspaceRoot, config, hostProfile }) {
  const hostDir = hostProfile?.runtime?.hostDirName || "codex";
  const runtimeRoot = path.join(workspaceRoot, ".wakeflow-local/wakeflow-delivery/hosts", hostDir);
  const registrations = readJsonDirectory(path.join(runtimeRoot, "thread-registry"))
    .filter((value) => value.windowName && value.threadId);
  const windowConfigs = readJsonDirectory(path.join(runtimeRoot, "window-config"));
  return {
    registrations,
    registrationCount: registrations.length,
    windowConfigs,
    config,
  };
}

function readJsonDirectory(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .flatMap((name) => {
      try {
        return [JSON.parse(readFileSync(path.join(dir, name), "utf8"))];
      } catch {
        return [];
      }
    });
}

function resolveActor({ callerHandle, callerProjectDir, inventory, workspaceRoot, config }) {
  if (callerHandle) {
    const matches = inventory.registrations.filter((item) => item.threadId === callerHandle);
    if (matches.length === 1) return actorForWindow(matches[0].windowName, config, "registered-handle");
    if (matches.length > 1) return null;
    // A host-supplied handle is stronger than cwd. Never let an unregistered
    // handle borrow another window's cwd identity.
    return null;
  }

  if (!callerProjectDir) return null;
  const callerPath = canonicalPath(callerProjectDir);
  if (callerPath === canonicalPath(workspaceRoot)) {
    return actorForWindow(config.controllerWindow, config, "workspace-cwd");
  }

  const configured = [
    ...(Array.isArray(config.repositories) ? config.repositories : []),
    ...(config.internalDesignPath ? [{ windowName: config.designWindow, path: config.internalDesignPath }] : []),
    ...(config.internalTestPath ? [{ windowName: config.testWindow, path: config.internalTestPath }] : []),
  ];
  for (const entry of configured) {
    if (!entry?.windowName || !entry?.path) continue;
    if (callerPath === canonicalPath(path.resolve(workspaceRoot, entry.path))) {
      return actorForWindow(entry.windowName, config, "configured-cwd");
    }
  }

  for (const value of inventory.windowConfigs) {
    for (const field of ["cwd", "repositoryPath", "responsibilityRoot"]) {
      if (!value?.[field]) continue;
      if (callerPath === canonicalPath(path.resolve(workspaceRoot, value[field]))) {
        return actorForWindow(value.windowName, config, "derived-window-cwd");
      }
    }
  }
  return null;
}

function actorForWindow(windowName, config, source) {
  if (!windowName) return null;
  const role = windowName === config.controllerWindow || windowName.startsWith("Controller__")
    ? "controller"
    : windowName === config.designWindow
      ? "design"
      : windowName === config.testWindow || windowName.startsWith(`${config.testWindow || "Test"}__`)
        ? "test"
        : "target";
  return { windowName, role, source };
}

function expectedControllerWindow({ workspaceRoot, config, args }) {
  const stateRoot = args.stateRoot || stateRootForDemand(workspaceRoot, args.demandKey);
  if (stateRoot) {
    const state = readWorkspaceJson(workspaceRoot, path.join(stateRoot, "wakeflow-state.json"), "demand state");
    if (state.controllerWindow) return state.controllerWindow;
  }
  return args.controllerWindow || config.controllerWindow;
}

function stateRootForDemand(workspaceRoot, demandKey) {
  if (!demandKey) return "";
  const candidate = path.join(".wakeflow-active/current", demandKey);
  return existsSync(path.join(workspaceRoot, candidate, "wakeflow-state.json")) ? candidate : "";
}

function readWorkspaceJson(workspaceRoot, input, label) {
  if (!input) throw new Error(`Wakeflow actor authorization requires ${label}.`);
  const file = path.isAbsolute(input) ? path.resolve(input) : path.resolve(workspaceRoot, input);
  const relative = path.relative(workspaceRoot, file);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Wakeflow actor authorization refuses ${label} outside the workspace.`);
  }
  if (!existsSync(file)) throw new Error(`Wakeflow actor authorization cannot read ${label}.`);
  return JSON.parse(readFileSync(file, "utf8"));
}

function requireController(toolName, actor, controllerWindow) {
  requireWindow(toolName, actor, controllerWindow, "the demand controller");
}

function requireWindow(toolName, actor, expectedWindow, expectedRole) {
  if (!expectedWindow || actor.windowName !== expectedWindow) {
    failAuthorization(
      toolName,
      `caller window ${actor.windowName} is ${actor.role}; required ${expectedRole}${expectedWindow ? ` ${expectedWindow}` : ""}`,
    );
  }
}

function failAuthorization(toolName, reason) {
  throw new Error(`Wakeflow actor authorization failed for ${toolName}: ${reason}.`);
}

function safeActorResult(actor) {
  return {
    enforced: true,
    actorWindow: actor.windowName,
    actorRole: actor.role,
    actorSource: actor.source,
  };
}

function canonicalPath(value) {
  const absolute = path.resolve(value);
  try {
    return realpathSync(absolute);
  } catch {
    return absolute;
  }
}
