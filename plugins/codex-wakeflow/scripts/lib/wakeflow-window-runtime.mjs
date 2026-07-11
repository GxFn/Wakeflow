import { existsSync } from "node:fs";
import path from "node:path";
import { hostProfile } from "./wakeflow-host-profile.mjs";
import {
  buildWindowDispatchConfig,
  createThreadRegistration,
  normalizeThreadRegistrationRecord,
} from "./wakeflow-thread-registry.mjs";
import { loadWorkspaceConfig, testWindowNames } from "./wakeflow-config.mjs";

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
    // The shared loader keeps the overlay-first path preference AND derives
    // the window-list views (dispatchWindows/requiredDispatchWindows/
    // repoNames/repositoryRoles) from repositories[], so slim tracked configs
    // resolve exactly like the old fat ones.
    return loadWorkspaceConfig({ workspaceRoot, args: [] });
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
    if (testWindowNames(config).includes(windowName)) return "test-target";
    // Demand pods: Controller__<pod> IS a controller; a pod-suffixed test
    // window (Test__<pod>) inherits its base window's role.
    const podBase = podBaseWindow(windowName);
    if (podBase === "Controller") return "controller";
    if (podBase && testWindowNames(config).includes(podBase)) return "test-target";
    return "target";
  }

  // Demand pods create runtime windows the tracked config never lists:
  // Controller__<pod> and Test__<pod> (isolation work windows land in the
  // derived overlay instead). `<base>__<suffix>` with a configured base — or
  // the literal Controller role prefix — is the pod shape.
  function podBaseWindow(windowName) {
    const marker = windowName.indexOf("__");
    return marker > 0 ? windowName.slice(0, marker) : null;
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
    interfaceLanguage = "en",
    craftSkill = false,
    testExecution = false,
  }) {
    if (!stateRef) fail("Target prompts require stateRef from a controller state root.");
    // Human-readable sentences follow the demand interfaceLanguage so the
    // target window answers in the workspace language; machine variable KEYS
    // (currentWindow/taskId/stateRoot/dispatchGroup/skill) stay English by
    // contract.
    const zh = interfaceLanguage === "zh";
    return [
      zh
        ? `\u7ee7\u7eed\u5f53\u524d\u7a97\u53e3\u4efb\u52a1\uff1a${targetWindow} / ${taskId}\u3002`
        : `Continue current window task: ${targetWindow} / ${taskId}.`,
      "",
      zh ? "\u53d8\u91cf\uff1a" : "Variables:",
      `- currentWindow: ${targetWindow}`,
      `- taskId: ${taskId}`,
      `- stateRoot: ${stateRef.stateRoot}`,
      ...(dispatchGroup ? [`- dispatchGroup: ${dispatchGroup}`] : []),
      "- skill: skills/wakeflow-target/SKILL.md",
      // Activation chain for the execution-craft skill: only when the task package
      // carries an evidence contract (zero traces otherwise — reminder-first). The
      // wake prompt is the one surface a target is GUARANTEED to read; a craft gate
      // whose skill never activates would fail the target at reduce time.
      ...(craftSkill ? ["- craftSkill: skills/wakeflow-target-craft/SKILL.md"] : []),
      ...(testExecution ? [`- testContract: task-packages/${stateRef.taskPackageId}.json#testExecution`] : []),
    ].join("\n");
  }

  function commandRegisterThread() {
    const windowName = requireValue("--window");
    const threadId = validateThreadId(requireValue("--thread-id"));
    const descriptor = windowRuntimeDescriptor(windowName);
    const configuredWindows = new Set([
      descriptor.config.controllerWindow,
      descriptor.config.designWindow,
      ...testWindowNames(descriptor.config),
      ...(Array.isArray(descriptor.config.repositories)
        ? descriptor.config.repositories.map((item) => item?.windowName)
        : []),
    ].filter(Boolean));
    // Pod fleets must survive reboots through the registry exactly like main
    // windows: accept Controller__<pod> and <configured-base>__<pod> (stream
    // windows arrive here via their derived-overlay repositories[] entry).
    const podBase = podBaseWindow(windowName);
    const podShaped = Boolean(podBase) && (podBase === "Controller" || configuredWindows.has(podBase));
    if (!configuredWindows.has(windowName) && !podShaped) {
      fail(`Window is not configured in wakeflow.config.json: ${windowName}`);
    }
    const registryFile = threadFileFor(windowName);
    const previousRegistryFile = (findThreadFile ?? threadFileFor)(windowName);
    const replacedExistingThread = existsSync(previousRegistryFile);
    const registration = createThreadRegistration({
      windowName,
      threadId,
      registeredAt: nowIso(),
      version: threadRegistrationVersion,
    });
    const configFile = windowConfigFileFor(windowName);
    const config = buildWindowDispatchConfig({
      windowName,
      config: descriptor.config,
      repository: descriptor.repository,
      deliveryRole: descriptor.deliveryRole,
      cwd: descriptor.cwd,
      responsibilityRoot: descriptor.responsibilityRoot,
      registration,
      threadRegistryFile: path.relative(stateDir, registryFile),
      generatedAt: nowIso(),
      version: windowConfigVersion,
    });
    if (write) {
      ensureStateDirs();
      atomicWriteJson(registryFile, registration);
      atomicWriteJson(configFile, config);
    }
    output(
      {
        ok: true,
        command: "register-thread",
        wrote: write,
        windowName,
        threadRegistered: write,
        registrationValid: true,
        replacedExistingThread,
        threadIdRedacted: true,
        windowHandleRedacted: true,
        registryFile: path.relative(workspaceRoot, registryFile),
        windowConfigFile: path.relative(workspaceRoot, configFile),
        windowConfigWritten: write,
      },
      [write ? hostProfile.texts.registeredHandle(windowName) : `Would register ${windowName}.`],
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
