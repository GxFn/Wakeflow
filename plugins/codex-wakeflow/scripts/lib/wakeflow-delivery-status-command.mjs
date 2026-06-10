import { existsSync } from "node:fs";
import path from "node:path";
import { buildReplaySummary } from "./wakeflow-idempotency.mjs";
import { buildControllerCallbackPlan } from "./wakeflow-return-policy.mjs";
import {
  buildRuntimeHealth,
  buildRuntimeResumePlan,
  countBy,
  deriveRuntimeGroupStatus,
  summarizeRuntimeNextAction,
} from "./wakeflow-runtime-summary.mjs";

export function commandStatus(ctx) {
  const {
    workspaceRoot,
    stateDir,
    dirs,
    helpText,
    hasFlag,
    output,
    listJsonFiles,
    listJsonArtifacts,
    artifactValues,
    readJsonArtifact,
    keepLiveStatus,
    keepLiveStateFile,
    artifactTrace,
    nowIso,
  } = ctx;

  function statusFromLoadedRuns(envelope, runArtifacts) {
    const runs = runArtifacts
      .filter((item) => item.value?.kind === "DirectThreadDeliveryRun" && item.value.deliveryId === envelope.deliveryId)
      .sort((left, right) => String(left.value.createdAt || "").localeCompare(String(right.value.createdAt || "")));
    const sentRun = [...runs].reverse().find((item) => item.value.status === "sent" && item.value.readback?.ok === true);
    const latestRun = runs[runs.length - 1] || null;
    const status = sentRun
      ? "sent"
      : runs.length === 0
        ? "pending-host-send"
        : latestRun.value.status;
    return {
      deliveryId: envelope.deliveryId,
      kind: envelope.kind,
      targetWindow: envelope.targetWindow || envelope.targetThread?.windowName || envelope.controllerWindow,
      taskId: envelope.taskId || envelope.triggerTaskId,
      dispatchGroup: envelope.dispatchGroup,
      sourcePacketId: envelope.sourcePacketId,
      status,
      sent: Boolean(sentRun),
      readbackOk: Boolean(sentRun?.value.readback?.ok),
      runCount: runs.length,
      latestRunFile: latestRun ? path.relative(workspaceRoot, latestRun.file) : undefined,
      wakeflowTrace: envelope.wakeflowTrace,
    };
  }

  function statusResultForPacket(packet, resultArtifacts, stateRootResultCache, diagnostics) {
    const local = resultArtifacts.find((item) => {
      const result = item.value;
      if (!result) return false;
      if (result.targetWindow !== packet.targetWindow) return false;
      if ((result.targetTaskId || result.taskId) !== packet.taskId) return false;
      return !result.dispatchGroup || result.dispatchGroup === packet.dispatchGroup;
    });
    if (local) return local;

    const stateRootRef = packet.stateRef?.stateRoot;
    if (!stateRootRef) return null;
    if (!stateRootResultCache.has(stateRootRef)) {
      const stateRoot = path.resolve(workspaceRoot, stateRootRef);
      const rel = path.relative(workspaceRoot, stateRoot);
      if (rel.startsWith("..") || path.isAbsolute(rel)) {
        diagnostics.errors.push({ file: stateRootRef, error: "state root is outside workspace" });
        stateRootResultCache.set(stateRootRef, []);
      } else {
        const artifacts = listJsonArtifacts(path.join(stateRoot, "target-results"));
        for (const artifact of artifacts.filter((item) => item.error)) {
          diagnostics.errors.push({
            file: path.relative(workspaceRoot, artifact.file),
            error: artifact.error,
          });
        }
        stateRootResultCache.set(stateRootRef, artifacts);
      }
    }
    return stateRootResultCache.get(stateRootRef).find((item) => {
      const result = item.value;
      return result
        && result.targetTaskId === packet.taskId
        && (!result.targetWindow || result.targetWindow === packet.targetWindow);
    }) || null;
  }

  function buildRuntimeGroupSummaries({ packets, groupArtifacts, resultArtifacts, deliveryStatuses, diagnostics }) {
    const stateRootResultCache = new Map();
    const groupsById = new Map();
    for (const packet of packets) {
      const groupId = packet.dispatchGroup || packet.taskId || packet.id;
      if (!groupsById.has(groupId)) groupsById.set(groupId, []);
      groupsById.get(groupId).push(packet);
    }
    const groupRecords = new Map(groupArtifacts.map((item) => [item.value.groupId, item.value]));
    const deliveryByPacket = new Map();
    for (const delivery of deliveryStatuses.filter((item) => item.kind === "DeliveryEnvelope")) {
      if (!delivery.sourcePacketId) continue;
      if (!deliveryByPacket.has(delivery.sourcePacketId)) deliveryByPacket.set(delivery.sourcePacketId, []);
      deliveryByPacket.get(delivery.sourcePacketId).push(delivery);
    }

    return [...groupsById.entries()].map(([groupId, groupPackets]) => {
      const packetSummaries = groupPackets.map((packet) => {
        const deliveries = deliveryByPacket.get(packet.id) || [];
        const result = statusResultForPacket(packet, resultArtifacts, stateRootResultCache, diagnostics);
        const deliverySent = deliveries.some((item) => item.status === "sent");
        const deliveryPending = deliveries.some((item) => item.status === "pending-host-send");
        const resultStatus = result?.value?.status
          || (deliverySent ? "missing" : deliveryPending ? "pending-host-send" : "pending-dispatch");
        return {
          packetId: packet.id,
          targetWindow: packet.targetWindow,
          taskId: packet.taskId,
          stateRoot: packet.stateRef?.stateRoot,
          status: resultStatus,
          deliveryStatus: deliveries[0]?.status || "not-built",
          resultFile: result ? path.relative(workspaceRoot, result.file) : undefined,
        };
      });
      const counts = countBy(packetSummaries, "status");
      const groupStatus = deriveRuntimeGroupStatus(counts);
      const returnPolicy = groupRecords.get(groupId)?.returnPolicy || groupPackets[0]?.returnPolicy || { mode: "group-ready" };
      const callbackSnapshot = {
        groupId,
        returnPolicy,
        groupStatus,
        expected: packetSummaries,
        ready: packetSummaries.filter((item) => !["missing", "pending-dispatch", "pending-host-send", "blocked"].includes(item.status)),
        blocked: packetSummaries.filter((item) => item.status === "blocked"),
        missing: packetSummaries.filter((item) => item.status === "missing"),
        pendingDispatch: packetSummaries.filter((item) => ["pending-dispatch", "pending-host-send"].includes(item.status)),
      };
      const callbackPlan = buildControllerCallbackPlan({
        dispatchGroup: groupId,
        returnPolicy,
        groupSnapshot: callbackSnapshot,
        controllerReturnDeliveries: deliveryStatuses.filter((item) => item.kind === "ControllerReturnEnvelope" && item.dispatchGroup === groupId),
      });
      return {
        groupId,
        returnPolicy,
        stateRoot: groupRecords.get(groupId)?.stateRef?.stateRoot || groupPackets.find((packet) => packet.stateRef?.stateRoot)?.stateRef?.stateRoot,
        groupStatus,
        targets: packetSummaries,
        counts,
        callbackPlan,
      };
    });
  }

  function collectProjectionHealth({ packets, diagnostics }) {
    const stateRootRefs = [...new Set(packets.map((packet) => packet.stateRef?.stateRoot).filter(Boolean))];
    return stateRootRefs.flatMap((stateRootRef) => {
      const stateRoot = path.resolve(workspaceRoot, stateRootRef);
      const rel = path.relative(workspaceRoot, stateRoot);
      if (rel.startsWith("..") || path.isAbsolute(rel)) {
        diagnostics.errors.push({ file: stateRootRef, error: "state root is outside workspace" });
        return [];
      }
      const stateFile = path.join(stateRoot, "wakeflow-state.json");
      if (!existsSync(stateFile)) {
        diagnostics.errors.push({ file: path.relative(workspaceRoot, stateFile), error: "state root is missing wakeflow-state.json" });
        return [];
      }
      const artifact = readJsonArtifact(stateFile);
      if (artifact.error) {
        diagnostics.errors.push({ file: path.relative(workspaceRoot, stateFile), error: artifact.error });
        return [];
      }
      const state = artifact.value;
      return [{
        stateRoot: stateRootRef,
        demandKey: state.demandKey,
        state: state.state,
        stateRevision: state.revision,
        projectionStatus: state.projection?.status || "unknown",
        progressDoc: state.projection?.progressDoc,
        updatedAt: state.updatedAt,
      }];
    });
  }

  function buildRuntimeSummary({
    packetCount,
    groupCount,
    deliveryCount,
    deliveryRunCount,
    resultCount,
    registeredThreadCount,
    windowConfigCount,
    keepLive,
  }) {
    const packetArtifacts = listJsonArtifacts(dirs.packets);
    const groupArtifacts = listJsonArtifacts(dirs.groups);
    const deliveryArtifacts = listJsonArtifacts(dirs.deliveries);
    const runArtifacts = listJsonArtifacts(dirs.deliveryRuns);
    const resultArtifacts = listJsonArtifacts(dirs.results);
    const diagnostics = {
      errors: [...packetArtifacts, ...groupArtifacts, ...deliveryArtifacts, ...runArtifacts, ...resultArtifacts]
        .filter((item) => item.error)
        .map((item) => ({ file: path.relative(workspaceRoot, item.file), error: item.error })),
    };
    const packets = artifactValues(packetArtifacts, "ControllerDispatchPacket").map((item) => item.value);
    const groups = artifactValues(groupArtifacts, "DispatchGroup");
    const results = artifactValues(resultArtifacts);
    const replaySummary = buildReplaySummary({
      deliveryRuns: artifactValues(runArtifacts, "DirectThreadDeliveryRun").map((item) => item.value),
      targetResults: results.map((item) => item.value),
    });
    const projectionHealth = collectProjectionHealth({ packets, diagnostics });
    const deliveryStatuses = artifactValues(deliveryArtifacts)
      .filter((item) => ["DeliveryEnvelope", "ControllerReturnEnvelope"].includes(item.value?.kind))
      .map((item) => ({
        file: path.relative(workspaceRoot, item.file),
        ...statusFromLoadedRuns(item.value, runArtifacts),
      }));
    const groupSummaries = buildRuntimeGroupSummaries({
      packets,
      groupArtifacts: groups,
      resultArtifacts: results,
      deliveryStatuses,
      diagnostics,
    });
    const deliveryCounts = countBy(deliveryStatuses, "status");
    const groupCounts = countBy(groupSummaries, "groupStatus");
    const nextAction = summarizeRuntimeNextAction({ diagnostics, deliveryStatuses, groupSummaries });
    const resumePlan = buildRuntimeResumePlan({
      nextAction,
      diagnostics,
      deliveryStatuses,
      groupSummaries,
    });
    const health = buildRuntimeHealth({
      diagnostics,
      deliveryStatuses,
      groupSummaries,
      replaySummary,
      projectionHealth,
      keepLive,
    });
    return {
      kind: "WakeflowClosedLoopRuntimeSummary",
      version: 1,
      status: health.status === "blocked" ? "blocked" : nextAction === "idle" ? "idle" : "active",
      nextAction,
      wakeflowTrace: artifactTrace({
        artifactKind: "runtime-summary",
        createdAt: nowIso(),
      }),
      health,
      resumePlan,
      totals: {
        packetCount,
        groupCount,
        deliveryCount,
        deliveryRunCount,
        resultCount,
        registeredThreadCount,
        windowConfigCount,
      },
      keepLive: {
        active: Boolean(keepLive.active),
        status: keepLive.status,
      },
      deliveries: {
        counts: deliveryCounts,
        pendingHostSend: deliveryStatuses.filter((item) => item.status === "pending-host-send"),
        sent: deliveryStatuses.filter((item) => item.status === "sent"),
        failed: deliveryStatuses.filter((item) => item.status === "failed"),
        blocked: deliveryStatuses.filter((item) => item.status === "blocked"),
      },
      groups: {
        counts: groupCounts,
        items: groupSummaries,
      },
      replay: replaySummary,
      diagnostics,
    };
  }

  if (hasFlag("--help") || hasFlag("-h")) {
    console.log(helpText);
    return;
  }
  const packetCount = listJsonFiles(dirs.packets).length;
  const groupCount = listJsonFiles(dirs.groups).length;
  const deliveryCount = listJsonFiles(dirs.deliveries).length;
  const deliveryRunCount = listJsonFiles(dirs.deliveryRuns).length;
  const resultCount = listJsonFiles(dirs.results).length;
  const registeredThreadCount = listJsonFiles(dirs.registry).length;
  const windowConfigCount = listJsonFiles(dirs.windowConfig).length;
  const keepLive = keepLiveStatus();
  const keepLiveStateExists = existsSync(keepLiveStateFile());
  const runtimeSummary = buildRuntimeSummary({
    packetCount,
    groupCount,
    deliveryCount,
    deliveryRunCount,
    resultCount,
    registeredThreadCount,
    windowConfigCount,
    keepLive,
  });
  output(
    {
      ok: true,
      command: "status",
      stateDir,
      packetCount,
      groupCount,
      deliveryCount,
      deliveryRunCount,
      resultCount,
      registeredThreadCount,
      windowConfigCount,
      keepLiveStateExists,
      keepLive,
      runtimeSummary,
    },
    [
      "Wakeflow delivery-loop status",
      `State: ${path.relative(workspaceRoot, stateDir) || "."}`,
      `Dispatch packets: ${packetCount}`,
      `Dispatch groups: ${groupCount}`,
      `Delivery envelopes: ${deliveryCount}`,
      `Delivery runs: ${deliveryRunCount}`,
      `Target results: ${resultCount}`,
      `Registered threads: ${registeredThreadCount}`,
      `Window configs: ${windowConfigCount}`,
      `Keep-live: ${keepLive.active ? `active worker=${keepLive.workerPid} child=${keepLive.childPid}` : keepLive.status}`,
      `Next action: ${runtimeSummary.nextAction}`,
    ],
  );
}
