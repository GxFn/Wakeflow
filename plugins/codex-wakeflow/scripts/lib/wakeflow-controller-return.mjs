export function formatPromptTargetList(targets) {
  const uniqueTargets = [...new Set((targets || []).filter(Boolean))];
  return uniqueTargets.length > 0 ? uniqueTargets.join(", ") : "None";
}

export function formatControllerReturnPrompt({
  dispatchGroup,
  triggerTarget,
  triggerTaskId,
  stateRef,
  reviewScope,
  groupSnapshot,
}) {
  if (!stateRef) throw new Error("Controller return prompts require stateRef from a controller state root.");
  const returnedTargets = [
    ...(groupSnapshot.readyTargets || []),
    ...(groupSnapshot.blockedTargets || []),
  ];
  const titleTargets = reviewScope === "group"
    ? formatPromptTargetList(returnedTargets)
    : triggerTarget;
  const title = reviewScope === "group"
    ? `Continue controller review: ${titleTargets} backfill.`
    : `Continue controller review: ${triggerTarget} backfill.`;
  const blockedTargets = formatPromptTargetList(groupSnapshot.blockedTargets);
  const remainingTargets = formatPromptTargetList(groupSnapshot.missingTargets);
  const pendingDispatchTargets = formatPromptTargetList(groupSnapshot.pendingDispatchTargets);
  const hasBlockedTargets = Array.isArray(groupSnapshot.blockedTargets) && groupSnapshot.blockedTargets.length > 0;
  const hasRemainingTargets = Array.isArray(groupSnapshot.missingTargets) && groupSnapshot.missingTargets.length > 0;
  const hasPendingDispatchTargets = Array.isArray(groupSnapshot.pendingDispatchTargets) && groupSnapshot.pendingDispatchTargets.length > 0;
  return [
    title,
    "",
    "Variables:",
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
}) {
  const prompt = formatControllerReturnPrompt({
    dispatchGroup,
    triggerTarget,
    triggerTaskId,
    stateRef,
    reviewScope,
    groupSnapshot,
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
      repeatControllerReturnForbidden: true,
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
