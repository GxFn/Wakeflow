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
    objective = "",
    taskBriefing = null,
    interfaceLanguage = "en",
    craftSkill = false,
    testExecution = false,
    acceptanceAnchors = false,
  }) {
    if (!stateRef) fail("Target prompts require stateRef from a controller state root.");
    const zh = interfaceLanguage === "zh";
    const cleanLine = (value, limit = 240) => {
      const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
      return normalized.length > limit
        ? `${normalized.slice(0, Math.max(1, limit - 1)).trimEnd()}…`
        : normalized;
    };
    const lines = (value, limit = 3) => (Array.isArray(value) ? value : [])
      .map((item) => cleanLine(item, 200))
      .filter(Boolean)
      .slice(0, limit);
    const briefing = taskBriefing && typeof taskBriefing === "object" ? taskBriefing : {};
    const promptObjective = cleanLine(briefing.objective || objective || `Complete ${taskId}.`);
    const completionExpectations = lines(briefing.completionExpectations, 4);
    const contextSummary = lines(briefing.contextSummary, 3);
    const requirementRefs = (Array.isArray(briefing.requirementRefs) ? briefing.requirementRefs : [])
      .filter((item) => item && typeof item === "object" && item.ref)
      .slice(0, 4);
    const boundaries = briefing.boundaries && typeof briefing.boundaries === "object"
      ? briefing.boundaries
      : {};
    const inScope = lines(boundaries.inScope, 3);
    const outOfScope = lines(boundaries.outOfScope, 2);
    const forbidden = lines(boundaries.forbidden, 2);
    const anchors = (Array.isArray(briefing.acceptanceAnchors) ? briefing.acceptanceAnchors : [])
      .filter((item) => item && typeof item === "object")
      .slice(0, 4);
    const requiredSkills = (Array.isArray(briefing.requiredSkills) && briefing.requiredSkills.length > 0)
      ? briefing.requiredSkills
      : [
          "skills/wakeflow-target/SKILL.md",
          ...(craftSkill ? ["skills/wakeflow-target-craft/SKILL.md"] : []),
        ];
    const taskPackageRef = briefing.taskPackageRef
      || `task-packages/${stateRef.taskPackageId}.json`;
    const repositoryRoot = cleanLine(briefing.repositoryRoot, 500);
    const repositoryInstructions = repositoryRoot
      ? path.join(repositoryRoot, hostProfile.memoryFile)
      : hostProfile.memoryFile;
    const commitExpectation = briefing.commitExpectation === "commit"
      ? (zh ? "\u63d0\u4ea4\u672c\u4efb\u52a1\u8303\u56f4\u5185\u7684\u4ed3\u5e93\u6539\u52a8\u540e\u518d\u56de\u4f20\u3002" : "Commit the repository changes in this task's scope before returning.")
      : briefing.commitExpectation === "leave-uncommitted"
        ? (zh ? "\u4fdd\u7559\u672c\u4efb\u52a1\u6539\u52a8\u4e3a\u672a\u63d0\u4ea4\u72b6\u6001\uff0c\u7531\u603b\u63a7\u51b3\u5b9a\u540e\u7eed\u63d0\u4ea4\u3002" : "Leave this task's changes uncommitted for controller handling.")
        : "";
    return [
      zh
        ? `\u7ee7\u7eed\u5f53\u524d\u7a97\u53e3\u4efb\u52a1\uff1a${targetWindow} / ${taskId}\u3002`
        : `Continue current window task: ${targetWindow} / ${taskId}.`,
      "",
      zh ? "\u672c\u8f6e\u76ee\u6807\uff08\u4ee5\u4efb\u52a1\u5305\u4e3a\u6743\u5a01\uff09\uff1a" : "Current objective (the task package is authoritative):",
      `- ${promptObjective}`,
      "",
      ...(completionExpectations.length > 0
        ? [
            zh ? "\u5b8c\u6210\u9884\u671f\uff1a" : "Completion expectations:",
            ...completionExpectations.map((item) => `- ${item}`),
            "",
          ]
        : []),
      ...(anchors.length > 0
        ? [
            zh ? "\u5173\u952e\u9a8c\u6536\u951a\u70b9\uff08\u5b8c\u6574\u63a2\u9488\u548c\u671f\u671b\u89c1\u4efb\u52a1\u5305\uff09\uff1a" : "Key acceptance anchors (full probes and expectations are in the task package):",
            ...anchors.map((anchor) => `- ${cleanLine(anchor.id, 80)}: ${cleanLine(anchor.claim, 180)}`),
            "",
          ]
        : []),
      ...(contextSummary.length > 0
        ? [
            zh ? "\u5df2\u786e\u8ba4\u4e0a\u4e0b\u6587\uff1a" : "Confirmed context:",
            ...contextSummary.map((item) => `- ${item}`),
            "",
          ]
        : []),
      zh ? "\u5f00\u59cb\u524d\u6309\u987a\u5e8f\u8bfb\u53d6\uff1a" : "Read before execution, in order:",
      `- ${zh ? "\u4efb\u52a1\u5305\uff08\u672c\u4efb\u52a1\u5b8c\u6574\u4e0a\u4e0b\u6587\uff09" : "Task package (complete task context)"}: ${taskPackageRef}`,
      ...requirementRefs.map((entry) => `- ${zh ? "\u9700\u6c42\u80cc\u666f\u951a\u70b9" : "Requirement background anchor"} [${entry.role}]: ${entry.resolvedRef || entry.ref}`),
      `- ${zh ? "\u4ed3\u5e93\u6307\u4ee4" : "Repository instructions"}: ${repositoryInstructions}`,
      "",
      zh ? "\u5fc5\u987b\u52a0\u8f7d\u7684\u6267\u884c Skills\uff08\u6267\u884c\u6d41\u7a0b\u6743\u5a01\uff09\uff1a" : "Required execution Skills (execution-process authority):",
      ...requiredSkills.map((skill) => `- ${skill}`),
      "",
      zh ? "\u4fe1\u606f\u5206\u5de5\uff1a" : "Authority by purpose:",
      ...(zh
        ? [
            "- \u672c\u63d0\u793a\u8bcd\uff1a\u672c\u8f6e\u76ee\u6807\u3001\u8bfb\u53d6\u987a\u5e8f\u4e0e\u56de\u4f20\u8981\u6c42\u3002",
            "- \u4efb\u52a1\u5305\uff1a\u5b8c\u6574\u4efb\u52a1\u4e0a\u4e0b\u6587\u3001\u8fb9\u754c\u3001\u5b8c\u6210\u9884\u671f\u548c\u9a8c\u6536\u951a\u70b9\u3002",
            "- \u9700\u6c42\u6587\u6863\u951a\u70b9\uff1a\u539f\u59cb\u76ee\u6807\u4e0e\u80cc\u666f\uff0c\u4e0d\u662f\u65b0\u7684\u6267\u884c\u6d41\u7a0b\u3002",
            "- Skills\uff1a\u5177\u4f53\u6267\u884c\u5de5\u827a\uff1b\u4e0d\u5f97\u501f\u5de5\u827a\u6269\u5199\u9700\u6c42\u3002",
          ]
        : [
            "- This prompt: the current objective, reading order, and return requirement.",
            "- Task package: complete task context, boundaries, completion expectations, and acceptance anchors.",
            "- Requirement anchors: original goals and background, not a new execution plan.",
            "- Skills: execution procedure; never use procedure to expand the requirement.",
          ]),
      "",
      zh ? "\u8eab\u4efd\u4e0e\u8fb9\u754c\uff1a" : "Identity and boundaries:",
      `- ${zh ? "\u5f53\u524d\u804c\u8d23\u7a97\u53e3" : "Current responsibility window"}: ${targetWindow}`,
      ...(repositoryRoot ? [`- ${zh ? "\u552f\u4e00\u5de5\u4f5c\u4ed3\u5e93" : "Only working repository"}: ${repositoryRoot}`] : []),
      ...inScope.map((item) => `- ${zh ? "\u8303\u56f4\u5185" : "In scope"}: ${item}`),
      ...outOfScope.map((item) => `- ${zh ? "\u8303\u56f4\u5916" : "Out of scope"}: ${item}`),
      ...forbidden.map((item) => `- ${zh ? "\u7981\u6b62" : "Forbidden"}: ${item}`),
      ...(commitExpectation ? [`- ${commitExpectation}`] : []),
      "",
      ...(acceptanceAnchors
        ? [
            zh
              ? "\u7f16\u7801\u524d\uff1a\u5c06\u4efb\u52a1\u5305\u4e2d\u7684\u6bcf\u4e2a acceptanceAnchor \u6620\u5c04\u4e3a RED \u6d4b\u8bd5\u6216\u63a2\u9488\uff1b\u65e0\u6cd5\u9a8c\u8bc1\u65f6\u56de\u4f20 needs-review\uff0c\u4e0d\u5f97\u81ea\u884c\u8865\u5145\u9700\u6c42\u3002"
              : "Before coding: read the assigned task package and map every acceptanceAnchor to a RED test or probe before implementation; return needs-review instead of inventing requirements when an anchor is untestable.",
            "",
          ]
        : []),
      zh ? "\u56de\u4f20\u8981\u6c42\uff1a" : "Return requirement:",
      zh
        ? "- \u4ec5\u6267\u884c\u8be5\u4efb\u52a1\u5305\uff1b\u5b8c\u6210\u540e\u6309 wakeflow-target Skill \u56de\u4f20 TargetResultEnvelope \u4e0e\u53ef\u6838\u9a8c\u8bc1\u636e\u3002Target \u7ed3\u679c\u4e0d\u662f\u603b\u63a7\u9a8c\u6536\u3002"
        : "- Execute only this task package. Return a TargetResultEnvelope with verifiable evidence through the wakeflow-target skill. A target result is not controller acceptance.",
      ...(testExecution ? [`- ${zh ? "Test \u6267\u884c\u5951\u7ea6" : "Test execution contract"}: ${taskPackageRef}#testExecution`] : []),
      "",
      zh ? "\u6d3e\u53d1\u8bb0\u5f55\uff08\u4ec5\u7528\u4e8e\u8def\u7531\u4e0e\u8ffd\u8e2a\uff09\uff1a" : "Dispatch record (routing and trace only):",
      `- taskId: ${taskId}`,
      `- taskPackageId: ${stateRef.taskPackageId}`,
      `- stateRoot: ${stateRef.stateRoot}`,
      `- stateRevision: ${stateRef.stateRevision}`,
      ...(dispatchGroup ? [`- dispatchGroup: ${dispatchGroup}`] : []),
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
