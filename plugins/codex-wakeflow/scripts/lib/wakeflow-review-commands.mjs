import { existsSync } from "node:fs";
import path from "node:path";
import { buildControllerCallbackPlan } from "./wakeflow-return-policy.mjs";
import { controllerReviewScope, hasPendingReworkDecision } from "./wakeflow-review-scope.mjs";
import { buildControllerReviewPack } from "./wakeflow-review-pack.mjs";
import { loadWorkspaceConfig, testWindowNames } from "./wakeflow-config.mjs";

export function createReviewCommands(ctx) {
  const {
    workspaceRoot,
    dirs,
    version,
    getValue,
    output,
    fail,
    nowIso,
    artifactTrace,
    readControllerStateRoot,
    resolveStateRoot,
    listJsonFiles,
    readJson,
    resultFileFor,
    controllerReturnDeliveryStatusForGroup,
    targetDeliveryStatusesForPacket,
    groupFromPackets,
    orderResultsByGroup,
    buildGroupSnapshot,
  } = ctx;

  // Map each work window to its repository root from config, so a target's evidence refs
  // resolve against the repo where the work + commit happened. Loaded once per run.
  let repoRootByWindow = null;
  function repoRootForWindow(windowName) {
    if (!windowName) return null;
    if (!repoRootByWindow) {
      repoRootByWindow = new Map();
      const config = loadWorkspaceConfig({ workspaceRoot });
      for (const repo of config.repositories ?? []) {
        if (repo?.windowName && repo?.path) {
          repoRootByWindow.set(repo.windowName, path.resolve(workspaceRoot, repo.path));
        }
      }
    }
    return repoRootByWindow.get(windowName) ?? null;
  }

  // Candidate roots for a relative evidence ref, most-specific first: the producing target
  // window's repo (where the work + commit happened), then the workspace root (plus any
  // extra roots such as the state root). Resolving ONLY against the workspace root
  // false-flags a target's own repo-relative evidence as "missing", which stalls the
  // controller return / verdict — a real closed-loop break.
  function evidenceRefCandidates(text, targetWindow, extraRoots = []) {
    if (path.isAbsolute(text)) return [text];
    return [...extraRoots, repoRootForWindow(targetWindow), workspaceRoot]
      .filter(Boolean)
      .map((root) => path.resolve(root, text));
  }

  function evidenceRefSummary(ref, targetWindow) {
    const text = String(ref ?? "");
    const looksLikePath = text.includes("/") || /\.(json|md|log|txt|png|jpg|jpeg|webp|html|csv)$/i.test(text);
    const candidatePaths = looksLikePath ? evidenceRefCandidates(text, targetWindow) : [];
    const resolvedPath = candidatePaths.find((candidate) => existsSync(candidate)) || candidatePaths[0] || "";
    return {
      ref: text,
      looksLikePath,
      exists: Boolean(resolvedPath && existsSync(resolvedPath)),
      path: resolvedPath && existsSync(resolvedPath) ? path.relative(workspaceRoot, resolvedPath) : undefined,
    };
  }

  function missingEvidenceRefsFromSummaries(summaries) {
    return summaries
      .filter((item) => item.looksLikePath && !item.exists)
      .map((item) => item.ref);
  }

  function targetResultReviewEntry(item) {
    const result = item.result;
    const evidenceRefs = Array.isArray(result?.evidenceRefs) ? result.evidenceRefs : [];
    const verificationSummary = Array.isArray(result?.verificationSummary) ? result.verificationSummary : [];
    const commits = Array.isArray(result?.commits) ? result.commits : [];
    const evidenceRefSummaries = item.stateRoot
      ? evidenceRefs.map((ref) => stateRootEvidenceRefSummary(item.stateRoot, item.stateRootRef, ref, item.packet.targetWindow))
      : evidenceRefs.map((ref) => evidenceRefSummary(ref, item.packet.targetWindow));
    const missingEvidenceRefs = missingEvidenceRefsFromSummaries(evidenceRefSummaries);
    return {
      packetId: item.packet.id,
      targetWindow: item.packet.targetWindow,
      taskId: item.packet.taskId,
      // Intent side-by-side (review-time judgment moment): the dispatch intent
      // sits beside the delivered result; designIntent appears only when Design
      // authored one (zero traces otherwise).
      objective: item.packet.objective,
      ...(item.packet.designIntent ? { designIntent: item.packet.designIntent } : {}),
      resultStatus: result?.status || "missing",
      resultFile: result ? path.relative(workspaceRoot, item.file) : undefined,
      changedRepos: Array.isArray(result?.changedRepos) ? result.changedRepos : [],
      commits,
      evidenceRefs,
      evidenceRefSummaries,
      missingEvidenceRefs,
      verificationSummary,
      riskSummary: Array.isArray(result?.riskSummary) ? result.riskSummary : [],
      nextSuggestion: result?.nextSuggestion,
      reportedAt: result?.reportedAt,
      hasControllerReviewEvidence: commits.length > 0 || evidenceRefs.length > 0 || verificationSummary.length > 0,
      targetDeliveries: targetDeliveryStatusesForPacket(item.packet.id),
      stateRootResult: Boolean(item.stateRootResult),
    };
  }

  function buildReviewPack(review) {
    const returnGroup = review.group || (review.packets.length === 1 ? review.packets[0].dispatchGroup : "");
    const controllerReturnDelivery = controllerReturnDeliveryStatusForGroup(returnGroup);
    const callbackPlan = buildControllerCallbackPlan({
      dispatchGroup: returnGroup,
      returnPolicy: review.returnPolicy,
      groupSnapshot: review.groupSnapshot,
      controllerReturnDeliveries: controllerReturnDelivery.deliveries,
    });
    const results = review.results.map(targetResultReviewEntry);
    const generatedAt = nowIso();
    return buildControllerReviewPack({
      review,
      controllerReturnDelivery,
      callbackPlan,
      targetResults: results,
      generatedAt,
      wakeflowTrace: artifactTrace({
        artifactKind: "review-pack",
        createdAt: generatedAt,
        dispatchGroup: review.group || undefined,
        stateRef: review.groupRecord?.stateRef,
        targetTaskId: review.taskId || undefined,
      }),
      version,
    });
  }

  function stateRootTargetResults(stateRoot) {
    const dir = path.join(stateRoot, "target-results");
    if (!existsSync(dir)) return [];
    return listJsonFiles(dir).map((file) => ({
      file,
      result: readJson(file, "state-root target result"),
    }));
  }

  function latestStateRootResultsByTargetTask(stateRoot) {
    const latest = new Map();
    for (const item of stateRootTargetResults(stateRoot)) {
      const existing = latest.get(item.result.targetTaskId);
      if (!existing || String(item.result.createdAt ?? "") >= String(existing.result.createdAt ?? "")) {
        latest.set(item.result.targetTaskId, item);
      }
    }
    return latest;
  }

  function normalizeStateRootResult(result) {
    const changedRepositories = Array.isArray(result?.changedRepositories) ? result.changedRepositories : [];
    const changedRepos = Array.isArray(result?.changedRepos)
      ? result.changedRepos
      : changedRepositories.map((item) => item.repository).filter(Boolean);
    const commits = Array.isArray(result?.commits)
      ? result.commits
      : changedRepositories.map((item) => item.head).filter(Boolean);
    return {
      kind: "TargetResultEnvelope",
      version,
      targetWindow: result?.targetWindow,
      taskId: result?.targetTaskId || result?.taskId,
      dispatchGroup: result?.dispatchGroup,
      status: result?.status,
      changedRepos,
      commits,
      evidenceRefs: Array.isArray(result?.evidenceRefs) ? result.evidenceRefs : [],
      verificationSummary: Array.isArray(result?.verificationSummary)
        ? result.verificationSummary
        : Array.isArray(result?.verification)
          ? result.verification
          : [],
      riskSummary: Array.isArray(result?.riskSummary)
        ? result.riskSummary
        : Array.isArray(result?.risks)
          ? result.risks
          : [],
      nextSuggestion: result?.nextSuggestion || result?.controllerActionRequired,
      reportedAt: result?.reportedAt || result?.createdAt,
    };
  }

  function stateRootResultForPacket({ packet, stateRoot, stateRootRef, resultsByTask }) {
    if (!stateRoot || !resultsByTask) return null;
    const item = resultsByTask.get(packet.taskId);
    if (!item) return null;
    if (item.result.targetWindow && item.result.targetWindow !== packet.targetWindow) {
      fail(`state-root target result window mismatch for ${packet.taskId}: result has ${item.result.targetWindow}, packet has ${packet.targetWindow}`);
    }
    return {
      packet,
      file: item.file,
      result: normalizeStateRootResult(item.result),
      stateRoot,
      stateRootRef,
      stateRootResult: true,
    };
  }

  function stateRootEvidenceRefSummary(stateRoot, stateRootRef, ref, targetWindow) {
    const text = String(ref ?? "");
    const looksLikePath = text.includes("/") || /\.(json|md|log|txt|png|jpg|jpeg|webp|html|csv)$/i.test(text);
    const absoluteRef = path.isAbsolute(text);
    const candidatePaths = looksLikePath ? evidenceRefCandidates(text, targetWindow, [stateRoot]) : [];
    const resolvedPath = candidatePaths.find((candidate) => existsSync(candidate)) || candidatePaths[0] || "";
    const stateRootCandidate = looksLikePath && !absoluteRef ? path.resolve(stateRoot, text) : "";
    return {
      ref: text,
      looksLikePath,
      exists: Boolean(resolvedPath && existsSync(resolvedPath)),
      path: resolvedPath && existsSync(resolvedPath) ? path.relative(workspaceRoot, resolvedPath) : undefined,
      stateRootRelativePath: stateRootCandidate ? path.join(stateRootRef, text) : undefined,
      resolvedAgainst: resolvedPath && existsSync(resolvedPath)
        ? (() => {
            const relativeToStateRoot = path.relative(stateRoot, resolvedPath);
            return !relativeToStateRoot.startsWith("..") && !path.isAbsolute(relativeToStateRoot) ? "state-root" : "workspace-root";
          })()
        : undefined,
    };
  }

  function stateRootTaskDeliveryStatus(task) {
    if (task?.delivery?.deliveryRunId) return "sent";
    if (task?.delivery?.deliveryFile) return "pending-host-send";
    return "not-built";
  }

  function stateRootTaskResultExpected(task) {
    if (task?.delivery?.deliveryRunId) return true;
    return ["sent", "active", "missing-result"].includes(task?.status || "");
  }

  function notApplicableStateRootCallbackPlan(dispatchGroup, returnPolicy, reason) {
    return {
      kind: "WakeflowControllerCallbackPlan",
      version: 1,
      dispatchGroup: dispatchGroup || undefined,
      returnPolicy: returnPolicy || { mode: "group-ready" },
      status: "not-applicable",
      reason,
      counts: {
        unitCount: 0,
        readyToBuildCount: 0,
        pendingHostSendCount: 0,
        sentCount: 0,
        waitingForSentResultsCount: 0,
        waitingForResultCount: 0,
        transportReviewCount: 0,
      },
      units: [],
      forbiddenConclusions: [
        "callback-plan-is-controller-acceptance",
        "callback-plan-sends-host-message",
        "callback-plan-creates-target-result",
      ],
    };
  }

  function stateRootCallbackContext(targetResults) {
    const controllerReturnResults = targetResults
      .filter((item) => item.dispatchGroup && item.returnRoute === "controller");
    const dispatchGroups = [...new Set(controllerReturnResults.map((item) => item.dispatchGroup))];
    if (dispatchGroups.length === 0) {
      return {
        dispatchGroup: "",
        review: null,
        controllerReturnDelivery: {
          status: "not-applicable",
          reason: "state-root review pack has no target result with deliveryContext.returnRoute=controller",
        },
        callbackPlan: notApplicableStateRootCallbackPlan(
          "",
          { mode: "group-ready" },
          "State-root review has no controller-return delivery context.",
        ),
      };
    }
    if (dispatchGroups.length > 1) {
      return {
        dispatchGroup: "",
        review: null,
        controllerReturnDelivery: {
          status: "needs-transport-review",
          reason: "multiple dispatch groups require a group-scoped review pack before controller-return",
          dispatchGroups,
        },
        callbackPlan: {
          ...notApplicableStateRootCallbackPlan(
            "",
            { mode: "group-ready" },
            "Multiple controller-return dispatch groups are present; use a group-scoped review pack.",
          ),
          status: "needs-transport-review",
          counts: {
            unitCount: dispatchGroups.length,
            readyToBuildCount: 0,
            pendingHostSendCount: 0,
            sentCount: 0,
            waitingForSentResultsCount: 0,
            waitingForResultCount: 0,
            transportReviewCount: dispatchGroups.length,
          },
          units: dispatchGroups.map((dispatchGroup) => ({
            scope: "group",
            dispatchGroup,
            status: "requires-group-scoped-review",
            buildAllowed: false,
            hostSendRequired: false,
            controllerAlreadyReached: false,
            failureNeedsReview: true,
          })),
        },
      };
    }

    const dispatchGroup = dispatchGroups[0];
    const packetsForGroup = listJsonFiles(dirs.packets)
      .map((file) => readJson(file, "dispatch packet"))
      .filter((packet) => packet.kind === "ControllerDispatchPacket" && packet.dispatchGroup === dispatchGroup);
    if (packetsForGroup.length === 0) {
      const returnPolicy = controllerReturnResults[0]?.returnPolicy || { mode: "group-ready" };
      return {
        dispatchGroup,
        review: null,
        controllerReturnDelivery: {
          status: "needs-transport-review",
          dispatchGroup,
          reason: "controller-return delivery context exists, but local dispatch packets are missing",
        },
        callbackPlan: {
          ...notApplicableStateRootCallbackPlan(
            dispatchGroup,
            returnPolicy,
            "Local dispatch packets are required before building a controller-return envelope.",
          ),
          status: "needs-transport-review",
          counts: {
            unitCount: 1,
            readyToBuildCount: 0,
            pendingHostSendCount: 0,
            sentCount: 0,
            waitingForSentResultsCount: 0,
            waitingForResultCount: 0,
            transportReviewCount: 1,
          },
          units: [{
            scope: "group",
            dispatchGroup,
            status: "missing-dispatch-packets",
            buildAllowed: false,
            hostSendRequired: false,
            controllerAlreadyReached: false,
            failureNeedsReview: true,
          }],
        },
      };
    }

    const review = computeReviewResults({ group: dispatchGroup });
    const controllerReturnDelivery = controllerReturnDeliveryStatusForGroup(dispatchGroup);
    return {
      dispatchGroup,
      review,
      controllerReturnDelivery,
      callbackPlan: buildControllerCallbackPlan({
        dispatchGroup,
        returnPolicy: review.returnPolicy,
        groupSnapshot: review.groupSnapshot,
        controllerReturnDeliveries: controllerReturnDelivery.deliveries,
      }),
    };
  }

  function buildStateRootReviewPack(stateRoot) {
    const { state, stateRootRef } = readControllerStateRoot(stateRoot);
    const resultsByTask = latestStateRootResultsByTargetTask(stateRoot);
    // Packets carry the authored dispatch intent (objective) and Design's
    // designIntent copy; index them once so every reviewable entry can show
    // the intent triple beside its result. Tasks never dispatched simply have
    // no packet: objective falls back to the task summary (source marked).
    const packetsByTaskId = new Map();
    for (const file of listJsonFiles(dirs.packets)) {
      const packet = readJson(file, "dispatch packet");
      if (packet?.kind !== "ControllerDispatchPacket") continue;
      if (packet?.stateRef?.stateRoot !== stateRootRef) continue;
      const packetTaskId = packet.stateRef?.targetTaskId || packet.taskId;
      if (packetTaskId && !packetsByTaskId.has(packetTaskId)) packetsByTaskId.set(packetTaskId, packet);
    }
    const allTargetTasks = state.targetTasks ?? [];
    const reviewScope = controllerReviewScope(allTargetTasks);
    const targetTasks = reviewScope.reviewableTargetTasks;
    const reworkCompanionPresent = reviewScope.mode === "rework-first-controller-review-targets"
      && targetTasks.some((task) => task.reviewRoute === "rework" && !hasPendingReworkDecision(task));
    const targetResults = targetTasks.map((task) => {
      const reworkAnchorCovered = hasPendingReworkDecision(task) && reworkCompanionPresent;
      const item = hasPendingReworkDecision(task) ? null : resultsByTask.get(task.targetTaskId);
      const result = item?.result ?? null;
      const evidenceRefs = Array.isArray(result?.evidenceRefs) ? result.evidenceRefs : [];
      const verificationSummary = Array.isArray(result?.verification) ? result.verification : [];
      const evidenceRefSummaries = evidenceRefs.map((ref) => stateRootEvidenceRefSummary(stateRoot, stateRootRef, ref, task.targetWindow));
      const missingEvidenceRefs = missingEvidenceRefsFromSummaries(evidenceRefSummaries);
      const resultExpected = stateRootTaskResultExpected(task);
      const resultStatus = reworkAnchorCovered
        ? "covered-by-rework-route"
        : result?.status || (resultExpected ? "missing" : "pending-dispatch");
      const packet = packetsByTaskId.get(task.targetTaskId);
      return {
        targetWindow: task.targetWindow,
        taskId: task.targetTaskId,
        taskPackageId: task.taskPackageId,
        objective: packet?.objective ?? task.summary,
        objectiveSource: packet?.objective ? "dispatch-packet" : "task-summary",
        ...(packet?.designIntent ? { designIntent: packet.designIntent } : {}),
        dispatchGroup: result?.dispatchGroup || result?.deliveryContext?.dispatchGroup || task.delivery?.dispatchGroup,
        returnRoute: result?.deliveryContext?.returnRoute || result?.returnRoute,
        returnPolicy: result?.deliveryContext?.returnPolicy || result?.returnPolicy,
        deliveryContext: result?.deliveryContext,
        resultId: result?.resultId,
        resultStatus,
        resultFile: item ? path.relative(workspaceRoot, item.file) : undefined,
        evidenceRefs,
        evidenceRefSummaries,
        missingEvidenceRefs,
        verificationSummary,
        riskSummary: Array.isArray(result?.risks) ? result.risks : [],
        reportedAt: result?.createdAt,
        hasControllerReviewEvidence: evidenceRefs.length > 0 || verificationSummary.length > 0,
        stateRootResult: true,
        resultExpected,
        deliveryStatus: stateRootTaskDeliveryStatus(task),
      };
    });
    const missing = targetResults.filter((item) => item.resultStatus === "missing");
    const pendingDispatch = targetResults.filter((item) => item.resultStatus === "pending-dispatch");
    const blocked = targetResults.filter((item) => item.resultStatus === "blocked");
    const ready = targetResults.filter((item) => !["missing", "pending-dispatch", "blocked"].includes(item.resultStatus));
    const noTargetTasks = allTargetTasks.length === 0;
    const noOpenTargetTasks = !noTargetTasks && targetTasks.length === 0;
    const demandCompleted = state.state === "completed" || state.review?.status === "demand-completed";
    const decision = demandCompleted
      ? "completed"
      : noTargetTasks
      ? "no-target-tasks"
      : noOpenTargetTasks
      ? "ready-to-complete-demand"
      : missing.length > 0
      ? "wait"
      : ready.length === 0 && blocked.length === 0
      ? "wait"
      : blocked.length > 0
        ? "blocked"
        : "needs-controller-review";
    const groupStatus = demandCompleted
      ? "completed"
      : noTargetTasks
      ? "empty"
      : noOpenTargetTasks
      ? "accepted"
      : missing.length > 0
      ? ready.length > 0 || blocked.length > 0 ? "partially-ready" : "waiting"
      : ready.length > 0 || blocked.length > 0
      ? pendingDispatch.length > 0
        ? "partially-ready"
        : blocked.length > 0
          ? "blocked"
          : "ready"
      : pendingDispatch.length > 0
        ? "pending-dispatch"
        : "waiting";
    const groupSnapshot = {
      groupId: state.demandKey,
      returnPolicy: { mode: "group-ready" },
      groupStatus,
      expected: targetResults.map((item) => ({
        packetId: item.taskId,
        targetWindow: item.targetWindow,
        taskId: item.taskId,
        status: item.resultStatus,
        resultFile: item.resultFile,
      })),
      completed: targetResults.filter((item) => item.resultStatus === "completed"),
      ready,
      blocked,
      missing,
      pendingDispatch,
      needsReview: targetResults.filter((item) => item.resultStatus === "needs-review"),
      expectedTargets: [...new Set(targetTasks.map((item) => item.targetWindow))],
      completedTargets: [...new Set(targetResults.filter((item) => item.resultStatus === "completed").map((item) => item.targetWindow))],
      readyTargets: [...new Set(ready.map((item) => item.targetWindow))],
      blockedTargets: [...new Set(blocked.map((item) => item.targetWindow))],
      missingTargets: [...new Set(missing.map((item) => item.targetWindow))],
      pendingDispatchTargets: [...new Set(pendingDispatch.map((item) => item.targetWindow))],
      allResultsPresent: missing.length === 0 && pendingDispatch.length === 0,
      allSentResultsPresent: missing.length === 0,
      stateRoot: stateRootRef,
    };
    const reviewReady = !demandCompleted && !noTargetTasks && !noOpenTargetTasks && decision !== "wait";
    const missingEvidenceRefs = targetResults.flatMap((item) => item.missingEvidenceRefs.map((ref) => ({
      targetWindow: item.targetWindow,
      taskId: item.taskId,
      ref,
    })));
    const missingEvidenceRefsPresent = missingEvidenceRefs.length > 0;
    const generatedAt = nowIso();
    const callbackContext = stateRootCallbackContext(targetResults);
    const callbackPlan = callbackContext.callbackPlan;
    const controllerReturnDelivery = callbackContext.controllerReturnDelivery;
    const controllerReturnReady = (callbackPlan?.counts?.readyToBuildCount || 0) > 0;
    const controllerReturnPendingHostSend = (callbackPlan?.counts?.pendingHostSendCount || 0) > 0;
    const controllerReturnSent = (callbackPlan?.counts?.sentCount || 0) > 0;
    return {
      kind: "ControllerReviewPack",
      version,
      source: "wakeflow-state-root",
      demandKey: state.demandKey,
      stateRoot: stateRootRef,
      stateRevision: state.revision,
      controllerState: state.state,
      decision,
      returnPolicy: groupSnapshot.returnPolicy,
      groupStatus,
      groupSnapshot,
      reviewScope: {
        mode: reviewScope.mode,
        targetTaskIds: reviewScope.targetTaskIds,
        excludedTargetTaskIds: reviewScope.excludedTargetTaskIds,
      },
      controllerReturnDelivery: {
        ...controllerReturnDelivery,
        reason: controllerReturnDelivery.reason || "state-root review pack resolved controller-return evidence from the delivery runtime",
      },
      callbackPlan,
      targetResults,
      rawEvidenceRequired: targetResults
        .filter((item) => item.resultStatus !== "missing")
        .map((item) => ({
          targetWindow: item.targetWindow,
          taskId: item.taskId,
          resultStatus: item.resultStatus,
          evidenceRefs: item.evidenceRefs,
          verificationSummary: item.verificationSummary,
          hasControllerReviewEvidence: item.hasControllerReviewEvidence,
          missingEvidenceRefs: item.missingEvidenceRefs,
        })),
      missingEvidenceRefs,
      gates: {
        controllerReviewReady: reviewReady && !missingEvidenceRefsPresent,
        noTargetTasks,
        noOpenTargetTasks,
        waitForMissingResults: missing.length > 0,
        pendingDispatchTargetsPresent: pendingDispatch.length > 0,
        blockedResultsPresent: blocked.length > 0,
        missingEvidenceRefsPresent,
        evidenceRepairRequired: missingEvidenceRefsPresent,
        controllerReturnSent,
        controllerReturnReady,
        controllerReturnPendingHostSend,
        rawEvidencePullRequired: reviewReady,
        totalControlVerdictRequired: reviewReady && !missingEvidenceRefsPresent,
        stateRootBased: true,
      },
      // Review-time intent check: additive advisory string, present only when
      // any reviewable task carries a designIntent. Never touches gates or
      // nextAction (machine tokens); the agent's decide-review reason is the
      // confirmation record.
      ...(targetResults.some((item) => item.designIntent)
        ? { intentCheck: "Compare designIntent / objective / delivered result per task. If the delivery departs from the design intent and the dispatch did not declare an intentional adaptation, run a requirement review (Original Plan / Requirement Design) first; if the requirement itself must change, decide redesign." }
        : {}),
      nextAction: demandCompleted
        ? "demand-completed-stop-without-next-dispatch"
        : noTargetTasks
        ? "add-task-package-before-review"
        : noOpenTargetTasks
        ? "run-wakeflow-complete-demand-or-add-next-package"
        : controllerReturnPendingHostSend
        ? "send-controller-return-and-record-delivery"
        : controllerReturnReady
        ? "build-controller-return"
        : decision === "wait"
        ? missing.length > 0
          ? "wait-for-state-root-target-result"
          : "dispatch-pending-target-before-result-review"
        : decision === "blocked"
          ? "pull-block-evidence-and-run-wakeflow-state-reducer"
          : missingEvidenceRefsPresent
            ? "fix-missing-evidence-refs-before-wakeflow-state-reducer"
            : pendingDispatch.length > 0
              ? "pull-raw-evidence-and-continue-pending-dispatch"
              : "pull-raw-evidence-and-run-wakeflow-state-reducer",
      forbiddenConclusions: [
        "review-pack-is-controller-acceptance",
        "review-pack-creates-next-dispatch",
        "review-pack-updates-developer-progress",
      ],
      wakeflowTrace: artifactTrace({
        artifactKind: "review-pack",
        createdAt: generatedAt,
        demandKey: state.demandKey,
        dispatchGroup: state.demandKey,
        stateRevision: state.revision,
        stateRoot: stateRootRef,
      }),
      generatedAt,
    };
  }

  function loadPacketsForScope({ group = "", taskId = "" } = {}) {
    if (!group && !taskId) fail("review-results requires --group or --task-id.");
    const packets = listJsonFiles(dirs.packets)
      .map((file) => readJson(file, "dispatch packet"))
      .filter((packet) => packet.kind === "ControllerDispatchPacket")
      .filter((packet) => (group ? packet.dispatchGroup === group : packet.taskId === taskId));
    return { group, taskId, packets };
  }

  function computeReviewResults({ group = "", taskId = "" } = {}) {
    const { packets } = loadPacketsForScope({ group, taskId });
    if (packets.length === 0) fail("No matching dispatch packets found for review.");
    const groupRecord = groupFromPackets({ groupId: group || packets[0]?.dispatchGroup || "", packets });
    const stateRootRef = groupRecord.stateRef?.stateRoot || packets.find((packet) => packet.stateRef?.stateRoot)?.stateRef?.stateRoot || "";
    const stateRoot = stateRootRef ? resolveStateRoot(stateRootRef) : null;
    const stateRootResultsByTask = stateRoot ? latestStateRootResultsByTargetTask(stateRoot) : null;
    const unorderedResults = packets.map((packet) => {
      const file = resultFileFor(packet.targetWindow, packet.taskId, packet.dispatchGroup);
      if (!existsSync(file)) {
        const stateRootResult = stateRootResultForPacket({
          packet,
          stateRoot,
          stateRootRef,
          resultsByTask: stateRootResultsByTask,
        });
        if (stateRootResult) return stateRootResult;
      }
      return {
        packet,
        file,
        result: existsSync(file) ? readJson(file, "target result") : null,
      };
    });
    const results = orderResultsByGroup({ groupRecord, results: unorderedResults });
    const groupSnapshot = buildGroupSnapshot({ groupRecord, results });
    const missing = groupSnapshot.missing.map((item) => item.packetId);
    const blocked = groupSnapshot.blocked.map((item) => item.packetId);
    const needsReview = groupSnapshot.ready.map((item) => item.packetId);
    const mode = groupSnapshot.returnPolicy.mode;
    const decision = mode === "per-target"
      ? ["waiting", "pending-dispatch"].includes(groupSnapshot.groupStatus)
        ? "wait"
        : groupSnapshot.blocked.length > 0 && groupSnapshot.ready.length === 0
          ? "blocked"
        : "needs-controller-review"
      : groupSnapshot.missing.length > 0
        ? "wait"
        : groupSnapshot.ready.length === 0 && groupSnapshot.blocked.length === 0
          ? "wait"
        : groupSnapshot.blocked.length > 0
          ? "blocked"
          : "needs-controller-review";
    return {
      group,
      taskId,
      groupRecord,
      returnPolicy: groupSnapshot.returnPolicy,
      groupStatus: groupSnapshot.groupStatus,
      groupSnapshot,
      packets,
      results,
      missing,
      blocked,
      needsReview,
      decision,
    };
  }

  function commandReviewResults() {
    const group = getValue("--group", "");
    const taskId = getValue("--task-id", "");
    const review = computeReviewResults({ group, taskId });
    const returnGroup = review.group || (review.packets.length === 1 ? review.packets[0].dispatchGroup : "");
    const controllerReturnDelivery = controllerReturnDeliveryStatusForGroup(returnGroup);
    const callbackPlan = buildControllerCallbackPlan({
      dispatchGroup: returnGroup,
      returnPolicy: review.returnPolicy,
      groupSnapshot: review.groupSnapshot,
      controllerReturnDeliveries: controllerReturnDelivery.deliveries,
    });

    output(
      {
        ok: true,
        command: "review-results",
        group: review.group || undefined,
        taskId: review.taskId || undefined,
        packetCount: review.packets.length,
        returnPolicy: review.returnPolicy,
        groupStatus: review.groupStatus,
        groupSnapshot: review.groupSnapshot,
        readyResults: review.groupSnapshot.ready,
        missingResults: review.groupSnapshot.missing,
        blockedResults: review.groupSnapshot.blocked,
        missing: review.missing,
        blocked: review.blocked,
        needsReview: review.needsReview,
        decision: review.decision,
        controllerReturnDeliveries: controllerReturnDelivery.deliveries,
        controllerReturnDelivery,
        callbackPlan,
      },
      [
        `Review scope: ${group ? `group ${group}` : `task ${taskId}`}`,
        `Packets: ${review.packets.length}`,
        `Decision: ${review.decision}`,
        `Controller return delivery: ${controllerReturnDelivery.status}`,
      ],
    );
  }

  function commandReviewPack() {
    const stateRootArg = getValue("--state-root", "");
    if (stateRootArg) {
      const stateRoot = resolveStateRoot(stateRootArg);
      const reviewPack = buildStateRootReviewPack(stateRoot);
      output(
        {
          ok: true,
          command: "review-pack",
          source: "wakeflow-state-root",
          stateRoot: reviewPack.stateRoot,
          stateRevision: reviewPack.stateRevision,
          demandKey: reviewPack.demandKey,
          decision: reviewPack.decision,
          groupStatus: reviewPack.groupStatus,
          reviewPack,
        },
        [
          `Review pack: state root ${reviewPack.stateRoot}`,
          `Decision: ${reviewPack.decision}`,
          `Targets: ${reviewPack.groupSnapshot.expectedTargets.join(", ") || "(none)"}`,
          `Next: ${reviewPack.nextAction}`,
        ],
      );
      return;
    }
    const group = getValue("--group", "");
    const taskId = getValue("--task-id", "");
    const review = computeReviewResults({ group, taskId });
    const reviewPack = buildReviewPack(review);
    output(
      {
        ok: true,
        command: "review-pack",
        group: review.group || undefined,
        taskId: review.taskId || undefined,
        decision: review.decision,
        groupStatus: review.groupStatus,
        reviewPack,
      },
      [
        `Review pack: ${group ? `group ${group}` : `task ${taskId}`}`,
        `Decision: ${review.decision}`,
        `Targets: ${reviewPack.groupSnapshot.expectedTargets.join(", ") || "(none)"}`,
        `Next: ${reviewPack.nextAction}`,
      ],
    );
  }

  // RA2: a read-only unified per-task rollup. Scans ALL target tasks (accepted history
  // preserved, unlike the review-scope-filtered review pack) and fuses execution status +
  // acceptance decision + persisted counts (dispatchCount/reworkCount/redesignCount) + the derived
  // retestCount (rounds dispatched to a Test window) + the recurringProblem signal (reworkCount >= 2) +
  // latest result + test-card status, so the controller sees the whole picture in one call.
  function buildTaskLedger(stateRoot) {
    const { state, stateRootRef } = readControllerStateRoot(stateRoot);
    const resultsByTask = latestStateRootResultsByTargetTask(stateRoot);
    const allTargetTasks = state.targetTasks ?? [];
    // Test-window names resolve retest churn below: a task whose targetWindow is a Test
    // window counts each (re)dispatch as a retest round (test -> fix -> test again).
    const testWindows = new Set(testWindowNames(loadWorkspaceConfig({ workspaceRoot })));

    // Test cards join to a task by suggestedTaskPackage.targetTaskId.
    const testCardStatusesByTask = new Map();
    const testCardsDir = path.join(stateRoot, "test-cards");
    if (existsSync(testCardsDir)) {
      for (const file of listJsonFiles(testCardsDir)) {
        const card = readJson(file, "test card");
        const taskId = card?.suggestedTaskPackage?.targetTaskId;
        if (!taskId) continue;
        const statuses = testCardStatusesByTask.get(taskId) ?? [];
        statuses.push(card?.status ?? "draft");
        testCardStatusesByTask.set(taskId, statuses);
      }
    }

    const tasks = allTargetTasks.map((task) => {
      const result = resultsByTask.get(task.targetTaskId)?.result ?? null;
      const testCardStatuses = testCardStatusesByTask.get(task.targetTaskId) ?? [];
      const persisted = task.counts ?? {};
      const reworkCount = persisted.reworkCount ?? 0;
      const dispatchCount = persisted.dispatchCount ?? 0;
      // retestCount: rounds this task was dispatched to a Test window (test -> fix -> test
      // again). Derived from dispatch history, decoupled from one-shot draft test-card files;
      // 0 for non-Test tasks. An informational hint for the controller, never a gate.
      const retestCount = testWindows.has(task.targetWindow) ? dispatchCount : 0;
      return {
        targetTaskId: task.targetTaskId,
        taskPackageId: task.taskPackageId,
        targetWindow: task.targetWindow,
        summary: task.summary,
        status: task.status,
        reviewDecision: task.reviewDecision ?? null,
        latestResultStatus: result?.status ?? null,
        latestResultId: result?.resultId ?? null,
        testCardStatus: testCardStatuses.length ? testCardStatuses[testCardStatuses.length - 1] : null,
        counts: {
          dispatchCount,
          reworkCount,
          retestCount,
          // redesignCount replaces the retired supplementCount: how many times this task was routed
          // back to Design (decide-review redesign). Persisted per-task, like reworkCount.
          redesignCount: persisted.redesignCount ?? 0,
        },
        // recurringProblem flags a stuck product-rework loop (K=2): stop bouncing point-fixes — give a
        // new root-cause hypothesis or route the next package to Design redesign.
        recurringProblem: reworkCount >= 2,
      };
    });
    const redesignCount = tasks.reduce((sum, task) => sum + task.counts.redesignCount, 0);
    const retestCount = tasks.reduce((sum, task) => sum + task.counts.retestCount, 0);

    return {
      kind: "WakeflowTaskLedger",
      version,
      demandKey: state.demandKey,
      demandState: state.state,
      revision: state.revision,
      stateRoot: stateRootRef,
      taskCount: tasks.length,
      redesignCount,
      retestCount,
      tasks,
      generatedAt: nowIso(),
    };
  }

  function commandTaskLedger() {
    const stateRootArg = getValue("--state-root");
    if (!stateRootArg) fail("task-ledger requires --state-root.");
    const stateRoot = resolveStateRoot(stateRootArg);
    const ledger = buildTaskLedger(stateRoot);
    const taskFilter = getValue("--task-id");
    const windowFilter = getValue("--target-window");
    let tasks = ledger.tasks;
    if (taskFilter) tasks = tasks.filter((item) => item.targetTaskId === taskFilter);
    if (windowFilter) tasks = tasks.filter((item) => item.targetWindow === windowFilter);
    output(
      { ...ledger, ok: true, command: "task-ledger", tasks },
      [
        `Task ledger: ${ledger.demandKey} (${tasks.length}/${ledger.taskCount} task(s), ${ledger.redesignCount} redesign(s))`,
        ...tasks.map((item) => `- ${item.targetTaskId} [${item.status}] dispatch x${item.counts.dispatchCount} rework x${item.counts.reworkCount} retest x${item.counts.retestCount} redesign x${item.counts.redesignCount}${item.recurringProblem ? " [recurring]" : ""}`),
      ],
    );
  }

  return {
    buildReviewPack,
    buildStateRootReviewPack,
    computeReviewResults,
    commandReviewResults,
    commandReviewPack,
    buildTaskLedger,
    commandTaskLedger,
  };
}
