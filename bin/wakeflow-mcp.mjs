#!/usr/bin/env node

import { listWakeflowRuntimeScripts, runWakeflowRuntime } from "../lib/wakeflow-runtime.mjs";

const tools = [
  {
    name: "wakeflow_initialize_workspace",
    description: "Initialize a Wakeflow runtime: discover siblings, generate/apply workspace config, install AGENTS blocks, create Design/Test surfaces, and record local window configuration. Dry-run unless apply is true. Does not accept or write thread ids.",
    inputSchema: {
      type: "object",
      properties: {
        root: { type: "string" },
        parent: { type: "string" },
        workspaceName: { type: "string" },
        controllerWindow: { type: "string" },
        useDiscovered: { type: "boolean" },
        apply: { type: "boolean" },
        internalDesign: { type: "boolean" },
        internalTest: { type: "boolean" },
        includeRealProject: { type: "boolean" },
        repositories: {
          type: "array",
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
        localWindows: {
          type: "array",
          items: {
            type: "object",
            required: ["windowName"],
            properties: {
              windowName: { type: "string" },
              role: { enum: ["controller", "target", "test-target", "design", "observer"] },
              cwd: { type: "string" },
              responsibilityRoot: { type: "string" },
              displayTitle: { type: "string" },
              canonicalUse: { type: "string" },
            },
          },
        },
      },
    },
  },
  {
    name: "wakeflow_discover_workspace",
    description: "Discover sibling repositories and current Wakeflow workspace setup without writing files.",
    inputSchema: {
      type: "object",
      properties: {
        root: { type: "string" },
        parent: { type: "string" },
      },
    },
  },
  {
    name: "wakeflow_access_profiles",
    description: "Inspect child-window AGENTS access-card coordinates and automation gates.",
    inputSchema: {
      type: "object",
      properties: {
        root: { type: "string" },
        window: { type: "string" },
      },
    },
  },
  {
    name: "wakeflow_sync_agents",
    description: "Install or dry-run Wakeflow root/child AGENTS surfaces. Does not register thread ids.",
    inputSchema: {
      type: "object",
      properties: {
        root: { type: "string" },
        rootAgents: { type: "boolean" },
        all: { type: "boolean" },
        windows: { type: "array", items: { type: "string" } },
        apply: { type: "boolean" },
      },
    },
  },
  {
    name: "wakeflow_status",
    description: "Inspect Wakeflow repository and closed-loop runtime status. Does not send messages.",
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
      },
    },
  },
  {
    name: "wakeflow_prepare_delivery",
    description: "Prepare a full runtime dispatch packet and delivery envelope. This is not a send.",
    inputSchema: {
      type: "object",
      required: ["stateRoot", "taskId"],
      properties: {
        root: { type: "string" },
        stateRoot: { type: "string" },
        taskId: { type: "string" },
        dispatchGroup: { type: "string" },
        controllerWindow: { type: "string" },
        taskPackageId: { type: "string" },
        humanContextRef: { type: "string" },
        returnPolicy: { enum: ["group-ready", "per-target"] },
        automationEnabled: { type: "boolean" },
      },
    },
  },
  {
    name: "wakeflow_record_delivery",
    description: "Record external host-send evidence for a full runtime delivery envelope.",
    inputSchema: {
      type: "object",
      required: ["deliveryFile", "status"],
      properties: {
        root: { type: "string" },
        deliveryFile: { type: "string" },
        status: { enum: ["sent", "blocked", "failed"] },
        evidence: { type: "string" },
        error: { type: "string" },
        readbackOk: { type: "boolean" },
        hostMethod: { type: "string" },
        hostMode: { enum: ["new-turn", "unknown"] },
      },
    },
  },
  {
    name: "wakeflow_submit_result",
    description: "Import a target result envelope into a full Wakeflow controller state root.",
    inputSchema: {
      type: "object",
      required: ["stateRoot", "taskId", "targetWindow", "status"],
      properties: {
        root: { type: "string" },
        stateRoot: { type: "string" },
        taskId: { type: "string" },
        targetWindow: { type: "string" },
        status: { enum: ["completed", "blocked", "needs-review"] },
        summary: { type: "string" },
        evidenceRefs: { type: "array", items: { type: "string" } },
        verification: { type: "array", items: { type: "string" } },
        risks: { type: "array", items: { type: "string" } },
        resultId: { type: "string" },
      },
    },
  },
  {
    name: "wakeflow_review",
    description: "Reduce full runtime target results into a controller review candidate.",
    inputSchema: {
      type: "object",
      required: ["stateRoot"],
      properties: {
        root: { type: "string" },
        stateRoot: { type: "string" },
      },
    },
  },
  {
    name: "wakeflow_review_pack",
    description: "Build a review evidence pack for a state root, dispatch group, or task id. This is evidence, not acceptance.",
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
    name: "wakeflow_decide_review",
    description: "Record an explicit controller decision for a review candidate.",
    inputSchema: {
      type: "object",
      required: ["stateRoot", "candidateId", "decision", "reason"],
      properties: {
        root: { type: "string" },
        stateRoot: { type: "string" },
        candidateId: { type: "string" },
        decision: { enum: ["accept", "rework", "blocked"] },
        reason: { type: "string" },
        evidenceRefs: { type: "array", items: { type: "string" } },
        apply: { type: "boolean" },
      },
    },
  },
  {
    name: "wakeflow_complete_demand",
    description: "Complete a demand after all task packages and target tasks are accepted.",
    inputSchema: {
      type: "object",
      required: ["stateRoot", "reason", "evidenceRefs"],
      properties: {
        root: { type: "string" },
        stateRoot: { type: "string" },
        reason: { type: "string" },
        evidenceRefs: { type: "array", items: { type: "string" } },
        apply: { type: "boolean" },
      },
    },
  },
  {
    name: "wakeflow_build_controller_return",
    description: "Build a controller-return delivery envelope for the original controller window. This is not a send.",
    inputSchema: {
      type: "object",
      required: ["dispatchGroup", "triggerTarget", "triggerTaskId"],
      properties: {
        root: { type: "string" },
        dispatchGroup: { type: "string" },
        triggerTarget: { type: "string" },
        triggerTaskId: { type: "string" },
        controllerWindow: { type: "string" },
        humanContextRef: { type: "string" },
        returnReason: { enum: ["result-ready", "blocked"] },
        automationEnabled: { type: "boolean" },
        apply: { type: "boolean" },
      },
    },
  },
  {
    name: "wakeflow_stop_loop",
    description: "Write a stop marker for Wakeflow automation transport and stop associated keep-live if applicable.",
    inputSchema: {
      type: "object",
      required: ["reason"],
      properties: {
        root: { type: "string" },
        reason: { type: "string" },
        automationRunId: { type: "string" },
      },
    },
  },
  {
    name: "wakeflow_keep_live_state",
    description: "Inspect keep-live state for unattended Wakeflow support.",
    inputSchema: {
      type: "object",
      properties: {
        root: { type: "string" },
      },
    },
  },
  {
    name: "wakeflow_intake_design_handoff",
    description: "Attach a ready Design handoff to a controller state root as machine intake.",
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
    inputSchema: {
      type: "object",
      properties: {
        root: { type: "string" },
        id: { type: "string" },
        source: { enum: ["all", "design", "todo"] },
        limit: { type: "number" },
        afterCompletion: { type: "boolean" },
        apply: { type: "boolean" },
      },
    },
  },
  {
    name: "wakeflow_archive_workspace_docs",
    description: "Archive completed Wakeflow workspace documents. Dry-run unless apply is true.",
    inputSchema: {
      type: "object",
      required: ["topic", "files"],
      properties: {
        root: { type: "string" },
        topic: { type: "string" },
        month: { type: "string" },
        files: { type: "array", items: { type: "string" } },
        keepIndexRows: { type: "boolean" },
        apply: { type: "boolean" },
      },
    },
  },
  {
    name: "wakeflow_archive_todo",
    description: "Archive completed global TODO rows. Dry-run unless apply is true.",
    inputSchema: {
      type: "object",
      properties: {
        root: { type: "string" },
        date: { type: "string" },
        apply: { type: "boolean" },
      },
    },
  },
  {
    name: "wakeflow_run_backend",
    description: "Run a Wakeflow runtime script through a whitelist. This does not send host thread messages.",
    inputSchema: {
      type: "object",
      required: ["script"],
      properties: {
        script: { enum: listWakeflowRuntimeScripts() },
        args: { type: "array", items: { type: "string" } },
        timeoutMs: { type: "number" },
      },
    },
  },
  {
    name: "wakeflow_full_status",
    description: "Run the embedded runtime status path.",
    inputSchema: {
      type: "object",
      properties: {
        root: { type: "string" },
        json: { type: "boolean" },
      },
    },
  },
  {
    name: "wakeflow_full_verify",
    description: "Run embedded Wakeflow runtime verification.",
    inputSchema: {
      type: "object",
      properties: {
        root: { type: "string" },
        scriptTests: { type: "boolean" },
      },
    },
  },
];

const handlers = {
  wakeflow_initialize_workspace: (args) => runWakeflowRuntime({
    script: "wakeflow-setup",
    args: [
      "initialize",
      ...rootArgs(args),
      ...optionalValue("--parent", args.parent),
      ...optionalValue("--workspace-name", args.workspaceName),
      ...optionalValue("--controller-window", args.controllerWindow),
      ...(args.useDiscovered ? ["--use-discovered"] : []),
      ...(args.internalDesign ? ["--internal-design"] : []),
      ...(args.internalTest ? ["--internal-test"] : []),
      ...(args.includeRealProject ? ["--include-real-project"] : []),
      ...repositoryArgs(args.repositories),
      ...localWindowArgs(args.localWindows),
      ...(args.apply ? ["--write"] : []),
      "--json",
    ],
    cwd: args.root || undefined,
  }),
  wakeflow_discover_workspace: (args) => runWakeflowRuntime({
    script: "wakeflow-setup",
    args: [
      "discover",
      ...rootArgs(args),
      ...optionalValue("--parent", args.parent),
      "--json",
    ],
    cwd: args.root || undefined,
  }),
  wakeflow_access_profiles: (args) => runWakeflowRuntime({
    script: "wakeflow-setup",
    args: [
      "access-profiles",
      ...rootArgs(args),
      ...optionalValue("--window", args.window),
      "--json",
    ],
    cwd: args.root || undefined,
  }),
  wakeflow_sync_agents: (args) => runWakeflowRuntime({
    script: "wakeflow-setup",
    args: args.rootAgents
      ? [
          "sync-root-agents",
          ...rootArgs(args),
          ...(args.apply ? ["--write"] : []),
          "--json",
        ]
      : [
          "write-agents",
          ...rootArgs(args),
          ...(args.all ? ["--all"] : []),
          ...repeatValues("--window", args.windows),
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
      "--json",
    ],
  }),
  wakeflow_prepare_delivery: (args) => runWakeflowRuntime({
    script: "wakeflow-delivery",
    args: [
      "prepare-dispatch-from-state",
      "--state-root", args.stateRoot,
      "--target-task-id", args.taskId,
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
  }),
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
  wakeflow_submit_result: (args) => runWakeflowRuntime({
    script: "wakeflow-state",
    args: [
      "import-target-result",
      "--state-root", args.stateRoot,
      "--target-task-id", args.taskId,
      "--target-window", args.targetWindow,
      "--status", args.status,
      ...optionalValue("--summary", args.summary),
      ...optionalValue("--result-id", args.resultId),
      ...repeatValues("--evidence-ref", args.evidenceRefs),
      ...repeatValues("--verification", args.verification),
      ...repeatValues("--risk", args.risks),
      ...rootArgs(args),
      "--write",
      "--json",
    ],
  }),
  wakeflow_review: (args) => runWakeflowRuntime({
    script: "wakeflow-state",
    args: ["reduce-results", "--state-root", args.stateRoot, ...rootArgs(args), "--write", "--json"],
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
  wakeflow_decide_review: (args) => runWakeflowRuntime({
    script: "wakeflow-state",
    args: [
      "decide-review",
      "--state-root", args.stateRoot,
      "--candidate-id", args.candidateId,
      "--decision", args.decision,
      "--reason", args.reason,
      ...repeatValues("--evidence-ref", args.evidenceRefs),
      ...rootArgs(args),
      ...(args.apply ? ["--write"] : []),
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
      "--json",
    ],
  }),
  wakeflow_build_controller_return: (args) => runWakeflowRuntime({
    script: "wakeflow-delivery",
    args: [
      "build-controller-return",
      "--group", args.dispatchGroup,
      "--trigger-target", args.triggerTarget,
      "--trigger-task-id", args.triggerTaskId,
      ...optionalValue("--controller-window", args.controllerWindow),
      ...optionalValue("--human-context-ref", args.humanContextRef),
      ...optionalValue("--return-reason", args.returnReason),
      ...(args.automationEnabled ? ["--automation-enabled"] : []),
      ...rootArgs(args),
      ...(args.apply ? ["--write"] : []),
      "--json",
    ],
  }),
  wakeflow_stop_loop: (args) => runWakeflowRuntime({
    script: "wakeflow-delivery",
    args: [
      "stop-loop",
      "--reason", args.reason,
      ...optionalValue("--automation-run-id", args.automationRunId),
      ...rootArgs(args),
      "--write",
      "--json",
    ],
  }),
  wakeflow_keep_live_state: (args) => runWakeflowRuntime({
    script: "wakeflow-delivery",
    args: ["keep-live-state", ...rootArgs(args), "--json"],
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
  wakeflow_archive_workspace_docs: (args) => runWakeflowRuntime({
    script: "wakeflow-archive-docs",
    args: [
      ...rootArgs(args),
      "--topic", args.topic,
      ...optionalValue("--month", args.month),
      ...repeatValues("--file", args.files),
      ...(args.keepIndexRows ? ["--keep-index-rows"] : []),
      ...(args.apply ? ["--apply"] : []),
      "--json",
    ],
    cwd: args.root || undefined,
  }),
  wakeflow_archive_todo: (args) => runWakeflowRuntime({
    script: "wakeflow-archive-todo",
    args: [
      ...rootArgs(args),
      ...optionalValue("--date", args.date),
      ...(args.apply ? ["--apply"] : []),
      "--json",
    ],
    cwd: args.root || undefined,
  }),
  wakeflow_run_backend: (args) => runWakeflowRuntime({
    script: args.script,
    args: args.args || [],
    timeoutMs: args.timeoutMs || 120000,
  }),
  wakeflow_full_status: (args) => runWakeflowRuntime({
    script: "wakeflow-cli",
    args: ["status", ...rootArgs(args), ...(args.json === false ? [] : ["--json"])],
    cwd: args.root || undefined,
  }),
  wakeflow_full_verify: (args) => runWakeflowRuntime({
    script: "wakeflow-cli",
    args: ["verify", ...rootArgs(args), ...(args.scriptTests ? ["--script-tests"] : []), "--json"],
    cwd: args.root || undefined,
    timeoutMs: args.scriptTests ? 180000 : 120000,
  }),
};

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  drainBuffer();
});

function optionalValue(flag, value) {
  return value === undefined || value === null || value === "" ? [] : [flag, String(value)];
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

function localWindowArgs(windows = []) {
  return (windows || []).flatMap((item) => [
    "--window", item.windowName,
    ...optionalValue("--thread-role", item.role ? `${item.windowName}=${item.role}` : ""),
    ...optionalValue("--thread-cwd", item.cwd ? `${item.windowName}=${item.cwd}` : ""),
    ...optionalValue("--thread-responsibility-root", item.responsibilityRoot ? `${item.windowName}=${item.responsibilityRoot}` : ""),
    ...optionalValue("--thread-title", item.displayTitle ? `${item.windowName}=${item.displayTitle}` : ""),
    ...optionalValue("--thread-use", item.canonicalUse ? `${item.windowName}=${item.canonicalUse}` : ""),
  ]);
}

function rootArgs(args) {
  return optionalValue("--root", args.root);
}

function send(message) {
  const body = JSON.stringify(message);
  process.stdout.write(`Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`);
}

function result(id, payload) {
  send({ jsonrpc: "2.0", id, result: payload });
}

function error(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

function toolContent(payload) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(payload, null, 2),
      },
    ],
  };
}

function handleLine(line) {
  let request;
  try {
    request = JSON.parse(line);
  } catch (parseError) {
    error(null, -32700, `Parse error: ${parseError.message}`);
    return;
  }
  try {
    if (request.method === "initialize") {
      result(request.id, {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "wakeflow", version: "0.1.0" },
      });
      return;
    }
    if (request.method === "tools/list") {
      result(request.id, { tools });
      return;
    }
    if (request.method === "tools/call") {
      const { name, arguments: args = {} } = request.params || {};
      const handler = handlers[name];
      if (!handler) throw new Error(`Unknown Wakeflow tool: ${name}`);
      Promise.resolve(handler(args))
        .then((payload) => result(request.id, toolContent(payload)))
        .catch((toolError) => error(request.id, -32000, toolError.message));
      return;
    }
    if (!request.id) return;
    error(request.id, -32601, `Unknown method: ${request.method}`);
  } catch (callError) {
    error(request.id, -32000, callError.message);
  }
}

function drainBuffer() {
  while (buffer.length) {
    if (buffer.startsWith("Content-Length:")) {
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd < 0) return;
      const header = buffer.slice(0, headerEnd);
      const match = /Content-Length:\s*(\d+)/i.exec(header);
      if (!match) {
        error(null, -32600, "Invalid MCP frame header");
        buffer = "";
        return;
      }
      const length = Number(match[1]);
      const bodyStart = headerEnd + 4;
      if (buffer.length < bodyStart + length) return;
      const body = buffer.slice(bodyStart, bodyStart + length);
      buffer = buffer.slice(bodyStart + length);
      handleLine(body);
      continue;
    }
    const newline = buffer.indexOf("\n");
    if (newline < 0) return;
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (line) handleLine(line);
  }
}
