import { existsSync, readdirSync, realpathSync } from "node:fs";
import path from "node:path";
import { hostProfile } from "./wakeflow-host-profile.mjs";
import {
  POD_BINDING_KIND,
  POD_OPERATION_KIND,
  contentDigest,
  createPodRuntime,
} from "./wakeflow-pod-runtime.mjs";
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
    getValue,
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
    withFileLock,
    WakeflowStateLockTimeoutError,
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
    if (podBase === config.controllerWindow || podBase === "Controller") return "controller";
    if (podBase === config.designWindow) return "design";
    if (podBase && testWindowNames(config).includes(podBase)) return "test-target";
    return "target";
  }

  // Complete Pods create runtime windows the tracked config never lists.
  // A suffix is only a naming shape; registration still requires a matching
  // host-local launch operation and binding correlation below.
  function podBaseWindow(windowName) {
    const marker = windowName.indexOf("__");
    return marker > 0 ? windowName.slice(0, marker) : null;
  }

  function podRuntime() {
    return createPodRuntime({
      workspaceRoot,
      stateDir,
      host: hostProfile.hostId,
      write: false,
    });
  }

  function activePodBinding(windowName) {
    const runtime = podRuntime();
    const matches = runtime.listBindings()
      .map((entry) => entry.value)
      .filter((binding) => binding?.windowName === windowName && binding?.status === "active");
    if (matches.length > 1) {
      fail(`More than one active Pod binding exists for ${windowName}; repair the host-local binding authority before dispatch.`);
    }
    const binding = matches[0] ?? null;
    if (!binding) return null;
    if (
      binding.kind !== POD_BINDING_KIND
      || binding.host !== hostProfile.hostId
      || !binding.podId
      || !binding.demandKey
      || !binding.launchCorrelationId
      || !binding.bindingId
      || !binding.receipt
      || binding.receiptDigest !== contentDigest(binding.receipt)
    ) {
      fail(`Active Pod binding for ${windowName} is incomplete or has a mismatched receipt digest.`);
    }
    const manifest = runtime.readManifest(binding.podId);
    const operation = runtime.readOperation(binding.launchCorrelationId);
    if (
      !manifest
      || manifest.host !== hostProfile.hostId
      || manifest.demandKey !== binding.demandKey
      || !manifest.operationIds?.includes(binding.launchCorrelationId)
      || !operation
      || operation.kind !== POD_OPERATION_KIND
      || operation.operationType !== "launch"
      || operation.status !== "bound"
      || operation.host !== hostProfile.hostId
      || operation.demandKey !== binding.demandKey
      || operation.podId !== binding.podId
      || operation.windowName !== binding.windowName
      || operation.role !== binding.role
      || operation.bindingId !== binding.bindingId
      || operation.receiptDigest !== binding.receiptDigest
    ) {
      fail(`Active Pod binding for ${windowName} does not match its manifest and launch operation.`);
    }
    if (
      !existsSync(binding.receipt.actualCwd)
      || realpathSync(binding.receipt.actualCwd) !== binding.receipt.actualCwd
    ) {
      fail(`Active Pod binding for ${windowName} points at a missing actualCwd.`);
    }
    const registryFile = (findThreadFile ?? threadFileFor)(windowName);
    if (!existsSync(registryFile)) {
      fail(`Active Pod binding for ${windowName} has no final host registry.`);
    }
    const registration = readJson(registryFile, "thread registration");
    if (
      registration.kind !== hostProfile.kinds.windowRegistration
      || registration.windowName !== windowName
      || registration.bindingId !== binding.bindingId
      || !registration.threadId
      || contentDigest({ host: hostProfile.hostId, handle: registration.threadId }) !== binding.handleDigest
    ) {
      fail(`Active Pod binding for ${windowName} does not match its registered final host session.`);
    }
    return binding;
  }

  function podStateForRuntimeRecord(record) {
    if (!record?.podId) return null;
    const manifest = podRuntime().readManifest(record.podId);
    if (!manifest?.stateRootRelative) return null;
    const stateRoot = path.resolve(workspaceRoot, manifest.stateRootRelative);
    const relativeStateRoot = path.relative(workspaceRoot, stateRoot);
    if (
      path.isAbsolute(relativeStateRoot)
      || relativeStateRoot === ".."
      || relativeStateRoot.startsWith(`..${path.sep}`)
    ) {
      fail(`Pod manifest ${record.podId} points outside the workspace.`);
    }
    const stateFile = path.join(stateRoot, "wakeflow-state.json");
    if (!existsSync(stateFile)) {
      fail(`Pod runtime record ${record.windowName} has no canonical demand state at ${manifest.stateRootRelative}.`);
    }
    const state = readJson(stateFile, "Pod controller state");
    if (
      state.demandKey !== record.demandKey
      || state.executionPlacement?.podId !== record.podId
      || state.executionPlacement?.selection !== "explicit-user-pod"
    ) {
      fail(`Pod runtime record ${record.windowName} does not match its canonical demand placement.`);
    }
    return { manifest, state, stateRoot };
  }

  function deliveryRoleForPodRecord(record) {
    if (record?.role === "controller") return "controller";
    if (record?.role === "design") return "design";
    if (record?.role === "test") return "test-target";
    if (record?.role === "product") return "target";
    return null;
  }

  function windowRuntimeDescriptor(windowName, podOperation = null) {
    const { config } = repositoryForWindow(windowName);
    const podBase = podBaseWindow(windowName);
    const binding = podBase ? activePodBinding(windowName) : null;
    const podRecord = binding ?? podOperation;
    const repositoryWindow = podRecord?.repositoryWindow
      ?? podRecord?.intent?.repositoryWindow
      ?? podBase
      ?? windowName;
    const repository = (Array.isArray(config.repositories) ? config.repositories : [])
      .find((item) => item?.windowName === repositoryWindow) ?? null;
    const podState = podRecord ? podStateForRuntimeRecord(podRecord) : null;
    return {
      config,
      repository,
      deliveryRole: deliveryRoleForPodRecord(podRecord) ?? deliveryRoleForWindow(config, windowName),
      cwd: podBase
        ? (binding?.receipt?.actualCwd ?? null)
        : windowName === config.controllerWindow
          ? workspaceRoot
          : repository?.path,
      responsibilityRoot: podBase
        ? (binding?.receipt?.actualCwd ?? null)
        : windowName === config.controllerWindow
          ? workspaceRoot
          : repository?.path,
      podBinding: binding,
      podOperation,
      podState,
    };
  }

  function applyPodDispatchGate(config, descriptor) {
    const podRecord = descriptor?.podBinding ?? descriptor?.podOperation;
    const podBase = podBaseWindow(podRecord?.windowName ?? config.windowName);
    if (!podBase) return config;
    const phase = descriptor.podState?.state?.podProvisioning?.phase ?? null;
    const testAccess = descriptor.podState?.state?.podProvisioning?.testAccess ?? null;
    const bindingVerified = Boolean(descriptor.podBinding && descriptor.podState);
    const role = descriptor.deliveryRole;
    const phaseAllowsDispatch = role === "controller"
      ? bindingVerified
      : role === "design"
        ? false
        : role === "test-target"
          ? phase === "execution-ready"
            && testAccess?.status === "validated"
            && testAccess?.capability === "direct-multi-root"
          : phase === "execution-ready";
    return {
      ...config,
      dispatchable: Boolean(config.dispatchable && bindingVerified && phaseAllowsDispatch),
      pod: {
        bindingVerified,
        phase,
        demandKey: descriptor.podBinding?.demandKey ?? null,
        podId: descriptor.podBinding?.podId ?? null,
        ...(role === "test-target"
          ? {
              testAccess: {
                status: testAccess?.status ?? "missing",
                capability: testAccess?.capability ?? null,
                probeId: testAccess?.probeId ?? null,
              },
            }
          : {}),
        dispatchGate: phaseAllowsDispatch ? "open" : "blocked",
      },
    };
  }

  function normalizeStateRootRelative(value) {
    const resolved = path.resolve(workspaceRoot, value);
    const relativeStateRoot = path.relative(workspaceRoot, resolved);
    if (
      !relativeStateRoot
      || path.isAbsolute(relativeStateRoot)
      || relativeStateRoot === ".."
      || relativeStateRoot.startsWith(`..${path.sep}`)
    ) {
      fail("--state-root for a Pod registration must resolve below the workspace root.");
    }
    return relativeStateRoot.split(path.sep).join("/");
  }

  function podLaunchOperationForRegistration({ windowName, launchCorrelationId, bindingId, stateRoot }) {
    if (!launchCorrelationId || !bindingId || !stateRoot) {
      fail(`Pod window ${windowName} requires --launch-correlation-id, --binding-id, and --state-root from its launch plan.`);
    }
    const runtime = podRuntime();
    const operation = runtime.readOperation(launchCorrelationId);
    if (
      !operation
      || operation.kind !== POD_OPERATION_KIND
      || operation.operationType !== "launch"
      || operation.operationId !== launchCorrelationId
    ) {
      fail(`No canonical Pod launch operation matches ${launchCorrelationId}.`);
    }
    if (operation.host !== hostProfile.hostId || operation.windowName !== windowName) {
      fail(`Pod launch operation ${launchCorrelationId} does not authorize ${windowName} on ${hostProfile.hostId}.`);
    }
    if (
      !operation.intent?.registrationBindingId
      || operation.intent.registrationBindingId !== bindingId
    ) {
      fail(`Pod registration ${windowName} must reuse the launch operation's exact registrationBindingId.`);
    }
    if (operation.status === "closed") {
      fail(`Pod launch operation ${launchCorrelationId} is already closed.`);
    }
    if (operation.bindingId && operation.bindingId !== bindingId) {
      fail(`Pod launch operation ${launchCorrelationId} is already associated with a different binding.`);
    }
    const manifest = runtime.readManifest(operation.podId);
    if (!manifest || manifest.host !== hostProfile.hostId || manifest.demandKey !== operation.demandKey) {
      fail(`Pod launch operation ${launchCorrelationId} has no matching host-local manifest.`);
    }
    if (normalizeStateRootRelative(stateRoot) !== manifest.stateRootRelative) {
      fail(`Pod registration ${windowName} does not match the launch plan's canonical state root.`);
    }
    return operation;
  }

  function rejectDuplicateRegisteredHandle(windowName, threadId) {
    const registryDir = path.dirname(threadFileFor(windowName));
    if (!existsSync(registryDir)) return;
    for (const entry of readdirSync(registryDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const file = path.join(registryDir, entry.name);
      const registration = readJson(file, "thread registration");
      if (registration.windowName !== windowName && registration.threadId === threadId) {
        fail(`The same host session is already registered to ${registration.windowName}; every Pod role requires an independent session.`);
      }
    }
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
    const completionExpectations = lines(briefing.completionExpectations, 2);
    const priorityContext = lines(briefing.contextSummary, 1)[0] || "";
    const requirementRefs = (Array.isArray(briefing.requirementRefs) ? briefing.requirementRefs : [])
      .filter((item) => item && typeof item === "object" && item.ref);
    const requirementEntry = requirementRefs.find((entry) => entry.role === "goal")
      ?? requirementRefs[0];
    const boundaries = briefing.boundaries && typeof briefing.boundaries === "object"
      ? briefing.boundaries
      : {};
    const criticalBoundary = [
      { kind: "forbidden", value: lines(boundaries.forbidden, 1)[0] },
      { kind: "outOfScope", value: lines(boundaries.outOfScope, 1)[0] },
      { kind: "inScope", value: lines(boundaries.inScope, 1)[0] },
    ].find((entry) => entry.value);
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
    const workspaceRoot = cleanLine(briefing.workspaceRoot, 500);
    const workspaceInstructions = workspaceRoot
      ? path.join(workspaceRoot, hostProfile.memoryFile)
      : "";
    const distinctWorkspaceInstructions = workspaceInstructions
      && path.resolve(workspaceInstructions) !== path.resolve(repositoryInstructions);
    const currentStateRoot = cleanLine(briefing.stateRoot || stateRef.stateRoot, 500);
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
            zh ? "\u672c\u8f6e\u5b8c\u6210\u91cd\u70b9\uff08\u5b8c\u6574\u6761\u4ef6\u89c1\u4efb\u52a1\u5305\uff09\uff1a" : "Completion focus (full criteria are in the task package):",
            ...completionExpectations.map((item) => `- ${item}`),
            "",
          ]
        : []),
      ...(priorityContext
        ? [`- ${zh ? "\u4f18\u5148\u4e0a\u4e0b\u6587" : "Priority context"}: ${priorityContext}`]
        : []),
      ...(criticalBoundary
        ? [`- ${zh ? "\u5173\u952e\u8fb9\u754c" : "Critical boundary"} [${criticalBoundary.kind}]: ${criticalBoundary.value}`]
        : []),
      ...(anchors.length > 0
        ? [
            zh ? "\u5173\u952e\u9a8c\u6536\u951a\u70b9\uff08\u5b8c\u6574\u63a2\u9488\u548c\u671f\u671b\u89c1\u4efb\u52a1\u5305\uff09\uff1a" : "Key acceptance anchors (full probes and expectations are in the task package):",
            ...anchors.map((anchor) => `- ${cleanLine(anchor.id, 80)}: ${cleanLine(anchor.claim, 180)}`),
            "",
          ]
        : []),
      zh ? "\u5f00\u59cb\u524d\u6309\u987a\u5e8f\u8bfb\u53d6\uff1a" : "Read before execution, in order:",
      `- ${zh ? "\u4efb\u52a1\u5305\uff08\u672c\u4efb\u52a1\u5b8c\u6574\u4e0a\u4e0b\u6587\uff09" : "Task package (complete task context)"}: ${taskPackageRef}`,
      ...(requirementEntry
        ? [`- ${zh ? "\u9700\u6c42\u80cc\u666f\u5165\u53e3\uff08\u5b8c\u6574\u951a\u70b9\u89c1\u4efb\u52a1\u5305\uff09" : "Requirement background entry (full anchors are in the task package)"} [${requirementEntry.role}]: ${requirementEntry.resolvedRef || requirementEntry.ref}`]
        : []),
      ...(distinctWorkspaceInstructions
        ? [`- ${zh ? "\u5de5\u4f5c\u7a7a\u95f4\u6307\u4ee4" : "Workspace instructions"}: ${workspaceInstructions}`]
        : []),
      `- ${zh ? "\u4ed3\u5e93\u6307\u4ee4" : "Repository instructions"}: ${repositoryInstructions}`,
      ...(currentStateRoot
        ? [`- ${zh ? "\u5f53\u524d state root" : "Current state root"}: ${currentStateRoot}`]
        : []),
      "",
      zh ? "\u5fc5\u987b\u52a0\u8f7d\u7684\u6267\u884c Skills\uff08\u6267\u884c\u6d41\u7a0b\u6743\u5a01\uff09\uff1a" : "Required execution Skills (execution-process authority):",
      ...requiredSkills.map((skill) => `- ${skill}`),
      "",
      zh ? "\u8eab\u4efd\u5b9a\u4f4d\uff08\u5b8c\u6574\u8fb9\u754c\u89c1\u4efb\u52a1\u5305\uff09\uff1a" : "Identity (full boundaries are in the task package):",
      `- ${zh ? "\u5f53\u524d\u804c\u8d23\u7a97\u53e3" : "Current responsibility window"}: ${targetWindow}`,
      ...(repositoryRoot ? [`- ${zh ? "\u552f\u4e00\u5de5\u4f5c\u4ed3\u5e93" : "Only working repository"}: ${repositoryRoot}`] : []),
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

  function commandRegisterThreadUnlocked() {
    const windowName = requireValue("--window");
    const threadId = validateThreadId(requireValue("--thread-id"));
    const launchCorrelationId = getValue("--launch-correlation-id", "");
    const bindingId = getValue("--binding-id", "");
    const stateRoot = getValue("--state-root", "");
    const initialDescriptor = windowRuntimeDescriptor(windowName);
    const configuredWindows = new Set([
      initialDescriptor.config.controllerWindow,
      initialDescriptor.config.designWindow,
      ...testWindowNames(initialDescriptor.config),
      ...(Array.isArray(initialDescriptor.config.repositories)
        ? initialDescriptor.config.repositories.map((item) => item?.windowName)
        : []),
    ].filter(Boolean));
    const podBase = podBaseWindow(windowName);
    const podShaped = Boolean(podBase) && !configuredWindows.has(windowName);
    const podOperation = podShaped
      ? podLaunchOperationForRegistration({
          windowName,
          launchCorrelationId,
          bindingId,
          stateRoot,
        })
      : null;
    if (!configuredWindows.has(windowName) && !podOperation) {
      fail(`Window is not configured in wakeflow.config.json: ${windowName}`);
    }
    if (!podOperation && (launchCorrelationId || bindingId || stateRoot)) {
      fail("Pod launch correlation fields are valid only for a window authorized by a canonical Pod launch plan.");
    }
    const descriptor = podOperation
      ? windowRuntimeDescriptor(windowName, podOperation)
      : initialDescriptor;
    rejectDuplicateRegisteredHandle(windowName, threadId);
    const registryFile = threadFileFor(windowName);
    const previousRegistryFile = (findThreadFile ?? threadFileFor)(windowName);
    const replacedExistingThread = existsSync(previousRegistryFile);
    const existingRegistration = existsSync(previousRegistryFile)
      ? readJson(previousRegistryFile, "thread registration")
      : null;
    const existingPodBinding = podOperation?.status === "bound"
      ? podRuntime().readBinding(podOperation.podId, windowName)
      : null;
    if (podOperation?.status === "bound" && !existingPodBinding) {
      fail(`Bound Pod window ${windowName} is missing its immutable binding; repair that authority instead of replacing the registered host session.`);
    }
    if (existingPodBinding) {
      const requestedHandleDigest = contentDigest({
        host: hostProfile.hostId,
        handle: threadId,
      });
      if (
        existingPodBinding.status !== "active"
        || existingPodBinding.bindingId !== bindingId
        || existingPodBinding.handleDigest !== requestedHandleDigest
        || existingRegistration?.threadId !== threadId
        || existingRegistration?.bindingId !== bindingId
      ) {
        fail(`Bound Pod window ${windowName} cannot replace its final host session; resume the exact registered handle instead.`);
      }
    }
    const verifiedAt = nowIso();
    const registration = createThreadRegistration({
      windowName,
      threadId,
      registeredAt: existingPodBinding && existingRegistration?.registeredAt
        ? existingRegistration.registeredAt
        : verifiedAt,
      ...(podOperation ? { bindingId } : {}),
      version: threadRegistrationVersion,
    });
    registration.lastVerifiedAt = verifiedAt;
    const configFile = windowConfigFileFor(windowName);
    const config = applyPodDispatchGate(buildWindowDispatchConfig({
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
    }), descriptor);
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

  function commandRegisterThread() {
    if (!write) return commandRegisterThreadUnlocked();
    // The lock lives under the host runtime root. Fresh workspaces do not have
    // that parent until the first registration, so establish the validated
    // runtime directories before trying O_EXCL on the lock file.
    ensureStateDirs();
    const lockFile = path.join(
      stateDir,
      "hosts",
      hostProfile.runtime.hostDirName,
      "thread-registry.lock",
    );
    try {
      return withFileLock(lockFile, commandRegisterThreadUnlocked);
    } catch (error) {
      if (error instanceof WakeflowStateLockTimeoutError) fail(error.message);
      throw error;
    }
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
    const descriptor = windowRuntimeDescriptor(windowName);
    const {
      config,
      repository,
      deliveryRole,
      cwd,
      responsibilityRoot,
    } = descriptor;
    return applyPodDispatchGate(buildWindowDispatchConfig({
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
    }), descriptor);
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
