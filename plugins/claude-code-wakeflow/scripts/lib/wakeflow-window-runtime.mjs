import { existsSync } from "node:fs";
import path from "node:path";
import { hostProfile } from "./wakeflow-host-profile.mjs";
import {
  buildWindowDispatchConfig,
  createThreadRegistration,
  normalizeThreadRegistrationRecord,
} from "./wakeflow-thread-registry.mjs";

export function createWindowRuntime(ctx) {
  const {
    workspaceRoot,
    stateDir,
    write,
    hasFlag,
    requireValue,
    nowIso,
    fail,
    output,
    ensureStateDirs,
    atomicWriteJson,
    readJson,
    threadFileFor,
    findThreadFile,
    windowConfigFileFor,
    threadRegistrationVersion,
    windowConfigVersion,
  } = ctx;

  function validateThreadId(value) {
    const threadId = String(value ?? "").trim();
    const placeholders = new Set(hostProfile.handleId.placeholders);
    if (placeholders.has(threadId.toLowerCase())) {
      fail(`--thread-id must be ${hostProfile.handleId.realIdRequirement}, not a placeholder.`);
    }
    if (/\s/.test(threadId)) {
      fail("--thread-id must not contain whitespace.");
    }
    return threadId;
  }

  function readWorkspaceConfig() {
    for (const candidate of [
      path.join(workspaceRoot, ".workspace-local/workspace.config.json"),
      path.join(workspaceRoot, "workspace.config.json"),
    ]) {
      if (existsSync(candidate)) return readJson(candidate, "workspace config");
    }
    return {};
  }

  function repositoryForWindow(windowName) {
    const config = readWorkspaceConfig();
    const repositories = Array.isArray(config.repositories) ? config.repositories : [];
    return {
      config,
      repository: repositories.find((item) => item.windowName === windowName) ?? null,
    };
  }

  function deliveryRoleForWindow(config, windowName) {
    if (windowName === config.controllerWindow) return "controller";
    if (windowName === config.designWindow) return "design";
    if (windowName === config.testWindow) return "test-target";
    return "target";
  }

  function windowRuntimeDescriptor(windowName) {
    const { config, repository } = repositoryForWindow(windowName);
    return {
      config,
      repository,
      deliveryRole: deliveryRoleForWindow(config, windowName),
      cwd: repository?.path,
      responsibilityRoot: repository?.path,
    };
  }

  function formatTargetPrompt({
    targetWindow,
    taskId,
    dispatchGroup,
    stateRef,
  }) {
    if (!stateRef) fail("Target prompts require stateRef from a controller state root.");
    return [
      `Continue current window task: ${targetWindow} / ${taskId}.`,
      "",
      "Variables:",
      `- currentWindow: ${targetWindow}`,
      `- taskId: ${taskId}`,
      `- stateRoot: ${stateRef.stateRoot}`,
      ...(dispatchGroup ? [`- dispatchGroup: ${dispatchGroup}`] : []),
      "- skill: skills/wakeflow-target/SKILL.md",
    ].join("\n");
  }

  function commandRegisterThread() {
    if (!write) fail("register-thread requires --write.");
    const windowName = requireValue("--window");
    const threadId = validateThreadId(requireValue("--thread-id"));
    const registration = createThreadRegistration({
      windowName,
      threadId,
      registeredAt: nowIso(),
      version: threadRegistrationVersion,
    });
    ensureStateDirs();
    atomicWriteJson(threadFileFor(windowName), registration);
    output(
      {
        ok: true,
        command: "register-thread",
        wrote: true,
        windowName,
        threadRegistered: true,
        threadIdRedacted: true,
        registryFile: path.relative(workspaceRoot, threadFileFor(windowName)),
      },
      [hostProfile.texts.registeredHandle(windowName)],
    );
  }

  function loadThreadRegistration(windowName) {
    const file = (findThreadFile ?? threadFileFor)(windowName);
    if (!existsSync(file)) return null;
    const registration = readJson(file, "thread registration");
    try {
      return normalizeThreadRegistrationRecord({
        windowName,
        registration,
        threadRegistryFile: path.relative(stateDir, file),
        version: threadRegistrationVersion,
      });
    } catch (error) {
      fail(error.message);
    }
    return null;
  }

  function redactDeliveryEnvelope(envelope) {
    const redacted = structuredClone(envelope);
    if (redacted.targetThread?.threadId) {
      redacted.targetThread.threadId = "<redacted>";
    }
    return redacted;
  }

  function buildWindowConfig(windowName, { requireThread = false } = {}) {
    const registration = loadThreadRegistration(windowName);
    if (requireThread && !registration) fail(`No registered thread for window: ${windowName}`);
    const { config, repository, deliveryRole, cwd, responsibilityRoot } = windowRuntimeDescriptor(windowName);
    return buildWindowDispatchConfig({
      windowName,
      config,
      repository,
      deliveryRole,
      cwd,
      responsibilityRoot,
      registration,
      threadRegistryFile: path.relative(stateDir, (findThreadFile ?? threadFileFor)(windowName)),
      generatedAt: nowIso(),
      version: windowConfigVersion,
    });
  }

  function commandBuildWindowConfig() {
    const windowName = requireValue("--window");
    const config = buildWindowConfig(windowName, { requireThread: hasFlag("--require-thread") });
    const configFile = windowConfigFileFor(windowName);
    if (write) {
      ensureStateDirs();
      atomicWriteJson(configFile, config);
    }
    output(
      {
        ok: true,
        command: "build-window-config",
        wrote: write,
        windowName,
        config,
        configFile: write ? path.relative(workspaceRoot, configFile) : "",
      },
      [
        `${write ? "Created" : "Would create"} window config for ${windowName}.`,
        `Thread: ${config.threadRegistered ? "registered" : "missing"}`,
        `Dispatchable: ${config.dispatchable ? "yes" : "no"}`,
      ],
    );
  }

  return {
    readWorkspaceConfig,
    formatTargetPrompt,
    commandRegisterThread,
    loadThreadRegistration,
    redactDeliveryEnvelope,
    buildWindowConfig,
    commandBuildWindowConfig,
  };
}
