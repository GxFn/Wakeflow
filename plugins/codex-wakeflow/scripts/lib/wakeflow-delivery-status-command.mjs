import { existsSync, readdirSync, readFileSync } from "node:fs";
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

function scanDemandHostOwnership(workspaceRoot) {
  // Active demand state roots live under the conventional current-plan dir.
  // Read-only visibility: which host's controller owns each active demand.
  const currentDir = path.join(workspaceRoot, ".wakeflow-active/current");
  if (!existsSync(currentDir)) return [];
  const active = [];
  const byHost = {};
  let total = 0;
  for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const stateFile = path.join(currentDir, entry.name, "wakeflow-state.json");
    if (!existsSync(stateFile)) continue;
    try {
      const state = JSON.parse(readFileSync(stateFile, "utf8"));
      total += 1;
      const host = state.controllerHost ?? "unclaimed";
      byHost[host] = (byHost[host] ?? 0) + 1;
      // completed/archived demands stay countable but are dropped from the
      // embedded list: the live workspace can hold ~100 state roots and the
      // status payload feeds straight into agent context.
      if (["completed", "archived"].includes(state.state)) continue;
      active.push({
        demandKey: state.demandKey,
        stateRoot: `.wakeflow-active/current/${entry.name}`,
        controllerHost: state.controllerHost ?? null,
        state: state.state,
      });
    } catch {
      // unreadable state roots are skipped; verify reports them separately
    }
  }
  const cap = 30;
  return {
    total,
    activeCount: active.length,
    byHost,
    truncated: active.length > cap ? active.length - cap : 0,
    demands: active.slice(0, cap),
  };
}

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
    listHostRuntimes,
    listFreshWindowLocks,
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

  function compactArray(items = [], limit = 10) {
    const list = Array.isArray(items) ? items : [];
    return list.slice(0, limit);
  }

  function truncatedCount(items = [], limit = 10) {
    return Math.max(0, (Array.isArray(items) ? items.length : 0) - limit);
  }

  function compactKeepLive(value = {}) {
    return {
      active: Boolean(value.active),
      status: value.status || "unknown",
      workerPid: value.workerPid,
      childPid: value.childPid,
      activeRunCount: value.activeRunCount,
      stateFile: value.stateFile,
    };
  }

  function compactDeliveryStatus(item = {}) {
    return {
      file: item.file,
      deliveryId: item.deliveryId,
      kind: item.kind,
      targetWindow: item.targetWindow,
      taskId: item.taskId,
      dispatchGroup: item.dispatchGroup,
      status: item.status,
      sent: item.sent,
      readbackOk: item.readbackOk,
      runCount: item.runCount,
      latestRunFile: item.latestRunFile,
    };
  }

  function compactGroupSummary(item = {}) {
    return {
      groupId: item.groupId,
      stateRoot: item.stateRoot,
      groupStatus: item.groupStatus,
      returnMode: item.returnPolicy?.mode,
      counts: item.counts || {},
      targetCount: item.targets?.length || 0,
      callbackPlan: item.callbackPlan
        ? {
            status: item.callbackPlan.status,
            nextAction: item.callbackPlan.nextAction,
            ready: item.callbackPlan.ready,
            reason: item.callbackPlan.reason,
            controllerReturnRequired: item.callbackPlan.controllerReturnRequired,
            hostSendRequired: item.callbackPlan.hostSendRequired,
          }
        : undefined,
    };
  }

  function compactRuntimeSummary(summary) {
    const resumePlan = summary.resumePlan || {};
    const health = summary.health || {};
    const replay = summary.replay || {};
    return {
      kind: summary.kind,
      version: summary.version,
      status: summary.status,
      nextAction: summary.nextAction,
      wakeflowTrace: summary.wakeflowTrace,
      totals: summary.totals,
      keepLive: summary.keepLive,
      health: {
        ...health,
        checks: {
          ...health.checks,
          projection: health.checks?.projection
            ? {
                ...health.checks.projection,
                staleStateRoots: health.checks.projection.staleStateRoots?.slice(0, 10) || [],
                staleStateRootsTruncated: Math.max(0, (health.checks.projection.staleStateRoots?.length || 0) - 10),
              }
            : undefined,
        },
        issues: compactArray(health.issues, 10),
      },
      resumePlan: {
        ...resumePlan,
        steps: compactArray(resumePlan.steps, 10),
        stepsTruncated: truncatedCount(resumePlan.steps, 10),
      },
      deliveries: {
        counts: summary.deliveries?.counts || {},
        pendingHostSend: compactArray(summary.deliveries?.pendingHostSend, 10).map(compactDeliveryStatus),
        failed: compactArray(summary.deliveries?.failed, 10).map(compactDeliveryStatus),
        blocked: compactArray(summary.deliveries?.blocked, 10).map(compactDeliveryStatus),
        sentCount: summary.deliveries?.sent?.length || 0,
      },
      groups: {
        counts: summary.groups?.counts || {},
        items: compactArray(summary.groups?.items, 10).map(compactGroupSummary),
        itemsTruncated: truncatedCount(summary.groups?.items, 10),
      },
      replay: {
        kind: replay.kind,
        version: replay.version,
        status: replay.status,
        deliveryAttemptCount: replay.deliveryAttemptCount,
        repeatedDeliveryAttemptCount: replay.repeatedDeliveryAttemptCount,
        repeatedDeliveryAttempts: compactArray(replay.repeatedDeliveryAttempts, 10),
        repeatedDeliveryAttemptsTruncated: truncatedCount(replay.repeatedDeliveryAttempts, 10),
        targetResultCount: replay.targetResultCount,
        supersededTargetResultCount: replay.supersededTargetResultCount,
        supersededTargetResults: compactArray(replay.supersededTargetResults, 10),
        supersededTargetResultsTruncated: truncatedCount(replay.supersededTargetResults, 10),
        missingIdempotencyKeyCount: replay.missingIdempotencyKeyCount,
        missingIdempotencyKeys: compactArray(replay.missingIdempotencyKeys, 10),
        missingIdempotencyKeysTruncated: truncatedCount(replay.missingIdempotencyKeys, 10),
        forbiddenConclusions: replay.forbiddenConclusions,
      },
      diagnostics: {
        errors: compactArray(summary.diagnostics?.errors, 20),
        errorsTruncated: truncatedCount(summary.diagnostics?.errors, 20),
      },
      truncation: {
        healthIssues: truncatedCount(health.issues, 10),
        resumePlanSteps: truncatedCount(resumePlan.steps, 10),
        pendingHostSendDeliveries: truncatedCount(summary.deliveries?.pendingHostSend, 10),
        failedDeliveries: truncatedCount(summary.deliveries?.failed, 10),
        blockedDeliveries: truncatedCount(summary.deliveries?.blocked, 10),
        groupItems: truncatedCount(summary.groups?.items, 10),
        repeatedDeliveryAttempts: truncatedCount(replay.repeatedDeliveryAttempts, 10),
        supersededTargetResults: truncatedCount(replay.supersededTargetResults, 10),
        missingIdempotencyKeys: truncatedCount(replay.missingIdempotencyKeys, 10),
        diagnosticsErrors: truncatedCount(summary.diagnostics?.errors, 20),
      },
      detail: "compact",
      fullStatusCommand: "wakeflow-delivery status --verbose --json",
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
  const verbose = hasFlag("--verbose") || hasFlag("--full");
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
      keepLive: verbose ? keepLive : compactKeepLive(keepLive),
      // Cross-host visibility: which hosts have registered windows in this
      // workspace and which windows hold a fresh in-flight delivery lock.
      dualHost: {
        hosts: listHostRuntimes ? listHostRuntimes() : [],
        demandOwnership: scanDemandHostOwnership(workspaceRoot),
        freshLocks: listFreshWindowLocks
          ? listFreshWindowLocks().map((lock) => ({
              windowName: lock.windowName,
              host: lock.host,
              deliveryId: lock.deliveryId,
              expiresAt: lock.expiresAt,
            }))
          : [],
      },
      runtimeSummary: verbose ? runtimeSummary : compactRuntimeSummary(runtimeSummary),
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
