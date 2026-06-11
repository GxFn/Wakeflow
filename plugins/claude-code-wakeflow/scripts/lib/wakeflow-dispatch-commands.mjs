import { existsSync, readFileSync } from "node:fs";
import { hostProfile } from "./wakeflow-host-profile.mjs";
import path from "node:path";
import { buildControllerReturnEnvelope } from "./wakeflow-controller-return.mjs";
import {
  annotateDispatchPacketIdempotency,
  sameDeliveryEnvelopeContent,
  sameDispatchPacketContent,
} from "./wakeflow-idempotency.mjs";
import {
  controllerReturnDuplicateScopeText,
  controllerReturnDuplicateSelector,
  returnPolicyReviewScope,
} from "./wakeflow-return-policy.mjs";

export function createDispatchCommands(ctx) {
  const {
    workspaceRoot,
    stateDir,
    write,
    hasFlag,
    getValue,
    getAllValues,
    requireValue,
    validateContextPolicy,
    validateReturnPolicyMode,
    validateReturnRoute,
    validateReturnReason,
    fail,
    output,
    slug,
    nowIso,
    version,
    deliveryEnvelopeVersion,
    readJson,
    ensureStateDirs,
    atomicWriteJson,
    resolveInputPath,
    resolveStateRoot,
    readControllerStateRoot,
    readTaskPackageFromStateRoot,
    packetFileFor,
    groupFileFor,
    deliveryFileFor,
    threadFileFor,
    findThreadFile,
    readWindowLock,
    windowLockFresh,
    writeWindowLock,
    windowConfigFileFor,
    keepLiveStateFile,
    startKeepLive,
    artifactTrace,
    upsertDispatchGroup,
    loadDispatchGroup,
    computeReviewResults,
    validateControllerReturnAllowed,
    controllerReturnDeliveryStatusForGroup,
    readWorkspaceConfig,
    loadThreadRegistration,
    buildWindowConfig,
    redactDeliveryEnvelope,
    formatTargetPrompt,
  } = ctx;

  function safeStateFileForRef(stateRef) {
    // Resolve a stateRef WITHOUT ctx fail(): ctx fail prints an ok:false JSON
    // blob and sets exitCode before throwing, which a try/catch cannot undo.
    if (!stateRef?.stateRoot) return null;
    const root = path.isAbsolute(stateRef.stateRoot) ? stateRef.stateRoot : path.resolve(workspaceRoot, stateRef.stateRoot);
    const stateFile = path.join(root, "wakeflow-state.json");
    return existsSync(stateFile) ? stateFile : null;
  }

  function interfaceLanguageForStateRef(stateRef) {
    // The demand's interfaceLanguage (stamped at init) drives the human-readable
    // sentences of envelope prompts so target windows answer in the workspace
    // language. Machine keys stay English. Defaults to en when unreadable.
    try {
      const stateFile = safeStateFileForRef(stateRef);
      if (stateFile) {
        const language = JSON.parse(readFileSync(stateFile, "utf8")).interfaceLanguage;
        if (language === "zh") return "zh";
      }
    } catch {
      // fall through to the English default
    }
    return "en";
  }

  function demandOwnerForStateRef(stateRef) {
    try {
      const stateFile = safeStateFileForRef(stateRef);
      if (stateFile) {
        const state = JSON.parse(readFileSync(stateFile, "utf8"));
        return { owner: state.controllerHost ?? null, demandKey: state.demandKey };
      }
    } catch {
      // unreadable state: no gate (verify reports broken state roots separately)
    }
    return null;
  }

  function buildDispatchArtifacts({
    contextPolicy,
    controllerWindow = "",
    dispatchGroup = "",
    evidenceRequired = [],
    forbidden = [],
    humanContextRef = "",
    objective,
    returnPolicyMode = "",
    scope = [],
    stateRef = null,
    targetWindow,
    taskId,
  }) {
    if (!stateRef) fail("dispatch requires stateRef from controller state root.");
    if (returnPolicyMode && !dispatchGroup) fail("--return-policy requires --group.");
    if (returnPolicyMode) validateReturnPolicyMode(returnPolicyMode);
    const prompt = formatTargetPrompt({
      targetWindow,
      taskId,
      dispatchGroup,
      controllerWindow,
      humanContextRef,
      stateRef,
      interfaceLanguage: interfaceLanguageForStateRef(stateRef),
    });
    if (!prompt) fail("Prompt cannot be empty.");

    const id = [dispatchGroup, targetWindow, taskId].filter(Boolean).map(slug).join("__");
    const dispatchGroupRecord = dispatchGroup
      ? upsertDispatchGroup({
          groupId: dispatchGroup,
          controllerWindow,
          humanContextRef,
          returnPolicyMode,
          stateRef,
          targetWindow,
          taskId,
          packetId: id,
        })
      : null;
    const createdAt = nowIso();
    const packet = annotateDispatchPacketIdempotency({
      kind: "ControllerDispatchPacket",
      version,
      id,
      targetWindow,
      taskId,
      dispatchGroup: dispatchGroup || undefined,
      controllerWindow: controllerWindow || undefined,
      humanContextRef: humanContextRef || undefined,
      stateRef: stateRef || undefined,
      objective,
      scope,
      forbidden,
      evidenceRequired,
      resultContract: "target-result-envelope-v1",
      returnPolicy: dispatchGroupRecord?.returnPolicy,
      contextPolicy: validateContextPolicy(contextPolicy || "refresh-if-missing"),
      prompt,
      wakeflowTrace: artifactTrace({
        artifactKind: "dispatch-packet",
        createdAt,
        dispatchGroup: dispatchGroup || undefined,
        stateRef,
        targetTaskId: taskId,
        targetWindow,
        taskPackageId: stateRef.taskPackageId,
      }),
      createdAt,
    });

    const packetFile = packetFileFor(packet.id);
    return { dispatchGroupRecord, packet, packetFile };
  }

  function writeDispatchArtifacts({ dispatchGroup = "", dispatchGroupRecord, packet, packetFile }) {
    ensureStateDirs();
    if (dispatchGroupRecord && dispatchGroup) {
      atomicWriteJson(groupFileFor(dispatchGroup), dispatchGroupRecord);
    }
    atomicWriteJson(packetFile, packet);
  }

  function buildDeliveryArtifacts({
    automationEnabled = false,
    deliveryId = "",
    packet,
    requireThread = false,
    returnRoute = "controller",
    windowConfig = null,
  }) {
    if (packet.kind !== "ControllerDispatchPacket") fail("Packet file must contain a ControllerDispatchPacket.");
    if (!packet.targetWindow || !packet.prompt || !packet.taskId) fail("Dispatch packet is missing targetWindow, taskId, or prompt.");
    if (!packet.stateRef) fail("Dispatch packet is missing stateRef; legacy Markdown-plan packets are no longer supported.");

    const registration = loadThreadRegistration(packet.targetWindow);
    if (requireThread && !registration) fail(`No registered thread for target window: ${packet.targetWindow}`);
    // Demand host-ownership gate also covers the packet-file route
    // (build-delivery): failing here is cheap; failing only at record time
    // would land AFTER the prompt was already sent into the target pane.
    const demandOwner = demandOwnerForStateRef(packet.stateRef);
    if (demandOwner?.owner && demandOwner.owner !== hostProfile.runtime.hostDirName) {
      fail(`demand ${demandOwner.demandKey} is owned by controller host ${demandOwner.owner}; this runtime is ${hostProfile.runtime.hostDirName}. Dispatch from the owning controller, or transfer ownership explicitly first (adopt-demand-host; MCP: wakeflow_adopt_demand_host).`);
    }
    const resolvedDeliveryId = deliveryId || `delivery-${packet.id}`;
    // Cross-host in-flight guard: a fresh delivery lock written by the OTHER
    // host means another controller is already driving this window's working
    // tree. Fail closed; same-host locks are reported as a warning because the
    // per-task sent-state guard already prevents double-sending here.
    const windowLock = readWindowLock ? readWindowLock(packet.targetWindow) : null;
    const windowLockIsFresh = Boolean(windowLock) && windowLockFresh(windowLock);
    if (windowLockIsFresh && windowLock.host && windowLock.host !== hostProfile.runtime.hostDirName) {
      fail(`Window ${packet.targetWindow} has a fresh in-flight delivery lock from host ${windowLock.host} (delivery ${windowLock.deliveryId || "unknown"}, expires ${windowLock.expiresAt}); wait for that delivery or coordinate before dispatching from this host.`);
    }
    const windowLockWarning = windowLockIsFresh && windowLock.deliveryId !== resolvedDeliveryId
      ? `Window ${packet.targetWindow} already has a fresh same-host delivery lock (${windowLock.deliveryId || "unknown"}); confirm the prior delivery finished before sending.`
      : undefined;
    const resolvedWindowConfig = windowConfig || buildWindowConfig(packet.targetWindow);
    const createdAt = nowIso();
    const envelope = {
      kind: "DeliveryEnvelope",
      version: deliveryEnvelopeVersion,
      deliveryId: resolvedDeliveryId,
      sourcePacketId: packet.id,
      targetWindow: packet.targetWindow,
      taskId: packet.taskId,
      dispatchGroup: packet.dispatchGroup,
      controllerWindow: packet.controllerWindow,
      humanContextRef: packet.humanContextRef,
      stateRef: packet.stateRef,
      prompt: packet.prompt,
      returnPolicy: packet.returnPolicy,
      returnRoute: validateReturnRoute(returnRoute),
      oneShot: true,
      correlationId: packet.dispatchGroup || packet.id,
      targetThread: registration
        ? {
            windowName: registration.windowName,
            threadIdRedacted: true,
            threadRegistryFile: registration.threadRegistryFile,
          }
        : undefined,
      transport: {
        kind: "direct-thread",
        threadRegistryFile: path.relative(stateDir, (findThreadFile ?? threadFileFor)(packet.targetWindow)),
        readbackRequired: true,
        missingThread: "fail-closed",
      },
      automation: {
        enabled: automationEnabled,
        continuousLoop: automationEnabled,
        keepLive: automationEnabled,
        keepLiveStateFile: automationEnabled ? path.relative(stateDir, keepLiveStateFile()) : undefined,
      },
      windowConfig: resolvedWindowConfig,
      wakeflowTrace: artifactTrace({
        artifactKind: "delivery-envelope",
        createdAt,
        deliveryId: resolvedDeliveryId,
        dispatchGroup: packet.dispatchGroup,
        stateRef: packet.stateRef,
        targetTaskId: packet.taskId,
        targetWindow: packet.targetWindow,
      }),
      createdAt,
    };

    const deliveryFile = deliveryFileFor(envelope.deliveryId);
    return { deliveryFile, envelope, registration, windowLockWarning };
  }

  function commandBuildDelivery() {
    const packetFile = resolveInputPath(requireValue("--packet-file"), "--packet-file");
    const packet = readJson(packetFile, "dispatch packet");
    const { deliveryFile, envelope, registration, windowLockWarning } = buildDeliveryArtifacts({
      automationEnabled: hasFlag("--automation-enabled"),
      deliveryId: getValue("--delivery-id", `delivery-${packet.id}`),
      packet,
      requireThread: hasFlag("--require-thread"),
      returnRoute: getValue("--return-route", "controller"),
    });
    if (write) {
      ensureStateDirs();
      atomicWriteJson(deliveryFile, envelope);
      // Acquire the shared cross-host window lock at envelope time so it
      // covers the whole build -> host send -> record window on every host
      // (the codex host send has no wakeflow hook of its own). Same-id
      // re-acquisition just refreshes the TTL.
      if (writeWindowLock && envelope.targetWindow) {
        writeWindowLock(envelope.targetWindow, { deliveryId: envelope.deliveryId });
      }
    }
    output(
      {
        ok: true,
        command: "build-delivery",
        wrote: write,
        envelope: redactDeliveryEnvelope(envelope),
        deliveryFile: write ? path.relative(workspaceRoot, deliveryFile) : "",
        threadReady: Boolean(registration),
        threadIdRedacted: Boolean(registration),
        windowLockWarning,
      },
      [
        `${write ? "Created" : "Would create"} delivery envelope ${envelope.deliveryId}.`,
        `Target: ${envelope.targetWindow}`,
        `Return route: ${envelope.returnRoute}`,
        `Thread: ${registration ? "registered" : "missing"}`,
      ],
    );
  }

  function validatePrepareDispatchEligibility({ state, taskPackage, targetTask }) {
    if (["completed", "archived", "paused", "blocked"].includes(state.state)) {
      fail(`cannot prepare dispatch while controller state is ${state.state}: ${state.demandKey}`);
    }
    if (["review-ready", "accepting"].includes(state.state)) {
      fail(`cannot prepare dispatch while controller state is ${state.state}; decide review before dispatching more work.`);
    }
    const eligibleTargetStatuses = new Set(["pending", "needs-rework", "missing-result"]);
    const targetStatus = targetTask.status || "pending";
    if (!eligibleTargetStatuses.has(targetStatus)) {
      fail(`target task ${targetTask.targetTaskId} is ${targetStatus}; only pending, needs-rework, or missing-result tasks can be dispatched.`);
    }
    const eligiblePackageStatuses = new Set(["pending", "needs-rework"]);
    const packageStatus = taskPackage.status || "pending";
    if (!eligiblePackageStatuses.has(packageStatus)) {
      fail(`task package ${taskPackage.taskPackageId} is ${packageStatus}; only pending or needs-rework packages can be dispatched.`);
    }
  }

  function commandPrepareDispatchFromState() {
    const stateRoot = resolveStateRoot(requireValue("--state-root"));
    const { state, stateRootRef } = readControllerStateRoot(stateRoot);
    // Demand host-ownership gate: never prepare a dispatch for a demand owned
    // by the other host's controller (ownership transfer is a state-machine
    // action: wakeflow-state --adopt-host).
    if (state.controllerHost && state.controllerHost !== hostProfile.runtime.hostDirName) {
      fail(`demand ${state.demandKey} is owned by controller host ${state.controllerHost}; this runtime is ${hostProfile.runtime.hostDirName}. Dispatch from the owning controller, or transfer ownership explicitly first (adopt-demand-host; MCP: wakeflow_adopt_demand_host).`);
    }
    const targetTaskId = requireValue("--target-task-id");
    const targetTask = (state.targetTasks ?? []).find((item) => item.targetTaskId === targetTaskId);
    if (!targetTask) fail(`target task does not exist in controller state: ${targetTaskId}`);
    const taskPackageId = getValue("--task-package-id", targetTask.taskPackageId);
    if (!taskPackageId) fail(`target task ${targetTaskId} is missing taskPackageId.`);
    if (targetTask.taskPackageId && taskPackageId !== targetTask.taskPackageId) {
      fail(`target task ${targetTaskId} belongs to task package ${targetTask.taskPackageId}, not ${taskPackageId}`);
    }
    const taskPackage = readTaskPackageFromStateRoot(stateRoot, taskPackageId);
    const targetWindow = targetTask.targetWindow;
    if (!targetWindow) fail(`target task ${targetTaskId} is missing targetWindow.`);
    validatePrepareDispatchEligibility({ state, taskPackage, targetTask });
    const controllerWindow = getValue("--controller-window", "");
    const dispatchGroup = getValue("--group", taskPackageId);
    const automationEnabled = hasFlag("--automation-enabled");
    const requireThread = hasFlag("--require-thread");
    const windowConfig = buildWindowConfig(targetWindow, { requireThread });
    const humanContextRef = getValue(
      "--human-context-ref",
      state.projection?.progressDoc ? path.join(stateRootRef, state.projection.progressDoc) : stateRootRef,
    );
    const stateRef = {
      stateRoot: stateRootRef,
      demandKey: state.demandKey,
      taskPackageId,
      targetTaskId,
      stateRevision: state.revision,
    };
    const { dispatchGroupRecord, packet, packetFile } = buildDispatchArtifacts({
      contextPolicy: getValue("--context-policy", "refresh-if-missing"),
      controllerWindow,
      dispatchGroup,
      evidenceRequired: [
        ...getAllValues("--evidence"),
        "TargetResultEnvelope with evidence refs; target result is not controller acceptance.",
      ],
      forbidden: [
        ...getAllValues("--forbidden"),
        "Do not treat dispatch packet, delivery run, or target result as total-control acceptance.",
        "Do not parse developer-progress.md as state authority.",
      ],
      humanContextRef,
      objective: getValue("--objective", targetTask.summary || taskPackage.summary || `Complete ${targetTaskId}.`),
      returnPolicyMode: getValue("--return-policy", ""),
      scope: [
        ...getAllValues("--scope"),
        `demandKey=${state.demandKey}`,
        `taskPackageId=${taskPackageId}`,
        `targetTaskId=${targetTaskId}`,
      ],
      stateRef,
      targetWindow,
      taskId: targetTaskId,
    });
    const { deliveryFile, envelope, registration, windowLockWarning } = buildDeliveryArtifacts({
      automationEnabled,
      deliveryId: getValue("--delivery-id", `delivery-${packet.id}`),
      packet,
      requireThread,
      returnRoute: getValue("--return-route", "controller"),
      windowConfig,
    });
    const dispatchGroupFile = dispatchGroup ? groupFileFor(dispatchGroup) : "";
    const existingGroup = dispatchGroup ? loadDispatchGroup(dispatchGroup) : null;
    const existingPacket = existsSync(packetFile) ? readJson(packetFile, "dispatch packet") : null;
    const existingEnvelope = existsSync(deliveryFile) ? readJson(deliveryFile, "delivery envelope") : null;
    if (existingPacket) {
      if (existingPacket.stateRef?.stateRevision !== state.revision) {
        fail(`existing dispatch packet ${packet.id} was prepared from state revision ${existingPacket.stateRef?.stateRevision}; current revision is ${state.revision}. Use a new dispatch group or clear stale local delivery runtime intentionally.`);
      }
      if (!sameDispatchPacketContent(existingPacket, packet)) {
        fail(`existing dispatch packet ${packet.id} has different content for the same state revision; refusing to overwrite local delivery runtime.`);
      }
    }
    if (existingEnvelope) {
      if (existingEnvelope.stateRef?.stateRevision !== state.revision) {
        fail(`existing delivery envelope ${envelope.deliveryId} was prepared from state revision ${existingEnvelope.stateRef?.stateRevision}; current revision is ${state.revision}. Use a new delivery id or clear stale local delivery runtime intentionally.`);
      }
      if (!sameDeliveryEnvelopeContent(existingEnvelope, envelope)) {
        fail(`existing delivery envelope ${envelope.deliveryId} has different content for the same state revision; refusing to overwrite local delivery runtime.`);
      }
    }
    if (existingGroup?.stateRef?.stateRevision && existingGroup.stateRef.stateRevision !== state.revision) {
      fail(`existing dispatch group ${dispatchGroup} was prepared from state revision ${existingGroup.stateRef.stateRevision}; current revision is ${state.revision}. Use a new dispatch group or clear stale local delivery runtime intentionally.`);
    }
    const idempotentReplay = Boolean(existingPacket && existingEnvelope);
    const repairArtifacts = [
      !existingGroup && dispatchGroupRecord ? "dispatch-group" : "",
      !existingPacket ? "dispatch-packet" : "",
      !existingEnvelope ? "delivery-envelope" : "",
    ].filter(Boolean);

    let keepLive = null;
    if (write) {
      ensureStateDirs();
      if (automationEnabled && !idempotentReplay) {
        keepLive = startKeepLive({ automationRunId: dispatchGroup || packet.id });
      }
      if (!idempotentReplay) atomicWriteJson(windowConfigFileFor(targetWindow), windowConfig);
      if (!existingGroup && dispatchGroupRecord && dispatchGroup) atomicWriteJson(dispatchGroupFile, dispatchGroupRecord);
      if (!existingPacket) atomicWriteJson(packetFile, packet);
      if (!existingEnvelope) atomicWriteJson(deliveryFile, envelope);
      if (writeWindowLock && envelope.targetWindow) {
        writeWindowLock(envelope.targetWindow, { deliveryId: envelope.deliveryId });
      }
    }

    output(
      {
        ok: true,
        command: "prepare-dispatch-from-state",
        wrote: write && (!idempotentReplay || repairArtifacts.length > 0),
        duplicate: idempotentReplay || undefined,
        idempotentReplay: idempotentReplay || undefined,
        repairedArtifacts: write && repairArtifacts.length > 0 ? repairArtifacts : undefined,
        keepLive,
        stateRoot: stateRootRef,
        stateRevision: state.revision,
        taskPackageId,
        targetTaskId,
        humanContextRef,
        windowName: targetWindow,
        windowConfig,
        configFile: write ? path.relative(workspaceRoot, windowConfigFileFor(targetWindow)) : "",
        packet: existingPacket || packet,
        dispatchGroup: dispatchGroupRecord,
        packetFile: write ? path.relative(workspaceRoot, packetFile) : "",
        dispatchGroupFile: write && dispatchGroupRecord ? path.relative(workspaceRoot, dispatchGroupFile) : "",
        envelope: redactDeliveryEnvelope(existingEnvelope || envelope),
        deliveryFile: write ? path.relative(workspaceRoot, deliveryFile) : "",
        threadReady: Boolean(registration),
        threadIdRedacted: Boolean(registration),
        windowLockWarning,
        forbiddenConclusions: [
          "prepared-dispatch-is-host-send",
          "prepared-dispatch-is-target-result",
          "prepared-dispatch-is-controller-acceptance",
        ],
      },
      [
        `${idempotentReplay ? "Reused" : write ? "Prepared" : "Would prepare"} state-root dispatch + delivery for ${targetWindow} / ${targetTaskId}.`,
        `State root: ${stateRootRef}`,
        `Thread: ${registration ? "registered" : "missing"}`,
        `Delivery: ${path.relative(workspaceRoot, deliveryFile)}`,
      ],
    );
  }

  function commandBuildControllerReturn() {
    const dispatchGroup = requireValue("--group");
    const triggerTarget = requireValue("--trigger-target");
    const triggerTaskId = requireValue("--trigger-task-id");
    const config = readWorkspaceConfig();
    const explicitControllerWindow = getValue("--controller-window", "");
    const returnReason = validateReturnReason(getValue("--return-reason", "result-ready"));
    const automationEnabled = hasFlag("--automation-enabled");
    const review = computeReviewResults({ group: dispatchGroup });
    const inheritedStateRef = review.groupRecord?.stateRef
      || review.packets.find((packet) => packet.stateRef)?.stateRef
      || null;
    const inheritedHumanContextRef = review.groupRecord?.humanContextRef
      || review.packets.find((packet) => packet.humanContextRef)?.humanContextRef
      || "";
    const humanContextRef = getValue("--human-context-ref", inheritedHumanContextRef || "");
    if (!inheritedStateRef) {
      fail("build-controller-return requires stateRef from a state-root dispatch group.");
    }
    const storedControllerWindow = review.groupRecord?.controllerWindow
      || review.packets.find((packet) => packet.controllerWindow)?.controllerWindow
      || "";
    if (explicitControllerWindow && storedControllerWindow && explicitControllerWindow !== storedControllerWindow) {
      fail(`Dispatch group ${dispatchGroup} returns to controller ${storedControllerWindow}; cannot override with ${explicitControllerWindow}.`);
    }
    const controllerWindow = explicitControllerWindow || storedControllerWindow || config.controllerWindow || config.workspaceName || "Wakeflow";
    const registration = loadThreadRegistration(controllerWindow);
    if (hasFlag("--require-thread") && !registration) fail(`No registered controller thread for window: ${controllerWindow}`);
    validateControllerReturnAllowed({ review, triggerTarget, triggerTaskId });
    const existingReturn = controllerReturnDeliveryStatusForGroup(
      dispatchGroup,
      controllerReturnDuplicateSelector({ returnPolicy: review.returnPolicy, triggerTarget, triggerTaskId }),
    );
    if (existingReturn.pendingCount > 0 || existingReturn.sentCount > 0) {
      const duplicateScope = controllerReturnDuplicateScopeText({ returnPolicy: review.returnPolicy, triggerTarget, triggerTaskId });
      fail(`Dispatch group ${dispatchGroup}${duplicateScope} already has controller-return delivery status ${existingReturn.status}; do not create duplicate controller returns.`);
    }
    const windowConfig = buildWindowConfig(controllerWindow);
    const reviewScope = returnPolicyReviewScope(review.returnPolicy);

    const deliveryId = `controller-return-${slug(dispatchGroup)}__${slug(triggerTarget)}__${slug(triggerTaskId)}`;
    const createdAt = nowIso();
    const envelope = buildControllerReturnEnvelope({
      version: deliveryEnvelopeVersion,
      deliveryId,
      dispatchGroup,
      controllerWindow,
      triggerTarget,
      triggerTaskId,
      interfaceLanguage: inheritedStateRef ? interfaceLanguageForStateRef(inheritedStateRef) : "en",
      returnPolicy: review.returnPolicy,
      groupSnapshot: review.groupSnapshot,
      reviewScope,
      humanContextRef,
      stateRef: inheritedStateRef,
      registration,
      transportThreadRegistryFile: path.relative(stateDir, (findThreadFile ?? threadFileFor)(controllerWindow)),
      automationEnabled,
      keepLiveStateFile: path.relative(stateDir, keepLiveStateFile()),
      returnReason,
      reviewDecision: review.decision,
      groupStatus: review.groupStatus,
      windowConfig,
      wakeflowTrace: artifactTrace({
        artifactKind: "controller-return-envelope",
        createdAt,
        deliveryId,
        dispatchGroup,
        stateRef: inheritedStateRef,
        targetTaskId: triggerTaskId,
        targetWindow: triggerTarget,
      }),
      createdAt,
    });

    const returnFile = deliveryFileFor(envelope.deliveryId);
    if (write) {
      ensureStateDirs();
      atomicWriteJson(returnFile, envelope);
    }
    output(
      {
        ok: true,
        command: "build-controller-return",
        wrote: write,
        envelope: redactDeliveryEnvelope(envelope),
        returnFile: write ? path.relative(workspaceRoot, returnFile) : "",
        threadReady: Boolean(registration),
        threadIdRedacted: Boolean(registration),
        deliveryStatus: "pending-host-send",
        deliveryCompletionRequired: true,
      },
      [
        `${write ? "Created" : "Would create"} controller-return envelope ${envelope.deliveryId}.`,
        `Controller: ${controllerWindow}`,
        `Thread: ${registration ? "registered" : "missing"}`,
        "Delivery: pending host send/readback/record-delivery-run",
      ],
    );
  }

  return {
    commandBuildDelivery,
    commandPrepareDispatchFromState,
    commandBuildControllerReturn,
  };
}
