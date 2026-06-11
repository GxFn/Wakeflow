import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export function commandTraceSpine(ctx) {
  const {
    workspaceRoot,
    dirs,
    getValue,
    output,
    fail,
    resolveInputPath,
    ensureInsideWorkspace,
    readJson,
    listJsonArtifacts,
    artifactValues,
    readJsonArtifact,
    computeReviewResults,
    redactDeliveryEnvelope,
  } = ctx;

  function traceRelativeFile(file) {
    return file ? path.relative(workspaceRoot, file) : undefined;
  }

  function traceTaskId(value = {}) {
    return value.taskId || value.targetTaskId || value.stateRef?.targetTaskId || value.wakeflowTrace?.targetTaskId || "";
  }

  function traceStateRoot(value = {}) {
    return value.stateRoot || value.stateRef?.stateRoot || value.wakeflowTrace?.stateRoot || "";
  }

  function traceTargetWindow(value = {}) {
    return value.targetWindow || value.targetThread?.windowName || value.wakeflowTrace?.targetWindow || "";
  }

  function traceDispatchGroup(value = {}) {
    return value.dispatchGroup || value.wakeflowTrace?.dispatchGroup || "";
  }

  function traceSelectorHasValue(selector) {
    return Object.entries(selector).some(([key, value]) => key !== "resultFile" && key !== "deliveryFile" && Boolean(value));
  }

  function readTraceSeedFile(value, label) {
    if (!value) return null;
    const file = resolveInputPath(value, label);
    ensureInsideWorkspace(file, label);
    return {
      file,
      value: readJson(file, label),
    };
  }

  function mergeTraceSelector(selector, artifact) {
    if (!artifact?.value) return selector;
    const value = artifact.value;
    return {
      ...selector,
      resultId: selector.resultId || value.resultId || "",
      deliveryId: selector.deliveryId || value.deliveryId || value.deliveryContext?.deliveryId || "",
      dispatchGroup: selector.dispatchGroup || traceDispatchGroup(value) || value.deliveryContext?.dispatchGroup || "",
      stateRoot: selector.stateRoot || traceStateRoot(value) || value.deliveryContext?.stateRoot || "",
      targetWindow: selector.targetWindow || traceTargetWindow(value) || "",
      taskId: selector.taskId || traceTaskId(value) || "",
    };
  }

  function stateRootResultArtifactsFor(stateRootRefs, diagnostics) {
    const seen = new Set();
    const artifacts = [];
    for (const stateRootRef of stateRootRefs.filter(Boolean)) {
      if (seen.has(stateRootRef)) continue;
      seen.add(stateRootRef);
      const stateRoot = path.resolve(workspaceRoot, stateRootRef);
      const rel = path.relative(workspaceRoot, stateRoot);
      if (rel.startsWith("..") || path.isAbsolute(rel)) {
        diagnostics.errors.push({ file: stateRootRef, error: "state root is outside workspace" });
        continue;
      }
      for (const artifact of listJsonArtifacts(path.join(stateRoot, "target-results"))) {
        if (artifact.error) {
          diagnostics.errors.push({ file: traceRelativeFile(artifact.file), error: artifact.error });
          continue;
        }
        artifacts.push({
          ...artifact,
          source: "state-root",
          stateRoot: stateRootRef,
        });
      }
    }
    return artifacts;
  }

  function traceMatchesSelector(value, selector, { loose = false } = {}) {
    if (!value) return false;
    const checks = [
      selector.resultId ? value.resultId === selector.resultId : true,
      selector.deliveryId ? value.deliveryId === selector.deliveryId || value.deliveryContext?.deliveryId === selector.deliveryId : true,
      selector.dispatchGroup ? traceDispatchGroup(value) === selector.dispatchGroup || value.deliveryContext?.dispatchGroup === selector.dispatchGroup : true,
      selector.stateRoot ? traceStateRoot(value) === selector.stateRoot || value.deliveryContext?.stateRoot === selector.stateRoot : true,
      selector.targetWindow ? traceTargetWindow(value) === selector.targetWindow : true,
      selector.taskId ? traceTaskId(value) === selector.taskId : true,
    ];
    if (checks.every(Boolean)) return true;
    if (!loose) return false;
    return Boolean(
      (selector.dispatchGroup && traceDispatchGroup(value) === selector.dispatchGroup)
        || (selector.deliveryId && (value.deliveryId === selector.deliveryId || value.deliveryContext?.deliveryId === selector.deliveryId))
        || (selector.resultId && value.resultId === selector.resultId)
        || (selector.stateRoot && traceStateRoot(value) === selector.stateRoot && selector.taskId && traceTaskId(value) === selector.taskId)
        || (selector.targetWindow && selector.taskId && traceTargetWindow(value) === selector.targetWindow && traceTaskId(value) === selector.taskId),
    );
  }

  function summarizeTraceArtifact({ file, value, source = "local" }) {
    return {
      file: traceRelativeFile(file),
      source,
      kind: value.kind || value.schemaVersion && "StateRootTargetResult" || "JSON",
      id: value.id || value.packetId || value.groupId || value.deliveryId || value.deliveryRunId || value.resultId || value.targetTaskId || value.taskPackageId,
      demandKey: value.demandKey || value.wakeflowTrace?.demandKey,
      stateRoot: traceStateRoot(value),
      stateRevision: value.stateRevision || value.stateRevisionObserved || value.stateRef?.stateRevision || value.wakeflowTrace?.stateRevision,
      taskPackageId: value.taskPackageId || value.stateRef?.taskPackageId || value.wakeflowTrace?.taskPackageId,
      targetWindow: traceTargetWindow(value),
      taskId: traceTaskId(value),
      dispatchGroup: traceDispatchGroup(value),
      deliveryId: value.deliveryId || value.deliveryContext?.deliveryId,
      deliveryRunId: value.deliveryRunId || value.deliveryContext?.deliveryRunId,
      status: value.status || value.state || value.review?.status,
      returnRoute: value.returnRoute || value.deliveryContext?.returnRoute,
      returnPolicy: value.returnPolicy || value.deliveryContext?.returnPolicy,
      createdAt: value.createdAt,
      reportedAt: value.reportedAt,
      wakeflowTrace: value.wakeflowTrace,
    };
  }

  function traceStateRootsFromArtifacts({ selector, packets, deliveries, results }) {
    return [...new Set([
      selector.stateRoot,
      ...packets.map((item) => traceStateRoot(item.value)),
      ...deliveries.map((item) => traceStateRoot(item.value)),
      ...results.map((item) => traceStateRoot(item.value) || item.stateRoot),
    ].filter(Boolean))];
  }

  function traceStateRootSummaries(stateRootRefs, selector, diagnostics) {
    return stateRootRefs.flatMap((stateRootRef) => {
      const stateRoot = path.resolve(workspaceRoot, stateRootRef);
      const stateFile = path.join(stateRoot, "wakeflow-state.json");
      if (!existsSync(stateFile)) {
        diagnostics.errors.push({ file: traceRelativeFile(stateFile), error: "state root is missing wakeflow-state.json" });
        return [];
      }
      const artifact = readJsonArtifact(stateFile);
      if (artifact.error) {
        diagnostics.errors.push({ file: traceRelativeFile(stateFile), error: artifact.error });
        return [];
      }
      const state = artifact.value;
      const targetTasks = (state.targetTasks || []).filter((task) => (
        (!selector.taskId || task.targetTaskId === selector.taskId)
          && (!selector.targetWindow || task.targetWindow === selector.targetWindow)
          && (!selector.dispatchGroup || task.delivery?.dispatchGroup === selector.dispatchGroup || state.demandKey === selector.dispatchGroup)
      ));
      const taskPackageIds = new Set(targetTasks.map((task) => task.taskPackageId).filter(Boolean));
      const taskPackages = (state.taskPackages || []).filter((taskPackage) => (
        taskPackageIds.size === 0
          ? (!selector.taskId && !selector.targetWindow)
          : taskPackageIds.has(taskPackage.taskPackageId)
      ));
      return [{
        file: traceRelativeFile(stateFile),
        stateRoot: stateRootRef,
        demandKey: state.demandKey,
        title: state.title,
        state: state.state,
        stateRevision: state.revision,
        reviewStatus: state.review?.status,
        projectionStatus: state.projection?.status,
        progressDoc: state.projection?.progressDoc,
        targetTasks,
        taskPackages,
      }];
    });
  }

  function traceControllerEvents(stateRootRefs, selector, diagnostics) {
    return stateRootRefs.flatMap((stateRootRef) => {
      const eventsFile = path.join(workspaceRoot, stateRootRef, "controller-events.jsonl");
      if (!existsSync(eventsFile)) return [];
      return readFileSync(eventsFile, "utf8")
        .split(/\r?\n/)
        .filter(Boolean)
        .flatMap((line) => {
          try {
            const event = JSON.parse(line);
            if (!traceMatchesSelector(event, selector, { loose: true })) return [];
            return [{
              file: traceRelativeFile(eventsFile),
              eventId: event.eventId,
              type: event.type,
              from: event.from,
              to: event.to,
              reason: event.reason,
              stateRevision: event.stateRevision,
              evidenceRefs: event.evidenceRefs || [],
              createdAt: event.createdAt,
              wakeflowTrace: event.wakeflowTrace,
            }];
          } catch (error) {
            diagnostics.errors.push({ file: traceRelativeFile(eventsFile), error: error.message });
            return [];
          }
        });
    });
  }

  const seedResult = readTraceSeedFile(getValue("--result-file", ""), "--result-file");
  const seedDelivery = readTraceSeedFile(getValue("--delivery-file", ""), "--delivery-file");
  let selector = {
    stateRoot: getValue("--state-root", ""),
    dispatchGroup: getValue("--group", ""),
    targetWindow: getValue("--target-window", ""),
    taskId: getValue("--task-id", ""),
    resultId: getValue("--result-id", ""),
    deliveryId: getValue("--delivery-id", ""),
  };
  selector = mergeTraceSelector(mergeTraceSelector(selector, seedResult), seedDelivery);
  if (!traceSelectorHasValue(selector)) {
    fail("trace-spine requires at least one selector: --state-root, --group, --target-window/--task-id, --result-file, --result-id, --delivery-file, or --delivery-id.");
  }

  const diagnostics = { errors: [] };
  const packetArtifacts = artifactValues(listJsonArtifacts(dirs.packets), "ControllerDispatchPacket");
  const groupArtifacts = artifactValues(listJsonArtifacts(dirs.groups), "DispatchGroup");
  const deliveryArtifacts = artifactValues(listJsonArtifacts(dirs.deliveries))
    .filter((item) => ["DeliveryEnvelope", "ControllerReturnEnvelope"].includes(item.value?.kind));
  const runArtifacts = artifactValues(listJsonArtifacts(dirs.deliveryRuns), "DirectThreadDeliveryRun");
  const localResultArtifacts = artifactValues(listJsonArtifacts(dirs.results))
    .filter((item) => item.value?.kind === "TargetResultEnvelope")
    .map((item) => ({ ...item, source: "local" }));
  const seedResults = seedResult ? [{ file: seedResult.file, value: seedResult.value, source: "seed" }] : [];
  const stateRootRefs = [...new Set([
    selector.stateRoot,
    ...packetArtifacts.map((item) => traceStateRoot(item.value)),
    ...deliveryArtifacts.map((item) => traceStateRoot(item.value)),
    ...seedResults.map((item) => traceStateRoot(item.value)),
  ].filter(Boolean))];
  let stateRootResults = stateRootResultArtifactsFor(stateRootRefs, diagnostics);
  let allResults = [...seedResults, ...localResultArtifacts, ...stateRootResults];
  let matchingResults = allResults.filter((item) => traceMatchesSelector(item.value, selector, { loose: true }));
  for (const result of matchingResults) selector = mergeTraceSelector(selector, result);

  let matchingPackets = packetArtifacts.filter((item) => traceMatchesSelector(item.value, selector, { loose: true }));
  let packetIds = new Set(matchingPackets.map((item) => item.value.id).filter(Boolean));
  const matchingDeliveries = [
    ...(seedDelivery ? [{ file: seedDelivery.file, value: seedDelivery.value }] : []),
    ...deliveryArtifacts,
  ].filter((item, index, array) => array.findIndex((candidate) => candidate.file === item.file) === index)
    .filter((item) => traceMatchesSelector(item.value, selector, { loose: true }) || packetIds.has(item.value.sourcePacketId));
  const deliverySourcePacketIds = new Set(matchingDeliveries.map((item) => item.value.sourcePacketId).filter(Boolean));
  matchingPackets = [
    ...matchingPackets,
    ...packetArtifacts.filter((item) => deliverySourcePacketIds.has(item.value.id)),
  ].filter((item, index, array) => array.findIndex((candidate) => candidate.file === item.file) === index);
  for (const packet of matchingPackets) selector = mergeTraceSelector(selector, packet);
  packetIds = new Set(matchingPackets.map((item) => item.value.id).filter(Boolean));
  const expandedStateRootRefs = [...new Set([
    ...stateRootRefs,
    ...matchingPackets.map((item) => traceStateRoot(item.value)),
    ...matchingDeliveries.map((item) => traceStateRoot(item.value)),
  ].filter(Boolean))];
  stateRootResults = stateRootResultArtifactsFor(expandedStateRootRefs, diagnostics);
  allResults = [...seedResults, ...localResultArtifacts, ...stateRootResults];
  matchingResults = allResults
    .filter((item, index, array) => array.findIndex((candidate) => candidate.file === item.file) === index)
    .filter((item) => traceMatchesSelector(item.value, selector, { loose: true }));
  for (const result of matchingResults) selector = mergeTraceSelector(selector, result);
  const deliveryIds = new Set(matchingDeliveries.map((item) => item.value.deliveryId).filter(Boolean));
  const matchingRuns = runArtifacts.filter((item) => deliveryIds.has(item.value.deliveryId) || traceMatchesSelector(item.value, selector, { loose: true }));
  const matchingGroups = groupArtifacts.filter((item) => (
    (selector.dispatchGroup && item.value.groupId === selector.dispatchGroup)
      || matchingPackets.some((packet) => packet.value.dispatchGroup && packet.value.dispatchGroup === item.value.groupId)
  ));
  const finalStateRootRefs = traceStateRootsFromArtifacts({
    selector,
    packets: matchingPackets,
    deliveries: matchingDeliveries,
    results: matchingResults,
  });
  const stateRoots = traceStateRootSummaries(finalStateRootRefs, selector, diagnostics);
  const controllerEvents = traceControllerEvents(finalStateRootRefs, selector, diagnostics);
  const review = selector.dispatchGroup && matchingPackets.length > 0
    ? (() => {
        try {
          const reviewResults = computeReviewResults({ group: selector.dispatchGroup });
          return {
            decision: reviewResults.decision,
            groupStatus: reviewResults.groupStatus,
            returnPolicy: reviewResults.returnPolicy,
            missing: reviewResults.missing,
            blocked: reviewResults.blocked,
            needsReview: reviewResults.needsReview,
          };
        } catch (error) {
          diagnostics.errors.push({ file: selector.dispatchGroup, error: error.message });
          return null;
        }
      })()
    : null;

  const traceSpine = {
    kind: "WakeflowTraceSpine",
    version: 1,
    selector,
    coverage: {
      stateRootCount: stateRoots.length,
      taskPackageCount: stateRoots.reduce((total, state) => total + state.taskPackages.length, 0),
      targetTaskCount: stateRoots.reduce((total, state) => total + state.targetTasks.length, 0),
      dispatchGroupCount: matchingGroups.length,
      dispatchPacketCount: matchingPackets.length,
      deliveryEnvelopeCount: matchingDeliveries.length,
      deliveryRunCount: matchingRuns.length,
      targetResultCount: matchingResults.length,
      controllerEventCount: controllerEvents.length,
      complete: matchingPackets.length > 0 && matchingDeliveries.length > 0 && matchingResults.length > 0,
    },
    demand: stateRoots.map((state) => ({
      file: state.file,
      stateRoot: state.stateRoot,
      demandKey: state.demandKey,
      title: state.title,
      state: state.state,
      stateRevision: state.stateRevision,
      reviewStatus: state.reviewStatus,
      projectionStatus: state.projectionStatus,
      progressDoc: state.progressDoc,
    })),
    taskPackages: stateRoots.flatMap((state) => state.taskPackages.map((taskPackage) => ({
      ...taskPackage,
      stateRoot: state.stateRoot,
    }))),
    targetTasks: stateRoots.flatMap((state) => state.targetTasks.map((task) => ({
      ...task,
      stateRoot: state.stateRoot,
    }))),
    dispatchGroups: matchingGroups.map(summarizeTraceArtifact),
    dispatchPackets: matchingPackets.map(summarizeTraceArtifact),
    deliveryEnvelopes: matchingDeliveries.map((item) => summarizeTraceArtifact({ ...item, value: item.value.kind === "DeliveryEnvelope" ? redactDeliveryEnvelope(item.value) : item.value })),
    deliveryRuns: matchingRuns.map(summarizeTraceArtifact),
    targetResults: matchingResults.map(summarizeTraceArtifact),
    controllerEvents,
    review,
    diagnostics,
    forbiddenConclusions: [
      "trace-spine-is-controller-acceptance",
      "trace-spine-sends-host-message",
      "trace-spine-creates-target-result",
    ],
  };

  output(
    {
      ok: diagnostics.errors.length === 0,
      command: "trace-spine",
      traceSpine,
      selector: traceSpine.selector,
      coverage: traceSpine.coverage,
      diagnostics,
    },
    [
      `Trace spine: ${selector.dispatchGroup || selector.deliveryId || selector.resultId || selector.taskId || selector.stateRoot}`,
      `Packets: ${traceSpine.coverage.dispatchPacketCount}; deliveries: ${traceSpine.coverage.deliveryEnvelopeCount}; runs: ${traceSpine.coverage.deliveryRunCount}; results: ${traceSpine.coverage.targetResultCount}`,
      `State roots: ${traceSpine.coverage.stateRootCount}; controller events: ${traceSpine.coverage.controllerEventCount}`,
    ],
  );
}
