import path from "node:path";

export function createDispatchGroupReview(ctx) {
  const {
    workspaceRoot,
    version,
    artifactTrace,
    fail,
    loadDispatchGroup,
    targetDescriptor,
    dispatchGroupStateRef,
    deliveryExpectationForPacket,
  } = ctx;

  function targetKey({ targetWindow, taskId }) {
    return `${targetWindow}\u0000${taskId}`;
  }

  function orderResultsByGroup({ groupRecord, results }) {
    const expectedTargets = Array.isArray(groupRecord?.expectedTargets) ? groupRecord.expectedTargets : [];
    const order = new Map(expectedTargets.map((target, index) => [targetKey(target), index]));
    return [...results].sort((left, right) => {
      const leftOrder = order.get(targetKey(left.packet)) ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = order.get(targetKey(right.packet)) ?? Number.MAX_SAFE_INTEGER;
      if (leftOrder !== rightOrder) return leftOrder - rightOrder;
      return String(left.packet.id).localeCompare(String(right.packet.id));
    });
  }

  function groupFromPackets({ groupId = "", packets = [] }) {
    if (!groupId) return null;
    const existing = loadDispatchGroup(groupId);
    if (existing) return existing;
    const firstPacket = packets[0] || {};
    if (!firstPacket.stateRef) {
      fail(`Dispatch group ${groupId} is missing stateRef; legacy Markdown-plan groups are no longer supported.`);
    }
    return {
      kind: "DispatchGroup",
      version,
      groupId,
      humanContextRef: firstPacket.humanContextRef,
      stateRef: dispatchGroupStateRef(firstPacket.stateRef) || firstPacket.stateRef,
      controllerWindow: firstPacket.controllerWindow,
      expectedTargets: packets.map((packet) => targetDescriptor({
        targetWindow: packet.targetWindow,
        taskId: packet.taskId,
        packetId: packet.id,
      })),
      returnPolicy: firstPacket.returnPolicy || { mode: "group-ready" },
      reconstructedFromPackets: true,
      wakeflowTrace: artifactTrace({
        artifactKind: "dispatch-group",
        createdAt: firstPacket.createdAt,
        dispatchGroup: groupId,
        stateRef: firstPacket.stateRef,
      }),
      createdAt: firstPacket.createdAt,
      updatedAt: firstPacket.createdAt,
    };
  }

  function resultSummary(item) {
    const delivery = deliveryExpectationForPacket(item.packet.id);
    const resultStatus = item.result?.status || (delivery.resultExpected ? "missing" : "pending-dispatch");
    return {
      packetId: item.packet.id,
      targetWindow: item.packet.targetWindow,
      taskId: item.packet.taskId,
      status: resultStatus,
      resultFile: item.result ? path.relative(workspaceRoot, item.file) : undefined,
      resultExpected: delivery.resultExpected,
      deliveryStatus: delivery.status,
      deliveryCount: delivery.count,
    };
  }

  function uniqueTargetNames(items) {
    return [...new Set(items.map((item) => item.packet?.targetWindow ?? item.targetWindow).filter(Boolean))];
  }

  function buildGroupSnapshot({ groupRecord, results }) {
    const annotated = results.map((item) => ({
      item,
      summary: resultSummary(item),
    }));
    const expectedResults = annotated.map((item) => item.summary);
    const ready = annotated.filter((item) => item.item.result && item.item.result.status !== "blocked");
    const blocked = annotated.filter((item) => item.item.result?.status === "blocked");
    const missing = annotated.filter((item) => !item.item.result && item.summary.resultExpected);
    const pendingDispatch = annotated.filter((item) => !item.item.result && !item.summary.resultExpected);
    const completed = ready.filter((item) => item.item.result?.status === "completed");
    const needsReview = ready.filter((item) => item.item.result?.status === "needs-review");
    const allSentResultsPresent = missing.length === 0;
    const allResultsPresent = missing.length === 0 && pendingDispatch.length === 0;
    const groupStatus = missing.length > 0
      ? ready.length > 0 || blocked.length > 0
        ? "partially-ready"
        : "waiting"
      : ready.length > 0 || blocked.length > 0
        ? pendingDispatch.length > 0
          ? "partially-ready"
          : blocked.length > 0
            ? "blocked"
            : "ready"
        : pendingDispatch.length > 0
          ? "pending-dispatch"
          : "waiting";

    return {
      groupId: groupRecord?.groupId,
      controllerWindow: groupRecord?.controllerWindow,
      returnPolicy: groupRecord?.returnPolicy || { mode: "group-ready" },
      groupStatus,
      expected: expectedResults,
      completed: completed.map((item) => item.summary),
      ready: ready.map((item) => item.summary),
      blocked: blocked.map((item) => item.summary),
      missing: missing.map((item) => item.summary),
      pendingDispatch: pendingDispatch.map((item) => item.summary),
      needsReview: needsReview.map((item) => item.summary),
      expectedTargets: uniqueTargetNames(results.map((item) => item.packet)),
      completedTargets: uniqueTargetNames(completed.map((item) => item.item.packet)),
      readyTargets: uniqueTargetNames(ready.map((item) => item.item.packet)),
      blockedTargets: uniqueTargetNames(blocked.map((item) => item.item.packet)),
      missingTargets: uniqueTargetNames(missing.map((item) => item.item.packet)),
      pendingDispatchTargets: uniqueTargetNames(pendingDispatch.map((item) => item.item.packet)),
      allResultsPresent,
      allSentResultsPresent,
      reconstructedFromPackets: Boolean(groupRecord?.reconstructedFromPackets),
    };
  }

  return {
    groupFromPackets,
    orderResultsByGroup,
    buildGroupSnapshot,
  };
}
