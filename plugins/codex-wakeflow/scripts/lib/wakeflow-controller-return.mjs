export function formatPromptTargetList(targets, interfaceLanguage = "en") {
  const uniqueTargets = [...new Set((targets || []).filter(Boolean))];
  if (uniqueTargets.length > 0) return uniqueTargets.join(", ");
  return interfaceLanguage === "zh" ? "\u65e0" : "None";
}

export function formatControllerReturnPrompt({
  dispatchGroup,
  triggerTarget,
  triggerTaskId,
  stateRef,
  reviewScope,
  groupSnapshot,
  interfaceLanguage = "en",
}) {
  if (!stateRef) throw new Error("Controller return prompts require stateRef from a controller state root.");
  // Sentences follow the demand interfaceLanguage; machine variable KEYS stay
  // English by contract.
  const zh = interfaceLanguage === "zh";
  const returnedTargets = [
    ...(groupSnapshot.readyTargets || []),
    ...(groupSnapshot.blockedTargets || []),
  ];
  const titleTargets = reviewScope === "group"
    ? formatPromptTargetList(returnedTargets, interfaceLanguage)
    : triggerTarget;
  const title = zh
    ? `\u7ee7\u7eed\u603b\u63a7\u8bc4\u5ba1\uff1a${titleTargets} \u56de\u586b\u3002`
    : `Continue controller review: ${titleTargets} backfill.`;
  const blockedTargets = formatPromptTargetList(groupSnapshot.blockedTargets, interfaceLanguage);
  const remainingTargets = formatPromptTargetList(groupSnapshot.missingTargets, interfaceLanguage);
  const pendingDispatchTargets = formatPromptTargetList(groupSnapshot.pendingDispatchTargets, interfaceLanguage);
  const hasBlockedTargets = Array.isArray(groupSnapshot.blockedTargets) && groupSnapshot.blockedTargets.length > 0;
  const hasRemainingTargets = Array.isArray(groupSnapshot.missingTargets) && groupSnapshot.missingTargets.length > 0;
  const hasPendingDispatchTargets = Array.isArray(groupSnapshot.pendingDispatchTargets) && groupSnapshot.pendingDispatchTargets.length > 0;
  return [
    title,
    "",
    zh ? "\u53d8\u91cf\uff1a" : "Variables:",
    `- stateRoot: ${stateRef.stateRoot}`,
    `- dispatchGroup: ${dispatchGroup}`,
    `- trigger: ${triggerTarget} / ${triggerTaskId}`,
    ...(hasBlockedTargets ? [`- blockedTargets: ${blockedTargets}`] : []),
    ...(hasRemainingTargets ? [`- remainingTargets: ${remainingTargets}`] : []),
    ...(hasPendingDispatchTargets ? [`- pendingDispatchTargets: ${pendingDispatchTargets}`] : []),
    "- skill: skills/wakeflow-controller/SKILL.md",
  ].join("\n");
}

export function buildControllerReturnEnvelope({
  version,
  deliveryId,
  dispatchGroup,
  controllerWindow,
  triggerTarget,
  triggerTaskId,
  returnPolicy,
  resultVersionKey,
  resultVersions,
  groupSnapshot,
  reviewScope,
  humanContextRef,
  stateRef,
  registration,
  transportThreadRegistryFile,
  automationEnabled,
  keepLiveStateFile,
  returnReason,
  reviewDecision,
  groupStatus,
  windowConfig,
  wakeflowTrace,
  createdAt,
  interfaceLanguage = "en",
}) {
  const prompt = formatControllerReturnPrompt({
    dispatchGroup,
    triggerTarget,
    triggerTaskId,
    stateRef,
    reviewScope,
    groupSnapshot,
    interfaceLanguage,
  });
  return {
    kind: "ControllerReturnEnvelope",
    version,
    deliveryId,
    dispatchGroup,
    controllerWindow,
    triggerTarget,
    triggerTaskId,
    returnPolicy,
    resultVersionKey,
    resultVersions,
    groupSnapshot,
    reviewScope,
    humanContextRef: humanContextRef || undefined,
    stateRef: stateRef || undefined,
    prompt,
    oneShot: true,
    targetThread: registration
      ? {
          windowName: registration.windowName,
          threadIdRedacted: true,
          threadRegistryFile: registration.threadRegistryFile,
        }
      : undefined,
    transport: {
      kind: "direct-thread",
      threadRegistryFile: transportThreadRegistryFile,
      readbackRequired: true,
      missingThread: "fail-closed",
    },
    automation: {
      enabled: automationEnabled,
      continuousLoop: automationEnabled,
      keepLive: automationEnabled,
      keepLiveStateFile: automationEnabled ? keepLiveStateFile : undefined,
    },
    deliveryCompletion: {
      required: true,
      pendingUntil: "host-send-readback-recorded",
      completionProof: "DirectThreadDeliveryRun status=sent with readback.ok=true",
      blockedAction: "record-delivery-run status=blocked or failed, then stop for total-control judgment",
    },
    loopGuard: {
      returnReason,
      reviewDecision,
      groupStatus,
      controllerWindow,
      returnPolicy,
      reviewScope,
      deliveryAllowedOnlyFor: ["result-ready", "blocked"],
      controllerReviewRequired: true,
      noEligibleTaskAction: "stop-without-next-delivery",
      resultVersionKey,
      repeatControllerReturnForbiddenForSameResultVersion: true,
      newerResultVersionRequiresNewControllerReturn: true,
      nextDispatchAllowedOnlyWhen: [
        "current plan has eligible unfinished task",
        "target evidence requires controller rework dispatch",
        "user-approved unattended automation remains inside boundary",
      ],
    },
    windowConfig,
    wakeflowTrace,
    createdAt,
  };
}
