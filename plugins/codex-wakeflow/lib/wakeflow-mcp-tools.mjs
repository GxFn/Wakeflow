import { existsSync } from "node:fs";
import path from "node:path";
import { runWakeflowRuntime } from "./wakeflow-runtime.mjs";
import { hostProfile } from "../scripts/lib/wakeflow-host-profile.mjs";

function readOnlyTool(title) {
  return {
    title,
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  };
}

function localWriteTool(title, idempotentHint = false) {
  return {
    title,
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint,
    openWorldHint: false,
  };
}

export const tools = [
  {
    name: "wakeflow_initialize_workspace",
    description: `Initialize a Wakeflow runtime: discover siblings, generate/apply workspace config, install ${hostProfile.memoryFileLabel} blocks, create sibling Design/Test surfaces, and record derived local window configuration. Dry-run unless apply is true. If repositories/useDiscovered are omitted, the tool returns read-only discovery plus an agent-selection protocol; ${hostProfile.hostName} must judge clean versus messy from those facts, pass explicit repositories for a clean workspace, or ask the user in a messy workspace. Returns a localized host ${hostProfile.hostTools.createWindow} launch plan; replaceWindows limits the plan to selected windows. Real thread ids are registered only in the local thread registry by host-controlled follow-up, not tracked docs or this MCP schema; window config is derived from workspace config plus registry presence.`,
    annotations: localWriteTool("Initialize Wakeflow Workspace", true),
    inputSchema: {
      type: "object",
      properties: {
        root: { type: "string" },
        parent: { type: "string" },
        workspaceName: { type: "string" },
        controllerWindow: { type: "string" },
        designWindow: {
          type: "string",
          description: "Only set this when the user explicitly names an existing or custom Design window. Otherwise Wakeflow creates/uses a fresh Design support surface.",
        },
        testWindow: {
          type: "string",
          description: "Only set this when the user explicitly names an existing or custom Test window. Otherwise Wakeflow creates/uses a fresh Test support surface.",
        },
        language: {
          type: "string",
          enum: ["auto", "zh", "en"],
          description: "Prompt/title language for window launch plans. Use zh for Chinese users, en for English users, or auto when unknown.",
        },
        useDiscovered: {
          type: "boolean",
          description: "Force every discovered directory into managed repositories. Use only after the agent/user has confirmed all discovered directories are intended work windows; prefer explicit repositories for messy workspaces.",
        },
        apply: { type: "boolean" },
        internalDesign: { type: "boolean" },
        internalTest: { type: "boolean" },
        includeRealProject: { type: "boolean" },
        excludeWindows: { type: "array", items: { type: "string" } },
        replaceWindows: {
          type: "array",
          items: { type: "string" },
          description: `Only return/create/update these replacement window entries; real replacement thread ids are still recorded in the local thread registry after host ${hostProfile.hostTools.createWindow} succeeds.`,
        },
        repositories: {
          type: "array",
          description: `Agent/user-confirmed work-window mappings. In clean workspaces ${hostProfile.hostName} should pass these explicitly after discovery instead of relying on hidden heuristics.`,
          items: {
            type: "object",
            required: ["windowName", "path"],
            properties: {
              windowName: { type: "string" },
              path: { type: "string" },
              role: { type: "string" },
            },
          },
        },
      },
    },
  },
  {
    name: "wakeflow_release_window_lock",
    description: "Release the shared cross-host in-flight delivery lock for one window. Recovery action for stalled or ownerless locks; releasing another host's fresh lock must be a deliberate controller decision.",
    annotations: localWriteTool("Release Wakeflow Window Lock"),
    inputSchema: {
      type: "object",
      required: ["window"],
      properties: {
        root: { type: "string" },
        window: { type: "string" },
        apply: { type: "boolean" },
      },
    },
  },
  {
    name: "wakeflow_status",
    description: "Inspect Wakeflow repository and closed-loop runtime status, including host-send, callbackPlan, delivery failure, replay, and resume-plan diagnostics. Does not send messages.",
    annotations: readOnlyTool("Inspect Wakeflow Status"),
    inputSchema: {
      type: "object",
      properties: {
        root: { type: "string" },
      },
    },
  },
  {
    name: "wakeflow_init_demand",
    description: "Create a full Wakeflow controller state root for one demand.",
    annotations: localWriteTool("Create Wakeflow Demand State"),
    inputSchema: {
      type: "object",
      required: ["demandKey", "title"],
      properties: {
        root: { type: "string" },
        demandKey: { type: "string" },
        title: { type: "string" },
        goal: { type: "string" },
        completionDefinition: { type: "string" },
        stagePlan: { type: "string" },
        stateRoot: { type: "string" },
      },
    },
  },
  {
    name: "wakeflow_add_task",
    description: "Add a full runtime task package and optional target task to a Wakeflow controller state root.",
    annotations: localWriteTool("Add Wakeflow Task Package"),
    inputSchema: {
      type: "object",
      required: ["stateRoot", "taskId", "targetWindow", "summary"],
      properties: {
        root: { type: "string" },
        stateRoot: { type: "string" },
        taskId: { type: "string" },
        targetWindow: { type: "string" },
        summary: { type: "string" },
        packageId: { type: "string" },
        sourceRef: { type: "string" },
        targetSummary: { type: "string" },
        adoptHost: { type: "boolean", description: "Explicitly transfer demand controller-host ownership to this host; without it, acting on a demand owned by the other host fails closed." },
      },
    },
  },
  {
    name: "wakeflow_prepare_delivery",
    description: "Prepare one direct-thread delivery envelope. Use direction=target for controller-to-window dispatch, or direction=controller-return for target-to-controller return. This never sends the host thread message.",
    annotations: localWriteTool("Prepare Wakeflow Delivery Envelope"),
    inputSchema: {
      type: "object",
      required: ["direction"],
      properties: {
        root: { type: "string" },
        direction: { type: "string", enum: ["target", "controller-return"] },
        stateRoot: { type: "string" },
        taskId: { type: "string" },
        dispatchGroup: { type: "string" },
        controllerWindow: { type: "string" },
        taskPackageId: { type: "string" },
        humanContextRef: { type: "string" },
        returnPolicy: { type: "string", enum: ["group-ready", "per-target"] },
        triggerTarget: { type: "string" },
        triggerTaskId: { type: "string" },
        returnReason: { type: "string", enum: ["result-ready", "blocked"] },
        automationEnabled: { type: "boolean" },
      },
    },
  },
  {
    name: "wakeflow_record_delivery",
    description: "Record external host-send evidence for a full runtime delivery envelope.",
    annotations: localWriteTool("Record Wakeflow Delivery Evidence"),
    inputSchema: {
      type: "object",
      required: ["deliveryFile", "status"],
      properties: {
        root: { type: "string" },
        deliveryFile: { type: "string" },
        status: { type: "string", enum: ["sent", "blocked", "failed"] },
        evidence: { type: "string" },
        error: { type: "string" },
        readbackOk: { type: "boolean" },
        hostMethod: { type: "string" },
        hostMode: { type: "string", enum: ["new-turn", "unknown"] },
      },
    },
  },
  {
    name: "wakeflow_record_target_result",
    description: "Record one target-window TargetResultEnvelope into a controller state root. This is target closeout evidence, not controller acceptance or next dispatch; when returnRoute=controller applies, follow with review pack, controller-return delivery, host send, and delivery-run recording.",
    annotations: localWriteTool("Record Wakeflow Target Result"),
    inputSchema: {
      type: "object",
      required: ["stateRoot", "targetWindow", "taskId", "status"],
      properties: {
        root: { type: "string" },
        stateRoot: { type: "string" },
        targetWindow: { type: "string" },
        taskId: { type: "string" },
        status: { type: "string", enum: ["completed", "blocked", "needs-review"] },
        resultId: { type: "string" },
        summary: { type: "string" },
        evidenceRefs: { type: "array", items: { type: "string" } },
        verification: { type: "array", items: { type: "string" } },
        risks: { type: "array", items: { type: "string" } },
      },
    },
  },
  {
    name: "wakeflow_review_pack",
    description: "Build a review evidence pack for a state root, dispatch group, or task id, including callbackPlan when direct-thread controller return is applicable. Read-only, two sanctioned uses: (1) controller review preparation; (2) a TARGET window confirming its OWN dispatch group's return readiness before building a controller-return. Targets must scope it to their own group; review decisions (accept/rework/blocked) stay controller-only. This is evidence, not acceptance.",
    annotations: readOnlyTool("Build Wakeflow Review Pack"),
    inputSchema: {
      type: "object",
      properties: {
        root: { type: "string" },
        stateRoot: { type: "string" },
        dispatchGroup: { type: "string" },
        taskId: { type: "string" },
      },
    },
  },
  {
    name: "wakeflow_trace_spine",
    description: "Trace the Wakeflow evidence spine for a state root, dispatch group, delivery, target, or target result. Read-only diagnostic evidence; not controller acceptance and not a host send.",
    annotations: readOnlyTool("Trace Wakeflow Evidence Spine"),
    inputSchema: {
      type: "object",
      properties: {
        root: { type: "string" },
        stateRoot: { type: "string" },
        dispatchGroup: { type: "string" },
        targetWindow: { type: "string" },
        taskId: { type: "string" },
        resultFile: { type: "string" },
        resultId: { type: "string" },
        deliveryFile: { type: "string" },
        deliveryId: { type: "string" },
      },
    },
  },
  {
    name: "wakeflow_reduce_results",
    description: "Reduce imported target results into a controller review candidate. This creates the transition candidate needed by wakeflow_decide_review, but it is not acceptance, completion, or dispatch.",
    annotations: localWriteTool("Reduce Wakeflow Target Results"),
    inputSchema: {
      type: "object",
      required: ["stateRoot"],
      properties: {
        root: { type: "string" },
        stateRoot: { type: "string" },
        apply: { type: "boolean" },
        adoptHost: { type: "boolean", description: "Explicitly transfer demand controller-host ownership to this host; without it, acting on a demand owned by the other host fails closed." },
      },
    },
  },
  {
    name: "wakeflow_decide_review",
    description: "Record an explicit controller decision for a review candidate created by wakeflow_reduce_results.",
    annotations: localWriteTool("Record Wakeflow Review Decision"),
    inputSchema: {
      type: "object",
      required: ["stateRoot", "candidateId", "decision", "reason"],
      properties: {
        root: { type: "string" },
        stateRoot: { type: "string" },
        candidateId: { type: "string" },
        decision: { type: "string", enum: ["accept", "rework", "blocked"] },
        reason: { type: "string" },
        evidenceRefs: { type: "array", items: { type: "string" } },
        acceptBlocked: {
          type: "boolean",
          description: "Explicitly accept a candidate that contains blocked target results. Without this, accept fails when blocked results are present.",
        },
        apply: { type: "boolean" },
        adoptHost: { type: "boolean", description: "Explicitly transfer demand controller-host ownership to this host; without it, acting on a demand owned by the other host fails closed." },
      },
    },
  },
  {
    name: "wakeflow_complete_demand",
    description: "Complete a demand after all task packages and target tasks are accepted.",
    annotations: localWriteTool("Complete Wakeflow Demand"),
    inputSchema: {
      type: "object",
      required: ["stateRoot", "reason", "evidenceRefs"],
      properties: {
        root: { type: "string" },
        stateRoot: { type: "string" },
        reason: { type: "string" },
        evidenceRefs: { type: "array", items: { type: "string" } },
        apply: { type: "boolean" },
        adoptHost: { type: "boolean", description: "Explicitly transfer demand controller-host ownership to this host; without it, acting on a demand owned by the other host fails closed." },
      },
    },
  },
  {
    name: "wakeflow_intake_design_handoff",
    description: "Attach a ready Design handoff to a controller state root as machine intake.",
    annotations: localWriteTool("Intake Wakeflow Design Handoff"),
    inputSchema: {
      type: "object",
      required: ["stateRoot", "designKey"],
      properties: {
        root: { type: "string" },
        stateRoot: { type: "string" },
        designKey: { type: "string" },
        board: { type: "string" },
        apply: { type: "boolean" },
      },
    },
  },
  {
    name: "wakeflow_intake_test_card",
    description: "Create a Test boundary card under a controller state root.",
    annotations: localWriteTool("Create Wakeflow Test Card"),
    inputSchema: {
      type: "object",
      required: [
        "stateRoot",
        "testId",
        "targetWindow",
        "question",
        "objectBoundary",
        "controllerSelfChecks",
        "realScenarioConditions",
        "successMeans",
        "failureMeans",
        "cannotConclude",
        "stopConditions"
      ],
      properties: {
        root: { type: "string" },
        stateRoot: { type: "string" },
        testId: { type: "string" },
        targetWindow: { type: "string" },
        question: { type: "string" },
        objectBoundary: { type: "string" },
        controllerSelfChecks: { type: "array", items: { type: "string" } },
        realScenarioConditions: { type: "array", items: { type: "string" } },
        successMeans: { type: "array", items: { type: "string" } },
        failureMeans: { type: "array", items: { type: "string" } },
        cannotConclude: { type: "array", items: { type: "string" } },
        stopConditions: { type: "array", items: { type: "string" } },
        sourceRef: { type: "string" },
        evidenceRequired: { type: "array", items: { type: "string" } },
        allowedOperations: { type: "array", items: { type: "string" } },
        forbiddenOperations: { type: "array", items: { type: "string" } },
        apply: { type: "boolean" },
      },
    },
  },
  {
    name: "wakeflow_next_work",
    description: "Scan Design handoff and TODO ledgers for the next controller-ready candidate.",
    annotations: localWriteTool("Select Wakeflow Next Work"),
    inputSchema: {
      type: "object",
      properties: {
        root: { type: "string" },
        id: { type: "string" },
        source: { type: "string", enum: ["all", "design", "todo"] },
        limit: { type: "number" },
        afterCompletion: { type: "boolean" },
        apply: { type: "boolean" },
      },
    },
  },
  {
    name: "wakeflow_archive_todo",
    description: "Archive completed Wakeflow TODO rows and historical sync records into the configured workspace ledger. Dry-run unless apply is true. This tool records archive facts only; it does not accept work, select next work, or send host messages.",
    annotations: localWriteTool("Archive Wakeflow TODO Rows"),
    inputSchema: {
      type: "object",
      properties: {
        root: { type: "string" },
        month: {
          type: "string",
          description: "Archive month in YYYY-MM. Defaults to the backend policy when omitted.",
        },
        date: {
          type: "string",
          description: "Archive date in YYYY-MM-DD. Defaults to today's date when omitted.",
        },
        keepCompleted: {
          type: "number",
          description: "Number of completed TODO rows to keep on the active board.",
        },
        keepSync: {
          type: "number",
          description: "Number of historical sync records to keep on the active board.",
        },
        apply: { type: "boolean" },
        refreshSummaries: {
          type: "boolean",
          description: "Refresh archive summary indexes after a successful archive run.",
        },
      },
    },
  },
  {
    name: "wakeflow_archive_workspace_docs",
    description: "Archive explicit completed Wakeflow workspace documents into the configured workspace ledger topic, or prune active index rows that already point at archive topics. Dry-run unless apply is true. This tool never archives the active index/current plan by inference.",
    annotations: localWriteTool("Archive Wakeflow Workspace Documents"),
    inputSchema: {
      type: "object",
      properties: {
        root: { type: "string" },
        topic: {
          type: "string",
          description: "Archive topic folder name. Required when files are supplied. The backend normalizes it to a safe kebab-case segment.",
        },
        month: {
          type: "string",
          description: "Archive month in YYYY-MM. Defaults to the backend policy when omitted.",
        },
        files: {
          type: "array",
          items: { type: "string" },
          description: "Active workspace Markdown documents to archive. Omit only when pruneIndexOnly is true.",
        },
        keepIndexRows: {
          type: "boolean",
          description: "Keep source index rows instead of trimming archived rows.",
        },
        pruneIndexOnly: {
          type: "boolean",
          description: "Only prune index rows for already archived docs; do not move files.",
        },
        apply: { type: "boolean" },
        refreshSummaries: {
          type: "boolean",
          description: "Refresh archive summary indexes after a successful archive run.",
        },
      },
    },
  },
  {
    name: "wakeflow_verify",
    description: "Run embedded Wakeflow runtime verification for an installed workspace or the Wakeflow source repository.",
    annotations: readOnlyTool("Verify Wakeflow Runtime"),
    inputSchema: {
      type: "object",
      properties: {
        root: { type: "string" },
        scriptTests: { type: "boolean" },
      },
    },
  },
];

export const handlers = {
  wakeflow_initialize_workspace: (args) => runWakeflowRuntime({
    script: "wakeflow-setup",
    args: [
      "initialize",
      ...rootArgs(args),
      ...optionalValue("--parent", args.parent),
      ...optionalValue("--workspace-name", args.workspaceName),
      ...optionalValue("--controller-window", args.controllerWindow),
      ...optionalValue("--design-window", args.designWindow),
      ...optionalValue("--test-window", args.testWindow),
      ...optionalValue("--language", args.language),
      ...(args.useDiscovered ? ["--use-discovered"] : []),
      ...(args.internalDesign ? ["--internal-design"] : []),
      ...(args.internalTest ? ["--internal-test"] : []),
      ...(args.includeRealProject ? ["--include-real-project"] : []),
      ...repositoryArgs(args.repositories),
      ...repeatValues("--exclude-window", args.excludeWindows),
      ...repeatValues("--replace-window", args.replaceWindows),
      ...(args.apply ? ["--write"] : []),
      "--json",
    ],
    cwd: args.root || undefined,
  }),
  wakeflow_release_window_lock: (args) => runWakeflowRuntime({
    script: "wakeflow-delivery",
    args: [
      "release-window-lock",
      "--window", args.window,
      ...rootArgs(args),
      ...(args.apply ? ["--write"] : []),
      "--json",
    ],
    cwd: args.root || undefined,
  }),
  wakeflow_status: (args) => runWakeflowRuntime({
    script: "wakeflow-cli",
    args: ["status", ...rootArgs(args), "--json"],
    cwd: args.root || undefined,
  }),
  wakeflow_init_demand: (args) => runWakeflowRuntime({
    script: "wakeflow-state",
    args: [
      "init",
      "--demand-key", args.demandKey,
      "--title", args.title,
      ...optionalValue("--goal", args.goal),
      ...optionalValue("--completion-definition", args.completionDefinition),
      ...optionalValue("--stage-plan", args.stagePlan),
      ...optionalValue("--state-root", args.stateRoot),
      ...rootArgs(args),
      "--write",
      "--json",
    ],
  }),
  wakeflow_add_task: (args) => runWakeflowRuntime({
    script: "wakeflow-state",
    args: [
      "add-task-package",
      "--state-root", args.stateRoot,
      "--task-package-id", args.packageId || args.taskId,
      "--summary", args.summary,
      "--target-window", args.targetWindow,
      "--target-task-id", args.taskId,
      ...optionalValue("--target-summary", args.targetSummary),
      ...optionalValue("--source-ref", args.sourceRef),
      ...rootArgs(args),
      "--write",
      ...(args.adoptHost ? ["--adopt-host"] : []),
      "--json",
    ],
  }),
  wakeflow_prepare_delivery: (args) => {
    const direction = args.direction || "target";
    if (direction === "controller-return") {
      const dispatchGroup = requireValueForTool(args, "dispatchGroup", "wakeflow_prepare_delivery direction=controller-return");
      const triggerTarget = requireValueForTool(args, "triggerTarget", "wakeflow_prepare_delivery direction=controller-return");
      const triggerTaskId = requireValueForTool(args, "triggerTaskId", "wakeflow_prepare_delivery direction=controller-return");
      return runWakeflowRuntime({
        script: "wakeflow-delivery",
        args: [
          "build-controller-return",
          "--group", dispatchGroup,
          "--trigger-target", triggerTarget,
          "--trigger-task-id", triggerTaskId,
          ...optionalValue("--controller-window", args.controllerWindow),
          ...optionalValue("--human-context-ref", args.humanContextRef),
          ...optionalValue("--return-reason", args.returnReason),
          ...(args.automationEnabled ? ["--automation-enabled"] : []),
          ...rootArgs(args),
          "--write",
          "--json",
        ],
      });
    }
    const stateRoot = requireValueForTool(args, "stateRoot", "wakeflow_prepare_delivery direction=target");
    const taskId = requireValueForTool(args, "taskId", "wakeflow_prepare_delivery direction=target");
    return runWakeflowRuntime({
      script: "wakeflow-delivery",
      args: [
        "prepare-dispatch-from-state",
        "--state-root", stateRoot,
        "--target-task-id", taskId,
        ...optionalValue("--task-package-id", args.taskPackageId),
        ...optionalValue("--human-context-ref", args.humanContextRef),
        ...optionalValue("--controller-window", args.controllerWindow),
        ...optionalValue("--group", args.dispatchGroup),
        ...optionalValue("--return-policy", args.returnPolicy),
        ...(args.automationEnabled ? ["--automation-enabled"] : []),
        ...rootArgs(args),
        "--write",
        "--json",
      ],
    });
  },
  wakeflow_record_delivery: (args) => runWakeflowRuntime({
    script: "wakeflow-delivery",
    args: [
      "record-delivery-run",
      "--delivery-file", args.deliveryFile,
      "--status", args.status,
      ...optionalValue("--evidence", args.evidence),
      ...optionalValue("--error", args.error),
      ...optionalValue("--host-method", args.hostMethod),
      ...optionalValue("--host-mode", args.hostMode),
      ...(typeof args.readbackOk === "boolean" ? ["--readback-ok", String(args.readbackOk)] : []),
      ...rootArgs(args),
      "--write",
      "--json",
    ],
  }),
  wakeflow_record_target_result: (args) => runWakeflowRuntime({
    script: "wakeflow-state",
    args: [
      "import-target-result",
      "--state-root", args.stateRoot,
      "--target-task-id", args.taskId,
      "--target-window", args.targetWindow,
      "--status", args.status,
      ...optionalValue("--result-id", args.resultId),
      ...optionalValue("--summary", args.summary),
      ...repeatValues("--evidence-ref", args.evidenceRefs),
      ...repeatValues("--verification", args.verification),
      ...repeatValues("--risk", args.risks),
      ...rootArgs(args),
      "--write",
      "--json",
    ],
  }),
  wakeflow_review_pack: (args) => runWakeflowRuntime({
    script: "wakeflow-delivery",
    args: [
      "review-pack",
      ...optionalValue("--state-root", args.stateRoot),
      ...optionalValue("--group", args.dispatchGroup),
      ...optionalValue("--task-id", args.taskId),
      ...rootArgs(args),
      "--json",
    ],
  }),
  wakeflow_trace_spine: (args) => runWakeflowRuntime({
    script: "wakeflow-delivery",
    args: [
      "trace-spine",
      ...optionalValue("--state-root", args.stateRoot),
      ...optionalValue("--group", args.dispatchGroup),
      ...optionalValue("--target-window", args.targetWindow),
      ...optionalValue("--task-id", args.taskId),
      ...optionalValue("--result-file", args.resultFile),
      ...optionalValue("--result-id", args.resultId),
      ...optionalValue("--delivery-file", args.deliveryFile),
      ...optionalValue("--delivery-id", args.deliveryId),
      ...rootArgs(args),
      "--json",
    ],
  }),
  wakeflow_reduce_results: (args) => runWakeflowRuntime({
    script: "wakeflow-state",
    args: [
      "reduce-results",
      "--state-root", args.stateRoot,
      ...rootArgs(args),
      ...(args.apply ? ["--write"] : []),
      ...(args.adoptHost ? ["--adopt-host"] : []),
      "--json",
    ],
  }),
  wakeflow_decide_review: (args) => runWakeflowRuntime({
    script: "wakeflow-state",
    args: [
      "decide-review",
      "--state-root", args.stateRoot,
      "--candidate-id", args.candidateId,
      "--decision", args.decision,
      "--reason", args.reason,
      ...repeatValues("--evidence-ref", args.evidenceRefs),
      ...(args.acceptBlocked ? ["--accept-blocked"] : []),
      ...rootArgs(args),
      ...(args.apply ? ["--write"] : []),
      ...(args.adoptHost ? ["--adopt-host"] : []),
      "--json",
    ],
  }),
  wakeflow_complete_demand: (args) => runWakeflowRuntime({
    script: "wakeflow-state",
    args: [
      "complete-demand",
      "--state-root", args.stateRoot,
      "--reason", args.reason,
      ...repeatValues("--evidence-ref", args.evidenceRefs),
      ...rootArgs(args),
      ...(args.apply ? ["--write"] : []),
      ...(args.adoptHost ? ["--adopt-host"] : []),
      "--json",
    ],
  }),
  wakeflow_intake_design_handoff: (args) => runWakeflowRuntime({
    script: "wakeflow-intake",
    args: [
      "design-handoff",
      "--state-root", args.stateRoot,
      "--design-key", args.designKey,
      ...optionalValue("--board", args.board),
      ...rootArgs(args),
      ...(args.apply ? ["--write"] : []),
      "--json",
    ],
  }),
  wakeflow_intake_test_card: (args) => runWakeflowRuntime({
    script: "wakeflow-intake",
    args: [
      "test-card",
      "--state-root", args.stateRoot,
      "--test-id", args.testId,
      "--target-window", args.targetWindow,
      "--question", args.question,
      "--object-boundary", args.objectBoundary,
      ...repeatValues("--controller-self-check", args.controllerSelfChecks),
      ...repeatValues("--real-scenario-condition", args.realScenarioConditions),
      ...repeatValues("--success-means", args.successMeans),
      ...repeatValues("--failure-means", args.failureMeans),
      ...repeatValues("--cannot-conclude", args.cannotConclude),
      ...repeatValues("--stop-condition", args.stopConditions),
      ...optionalValue("--source-ref", args.sourceRef),
      ...repeatValues("--evidence-required", args.evidenceRequired),
      ...repeatValues("--allowed-operation", args.allowedOperations),
      ...repeatValues("--forbidden-operation", args.forbiddenOperations),
      ...rootArgs(args),
      ...(args.apply ? ["--write"] : []),
      "--json",
    ],
  }),
  wakeflow_next_work: (args) => runWakeflowRuntime({
    script: "wakeflow-next-work",
    args: [
      ...rootArgs(args),
      ...optionalValue("--id", args.id),
      ...optionalValue("--source", args.source),
      ...optionalValue("--limit", args.limit),
      ...(args.afterCompletion ? ["--after-completion"] : []),
      ...(args.apply ? ["--write"] : []),
      "--json",
    ],
    cwd: args.root || undefined,
  }),
  wakeflow_archive_todo: async (args) => {
    const archive = await runWakeflowRuntime({
      script: "wakeflow-archive-todo",
      args: [
        ...rootArgs(args),
        ...optionalValue("--month", args.month),
        ...optionalValue("--date", args.date),
        ...optionalValue("--keep-completed", args.keepCompleted),
        ...optionalValue("--keep-sync", args.keepSync),
        ...(args.apply ? ["--apply"] : []),
        "--json",
      ],
      cwd: args.root || undefined,
    });
    return maybeRefreshArchiveSummaries(args, archive);
  },
  wakeflow_archive_workspace_docs: async (args) => {
    const files = asStringList(args.files);
    if (files.length === 0 && !args.pruneIndexOnly) {
      throw new Error("wakeflow_archive_workspace_docs requires files unless pruneIndexOnly is true");
    }
    if (files.length > 0) {
      requireValueForTool(args, "topic", "wakeflow_archive_workspace_docs");
    }
    const archive = await runWakeflowRuntime({
      script: "wakeflow-archive-docs",
      args: [
        ...rootArgs(args),
        ...optionalValue("--topic", args.topic),
        ...optionalValue("--month", args.month),
        ...repeatValues("--file", files),
        ...(args.keepIndexRows ? ["--keep-index-rows"] : []),
        ...(args.pruneIndexOnly ? ["--prune-index-only"] : []),
        ...(args.apply ? ["--apply"] : []),
        "--json",
      ],
      cwd: args.root || undefined,
    });
    return maybeRefreshArchiveSummaries(args, archive);
  },
  wakeflow_verify: (args) => runWakeflowRuntime({
    script: "wakeflow-cli",
    args: ["verify", ...rootArgs(args), ...(args.scriptTests ? ["--script-tests"] : []), "--json"],
    cwd: args.root || undefined,
    timeoutMs: args.scriptTests ? 180000 : 120000,
  }),
};

async function maybeRefreshArchiveSummaries(args, archiveResult) {
  if (!args.refreshSummaries || !archiveResult?.ok) {
    return archiveResult;
  }
  const summaries = await runWakeflowRuntime({
    script: "wakeflow-archive-summaries",
    args: [
      ...rootArgs(args),
      ...(args.apply ? ["--apply"] : []),
      "--json",
    ],
    cwd: args.root || undefined,
  });
  return {
    ok: Boolean(archiveResult.ok && summaries.ok),
    archive: archiveResult,
    summaries,
  };
}

function optionalValue(flag, value) {
  return value === undefined || value === null || value === "" ? [] : [flag, String(value)];
}

function requireValueForTool(args, name, context) {
  const value = args[name];
  if (value === undefined || value === null || value === "") {
    throw new Error(`${context} requires ${name}`);
  }
  return String(value);
}

function asStringList(values) {
  if (!values) return [];
  return (Array.isArray(values) ? values : [values])
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);
}

function repeatValues(flag, values) {
  if (!values) return [];
  const list = Array.isArray(values) ? values : [values];
  return list.flatMap((value) => optionalValue(flag, value));
}

function repositoryArgs(repositories = []) {
  return (repositories || []).flatMap((repo) => [
    "--repo", `${repo.windowName}=${repo.path}`,
    ...optionalValue("--role", repo.role ? `${repo.windowName}=${repo.role}` : ""),
  ]);
}

function rootArgs(args) {
  return optionalValue("--root", args.root ?? defaultWorkspaceRoot());
}

function defaultWorkspaceRoot() {
  // The MCP server process may start with an arbitrary cwd (for plugin-managed
  // servers it is not the user's workspace), so an explicit root from the
  // caller wins; otherwise fall back to the host-injected workspace dir.
  for (const candidate of [process.env.WAKEFLOW_DEFAULT_ROOT, process.env.CLAUDE_PROJECT_DIR]) {
    if (candidate && path.isAbsolute(candidate) && existsSync(candidate)) return candidate;
  }
  return undefined;
}
