import path from "node:path";
import { controllerReturnResultVersion } from "./wakeflow-return-policy.mjs";

export function createDeliveryEvidence(ctx) {
  const {
    workspaceRoot,
    dirs,
    listJsonFiles,
    readJson,
  } = ctx;

  function deliveryRunsFor(deliveryId) {
    return listJsonFiles(dirs.deliveryRuns)
      .map((file) => ({
        file,
        run: readJson(file, "delivery run"),
      }))
      .filter((item) => item.run.kind === "DirectThreadDeliveryRun" && item.run.deliveryId === deliveryId)
      .sort((a, b) => String(a.run.createdAt || "").localeCompare(String(b.run.createdAt || "")));
  }

  function resultVersionForEnvelope(envelope) {
    if (envelope.kind !== "ControllerReturnEnvelope") {
      return {
        resultVersionKey: envelope.resultVersionKey,
        resultVersions: envelope.resultVersions,
      };
    }
    const derived = controllerReturnResultVersion({
      returnPolicy: envelope.returnPolicy,
      groupSnapshot: envelope.groupSnapshot,
      triggerTarget: envelope.triggerTarget,
      triggerTaskId: envelope.triggerTaskId,
    });
    return {
      resultVersionKey: envelope.resultVersionKey || derived.resultVersionKey,
      resultVersions: envelope.resultVersions || derived.resultVersions,
    };
  }

  function deliveryRunStatusForEnvelope(envelope) {
    const runs = deliveryRunsFor(envelope.deliveryId);
    const sentRun = runs.findLast?.((item) => item.run.status === "sent" && item.run.readback?.ok === true)
      || [...runs].reverse().find((item) => item.run.status === "sent" && item.run.readback?.ok === true);
    const latestRun = runs[runs.length - 1] || null;
    const status = sentRun
      ? "sent"
      : runs.length === 0
        ? "pending-host-send"
        : latestRun.run.status;
    const resultVersion = resultVersionForEnvelope(envelope);

    return {
      deliveryId: envelope.deliveryId,
      kind: envelope.kind,
      targetWindow: envelope.targetWindow || envelope.targetThread?.windowName,
      taskId: envelope.taskId || envelope.triggerTaskId,
      dispatchGroup: envelope.dispatchGroup,
      triggerTarget: envelope.triggerTarget,
      triggerTaskId: envelope.triggerTaskId,
      resultVersionKey: resultVersion.resultVersionKey,
      resultVersions: resultVersion.resultVersions,
      reviewScope: envelope.reviewScope,
      returnPolicy: envelope.returnPolicy,
      groupStatus: envelope.groupSnapshot?.groupStatus,
      status,
      sent: Boolean(sentRun),
      readbackOk: Boolean(sentRun?.run.readback?.ok),
      runCount: runs.length,
      latestRunFile: latestRun ? path.relative(workspaceRoot, latestRun.file) : undefined,
    };
  }

  function controllerReturnDeliveryStatusForGroup(
    dispatchGroup,
    {
      triggerTarget = "",
      triggerTaskId = "",
      resultVersionKey = "",
    } = {},
  ) {
    if (!dispatchGroup) {
      return {
        status: "not-applicable",
        dispatchGroup: undefined,
        triggerTarget: triggerTarget || undefined,
        triggerTaskId: triggerTaskId || undefined,
        envelopeCount: 0,
        sentCount: 0,
        pendingCount: 0,
        failedCount: 0,
        blockedCount: 0,
        deliveries: [],
      };
    }

    const deliveries = listJsonFiles(dirs.deliveries)
      .map((file) => ({
        file,
        envelope: readJson(file, "delivery envelope"),
      }))
      .filter((item) => item.envelope.kind === "ControllerReturnEnvelope" && item.envelope.dispatchGroup === dispatchGroup)
      .filter((item) => !triggerTarget || item.envelope.triggerTarget === triggerTarget)
      .filter((item) => !triggerTaskId || item.envelope.triggerTaskId === triggerTaskId)
      .filter((item) => {
        if (!resultVersionKey) return true;
        return resultVersionForEnvelope(item.envelope).resultVersionKey === resultVersionKey;
      })
      .map((item) => ({
        file: path.relative(workspaceRoot, item.file),
        ...deliveryRunStatusForEnvelope(item.envelope),
      }));

    const sentCount = deliveries.filter((item) => item.status === "sent").length;
    const pendingCount = deliveries.filter((item) => item.status === "pending-host-send").length;
    const failedCount = deliveries.filter((item) => item.status === "failed").length;
    const blockedCount = deliveries.filter((item) => item.status === "blocked").length;
    const status = deliveries.length === 0
      ? "not-built"
      : sentCount > 0
        ? "sent"
        : pendingCount > 0
          ? "pending-host-send"
          : failedCount > 0
            ? "failed"
            : blockedCount > 0
              ? "blocked"
              : "unknown";

    return {
      status,
      dispatchGroup,
      triggerTarget: triggerTarget || undefined,
      triggerTaskId: triggerTaskId || undefined,
      envelopeCount: deliveries.length,
      sentCount,
      pendingCount,
      failedCount,
      blockedCount,
      deliveries,
    };
  }

  function targetDeliveryStatusesForPacket(packetId) {
    return listJsonFiles(dirs.deliveries)
      .map((file) => ({
        file,
        envelope: readJson(file, "delivery envelope"),
      }))
      .filter((item) => item.envelope.kind === "DeliveryEnvelope" && item.envelope.sourcePacketId === packetId)
      .map((item) => ({
        file: path.relative(workspaceRoot, item.file),
        ...deliveryRunStatusForEnvelope(item.envelope),
      }));
  }

  function deliveryExpectationForPacket(packetId) {
    const deliveries = targetDeliveryStatusesForPacket(packetId);
    if (deliveries.some((item) => item.status === "sent")) {
      return {
        status: "sent",
        resultExpected: true,
        count: deliveries.length,
      };
    }
    if (deliveries.some((item) => item.status === "pending-host-send")) {
      return {
        status: "pending-host-send",
        resultExpected: false,
        count: deliveries.length,
      };
    }
    if (deliveries.some((item) => item.status === "failed")) {
      return {
        status: "failed",
        resultExpected: false,
        count: deliveries.length,
      };
    }
    if (deliveries.some((item) => item.status === "blocked")) {
      return {
        status: "blocked",
        resultExpected: false,
        count: deliveries.length,
      };
    }
    return {
      status: deliveries.length > 0 ? "unknown" : "not-built",
      resultExpected: false,
      count: deliveries.length,
    };
  }

  return {
    deliveryRunsFor,
    deliveryRunStatusForEnvelope,
    controllerReturnDeliveryStatusForGroup,
    targetDeliveryStatusesForPacket,
    deliveryExpectationForPacket,
  };
}
