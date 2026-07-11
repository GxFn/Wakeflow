import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { buildReplaySummary } from "./wakeflow-idempotency.mjs";
import { buildControllerCallbackPlan } from "./wakeflow-return-policy.mjs";
import { loadWorkspaceConfig, workspaceLedgerPaths } from "./wakeflow-config.mjs";
import {
  buildRuntimeHealth,
  buildRuntimeResumePlan,
  countBy,
  deriveRuntimeGroupStatus,
  summarizeRuntimeNextAction,
} from "./wakeflow-runtime-summary.mjs";

function scanArchivedStateRoots(workspaceRoot) {
  const config = loadWorkspaceConfig({ workspaceRoot });
  const ledgerPaths = workspaceLedgerPaths({ workspaceRoot, config });
  const archiveRoot = path.join(ledgerPaths.projectLedgerRoot, "workspace", "archive");
  const archived = new Map();
  if (!existsSync(archiveRoot)) return archived;
  for (const month of readdirSync(archiveRoot, { withFileTypes: true })) {
    if (!month.isDirectory()) continue;
    const monthDir = path.join(archiveRoot, month.name);
    for (const demand of readdirSync(monthDir, { withFileTypes: true })) {
      if (!demand.isDirectory()) continue;
      const root = path.join(monthDir, demand.name);
      const manifestFile = path.join(root, "archive-manifest.json");
      const stateFile = path.join(root, "wakeflow-state.json");
      if (!existsSync(manifestFile) || !existsSync(stateFile)) continue;
      try {
        const manifest = JSON.parse(readFileSync(manifestFile, "utf8"));
        const sourceStateRoot = String(manifest.sourceStateRoot ?? "").split(path.sep).join("/");
        if (sourceStateRoot) archived.set(sourceStateRoot, { root, stateFile });
      } catch {
        // Archive verification reports malformed manifests. Status only uses valid mappings.
      }
    }
  }
  return archived;
}

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
      if (["completed", "archived", "cancelled"].includes(state.state)) continue;
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
  const archivedStateRoots = scanArchivedStateRoots(workspaceRoot);
  const stateSnapshotCache = new Map();

  function stateRootLocation(stateRootRef) {
    const normalized = String(stateRootRef ?? "").split(path.sep).join("/");
    const activeRoot = path.resolve(workspaceRoot, normalized);
    const rel = path.relative(workspaceRoot, activeRoot);
    if (rel.startsWith("..") || path.isAbsolute(rel)) return { error: "state root is outside workspace" };
    const activeStateFile = path.join(activeRoot, "wakeflow-state.json");
    if (existsSync(activeStateFile)) return { root: activeRoot, stateFile: activeStateFile, archived: false };
    const archived = archivedStateRoots.get(normalized);
    return archived ? { ...archived, archived: true } : { root: activeRoot, stateFile: activeStateFile, archived: false };
  }

  function stateSnapshot(stateRootRef, diagnostics) {
    if (!stateRootRef) return null;
    if (stateSnapshotCache.has(stateRootRef)) return stateSnapshotCache.get(stateRootRef);
    const location = stateRootLocation(stateRootRef);
    if (location.error) {
      diagnostics.errors.push({ file: stateRootRef, error: location.error });
      stateSnapshotCache.set(stateRootRef, null);
      return null;
    }
    if (!existsSync(location.stateFile)) {
      // A vanished state root (archived copy pruned, custom archive dir, hand
      // cleanup) makes its packets HISTORY, not an active-blocking error: the
      // archived-location resolver already covered every sanctioned move.
      (diagnostics.warnings ?? (diagnostics.warnings = [])).push({ file: path.relative(workspaceRoot, location.stateFile), warning: "state root file is gone (archived copy pruned or custom location); its packets are treated as historical" });
      stateSnapshotCache.set(stateRootRef, null);
      return null;
    }
    const artifact = readJsonArtifact(location.stateFile);
    if (artifact.error) {
      diagnostics.errors.push({ file: path.relative(workspaceRoot, location.stateFile), error: artifact.error });
      stateSnapshotCache.set(stateRootRef, null);
      return null;
    }
    const snapshot = { ...location, state: artifact.value };
    stateSnapshotCache.set(stateRootRef, snapshot);
    return snapshot;
  }

  function packetStateRevision(packet) {
    const revision = Number(packet.stateRef?.stateRevision);
    return Number.isFinite(revision) ? revision : null;
  }

  function packetStillActive(packet, diagnostics, allPackets) {
    const snapshot = stateSnapshot(packet.stateRef?.stateRoot, diagnostics);
    // No readable state root anywhere (active or archived): treat the packet
    // as historical rather than resurrecting it into the resume plan.
    if (!snapshot) return false;
    if (["completed", "archived", "cancelled"].includes(snapshot.state.state)) return false;
    const task = (snapshot.state.targetTasks ?? []).find((item) => item.targetTaskId === packet.taskId);
    if (!task) return true;
    const currentGroup = task.delivery?.dispatchGroup;
    const packetRevision = packetStateRevision(packet);
    const stateRevision = Number(snapshot.state.revision);
    const currentDeliveryRevision = currentGroup
      ? Math.max(
          ...allPackets
            .filter((item) => item.taskId === packet.taskId
              && item.stateRef?.stateRoot === packet.stateRef?.stateRoot
              && item.dispatchGroup === currentGroup)
            .map(packetStateRevision)
            .filter((revision) => revision !== null),
        )
      : null;
    const replacesCurrentDelivery = Boolean(currentGroup && currentGroup !== packet.dispatchGroup)
      && packetRevision !== null
      && (Number.isFinite(currentDeliveryRevision)
        ? packetRevision > currentDeliveryRevision
        : packetRevision === stateRevision);
    if (currentGroup && currentGroup !== packet.dispatchGroup && !replacesCurrentDelivery) return false;
    if (["accepted", "blocked"].includes(task.status)) return false;
    if (["rework", "redesign"].includes(task.reviewDecision) && task.status === "needs-rework") {
      // The recorded delivery still points at the reviewed group until the host
      // actually sends a replacement, so a replacement prepared AFTER the rework
      // decision stays live: its prepare-time revision beats the reviewed
      // group's packets even when a sibling task advanced the demand-wide
      // revision in between (replacesCurrentDelivery). The no-recorded-delivery
      // fallback is deliberately stricter — with no group to compare against it
      // only trusts a packet prepared from the CURRENT revision exactly.
      return replacesCurrentDelivery
        || (!currentGroup && packetRevision !== null && packetRevision === stateRevision);
    }
    return true;
  }

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
    function resultMatchesPacket(result, { requireTargetWindow = false } = {}) {
      if (!result) return false;
      if (requireTargetWindow
        ? result.targetWindow !== packet.targetWindow
        : result.targetWindow && result.targetWindow !== packet.targetWindow) return false;
      if ((result.targetTaskId || result.taskId) !== packet.taskId) return false;
      const resultGroup = result.dispatchGroup || result.deliveryContext?.dispatchGroup;
      return !resultGroup || resultGroup === packet.dispatchGroup;
    }

    const local = resultArtifacts.find((item) => {
      return resultMatchesPacket(item.value, { requireTargetWindow: true });
    });
    if (local) return local;

    const stateRootRef = packet.stateRef?.stateRoot;
    if (!stateRootRef) return null;
    if (!stateRootResultCache.has(stateRootRef)) {
      const location = stateRootLocation(stateRootRef);
      if (location.error) {
        diagnostics.errors.push({ file: stateRootRef, error: location.error });
        stateRootResultCache.set(stateRootRef, []);
      } else {
        const artifacts = listJsonArtifacts(path.join(location.root, "target-results"));
        for (const artifact of artifacts.filter((item) => item.error)) {
          diagnostics.errors.push({
            file: path.relative(workspaceRoot, artifact.file),
            error: artifact.error,
          });
        }
        stateRootResultCache.set(stateRootRef, artifacts);
      }
    }
    return stateRootResultCache.get(stateRootRef).find((item) => resultMatchesPacket(item.value)) || null;
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
      const snapshot = stateSnapshot(stateRootRef, diagnostics);
      if (!snapshot || ["completed", "archived", "cancelled"].includes(snapshot.state.state)) return [];
      const state = snapshot.state;
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

  function collectStateRootResultCounts({ packets, diagnostics }) {
    const counts = {
      stateRootCount: 0,
      currentResultCount: 0,
      historyResultCount: 0,
      lateResultCount: 0,
    };
    const refs = [...new Set(packets.map((packet) => packet.stateRef?.stateRoot).filter(Boolean))];
    for (const stateRootRef of refs) {
      const location = stateRootLocation(stateRootRef);
      if (location.error || !existsSync(location.stateFile)) continue;
      counts.stateRootCount += 1;
      const current = listJsonArtifacts(path.join(location.root, "target-results"));
      const history = listJsonArtifacts(path.join(location.root, "target-results", "history"));
      for (const artifact of [...current, ...history].filter((item) => item.error)) {
        diagnostics.errors.push({ file: path.relative(workspaceRoot, artifact.file), error: artifact.error });
      }
      counts.currentResultCount += current.filter((item) => !item.error).length;
      const readableHistory = history.filter((item) => !item.error);
      counts.historyResultCount += readableHistory.length;
      counts.lateResultCount += readableHistory.filter((item) => item.value?.historyReason === "late-dispatch-group").length;
    }
    return counts;
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
    const activePackets = packets.filter((packet) => packetStillActive(packet, diagnostics, packets));
    const stateRootResults = collectStateRootResultCounts({ packets, diagnostics });
    const activePacketIds = new Set(activePackets.map((packet) => packet.id));
    const activeGroupIds = new Set(activePackets.map((packet) => packet.dispatchGroup || packet.taskId || packet.id));
    const liveDeliveryStatuses = deliveryStatuses.filter((delivery) => delivery.kind === "DeliveryEnvelope"
      ? delivery.sourcePacketId
        ? activePacketIds.has(delivery.sourcePacketId)
        : activeGroupIds.has(delivery.dispatchGroup)
      : activeGroupIds.has(delivery.dispatchGroup));
    const groupSummaries = buildRuntimeGroupSummaries({
      packets: activePackets,
      groupArtifacts: groups,
      resultArtifacts: results,
      deliveryStatuses: liveDeliveryStatuses,
      diagnostics,
    });
    const deliveryCounts = countBy(liveDeliveryStatuses, "status");
    const groupCounts = countBy(groupSummaries, "groupStatus");
    const nextAction = summarizeRuntimeNextAction({ diagnostics, deliveryStatuses: liveDeliveryStatuses, groupSummaries });
    const resumePlan = buildRuntimeResumePlan({
      nextAction,
      diagnostics,
      deliveryStatuses: liveDeliveryStatuses,
      groupSummaries,
    });
    const health = buildRuntimeHealth({
      diagnostics,
      deliveryStatuses: liveDeliveryStatuses,
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
        stateRootResults,
        registeredThreadCount,
        windowConfigCount,
      },
      keepLive: {
        active: Boolean(keepLive.active),
        status: keepLive.status,
      },
      deliveries: {
        counts: deliveryCounts,
        pendingHostSend: liveDeliveryStatuses.filter((item) => item.status === "pending-host-send"),
        sent: liveDeliveryStatuses.filter((item) => item.status === "sent"),
        failed: liveDeliveryStatuses.filter((item) => item.status === "failed"),
        blocked: liveDeliveryStatuses.filter((item) => item.status === "blocked"),
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
      stateRootResultCounts: runtimeSummary.totals.stateRootResults,
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
      `State-root results: ${runtimeSummary.totals.stateRootResults.currentResultCount} current, ${runtimeSummary.totals.stateRootResults.historyResultCount} history (${runtimeSummary.totals.stateRootResults.lateResultCount} late)`,
      `Registered threads: ${registeredThreadCount}`,
      `Window configs: ${windowConfigCount}`,
      `Keep-live: ${keepLive.active ? `active worker=${keepLive.workerPid} child=${keepLive.childPid}` : keepLive.status}`,
      `Next action: ${runtimeSummary.nextAction}`,
    ],
  );
}
