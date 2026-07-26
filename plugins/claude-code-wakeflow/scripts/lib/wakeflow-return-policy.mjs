export const returnPolicyModes = Object.freeze(["group-ready", "per-target"]);

export function normalizeReturnPolicyMode(value = "group-ready") {
  const mode = value || "group-ready";
  if (!returnPolicyModes.includes(mode)) {
    throw new Error(`Invalid return policy mode: ${value}`);
  }
  return mode;
}

export function returnPolicyReviewScope(returnPolicy = {}) {
  return normalizeReturnPolicyMode(returnPolicy.mode || returnPolicy) === "group-ready"
    ? "group"
    : "single-target";
}

export function controllerReturnDuplicateSelector({
  returnPolicy = {},
  triggerTarget = "",
  triggerTaskId = "",
  resultVersionKey = "",
} = {}) {
  const mode = normalizeReturnPolicyMode(returnPolicy.mode || returnPolicy);
  return {
    ...(mode === "per-target" ? { triggerTarget, triggerTaskId } : {}),
    ...(resultVersionKey ? { resultVersionKey } : {}),
  };
}

export function controllerReturnDuplicateScopeText({
  returnPolicy = {},
  triggerTarget = "",
  triggerTaskId = "",
  resultVersions = [],
} = {}) {
  const mode = normalizeReturnPolicyMode(returnPolicy.mode || returnPolicy);
  const targetScope = mode === "per-target" ? ` for ${triggerTarget} / ${triggerTaskId}` : "";
  const revisionScope = resultVersions.length === 1
    ? ` result revision ${resultVersions[0].resultRevision}`
    : resultVersions.length > 1
      ? ` result revisions ${resultVersions.map((item) => item.resultRevision).join("/")}`
      : "";
  return `${targetScope}${revisionScope}`;
}

function normalizeResultRevision(value) {
  const revision = Number(value ?? 1);
  return Number.isInteger(revision) && revision > 0 ? revision : 1;
}

function resultVersionsFor(items = []) {
  return items
    .filter((item) => item?.targetWindow && item?.taskId)
    .map((item) => ({
      targetWindow: item.targetWindow,
      taskId: item.taskId,
      resultRevision: normalizeResultRevision(item.resultRevision),
    }))
    .sort((left, right) => (
      String(left.targetWindow).localeCompare(String(right.targetWindow))
      || String(left.taskId).localeCompare(String(right.taskId))
    ));
}

function resultVersionKey(resultVersions = []) {
  return resultVersions
    .map((item) => `${item.targetWindow}\u0000${item.taskId}\u0000r${item.resultRevision}`)
    .join("\u0001");
}

export function controllerReturnResultVersion({
  returnPolicy = {},
  groupSnapshot = {},
  triggerTarget = "",
  triggerTaskId = "",
} = {}) {
  const mode = normalizeReturnPolicyMode(returnPolicy.mode || returnPolicy);
  const returnable = [...(groupSnapshot.ready || []), ...(groupSnapshot.blocked || [])];
  const selected = mode === "per-target"
    ? returnable.filter((item) => item.targetWindow === triggerTarget && item.taskId === triggerTaskId)
    : returnable;
  const resultVersions = resultVersionsFor(selected);
  return {
    resultVersions,
    resultVersionKey: resultVersionKey(resultVersions),
    deliveryIdSuffix: resultVersions.length === 0
      ? ""
      : resultVersions.length === 1
        ? `r${resultVersions[0].resultRevision}`
        : `r${resultVersions.map((item) => item.resultRevision).join("-")}`,
  };
}

function deliveriesForResultVersion(deliveries = [], version = {}) {
  return deliveries.filter((delivery) => (
    delivery.resultVersionKey
    && delivery.resultVersionKey === version.resultVersionKey
  ));
}

export function controllerReturnReadinessIssue({ review, triggerTarget, triggerTaskId } = {}) {
  const trigger = (review?.results || [])
    .find((item) => item.packet.targetWindow === triggerTarget && item.packet.taskId === triggerTaskId);
  if (!trigger) {
    return {
      code: "trigger-target-not-in-group",
      message: `Trigger target ${triggerTarget} / ${triggerTaskId} is not part of dispatch group ${review?.group}.`,
    };
  }
  if (!trigger.result) {
    return {
      code: "trigger-result-missing",
      message: `Cannot build controller return before trigger target result exists: ${triggerTarget} / ${triggerTaskId}.`,
    };
  }

  const mode = normalizeReturnPolicyMode(review?.returnPolicy?.mode);
  const blockerReturn = trigger.result.status === "blocked";
  if (mode === "group-ready" && !review.groupSnapshot.allSentResultsPresent && !blockerReturn) {
    return {
      code: "group-ready-missing-sent-results",
      message: `Cannot build group-ready controller return while dispatch group has sent targets missing results: ${review.groupSnapshot.missing.map((item) => item.packetId).join(", ")}`,
    };
  }
  if (mode === "group-ready" && review.groupSnapshot.ready.length === 0 && review.groupSnapshot.blocked.length === 0) {
    return {
      code: "group-ready-no-ready-result",
      message: "Cannot build group-ready controller return before any sent target result is ready.",
    };
  }
  return null;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function existingDeliveryStatus(deliveries = []) {
  if (deliveries.some((item) => item.status === "pending-host-send")) return "pending-host-send";
  if (deliveries.some((item) => item.status === "sent")) return "sent";
  if (deliveries.some((item) => item.status === "failed")) return "failed";
  if (deliveries.some((item) => item.status === "blocked")) return "blocked";
  return deliveries.length > 0 ? "unknown" : "not-built";
}

function callbackUnitStatus({ mode, returnable, blockerReturnable, missingSent, existingDeliveries }) {
  const existingStatus = existingDeliveryStatus(existingDeliveries);
  if (existingStatus !== "not-built") return existingStatus;
  if (mode === "group-ready" && missingSent.length > 0 && !blockerReturnable) return "waiting-for-sent-results";
  if (!returnable) return "waiting-for-result";
  return "ready-to-build-controller-return";
}

export function buildControllerCallbackPlan({
  dispatchGroup = "",
  returnPolicy = {},
  groupSnapshot = {},
  controllerReturnDeliveries = [],
} = {}) {
  const mode = normalizeReturnPolicyMode(returnPolicy.mode || returnPolicy || "group-ready");
  const ready = groupSnapshot.ready || [];
  const blocked = groupSnapshot.blocked || [];
  const missing = groupSnapshot.missing || [];
  const pendingDispatch = groupSnapshot.pendingDispatch || [];
  const returnable = [...ready, ...blocked];
  const groupVersion = mode === "group-ready"
    ? controllerReturnResultVersion({ returnPolicy: { mode }, groupSnapshot })
    : null;
  const groupExistingDeliveries = groupVersion
    ? deliveriesForResultVersion(controllerReturnDeliveries, groupVersion)
    : [];

  const units = mode === "group-ready"
    ? [{
        scope: "group",
        dispatchGroup,
        triggerTarget: returnable[0]?.targetWindow,
        triggerTaskId: returnable[0]?.taskId,
        coveredTargets: unique(returnable.map((item) => item.targetWindow)),
        missingSentTargets: unique(missing.map((item) => item.targetWindow)),
        pendingDispatchTargets: unique(pendingDispatch.map((item) => item.targetWindow)),
        ...groupVersion,
        existingDeliveries: groupExistingDeliveries,
        status: callbackUnitStatus({
          mode,
          returnable: returnable.length > 0,
          blockerReturnable: blocked.length > 0,
          missingSent: missing,
          existingDeliveries: groupExistingDeliveries,
        }),
      }]
    : returnable.map((item) => {
        const version = controllerReturnResultVersion({
          returnPolicy: { mode },
          groupSnapshot,
          triggerTarget: item.targetWindow,
          triggerTaskId: item.taskId,
        });
        const targetDeliveries = controllerReturnDeliveries
          .filter((delivery) => delivery.triggerTarget === item.targetWindow && delivery.triggerTaskId === item.taskId);
        const existingDeliveries = deliveriesForResultVersion(targetDeliveries, version);
        return {
          scope: "target",
          dispatchGroup,
          triggerTarget: item.targetWindow,
          triggerTaskId: item.taskId,
          coveredTargets: [item.targetWindow].filter(Boolean),
          missingSentTargets: [],
          pendingDispatchTargets: unique(pendingDispatch.map((pending) => pending.targetWindow)),
          ...version,
          existingDeliveries,
          status: callbackUnitStatus({
            mode,
            returnable: true,
            blockerReturnable: item.status === "blocked",
            missingSent: [],
            existingDeliveries,
          }),
        };
      });

  const normalizedUnits = units.map((unit) => ({
    ...unit,
    buildAllowed: unit.status === "ready-to-build-controller-return",
    hostSendRequired: unit.status === "pending-host-send",
    controllerAlreadyReached: unit.status === "sent",
    failureNeedsReview: ["failed", "blocked", "unknown"].includes(unit.status),
  }));
  const statusCounts = normalizedUnits.reduce((acc, unit) => {
    acc[unit.status] = (acc[unit.status] || 0) + 1;
    return acc;
  }, {});

  return {
    kind: "WakeflowControllerCallbackPlan",
    version: 1,
    dispatchGroup: dispatchGroup || undefined,
    returnPolicy: { mode },
    status: statusCounts["ready-to-build-controller-return"] > 0
      ? "ready-to-build"
      : statusCounts["pending-host-send"] > 0
        ? "pending-host-send"
        : statusCounts.sent > 0
          ? "sent"
          : statusCounts.failed > 0 || statusCounts.blocked > 0 || statusCounts.unknown > 0
            ? "needs-transport-review"
            : "waiting",
    counts: {
      unitCount: normalizedUnits.length,
      readyToBuildCount: statusCounts["ready-to-build-controller-return"] || 0,
      pendingHostSendCount: statusCounts["pending-host-send"] || 0,
      sentCount: statusCounts.sent || 0,
      waitingForSentResultsCount: statusCounts["waiting-for-sent-results"] || 0,
      waitingForResultCount: statusCounts["waiting-for-result"] || 0,
      transportReviewCount: (statusCounts.failed || 0) + (statusCounts.blocked || 0) + (statusCounts.unknown || 0),
    },
    units: normalizedUnits,
    forbiddenConclusions: [
      "callback-plan-is-controller-acceptance",
      "callback-plan-sends-host-message",
      "callback-plan-creates-target-result",
    ],
  };
}
