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

const toolDefinitions = [
  {
    name: "wakeflow_initialize_workspace",
    description: `Initialize a Wakeflow runtime: discover siblings, generate/apply workspace config, install ${hostProfile.memoryFileLabel} blocks, create sibling Design/Test surfaces, and record derived local window configuration. Dry-run unless apply is true. On an already initialized workspace, apply is allowed only when the user explicitly asks for reset initialization and resetInitialization is true with explicit repositories; never use useDiscovered for reset. Heavy or stale existing windows should use wakeflow_replace_windows instead of initialization. Launch plans include host-profile create-window settings such as reasoning effort/model when supported. Real thread ids are registered only in the local thread registry by host-controlled follow-up, not tracked docs or this MCP schema; window config is derived from workspace config plus registry presence.`,
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
        resetInitialization: {
          type: "boolean",
          description: "Required with apply:true only when the user explicitly requests resetting an already initialized Wakeflow workspace. Reset requires explicit repositories and refuses useDiscovered.",
        },
        internalDesign: { type: "boolean" },
        internalTest: { type: "boolean" },
        includeRealProject: { type: "boolean" },
        excludeWindows: { type: "array", items: { type: "string" } },
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
    name: "wakeflow_replace_windows",
    description: `Regenerate a scoped ${hostProfile.hostTools.createWindow} launch plan for one or more existing Wakeflow windows without reinitializing workspace docs. Pass window for the high-frequency single-window path (a responsibility window that is too context-heavy, stale, or needs rebinding) or windows for a batch. The tool reads the current workspace config, returns only the requested replacement entries with host-profile create-window settings such as reasoning effort/model when supported, and includes localRegistration argv templates; real thread ids are still registered only by the host-controlled local follow-up after ${hostProfile.hostTools.createWindow} succeeds.`,
    annotations: readOnlyTool("Plan Wakeflow Replacement Windows"),
    inputSchema: {
      type: "object",
      properties: {
        root: { type: "string" },
        parent: { type: "string" },
        language: {
          type: "string",
          enum: ["auto", "zh", "en"],
          description: "Prompt/title language for replacement window launch plans. Use zh for Chinese users, en for English users, or auto when unknown.",
        },
        includeRealProject: {
          type: "boolean",
          description: "Allow replacing the configured real-project window when that window is intentionally managed.",
        },
        window: {
          type: "string",
          description: "Recreate exactly ONE existing Wakeflow logical window (high-frequency path). Provide window or windows, not both.",
        },
        windows: {
          type: "array",
          minItems: 1,
          items: { type: "string" },
          description: "Existing Wakeflow logical window names to recreate as a batch. Provide window or windows, not both.",
        },
      },
    },
  },
  {
    name: "wakeflow_adopt_demand_host",
    description: "Explicitly transfer (or claim) demand controller-host ownership to THIS host, with an audit event and a revision bump — no other state changes. The sanctioned cross-host handoff; existing transition candidates become stale and must be re-reduced on the new host.",
    annotations: localWriteTool("Adopt Wakeflow Demand Ownership"),
    inputSchema: {
      type: "object",
      required: ["stateRoot"],
      properties: {
        root: { type: "string" },
        stateRoot: { type: "string" },
        reason: { type: "string" },
        apply: { type: "boolean" },
      },
    },
  },
  {
    name: "wakeflow_render_progress",
    description: "Re-render the developer progress projection for a demand state root (the projection goes stale after every state mutation). Owner-host only; does not change machine state semantics.",
    annotations: localWriteTool("Render Wakeflow Progress"),
    inputSchema: {
      type: "object",
      required: ["stateRoot"],
      properties: {
        root: { type: "string" },
        stateRoot: { type: "string" },
        apply: { type: "boolean" },
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
        language: { type: "string", enum: ["auto", "zh", "en"], description: "Demand interface language; drives the human-readable sentences of all envelope prompts for this demand." },
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
        verbose: { type: "boolean", description: "Return the full structured payload (envelope/packet/run echoes). Default is a compact summary; the artifacts are on disk at the reported file paths." },
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
        verbose: { type: "boolean", description: "Return the full structured payload (envelope/packet/run echoes). Default is a compact summary; the artifacts are on disk at the reported file paths." },
        deliveryFile: { type: "string" },
        status: { type: "string", enum: ["sent", "blocked", "failed"] },
        evidence: { type: "string" },
        deliveryRunId: { type: "string", description: "Distinct run id for retrying the same delivery after a failed attempt (defaults to run-<deliveryId>, which cannot be re-recorded with different content)." },
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
        verbose: { type: "boolean", description: "Return the full structured payload (envelope/packet/run echoes). Default is a compact summary; the artifacts are on disk at the reported file paths." },
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
    name: "wakeflow_view",
    description: "Read-only (mostly) projections for a demand state root; scope selects which. task-ledger: unified per-task rollup for EVERY target task (accepted history preserved) — execution status, acceptance decision, latest result, test-card status, and handling counts (dispatchCount/reworkCount persisted; retestCount/supplementCount derived). window: per-window orientation card — the tasks that belong to a window (with handling counts), its task packages, its rollup, and the file areas where its state-root/transport files live. focus: generate a focused, regenerable sub-document for one window (or best-effort one phase) under focus/ — dry-run by default, apply:true writes under the owning-host gate (focus docs are never state authority). trace: trace the evidence spine for a state root, dispatch group, delivery, target, or target result. Evidence, not acceptance, and never a host send.",
    annotations: localWriteTool("Wakeflow View Projection"),
    inputSchema: {
      type: "object",
      required: ["scope"],
      properties: {
        root: { type: "string" },
        scope: {
          type: "string",
          enum: ["task-ledger", "window", "focus", "trace"],
          description: "Which projection to return: task-ledger | window | focus | trace.",
        },
        stateRoot: { type: "string" },
        window: { type: "string", description: "Window name for scope=window or scope=focus." },
        phase: { type: "string", description: "Best-effort phase for scope=focus." },
        apply: { type: "boolean", description: "scope=focus only: write the focus doc (default dry-run)." },
        taskId: { type: "string", description: "Task id for scope=task-ledger or scope=trace." },
        targetWindow: { type: "string", description: "Target window for scope=task-ledger or scope=trace." },
        dispatchGroup: { type: "string", description: "Dispatch group for scope=trace." },
        resultFile: { type: "string", description: "Result file for scope=trace." },
        resultId: { type: "string", description: "Result id for scope=trace." },
        deliveryFile: { type: "string", description: "Delivery file for scope=trace." },
        deliveryId: { type: "string", description: "Delivery id for scope=trace." },
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
    name: "wakeflow_archive",
    description: "Archive completed Wakeflow content into the committed ledger; target selects which. demand: relocate a completed demand state root into the ledger — a P1-0 redaction guard refuses on any real-id-shaped string unless redact relocates a cleaned copy (original preserved for audit); commits state-root content to the version-controlled ledger, review redactedFields before pushing. todo: completed TODO rows + historical sync records into the workspace ledger. docs: explicit completed workspace documents into a ledger topic, or prune active index rows that already point at archive topics (never archives the active index/current plan by inference). Dry-run unless apply is true. Records archive facts only — never accepts work, selects next work, or sends host messages. (Transport-runtime GC is the separate wakeflow_prune_runtime.)",
    annotations: localWriteTool("Archive Wakeflow Content"),
    inputSchema: {
      type: "object",
      required: ["target"],
      properties: {
        root: { type: "string" },
        target: {
          type: "string",
          enum: ["demand", "todo", "docs"],
          description: "What to archive: demand (a completed demand state root) | todo (completed TODO rows + sync records) | docs (explicit workspace documents).",
        },
        stateRoot: { type: "string", description: "target=demand: the completed demand state root to relocate." },
        reason: { type: "string", description: "target=demand: required archive reason." },
        redact: { type: "boolean", description: "target=demand: relocate a redacted copy when real-id-shaped strings are present." },
        evidenceRefs: { type: "array", items: { type: "string" }, description: "target=demand: evidence references to record." },
        month: { type: "string", description: "target=todo/docs: archive month YYYY-MM (backend policy default when omitted)." },
        date: { type: "string", description: "target=todo: archive date YYYY-MM-DD (today when omitted)." },
        keepCompleted: { type: "number", description: "target=todo: completed TODO rows to keep on the active board." },
        keepSync: { type: "number", description: "target=todo: historical sync records to keep on the active board." },
        topic: { type: "string", description: "target=docs: archive topic folder (required when files are supplied; normalized to a safe kebab-case segment)." },
        files: { type: "array", items: { type: "string" }, description: "target=docs: workspace Markdown documents to archive (omit only when pruneIndexOnly is true)." },
        keepIndexRows: { type: "boolean", description: "target=docs: keep source index rows instead of trimming archived rows." },
        pruneIndexOnly: { type: "boolean", description: "target=docs: only prune index rows for already-archived docs; do not move files." },
        refreshSummaries: { type: "boolean", description: "target=todo/docs: refresh archive summary indexes after a successful run." },
        apply: { type: "boolean" },
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
    name: "wakeflow_claim_next",
    description: "Design-gated controller auto-claim: init at most one demand from a Design-set controller-claimable handoff row. Dry-run unless apply is true. This tool inits a state root only; it never dispatches, accepts evidence, or weakens per-demand user confirmation.",
    annotations: localWriteTool("Claim Next Controller Demand"),
    inputSchema: {
      type: "object",
      properties: {
        root: { type: "string" },
        designKey: { type: "string" },
        apply: { type: "boolean" },
      },
    },
  },
  {
    name: "wakeflow_prune_runtime",
    description: "Prune replay-safe, confirmed-send delivery-run transport files older than a cutoff. Dry-run unless apply is true; apply requires before. Target-results (evidence) are never deleted, and runs inside a surviving repeated-attempt chain are retained.",
    annotations: localWriteTool("Prune Wakeflow Runtime Transport"),
    inputSchema: {
      type: "object",
      properties: {
        root: { type: "string" },
        before: { type: "string" },
        apply: { type: "boolean" },
      },
    },
  },
  {
    name: "wakeflow_verify",
    description: "Run embedded Wakeflow runtime verification for an installed workspace or the Wakeflow source repository. Set withRuntime for the runtime-residue check (strictRuntime to fail on blocking residue); scriptTests to run the script test suite.",
    annotations: readOnlyTool("Verify Wakeflow Runtime"),
    inputSchema: {
      type: "object",
      properties: {
        root: { type: "string" },
        scriptTests: { type: "boolean" },
        withRuntime: { type: "boolean" },
        strictRuntime: { type: "boolean" },
      },
    },
  },
];

// Some Codex hosts only surface an early prefix of MCP tools to the model.
// Keep the controller closed-loop path inside that prefix so imported target
// results can always be reviewed, reduced, decided, and completed through MCP.
const HOST_VISIBLE_PRIORITY_TOOLS = [
  "wakeflow_status",
  "wakeflow_initialize_workspace",
  "wakeflow_replace_windows",
  "wakeflow_init_demand",
  "wakeflow_add_task",
  "wakeflow_prepare_delivery",
  "wakeflow_record_delivery",
  "wakeflow_record_target_result",
  "wakeflow_review_pack",
  "wakeflow_reduce_results",
  "wakeflow_decide_review",
  "wakeflow_complete_demand",
];

export const tools = prioritizeHostVisibleTools(toolDefinitions);

function prioritizeHostVisibleTools(definitions) {
  const remaining = new Map(definitions.map((tool) => [tool.name, tool]));
  const prioritized = [];
  for (const name of HOST_VISIBLE_PRIORITY_TOOLS) {
    const tool = remaining.get(name);
    if (!tool) continue;
    prioritized.push(tool);
    remaining.delete(name);
  }
  return [
    ...prioritized,
    ...definitions.filter((tool) => remaining.has(tool.name)),
  ];
}

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
      ...(args.resetInitialization ? ["--reset-initialization"] : []),
      ...(args.useDiscovered ? ["--use-discovered"] : []),
      ...(args.internalDesign ? ["--internal-design"] : []),
      ...(args.internalTest ? ["--internal-test"] : []),
      ...(args.includeRealProject ? ["--include-real-project"] : []),
      ...repositoryArgs(args.repositories),
      ...repeatValues("--exclude-window", args.excludeWindows),
      ...(args.apply ? ["--write"] : []),
      "--json",
    ],
    cwd: args.root || undefined,
  }),
  wakeflow_replace_windows: (args) => runWakeflowRuntime({
    script: "wakeflow-setup",
    args: args.window
      ? [
          "replace-window",
          ...rootArgs(args),
          ...optionalValue("--parent", args.parent),
          ...optionalValue("--language", args.language),
          ...(args.includeRealProject ? ["--include-real-project"] : []),
          ...optionalValue("--window", args.window),
          "--json",
        ]
      : [
          "replace-windows",
          ...rootArgs(args),
          ...optionalValue("--parent", args.parent),
          ...optionalValue("--language", args.language),
          ...(args.includeRealProject ? ["--include-real-project"] : []),
          ...repeatValues("--window", args.windows),
          "--json",
        ],
    cwd: args.root || undefined,
  }),
  wakeflow_adopt_demand_host: (args) => runWakeflowRuntime({
    script: "wakeflow-state",
    args: [
      "adopt-demand-host",
      "--state-root", args.stateRoot,
      ...(args.reason ? ["--reason", args.reason] : []),
      ...rootArgs(args),
      ...(args.apply ? ["--write"] : []),
      "--json",
    ],
    cwd: args.root || undefined,
  }),
  wakeflow_render_progress: (args) => runWakeflowRuntime({
    script: "wakeflow-render-progress",
    args: [
      "--state-root", args.stateRoot,
      ...rootArgs(args),
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
      ...(args.language ? ["--language", args.language] : []),
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
          ...(args.verbose ? [] : ["--compact"]),
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
        ...(args.verbose ? [] : ["--compact"]),
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
      ...(args.deliveryRunId ? ["--delivery-run-id", args.deliveryRunId] : []),
      ...(args.verbose ? [] : ["--compact"]),
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
      ...(args.verbose ? [] : ["--compact"]),
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
  wakeflow_view: (args) => {
    if (args.scope === "task-ledger") {
      return runWakeflowRuntime({
        script: "wakeflow-delivery",
        args: [
          "task-ledger",
          ...optionalValue("--state-root", args.stateRoot),
          ...optionalValue("--task-id", args.taskId),
          ...optionalValue("--target-window", args.targetWindow),
          ...rootArgs(args),
          "--json",
        ],
      });
    }
    if (args.scope === "window") {
      return runWakeflowRuntime({
        script: "wakeflow-state",
        args: [
          "window-view",
          ...optionalValue("--state-root", args.stateRoot),
          ...optionalValue("--window", args.window),
          ...rootArgs(args),
          "--json",
        ],
      });
    }
    if (args.scope === "focus") {
      return runWakeflowRuntime({
        script: "wakeflow-state",
        args: [
          "focus-doc",
          ...optionalValue("--state-root", args.stateRoot),
          ...optionalValue("--window", args.window),
          ...optionalValue("--phase", args.phase),
          ...(args.apply ? ["--write"] : []),
          ...rootArgs(args),
          "--json",
        ],
      });
    }
    if (args.scope === "trace") {
      return runWakeflowRuntime({
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
      });
    }
    throw new Error(`wakeflow_view: unknown scope "${args.scope}" (expected task-ledger | window | focus | trace)`);
  },
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
  wakeflow_archive: async (args) => {
    if (args.target === "demand") {
      return runWakeflowRuntime({
        script: "wakeflow-state",
        args: [
          "archive-demand",
          "--state-root", args.stateRoot,
          "--reason", args.reason,
          ...(args.redact ? ["--redact"] : []),
          ...repeatValues("--evidence-ref", args.evidenceRefs ?? []),
          ...rootArgs(args),
          ...(args.apply ? ["--write"] : []),
          "--json",
        ],
      });
    }
    if (args.target === "todo") {
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
    }
    if (args.target === "docs") {
      const files = asStringList(args.files);
      if (files.length === 0 && !args.pruneIndexOnly) {
        throw new Error("wakeflow_archive target=docs requires files unless pruneIndexOnly is true");
      }
      if (files.length > 0) {
        requireValueForTool(args, "topic", "wakeflow_archive (target=docs)");
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
    }
    throw new Error(`wakeflow_archive: unknown target "${args.target}" (expected demand | todo | docs)`);
  },
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
  wakeflow_claim_next: (args) => runWakeflowRuntime({
    script: "wakeflow-demand-sequence",
    args: [
      "claim-from-design",
      ...rootArgs(args),
      ...optionalValue("--design-key", args.designKey),
      ...(args.apply ? ["--write"] : []),
      "--json",
    ],
    cwd: args.root || undefined,
  }),
  wakeflow_prune_runtime: (args) => runWakeflowRuntime({
    script: "wakeflow-delivery",
    args: [
      "prune-runtime",
      ...rootArgs(args),
      ...optionalValue("--before", args.before),
      ...(args.apply ? ["--write"] : []),
      "--json",
    ],
    cwd: args.root || undefined,
  }),
  wakeflow_verify: (args) => runWakeflowRuntime({
    script: "wakeflow-cli",
    args: [
      "verify",
      ...rootArgs(args),
      ...(args.scriptTests ? ["--script-tests"] : []),
      ...(args.strictRuntime ? ["--strict-runtime"] : args.withRuntime ? ["--with-runtime"] : []),
      "--json",
    ],
    cwd: args.root || undefined,
    timeoutMs: args.scriptTests || args.withRuntime || args.strictRuntime ? 180000 : 120000,
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
