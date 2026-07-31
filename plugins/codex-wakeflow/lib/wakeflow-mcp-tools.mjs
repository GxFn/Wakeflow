import { existsSync } from "node:fs";
import path from "node:path";
import { runWakeflowRuntime } from "./wakeflow-runtime.mjs";
import { hostProfile } from "../scripts/lib/wakeflow-host-profile.mjs";
import {
  TASK_CONTEXT_VERSION,
  normalizeTaskPackageContext,
} from "../scripts/lib/wakeflow-task-package.mjs";

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

const taskPackageContextRequired = [
  "workType",
  "objective",
  "contextSummary",
  "requirementRefs",
  "boundaries",
  "completionExpectations",
  "commitExpectation",
];

const taskPackageContextProperties = {
  workType: {
    type: "string",
    enum: ["implementation", "research", "documentation", "test"],
    description: "Classifies the package so pre-dispatch readiness can apply the right execution gate.",
  },
  objective: {
    type: "string",
    description: "The one observable outcome this target must deliver. Stored on the task package; target dispatch cannot replace it.",
  },
  contextSummary: {
    type: "array",
    minItems: 1,
    items: { type: "string" },
    description: "Small ordered set of confirmed facts the target needs before execution. Background detail stays in requirementRefs.",
  },
  requirementRefs: {
    type: "array",
    minItems: 1,
    description: "Workspace-relative requirement/background references. At least one entry must have role=goal; non-evidence roles must include an exact Markdown #anchor.",
    contains: {
      type: "object",
      required: ["role"],
      properties: { role: { const: "goal" } },
    },
    minContains: 1,
    items: {
      type: "object",
      required: ["ref", "role"],
      properties: {
        ref: { type: "string" },
        role: { type: "string", enum: ["goal", "completion", "constraint", "validation", "design", "evidence"] },
        label: { type: "string" },
      },
    },
  },
  boundaries: {
    type: "object",
    required: ["inScope", "outOfScope", "forbidden"],
    properties: {
      inScope: { type: "array", minItems: 1, items: { type: "string" } },
      outOfScope: { type: "array", items: { type: "string" } },
      forbidden: { type: "array", items: { type: "string" } },
    },
  },
  completionExpectations: {
    type: "array",
    minItems: 1,
    items: { type: "string" },
    description: "Ordered concrete results that must be present before the target can return completed, most important first. The prompt surfaces the first two; the task package retains the full list.",
  },
  dependsOnTaskIds: {
    type: "array",
    items: { type: "string" },
    description: "Explicit upstream target task ids. Dispatch is blocked until every dependency is controller-accepted.",
  },
  commitExpectation: {
    type: "string",
    enum: ["commit", "leave-uncommitted"],
    description: "Whether the owning repository window must commit its scoped work before returning.",
  },
};

const toolDefinitions = [
  {
    name: "wakeflow_initialize_workspace",
    description: `Initialize a Wakeflow runtime: discover siblings, generate/apply workspace config, install ${hostProfile.memoryFileLabel} blocks, create sibling Design/Test surfaces, and record derived local window configuration. Dry-run unless apply is true. On an already initialized workspace, apply is allowed only when the user explicitly asks for reset initialization and resetInitialization is true with explicit repositories; never use useDiscovered for reset. Heavy or stale existing windows should use wakeflow_replace_windows instead of initialization. Launch plans include host-profile create-window settings such as reasoning effort/model when supported. After the host creates each real window, register its handle through wakeflow_register_window; the handle is written only to the local registry and is redacted from tool output.`,
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
    description: `Regenerate a scoped ${hostProfile.hostTools.createWindow} launch plan for one or more existing Wakeflow windows without reinitializing workspace docs. Pass window for the high-frequency single-window path (a responsibility window that is too context-heavy, stale, or needs rebinding) or windows for a batch. The tool reads the current workspace config and returns only the requested replacement entries. After ${hostProfile.hostTools.createWindow} succeeds, use each entry's wakeflow_register_window call template to replace only that window's local handle registration.`,
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
    name: "wakeflow_register_window",
    description: `Register one host-created Wakeflow window using ${hostProfile.handleId.realIdRequirement}. Mainline windows must be configured. Pod windows additionally require the exact launchCorrelationId, bindingId, and canonical stateRoot from wakeflow_pod_open; a __ suffix alone never authorizes registration. The handle is stored only in the host-scoped local registry and redacted from all output. Registration does not make a Pod product dispatchable until wakeflow_pod_bind verifies its receipt. Dry-run unless apply is true.`,
    annotations: localWriteTool("Register Wakeflow Window", true),
    inputSchema: {
      type: "object",
      required: ["window", "windowHandle"],
      properties: {
        root: { type: "string" },
        window: { type: "string", description: "Configured Wakeflow logical window name." },
        windowHandle: { type: "string", description: `The ${hostProfile.handleId.realIdRequirement} returned by the host launch tool. It is never echoed.` },
        launchCorrelationId: { type: "string", description: "Required only for a Pod window; must match its canonical host-local launch operation." },
        bindingId: { type: "string", description: "Required only for a Pod window; opaque registry/binding correlation, not the real host handle." },
        stateRoot: { type: "string", description: "Required only for a Pod window; canonical demand state root authorized by the launch manifest." },
        apply: { type: "boolean" },
      },
    },
  },
  {
    name: "wakeflow_adopt_demand_host",
    description: "Explicitly transfer (or claim) demand controller-host ownership to THIS host, with an audit event and a revision bump — no other state changes. The sanctioned cross-host handoff; existing transition candidates become stale and must be re-reduced on the new host. Dry-run unless apply is true.",
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
    name: "wakeflow_recover_state_transition",
    description: "Inspect or explicitly recover the pending state/event transition journal for one demand state root. Dry-run unless apply is true. This is the sanctioned recovery path for a consistent wakeflow-state.pending-transition.json; it never guesses through malformed or conflicting authority artifacts.",
    annotations: localWriteTool("Recover Wakeflow State Transition", true),
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
    name: "wakeflow_render_progress",
    description: "Re-render the developer progress projection for a demand state root (the projection goes stale after every state mutation). Owner-host only; does not change machine state semantics. Dry-run unless apply is true.",
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
    description: "Release the shared cross-host in-flight delivery lock for one window. Recovery action for stalled or ownerless locks; releasing another host's fresh lock must be a deliberate controller decision. Dry-run unless apply is true.",
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
    name: "wakeflow_add_task",
    description: "Add a full runtime task package and optional target task to a Wakeflow demand state root. Plans the next work; it does not dispatch, send, or accept.",
    annotations: localWriteTool("Add Wakeflow Task Package"),
    inputSchema: {
      type: "object",
      required: ["stateRoot", "taskId", "targetWindow", "summary", ...taskPackageContextRequired],
      properties: {
        root: { type: "string" },
        stateRoot: { type: "string" },
        taskId: { type: "string" },
        targetWindow: { type: "string" },
        summary: { type: "string" },
        packageId: { type: "string" },
        sourceRef: { type: "string" },
        targetSummary: { type: "string" },
        replacesTargetTaskId: { type: "string", description: "For controller-decided redesign only: the exact prior targetTaskId this new full-context implementation task replaces. The prior task must be parked by reviewDecision=redesign and the replacement must target a product responsibility window. Ordinary rework must re-dispatch the original task instead." },
        ...taskPackageContextProperties,
        designIntent: { type: "string", description: "Design's one-line implementation intent ('roughly how'). Optional and advisory: surfaced side-by-side with the controller's objective at dispatch and review for the agent's own alignment check — never a gate or score." },
        acceptanceAnchors: {
          type: "array",
          description: "Optional controller-authored acceptance probes for implementation work. Each {id,claim,probe,expected} entry must come from the confirmed requirement and tells the target which behavior to pin as RED before coding; targets must not invent missing anchors.",
          items: {
            type: "object",
            required: ["id", "claim", "probe", "expected"],
            properties: {
              id: { type: "string" },
              claim: { type: "string" },
              probe: { type: "string" },
              expected: { type: "string" },
            },
          },
        },
        evidenceContract: { type: "object", description: "Design-authored execution-craft evidence contract: { version, required:[{kind,verify}], advisory:[{kind}] }. Enforced at reduce-results (a completed result must cover the required kinds); advisory kinds only surface as reminders. Optional; absent = no craft gate." },
        testCardId: { type: "string", description: "Required when targetWindow is the configured Test window. Links this task to the authoritative Test boundary/execution card." },
        testContinuationOf: { type: "string", description: "For a later Test attempt, the immediately preceding targetTaskId in the same Test-card lineage." },
        restartTest: { type: "boolean", description: "Declare that this continuation restarts environment/setup instead of resuming prior evidence. Allowed only by the Test card contract." },
        testRestartReason: { type: "string", description: "Required with restartTest. Records the controller's explicit reason; Test cannot decide this itself." },
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
        groupTaskIds: { type: "array", items: { type: "string" }, description: "direction=target: complete targetTaskId membership for a multi-target dispatch group. Supply it on the first prepare; later prepares must match the finalized set." },
        dispatchGroup: { type: "string" },
        controllerWindow: { type: "string", description: "Return-route override. Default chain: this flag > the state root's stamped controllerWindow (pod demands) > wakeflow.config.json controllerWindow — normally omit and let the stamp route." },
        taskPackageId: { type: "string" },
        humanContextRef: { type: "string", description: "direction=controller-return only. Target dispatch derives its task context from the authoritative task package." },
        returnPolicy: { type: "string", enum: ["group-ready", "per-target"] },
        triggerTarget: { type: "string" },
        triggerTaskId: { type: "string" },
        returnReason: { type: "string", enum: ["result-ready", "blocked"] },
        automationEnabled: { type: "boolean" },
        apply: { type: "boolean", description: "direction=target: false/omitted previews the exact dispatch briefing without writing transport files; true writes the validated packet/envelope." },
        expectedPreviewDigest: { type: "string", description: "direction=target with apply=true: required digest copied from the reviewed preview previewDigest. Apply fails if task context, state revision, resolved repository, prompt, or transport config changed." },
      },
    },
  },
  {
    name: "wakeflow_record_delivery",
    description: "Record external host-send evidence for a delivery envelope, after the host tool performs the real send. A recorded status=sent with readbackOk=true closes the dispatch turn; this does not send the message or accept the result.",
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
    description: "Record one target-window TargetResultEnvelope into a demand state root. This is target closeout evidence, not controller acceptance or next dispatch; when returnRoute=controller applies, follow with review pack, controller-return delivery, host send, and delivery-run recording.",
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
        dispatchGroup: { type: "string", description: "The exact dispatch group this result answers. Required whenever the target task has been delivered; state-only tasks without delivery metadata may omit it. Explicit old groups are retained as history and never become the current round." },
        supersedeResult: { type: "boolean", description: "Explicitly replace a changed result for the same current dispatch round, or append a corrected revision to late-result history. The prior result remains in target-results/history/." },
        summary: { type: "string" },
        changedRepos: { type: "array", items: { type: "string" }, description: "Repositories whose working or committed content changed for this result." },
        commits: { type: "array", items: { type: "string" }, description: "Commit ids created for this result." },
        commitDisposition: { type: "string", enum: ["committed", "left-uncommitted", "no-changes"], description: "How this result honored the task package commit expectation." },
        evidenceRefs: { type: "array", items: { type: "string" } },
        verification: { type: "array", items: { type: "string" } },
        risks: { type: "array", items: { type: "string" } },
        craftEvidence: {
          type: "array",
          items: {
            type: "object",
            required: ["kind"],
            properties: {
              kind: { type: "string", minLength: 1 },
              ref: { type: "string", minLength: 1 },
              value: { type: "string", minLength: 1 },
              commit: { type: "string", minLength: 1 },
              verify: { type: "string", minLength: 1 },
              anchorId: { type: "string", minLength: 1 },
              red: { type: "string", minLength: 1 },
              green: { type: "string", minLength: 1 },
              planIndex: { type: "integer", minimum: 0 },
              step: { type: "string", minLength: 1 },
            },
            anyOf: [
              { required: ["ref"] },
              { required: ["value"] },
              { required: ["commit"] },
            ],
          },
          description: "Typed execution evidence. Generic entries use {kind, ref|value|commit, verify}; implementation completion maps each acceptance anchor with {kind:'acceptance-anchor', anchorId, red, green, ref}; Test completion maps each approved step with {kind:'test-step', planIndex, step, ref}. Mapping completeness enables controller review but never implies acceptance.",
        },
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
    description: "Read-only (mostly) projections for a demand state root; scope selects which. task-ledger: unified per-task rollup for EVERY target task (accepted history preserved) — execution status, acceptance decision, latest result, test-card status, and handling counts (dispatchCount/reworkCount/redesignCount persisted; retestCount derived as rounds dispatched to a Test window — an informational hint, not a gate) plus a recurringProblem flag (reworkCount >= 2). window: per-window orientation card — the tasks that belong to a window (with the same handling counts and recurringProblem flag), its task packages, its rollup, and the file areas where its state-root/transport files live. focus: generate a focused, regenerable sub-document for one window (or best-effort one phase) under focus/ — dry-run by default, apply:true writes under the owning-host gate (focus docs are never state authority). trace: trace the evidence spine for a state root, dispatch group, delivery, target, or target result. storage: the local-storage map — every known tree under .wakeflow-active/.wakeflow-local/ledger with class (authority/projection/transport/evidence/handles/preserved), size, and age, plus legacy residue, unknown trees, and aging preserved/ entries; classification is descriptive guidance, never a deletion authorization. Evidence, not acceptance, and never a host send.",
    annotations: localWriteTool("Wakeflow View Projection"),
    inputSchema: {
      type: "object",
      required: ["scope"],
      properties: {
        root: { type: "string" },
        scope: {
          type: "string",
          enum: ["task-ledger", "window", "focus", "trace", "storage"],
          description: "Which projection to return: task-ledger | window | focus | trace | storage.",
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
    description: "Reduce imported target results into a controller review candidate. This creates the transition candidate needed by wakeflow_decide_review, but it is not acceptance, completion, or dispatch. Dry-run unless apply is true.",
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
    description: "Record an explicit controller decision for a review candidate created by wakeflow_reduce_results. decision=redesign parks the old task (needs-rework), routes the requirement back to Design (redesignCount++), and requires the later corrected product task to declare replacesTargetTaskId; the old task cannot be re-dispatched or accepted as the correction. Use redesign for a non-bug mismatch or a small requirement-level fix. Dry-run unless apply is true.",
    annotations: localWriteTool("Record Wakeflow Review Decision"),
    inputSchema: {
      type: "object",
      required: ["stateRoot", "candidateId", "decision", "reason"],
      properties: {
        root: { type: "string" },
        stateRoot: { type: "string" },
        candidateId: { type: "string" },
        decision: { type: "string", enum: ["accept", "rework", "blocked", "redesign"] },
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
    description: "Complete a demand after all task packages and target tasks are accepted. Dry-run unless apply is true.",
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
    name: "wakeflow_continue_demand",
    description: "Continue a completed but not yet archived demand when a verified bug, confirmed requirement supplement, or explicitly authorized optimization still belongs to the same demand. This is one locked operation: it preserves the prior completion and accepted evidence, records the continuation authority, changes the demand back to planned, and adds the first concrete task package. It refuses active, cancelled, or archived demands and never dispatches. Use a new demand for archived history or independently scoped follow-up work. Dry-run unless apply is true.",
    annotations: localWriteTool("Continue Completed Wakeflow Demand"),
    inputSchema: {
      type: "object",
      required: ["stateRoot", "continuationType", "reason", "evidenceRefs", "taskId", "targetWindow", "summary", ...taskPackageContextRequired],
      properties: {
        root: { type: "string" },
        stateRoot: { type: "string", description: "The completed, unarchived demand state root." },
        continuationType: { type: "string", enum: ["verified-bug", "requirement-supplement", "optimization"] },
        reason: { type: "string", description: "Why this work remains part of the same demand rather than a new demand." },
        evidenceRefs: { type: "array", minItems: 1, items: { type: "string" }, description: "Verified defect evidence or explicit requirement/scope decision references." },
        taskId: { type: "string", description: "The first target task id for the continuation." },
        targetWindow: { type: "string" },
        summary: { type: "string" },
        packageId: { type: "string", description: "Defaults to taskId when omitted." },
        sourceRef: { type: "string" },
        targetSummary: { type: "string" },
        ...taskPackageContextProperties,
        designIntent: { type: "string", description: "Optional advisory implementation intent; never a gate." },
        acceptanceAnchors: {
          type: "array",
          description: "Optional controller-authored {id,claim,probe,expected} probes for the continuation's first implementation package.",
          items: {
            type: "object",
            required: ["id", "claim", "probe", "expected"],
            properties: {
              id: { type: "string" },
              claim: { type: "string" },
              probe: { type: "string" },
              expected: { type: "string" },
            },
          },
        },
        evidenceContract: { type: "object", description: "Optional execution-craft evidence contract for the first package." },
        testCardId: { type: "string", description: "Required when the first target is the configured Test window." },
        testContinuationOf: { type: "string" },
        restartTest: { type: "boolean" },
        testRestartReason: { type: "string" },
        apply: { type: "boolean" },
        adoptHost: { type: "boolean", description: "Explicitly transfer demand controller-host ownership to this host." },
      },
    },
  },
  {
    name: "wakeflow_archive",
    description: "Archive completed Wakeflow content into the committed ledger; target selects which. demand: relocate a completed demand state root into the ledger — the archive privacy guard refuses real-id-shaped strings and user/workspace absolute paths unless redact relocates a portable cleaned copy (original preserved for audit); the staged copy is re-scanned before commit. todo: completed TODO rows + historical sync records into the workspace ledger. docs: explicit completed workspace documents into a ledger topic, or prune active index rows that already point at archive topics (never archives the active index/current plan by inference). Dry-run unless apply is true. Records archive facts only — never accepts work, selects next work, or sends host messages. (Transport-runtime GC is the separate wakeflow_prune_runtime.)",
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
        redact: { type: "boolean", description: "target=demand: relocate a portable copy when real ids or user/workspace absolute paths are present; preserve the original locally." },
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
    name: "wakeflow_sanitize_archive",
    description: "Sanitize one EXISTING archived demand in the configured project ledger when historical archive content contains real host ids or user/workspace absolute paths. The archive must already be state=archived and carry archive-manifest.json. Replaces only that archive path with a fully re-scanned portable copy, appends archive.sanitized audit history, and moves the original bytes to .wakeflow-local/preserved/. Never reopens the demand, changes acceptance, touches active state, or repairs arbitrary directories. Dry-run unless apply is true.",
    annotations: localWriteTool("Sanitize Wakeflow Archive", true),
    inputSchema: {
      type: "object",
      required: ["stateRoot", "reason"],
      properties: {
        root: { type: "string" },
        stateRoot: { type: "string", description: "Existing archived demand root below wakeflow-ledger/workspace/archive/." },
        reason: { type: "string", description: "Audit reason recorded in the archive amendment." },
        apply: { type: "boolean" },
      },
    },
  },
  {
    name: "wakeflow_intake_test_card",
    description: "Create a Test boundary card under a demand state root. Dry-run unless apply is true.",
    annotations: localWriteTool("Create Wakeflow Test Card"),
    inputSchema: {
      type: "object",
      required: [
        "stateRoot",
        "testId",
        "targetWindow",
        "strategySource",
        "approvedTestPlan",
        "allowedTestSkills",
        "setupPolicy",
        "maxAttempts",
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
        strategySource: { type: "string", description: "Required authority for the exact Test approach (normally the confirmed Design-stage testing decision)." },
        approvedTestPlan: { type: "array", minItems: 1, items: { type: "string" }, description: "Requirement-stage confirmed Test plan items. Test may add operational command detail only when every detail maps to one of these items; it may not add new test targets or gates." },
        allowedTestSkills: { type: "array", items: { type: "string" }, description: "Exact Test-local skill ids authorized for this card. Pass [] when none are authorized; progressive-chain-validation must be named explicitly to be usable." },
        setupPolicy: { type: "string", enum: ["reuse-existing", "fresh-once", "fresh-per-attempt"], description: "Controls whether Test may create a new environment." },
        maxAttempts: { type: "integer", minimum: 1, maximum: 10, description: "Maximum target-task attempts in this Test-card lineage, even when later attempts use new task ids." },
        restartConditions: { type: "array", items: { type: "string" }, description: "Controller-approved reasons that can justify a full restart. Required non-empty when setupPolicy=fresh-per-attempt." },
        evidenceRequired: { type: "array", items: { type: "string" } },
        allowedOperations: { type: "array", items: { type: "string" } },
        forbiddenOperations: { type: "array", items: { type: "string" } },
        apply: { type: "boolean" },
      },
    },
  },
  {
    name: "wakeflow_deliver",
    description: "Design-side append-only delivery: append one ready item (type requirement|bug|supplement|research) to the workspace global TODO board as a `pending-claim` row for the controller to claim. Sets immutable Auto Claim and Testing Decision delivery properties once — autoClaim=true authorizes unattended controller auto-claim and, for type=requirement, requires linked Original Plan + Requirement Design; otherwise the controller confirms first. Append-only: it never edits or re-statuses an existing row, and is the only controller-surface write Design performs. Dry-run unless apply is true.",
    annotations: localWriteTool("Deliver Item To Controller TODO"),
    inputSchema: {
      type: "object",
      required: ["type", "designKey", "title"],
      properties: {
        root: { type: "string" },
        type: { type: "string", enum: ["requirement", "bug", "supplement", "research"] },
        designKey: { type: "string", description: "<topic>-YYYY-MM-DD; becomes the TODO ID and, on claim, the demandKey." },
        title: { type: "string" },
        item: { type: "string", description: "TODO Item / Goal text; defaults to title." },
        autoClaim: { type: "boolean", description: "true = authorize unattended controller auto-claim (requires the design docs for type=requirement); default false = controller confirms first." },
        priority: { type: "string", description: "P0..P3; defaults to P2." },
        originalPlan: { type: "string", description: "link to the Original Plan (required for requirement + autoClaim)." },
        requirementDesign: { type: "string", description: "link to the Requirement Design (required for requirement + autoClaim)." },
        testDecision: { type: "string", description: "Design's testing approach/decision for this demand; carried into the claimed demand state." },
        dependency: { type: "string" },
        apply: { type: "boolean" },
      },
    },
  },
  {
    name: "wakeflow_next_work",
    description: "Scan the global TODO board for the next controller-ready candidate and report active demand facts. Mainline is the default execution surface: when another mainline demand is active, ordinary and unattended candidates remain visible but wait instead of silently becoming Pods. Explicit Pods are created only through a user-authorized claim/create call.",
    annotations: localWriteTool("Select Wakeflow Next Work"),
    inputSchema: {
      type: "object",
      properties: {
        root: { type: "string" },
        id: { type: "string" },
        source: { type: "string", enum: ["all", "todo"] },
        limit: { type: "number" },
        afterCompletion: { type: "boolean" },
        apply: { type: "boolean" },
      },
    },
  },
  {
    name: "wakeflow_claim_next",
    description: "Unified controller claim from the global TODO board. Omit designKey for unattended Auto Claim, which is mainline-only and waits while mainline is busy. With a user-confirmed designKey, placement=pod is accepted only with an authorizationRef; otherwise the claim uses mainline. A waiting or rejected claim consumes no TODO row and creates no state or host resource. Dry-run unless apply is true.",
    annotations: localWriteTool("Claim Next Controller Demand"),
    inputSchema: {
      type: "object",
      properties: {
        root: { type: "string" },
        designKey: { type: "string" },
        controllerWindow: { type: "string", description: "The claiming controller's own window (demand pods: Controller__<pod>). Stamped into the new state root so controller-returns route back to the claimer; omit in the default controller." },
        placement: { type: "string", enum: ["main", "pod"], description: "Execution surface. Omit for mainline. pod is valid only for an explicitly user-confirmed designKey and requires authorizationRef." },
        authorizationRef: { type: "string", description: "Auditable requirement/controller anchor proving the user explicitly requested this Pod. Required for placement=pod; forbidden for main." },
        podId: { type: "string", description: "Stable logical Pod id. Optional for placement=pod (defaults from demand identity); forbidden for main." },
        apply: { type: "boolean" },
      },
    },
  },
  {
    name: "wakeflow_create_demand",
    description: "Unified controller create: init a demand state root, adopt this window as its host, add any initial task packages, render its progress doc, and consume the originating TODO row (Current Mount = state root) in one call. Replaces init_demand + intake_design_handoff + add_task + adopt_demand_host. Pass todoId to create from a delivered TODO row (its title + linked docs synthesize the goal/completion and the row is consumed), or demandKey + title to create inline. Dry-run unless apply is true. Inits only — it never dispatches, accepts evidence, or weakens per-demand user confirmation.",
    annotations: localWriteTool("Create Controller Demand"),
    inputSchema: {
      type: "object",
      properties: {
        root: { type: "string" },
        todoId: { type: "string", description: "ID of a delivered TODO row to claim; its title and linked Documents seed the demand, and the row is consumed (marked claimed, Current Mount = state root)." },
        demandKey: { type: "string", description: "<topic>-YYYY-MM-DD; the demand key and state-root slug. Defaults to todoId when omitted; when todoId is present this must be omitted or exactly equal to todoId so one delivered row has one canonical demand identity." },
        title: { type: "string", description: "Demand title; taken from the TODO row when todoId is given." },
        controllerWindow: { type: "string", description: "The demand's OWN controller window (demand pods: Controller__<pod>). Stamped into the state root so every dispatch's controller-return routes home by default; omit to use the workspace controllerWindow." },
        placement: { type: "string", enum: ["main", "pod"], description: "Execution surface. Omit for mainline; pod requires authorizationRef and creates only the canonical Pod provisioning state, never host resources." },
        authorizationRef: { type: "string", description: "Auditable requirement/controller anchor proving the user explicitly requested this Pod. Required for placement=pod; forbidden for main." },
        podId: { type: "string", description: "Stable logical Pod id. Optional for placement=pod (defaults from demand identity); forbidden for main." },
        goal: { type: "string", description: "Demand goal; synthesized from the delivered docs when todoId is given and goal is omitted." },
        completionDefinition: { type: "string" },
        testDecision: { type: "string", description: "Design's testing decision (which validation / real-Test approach). Optional; surfaced as a reminder at create-demand when absent, never a gate." },
        stagePlan: { type: "string" },
        taskPackages: {
          type: "array",
          description: "Optional initial task packages to add right after init.",
          items: {
            type: "object",
            required: ["summary", "targetWindow", ...taskPackageContextRequired],
            properties: {
              taskPackageId: { type: "string" },
              summary: { type: "string" },
              targetWindow: { type: "string" },
              targetTaskId: { type: "string" },
              sourceRef: { type: "string" },
              ...taskPackageContextProperties,
              designIntent: { type: "string", description: "Design's one-line implementation intent for this package; optional, advisory, never a gate." },
              acceptanceAnchors: {
                type: "array",
                description: "Optional controller-authored {id,claim,probe,expected} probes for this implementation package.",
                items: {
                  type: "object",
                  required: ["id", "claim", "probe", "expected"],
                  properties: {
                    id: { type: "string" },
                    claim: { type: "string" },
                    probe: { type: "string" },
                    expected: { type: "string" },
                  },
                },
              },
              evidenceContract: { type: "object", description: "Design-authored execution-craft evidence contract for this package; optional, enforced at reduce-results." },
            },
          },
        },
        apply: { type: "boolean" },
      },
    },
  },
  {
    name: "wakeflow_cancel_demand",
    description: "Cancel an in-flight demand without pretending completion: no acceptance, no evidence gate, open tasks keep their last honest status, and recorded evidence stays untouched. Refused on completed/archived/already-cancelled demands. A cancelled Pod still needs logical Pod close receipts before archive. Dry-run unless apply is true.",
    annotations: localWriteTool("Cancel Wakeflow Demand"),
    inputSchema: {
      type: "object",
      required: ["stateRoot", "reason"],
      properties: {
        root: { type: "string" },
        stateRoot: { type: "string", description: "The demand's state root directory." },
        reason: { type: "string", description: "Why the flow is being cancelled; recorded on the state and the audit event." },
        apply: { type: "boolean" },
      },
    },
  },
  {
    name: "wakeflow_pod_open",
    description: "Plan/reserve an explicitly authorized Pod without creating host resources. Wakeflow never creates a worktree or thread; the current host materializes those resources. Pass repositories=[] for the standard first phase, which plans only independent Controller/Design/Test sessions. After the recorded Design handoff freezes its landing plan, call this tool again with the exact repository coverage and expected local HEADs to append product launch operations. If S0 already froze exact coverage, repositories may be supplied on the first call. Existing launch correlations are immutable. The Agent records each verified receipt with wakeflow_pod_bind. Dry-run unless apply is true.",
    annotations: localWriteTool("Open Demand Pod"),
    inputSchema: {
      type: "object",
      required: ["demandKey"],
      properties: {
        root: { type: "string" },
        demandKey: { type: "string", description: "The canonical demand whose executionPlacement is an explicitly authorized Pod." },
        repositories: {
          type: "array",
          description: "Frozen product-window coverage and local base identity. Omit or pass [] while creating only the three control windows; after Design, pass the exact landingPlan repository set. Wakeflow resolves roots but never creates worktrees.",
          items: {
            type: "object",
            required: ["windowName", "expectedBaseHead"],
            properties: {
              windowName: { type: "string" },
              expectedBaseHead: { type: "string" },
              basePolicy: { type: "string", enum: ["local-head"], description: "Only local-head is supported by the new Pod path." },
            },
          },
        },
        requestedAt: { type: "string" },
        apply: { type: "boolean" },
      },
    },
  },
  {
    name: "wakeflow_pod_record_materialization",
    description: "Record the host-local lifecycle of one exact Pod launch correlation. Call with status=creating immediately before the host create call; if Codex returns clientThreadId, record status=pending with that temporary id, then use the host profile's bounded discovery protocol and record finalized only when exactly one final session matches launchCorrelationId. Temporary ids are stored only as a digest and can never enter the window registry. A creating/pending attempt forbids blind duplicate creation; a terminal failure requires explicit retry authorization. Dry-run unless apply is true.",
    annotations: localWriteTool("Record Pod Host Materialization", true),
    inputSchema: {
      type: "object",
      required: ["attempt"],
      properties: {
        root: { type: "string" },
        attempt: {
          type: "object",
          required: ["launchCorrelationId", "host", "status", "observedAt"],
          properties: {
            launchCorrelationId: { type: "string" },
            host: { type: "string", enum: ["codex", "claude-code"] },
            status: {
              type: "string",
              enum: ["creating", "pending", "finalized", "failed"],
            },
            observedAt: { type: "string" },
            hostRequestId: {
              type: "string",
              description: "Host temporary async request id; accepted only for pending and persisted only as a digest.",
            },
            terminalFailure: { type: "boolean", const: true },
            failureReason: { type: "string" },
            retryAuthorizationRef: { type: "string" },
          },
        },
        apply: { type: "boolean" },
      },
    },
  },
  {
    name: "wakeflow_pod_bind",
    description: "Validate and bind one host-created Pod session from its provisioning receipt. Real handles remain in the host-local registry; this receipt carries only bindingId plus cwd/Git identity. Product bindings must match the exact repo/common-dir/base HEAD and must not be the main checkout. Control bindings must be distinct sessions scoped to this Pod. Conflicts fail closed and never overwrite an existing binding. Dry-run unless apply is true.",
    annotations: localWriteTool("Bind Host-created Pod Window", true),
    inputSchema: {
      type: "object",
      required: ["receipt"],
      properties: {
        root: { type: "string" },
        receipt: {
          type: "object",
          required: [
            "launchCorrelationId",
            "windowName",
            "host",
            "bindingId",
            "handleRegistered",
            "handleKind",
            "stateRootRelative",
            "actualCwd",
            "createdAt",
          ],
          properties: {
            launchCorrelationId: { type: "string" },
            windowName: { type: "string" },
            host: { type: "string" },
            bindingId: { type: "string", description: "Opaque registry-to-binding correlation, not the real thread/session handle." },
            handleRegistered: { type: "boolean", const: true },
            handleKind: { type: "string", const: "final" },
            stateRootRelative: { type: "string" },
            actualCwd: { type: "string" },
            gitTopLevel: { type: "string" },
            gitCommonDir: { type: "string" },
            head: { type: "string" },
            branch: { type: ["string", "null"] },
            detached: { type: "boolean" },
            mainCheckout: { type: "boolean" },
            createdAt: { type: "string" },
          },
        },
        apply: { type: "boolean" },
      },
    },
  },
  {
    name: "wakeflow_pod_prepare_design_request",
    description: "Freeze one controller-authored PodDesignRequest after the independent Controller/Design/Test sessions are bound. The digest-named artifact carries the original goal, requirement anchors, code evidence, paused redesign identity, non-goals, and pending decisions; it advances only podProvisioning.phase to designing and is neither a target result nor a global TODO. A different request cannot replace the frozen request. Dry-run unless apply is true.",
    annotations: localWriteTool("Prepare Pod Design Request", true),
    inputSchema: {
      type: "object",
      required: ["request"],
      properties: {
        root: { type: "string" },
        request: {
          type: "object",
          required: [
            "demandKey",
            "podId",
            "requestType",
            "originalGoal",
            "requirementAnchors",
            "codeEvidenceRefs",
            "pausedTargetIdentity",
            "pausedReviewIdentity",
            "nonGoals",
            "decisionsRequired",
          ],
          properties: {
            demandKey: { type: "string" },
            podId: { type: "string" },
            requestType: { type: "string", enum: ["initial-design", "supplement", "redesign"] },
            originalGoal: { type: "string" },
            requirementAnchors: { type: "array", minItems: 1, items: { type: "string" } },
            codeEvidenceRefs: { type: "array", minItems: 1, items: { type: "string" } },
            pausedTargetIdentity: { type: ["object", "null"] },
            pausedReviewIdentity: { type: ["object", "null"] },
            nonGoals: { type: "array", items: { type: "string" } },
            decisionsRequired: { type: "array", items: { type: "string" } },
          },
        },
        apply: { type: "boolean" },
      },
    },
  },
  {
    name: "wakeflow_pod_record_design_handoff",
    description: "Controller-side record of a PodDesignHandoffEnvelope for the exact immutable PodDesignRequest. The handoff must cite the request id/ref/digest and preserve its request type and requirement anchors; it freezes per-repository landing and Test decisions, never creates a global TODO, and never counts as a target result. Product dispatch remains blocked until this handoff and all required product bindings are present. Dry-run unless apply is true.",
    annotations: localWriteTool("Record Pod Design Handoff", true),
    inputSchema: {
      type: "object",
      required: ["handoff"],
      properties: {
        root: { type: "string" },
        handoff: {
          type: "object",
          required: [
            "demandKey",
            "podId",
            "designRequestId",
            "designRequestRef",
            "designRequestDigest",
            "requestType",
            "preservesOriginalGoal",
            "requirementAnchors",
            "evidenceRefs",
            "userConfirmationRefs",
            "landingPlan",
            "designIntent",
            "testDecision",
            "environmentSpec",
          ],
          properties: {
            demandKey: { type: "string" },
            podId: { type: "string" },
            designRequestId: { type: "string" },
            designRequestRef: { type: "string" },
            designRequestDigest: { type: "string" },
            requestType: { type: "string", enum: ["initial-design", "supplement", "redesign"] },
            preservesOriginalGoal: { type: "boolean", const: true },
            requirementAnchors: { type: "array", minItems: 1, items: { type: "string" } },
            evidenceRefs: { type: "array", items: { type: "string" } },
            userConfirmationRefs: { type: "array", items: { type: "string" } },
            landingPlan: {
              type: "array",
              minItems: 1,
              items: {
                type: "object",
                required: ["repositoryWindow"],
                properties: {
                  repositoryWindow: { type: "string" },
                  objective: { type: "string" },
                  boundaries: { type: "array", items: { type: "string" } },
                },
              },
            },
            designIntent: { type: "string" },
            testDecision: { type: "string" },
            environmentSpec: { type: "object" },
            replacementLineage: { type: "object" },
          },
        },
        apply: { type: "boolean" },
      },
    },
  },
  {
    name: "wakeflow_pod_prepare_test_access",
    description: "Create the host-local access probe plan for an independent Pod Test session after all frozen product worktrees are bound. The exact worktree roots stay only in host-local runtime; tool output and tracked state contain only opaque probe/digest summaries. This does not make Test dispatchable. Dry-run unless apply is true.",
    annotations: localWriteTool("Prepare Pod Test Access Probe", true),
    inputSchema: {
      type: "object",
      required: ["demandKey"],
      properties: {
        root: { type: "string" },
        demandKey: { type: "string" },
        apply: { type: "boolean" },
      },
    },
  },
  {
    name: "wakeflow_pod_record_test_access",
    description: "Record the exact redacted receipt from the independent Pod Test access probe. Only validated direct-multi-root coverage of every active product binding opens Test dispatch. Unsupported hosts remain blocked; Wakeflow never falls back to a main checkout, lets a product window impersonate Test, or claims an unverified per-repository executor. Dry-run unless apply is true.",
    annotations: localWriteTool("Record Pod Test Access Receipt", true),
    inputSchema: {
      type: "object",
      required: ["receipt"],
      properties: {
        root: { type: "string" },
        receipt: {
          type: "object",
          required: [
            "probeId",
            "demandKey",
            "podId",
            "host",
            "testWindowName",
            "testBindingId",
            "status",
            "capability",
            "observedAt"
          ],
          properties: {
            probeId: { type: "string" },
            demandKey: { type: "string" },
            podId: { type: "string" },
            host: { type: "string", enum: ["codex", "claude-code"] },
            testWindowName: { type: "string" },
            testBindingId: {
              type: "string",
              description: "Opaque Test registry/binding correlation, never the host thread/session handle.",
            },
            status: { type: "string", enum: ["validated", "blocked"] },
            capability: {
              type: "string",
              enum: [
                "direct-multi-root",
                "unsupported",
                "per-repo-executor-unavailable"
              ],
            },
            productAccess: {
              type: "array",
              description: "Required for validated direct-multi-root. One redacted identity observation per planned product binding; contains digests and Git HEAD, never cwd or host handles.",
              items: {
                type: "object",
                required: [
                  "windowName",
                  "repositoryWindow",
                  "bindingId",
                  "rootDigest",
                  "gitTopLevelDigest",
                  "head",
                  "readable",
                  "gitIdentityVerified"
                ],
                properties: {
                  windowName: { type: "string" },
                  repositoryWindow: { type: "string" },
                  bindingId: { type: "string" },
                  rootDigest: { type: "string" },
                  gitTopLevelDigest: { type: "string" },
                  head: { type: "string" },
                  readable: { type: "boolean" },
                  gitIdentityVerified: { type: "boolean" },
                },
              },
            },
            reasonCode: {
              type: "string",
              enum: [
                "direct-multi-root-unsupported",
                "access-probe-failed",
                "per-repo-executor-unavailable"
              ],
            },
            observedAt: { type: "string" },
          },
        },
        apply: { type: "boolean" },
      },
    },
  },
  {
    name: "wakeflow_pod_close",
    description: "Generate an idempotent host close plan for a completed, cancelled, or archived Pod. Wakeflow does not inspect or delete Git worktrees/branches and does not claim that archiving a session physically removed its worktree. The Agent executes each host operation and records the outcome with wakeflow_pod_record_close_receipt. Dry-run unless apply is true.",
    annotations: localWriteTool("Close Demand Pod"),
    inputSchema: {
      type: "object",
      required: ["demandKey"],
      properties: {
        root: { type: "string" },
        demandKey: { type: "string" },
        apply: { type: "boolean" },
      },
    },
  },
  {
    name: "wakeflow_pod_record_close_receipt",
    description: "Record one host-confirmed Pod close result. Session closure and physical worktree cleanup are separate facts: retained/unknown never becomes removed. A binding is logically closed only after a matching host receipt, and the Pod reaches closed only after every planned window has one. Dry-run unless apply is true.",
    annotations: localWriteTool("Record Pod Close Receipt", true),
    inputSchema: {
      type: "object",
      required: ["receipt"],
      properties: {
        root: { type: "string" },
        receipt: {
          type: "object",
          required: [
            "closeCorrelationId",
            "bindingId",
            "windowName",
            "host",
            "sessionStatus",
            "worktreeStatus",
            "confirmedAt",
          ],
          properties: {
            closeCorrelationId: { type: "string" },
            bindingId: { type: ["string", "null"] },
            windowName: { type: "string" },
            host: { type: "string" },
            sessionStatus: { type: "string", enum: ["archived", "closed", "handed-off", "not-found"] },
            worktreeStatus: { type: "string", enum: ["removed", "retained", "not-applicable", "unknown"] },
            confirmedAt: { type: "string" },
            error: { type: "string" },
          },
        },
        apply: { type: "boolean" },
      },
    },
  },
  {
    name: "wakeflow_pod_list",
    description: "Read-only Pod inventory from canonical demand state plus host-local launch operations and bindings. It does not scan guessed worktree paths or a dynamic repository overlay.",
    annotations: readOnlyTool("List Demand Pods"),
    inputSchema: {
      type: "object",
      properties: {
        root: { type: "string" },
      },
    },
  },
  {
    name: "wakeflow_prune_runtime",
    description: "Prune replay-safe local runtime; target selects which. transport (default): confirmed-send delivery-run transport files older than a cutoff — dry-run unless apply is true; apply requires before; target-results (evidence) are never deleted, and runs inside a surviving repeated-attempt chain are retained. preserved: audit holds under .wakeflow-local/preserved/ older than the retention (preservedRetentionDays, default 30) or an explicit before — dry-run lists candidates with their manifests; apply deletes them. Legacy/unknown trees are NEVER pruned by any target — they route to the user.",
    annotations: localWriteTool("Prune Wakeflow Runtime Transport"),
    inputSchema: {
      type: "object",
      properties: {
        root: { type: "string" },
        target: { type: "string", enum: ["transport", "preserved"], description: "What to prune: transport (delivery-run files, default) or preserved (aged audit holds)." },
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
  "wakeflow_register_window",
  "wakeflow_create_demand",
  "wakeflow_add_task",
  "wakeflow_prepare_delivery",
  "wakeflow_record_delivery",
  "wakeflow_record_target_result",
  "wakeflow_review_pack",
  "wakeflow_reduce_results",
  "wakeflow_decide_review",
  "wakeflow_complete_demand",
  "wakeflow_continue_demand",
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
  wakeflow_register_window: (args) => runWakeflowRuntime({
    script: "wakeflow-delivery",
    args: [
      "register-thread",
      ...rootArgs(args),
      ...optionalValue("--window", args.window),
      ...optionalValue("--thread-id", args.windowHandle),
      ...optionalValue("--launch-correlation-id", args.launchCorrelationId),
      ...optionalValue("--binding-id", args.bindingId),
      ...optionalValue("--state-root", args.stateRoot),
      ...(args.apply ? ["--write"] : []),
      "--json",
    ],
    cwd: args.root || undefined,
    sensitiveValues: typeof args.windowHandle === "string" ? [args.windowHandle] : [],
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
  wakeflow_recover_state_transition: (args) => runWakeflowRuntime({
    script: "wakeflow-state",
    args: [
      "recover-state-transition",
      "--state-root", requireValueForTool(args, "stateRoot", "wakeflow_recover_state_transition"),
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
  wakeflow_add_task: (args) => {
    validateMcpTaskPackageContext(args, "wakeflow_add_task");
    return runWakeflowRuntime({
      script: "wakeflow-state",
      args: [
        "add-task-package",
        "--state-root", args.stateRoot,
        "--task-package-id", args.packageId || args.taskId,
        "--summary", args.summary,
        "--target-window", args.targetWindow,
        "--target-task-id", args.taskId,
        ...optionalValue("--replaces-target-task-id", args.replacesTargetTaskId),
        ...optionalValue("--target-summary", args.targetSummary),
        ...optionalValue("--source-ref", args.sourceRef),
        ...optionalValue("--work-type", args.workType),
        ...optionalValue("--objective", args.objective),
        ...optionalValue("--context-summary", args.contextSummary ? JSON.stringify(args.contextSummary) : undefined),
        ...optionalValue("--requirement-refs", args.requirementRefs ? JSON.stringify(args.requirementRefs) : undefined),
        ...optionalValue("--boundaries", args.boundaries ? JSON.stringify(args.boundaries) : undefined),
        ...optionalValue("--completion-expectations", args.completionExpectations ? JSON.stringify(args.completionExpectations) : undefined),
        ...optionalValue("--depends-on-task-ids", args.dependsOnTaskIds ? JSON.stringify(args.dependsOnTaskIds) : undefined),
        ...optionalValue("--commit-expectation", args.commitExpectation),
        ...optionalValue("--design-intent", args.designIntent),
        ...optionalValue("--acceptance-anchors", args.acceptanceAnchors ? JSON.stringify(args.acceptanceAnchors) : undefined),
        ...optionalValue("--evidence-contract", args.evidenceContract ? JSON.stringify(args.evidenceContract) : undefined),
        ...optionalValue("--test-card-id", args.testCardId),
        ...optionalValue("--test-continuation-of", args.testContinuationOf),
        ...(args.restartTest ? ["--restart-test"] : []),
        ...optionalValue("--test-restart-reason", args.testRestartReason),
        ...rootArgs(args),
        "--write",
        ...(args.adoptHost ? ["--adopt-host"] : []),
        "--json",
      ],
    });
  },
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
          ...optionalValue("--state-root", args.stateRoot),
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
    const expectedPreviewDigest = args.apply
      ? requireValueForTool(args, "expectedPreviewDigest", "wakeflow_prepare_delivery direction=target with apply=true")
      : args.expectedPreviewDigest;
    return runWakeflowRuntime({
      script: "wakeflow-delivery",
      args: [
        "prepare-dispatch-from-state",
        "--state-root", stateRoot,
        "--target-task-id", taskId,
        ...repeatValues("--group-target-task-id", args.groupTaskIds),
        ...optionalValue("--task-package-id", args.taskPackageId),
        ...optionalValue("--controller-window", args.controllerWindow),
        ...optionalValue("--group", args.dispatchGroup),
        ...optionalValue("--return-policy", args.returnPolicy),
        ...optionalValue("--expected-preview-digest", expectedPreviewDigest),
        ...(args.automationEnabled ? ["--automation-enabled"] : []),
        ...rootArgs(args),
        ...(args.apply ? ["--write"] : []),
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
      ...optionalValue("--dispatch-group", args.dispatchGroup),
      ...(args.supersedeResult ? ["--supersede-result"] : []),
      ...optionalValue("--summary", args.summary),
      ...repeatValues("--changed-repo", args.changedRepos),
      ...repeatValues("--commit", args.commits),
      ...optionalValue("--commit-disposition", args.commitDisposition),
      ...repeatValues("--evidence-ref", args.evidenceRefs),
      ...repeatValues("--verification", args.verification),
      ...repeatValues("--risk", args.risks),
      ...optionalValue("--craft-evidence", args.craftEvidence && args.craftEvidence.length ? JSON.stringify(args.craftEvidence) : undefined),
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
    if (args.scope === "storage") {
      return runWakeflowRuntime({
        script: "wakeflow-storage",
        args: ["map", ...rootArgs(args), "--json"],
        cwd: args.root || undefined,
      });
    }
    throw new Error(`wakeflow_view: unknown scope "${args.scope}" (expected task-ledger | window | focus | trace | storage)`);
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
  wakeflow_continue_demand: (args) => {
    validateMcpTaskPackageContext(args, "wakeflow_continue_demand");
    return runWakeflowRuntime({
      script: "wakeflow-state",
      args: [
        "continue-demand",
        "--state-root", args.stateRoot,
        "--continuation-type", args.continuationType,
        "--reason", args.reason,
        ...repeatValues("--evidence-ref", args.evidenceRefs),
        "--task-package-id", args.packageId || args.taskId,
        "--summary", args.summary,
        "--target-window", args.targetWindow,
        "--target-task-id", args.taskId,
        ...optionalValue("--source-ref", args.sourceRef),
        ...optionalValue("--target-summary", args.targetSummary),
        ...optionalValue("--work-type", args.workType),
        ...optionalValue("--objective", args.objective),
        ...optionalValue("--context-summary", args.contextSummary ? JSON.stringify(args.contextSummary) : undefined),
        ...optionalValue("--requirement-refs", args.requirementRefs ? JSON.stringify(args.requirementRefs) : undefined),
        ...optionalValue("--boundaries", args.boundaries ? JSON.stringify(args.boundaries) : undefined),
        ...optionalValue("--completion-expectations", args.completionExpectations ? JSON.stringify(args.completionExpectations) : undefined),
        ...optionalValue("--depends-on-task-ids", args.dependsOnTaskIds ? JSON.stringify(args.dependsOnTaskIds) : undefined),
        ...optionalValue("--commit-expectation", args.commitExpectation),
        ...optionalValue("--design-intent", args.designIntent),
        ...(args.acceptanceAnchors ? ["--acceptance-anchors", JSON.stringify(args.acceptanceAnchors)] : []),
        ...(args.evidenceContract ? ["--evidence-contract", JSON.stringify(args.evidenceContract)] : []),
        ...optionalValue("--test-card-id", args.testCardId),
        ...optionalValue("--test-continuation-of", args.testContinuationOf),
        ...(args.restartTest ? ["--restart-test"] : []),
        ...optionalValue("--test-restart-reason", args.testRestartReason),
        ...rootArgs(args),
        ...(args.apply ? ["--write"] : []),
        ...(args.adoptHost ? ["--adopt-host"] : []),
        "--json",
      ],
    });
  },
  wakeflow_archive: async (args) => {
    if (args.target === "demand") {
      const stateRoot = requireValueForTool(args, "stateRoot", "wakeflow_archive target=demand");
      const reason = requireValueForTool(args, "reason", "wakeflow_archive target=demand");
      return runWakeflowRuntime({
        script: "wakeflow-state",
        args: [
          "archive-demand",
          "--state-root", stateRoot,
          "--reason", reason,
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
  wakeflow_sanitize_archive: (args) => runWakeflowRuntime({
    script: "wakeflow-state",
    args: [
      "sanitize-archive",
      "--state-root", requireValueForTool(args, "stateRoot", "wakeflow_sanitize_archive"),
      "--reason", requireValueForTool(args, "reason", "wakeflow_sanitize_archive"),
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
      ...optionalValue("--strategy-source", args.strategySource),
      ...repeatValues("--approved-test-step", args.approvedTestPlan),
      ...repeatValues("--allowed-test-skill", args.allowedTestSkills),
      ...optionalValue("--setup-policy", args.setupPolicy),
      ...optionalValue("--max-attempts", args.maxAttempts),
      ...repeatValues("--restart-condition", args.restartConditions),
      ...repeatValues("--evidence-required", args.evidenceRequired),
      ...repeatValues("--allowed-operation", args.allowedOperations),
      ...repeatValues("--forbidden-operation", args.forbiddenOperations),
      ...rootArgs(args),
      ...(args.apply ? ["--write"] : []),
      "--json",
    ],
  }),
  wakeflow_deliver: (args) => runWakeflowRuntime({
    script: "wakeflow-todo",
    args: [
      "deliver",
      ...optionalValue("--type", args.type),
      ...optionalValue("--design-key", args.designKey),
      ...optionalValue("--title", args.title),
      ...optionalValue("--item", args.item),
      ...(args.autoClaim ? ["--auto-claim"] : []),
      ...optionalValue("--priority", args.priority),
      ...optionalValue("--original-plan", args.originalPlan),
      ...optionalValue("--requirement-design", args.requirementDesign),
      ...optionalValue("--test-decision", args.testDecision),
      ...optionalValue("--dependency", args.dependency),
      ...rootArgs(args),
      ...(args.apply ? ["--apply"] : []),
      "--json",
    ],
    cwd: args.root || undefined,
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
      "claim-todo",
      ...rootArgs(args),
      ...optionalValue("--design-key", args.designKey),
      ...optionalValue("--controller-window", args.controllerWindow),
      ...optionalValue("--placement", args.placement),
      ...optionalValue("--authorization-ref", args.authorizationRef),
      ...optionalValue("--pod-id", args.podId),
      ...(args.apply ? ["--write"] : []),
      "--json",
    ],
    cwd: args.root || undefined,
  }),
  wakeflow_create_demand: (args) => {
    if (args.taskPackages !== undefined) {
      if (!Array.isArray(args.taskPackages)) {
        throw new Error("wakeflow_create_demand taskPackages must be an array");
      }
      args.taskPackages.forEach((taskPackage, index) => {
        validateMcpTaskPackageContext(taskPackage, `wakeflow_create_demand taskPackages[${index}]`);
      });
    }
    return runWakeflowRuntime({
      script: "wakeflow-demand-sequence",
      args: [
        "create-demand",
        ...rootArgs(args),
        ...optionalValue("--todo-id", args.todoId),
        ...optionalValue("--demand-key", args.demandKey),
        ...optionalValue("--title", args.title),
        ...optionalValue("--controller-window", args.controllerWindow),
        ...optionalValue("--placement", args.placement),
        ...optionalValue("--authorization-ref", args.authorizationRef),
        ...optionalValue("--pod-id", args.podId),
        ...optionalValue("--goal", args.goal),
        ...optionalValue("--completion-definition", args.completionDefinition),
        ...optionalValue("--test-decision", args.testDecision),
        ...optionalValue("--stage-plan", args.stagePlan),
        ...(args.taskPackages ? ["--task-packages", JSON.stringify(args.taskPackages)] : []),
        ...(args.apply ? ["--write"] : []),
        "--json",
      ],
      cwd: args.root || undefined,
    });
  },
  wakeflow_cancel_demand: (args) => runWakeflowRuntime({
    script: "wakeflow-state",
    args: [
      "cancel-demand",
      ...optionalValue("--state-root", args.stateRoot),
      ...optionalValue("--reason", args.reason),
      ...rootArgs(args),
      ...(args.apply ? ["--write"] : []),
      "--json",
    ],
    cwd: args.root || undefined,
  }),
  wakeflow_pod_open: (args) => runWakeflowRuntime({
    script: "wakeflow-pod",
    args: [
      "open",
      ...rootArgs(args),
      "--request-json",
      JSON.stringify({
        demandKey: args.demandKey,
        host: hostProfile.hostId,
        repositories: args.repositories ?? [],
        ...(args.requestedAt ? { requestedAt: args.requestedAt } : {}),
      }),
      ...(args.apply ? ["--write"] : []),
      "--json",
    ],
    cwd: args.root || undefined,
  }),
  wakeflow_pod_record_materialization: (args) => runWakeflowRuntime({
    script: "wakeflow-pod",
    args: [
      "record-materialization",
      ...rootArgs(args),
      "--attempt-json",
      JSON.stringify({
        ...args.attempt,
        host: hostProfile.hostId,
      }),
      ...(args.apply ? ["--write"] : []),
      "--json",
    ],
    cwd: args.root || undefined,
  }),
  wakeflow_pod_bind: (args) => runWakeflowRuntime({
    script: "wakeflow-pod",
    args: [
      "bind",
      ...rootArgs(args),
      "--receipt-json",
      JSON.stringify(args.receipt),
      ...(args.apply ? ["--write"] : []),
      "--json",
    ],
    cwd: args.root || undefined,
  }),
  wakeflow_pod_prepare_design_request: (args) => runWakeflowRuntime({
    script: "wakeflow-pod",
    args: [
      "prepare-design-request",
      ...rootArgs(args),
      "--request-json",
      JSON.stringify(args.request),
      ...(args.apply ? ["--write"] : []),
      "--json",
    ],
    cwd: args.root || undefined,
  }),
  wakeflow_pod_record_design_handoff: (args) => runWakeflowRuntime({
    script: "wakeflow-pod",
    args: [
      "record-design-handoff",
      ...rootArgs(args),
      "--handoff-json",
      JSON.stringify(args.handoff),
      ...(args.apply ? ["--write"] : []),
      "--json",
    ],
    cwd: args.root || undefined,
  }),
  wakeflow_pod_prepare_test_access: (args) => runWakeflowRuntime({
    script: "wakeflow-pod",
    args: [
      "prepare-test-access",
      ...rootArgs(args),
      "--demand-key",
      requireValueForTool(
        args,
        "demandKey",
        "wakeflow_pod_prepare_test_access",
      ),
      ...(args.apply ? ["--write"] : []),
      "--json",
    ],
    cwd: args.root || undefined,
  }),
  wakeflow_pod_record_test_access: (args) => runWakeflowRuntime({
    script: "wakeflow-pod",
    args: [
      "record-test-access",
      ...rootArgs(args),
      "--receipt-json",
      JSON.stringify(args.receipt),
      ...(args.apply ? ["--write"] : []),
      "--json",
    ],
    cwd: args.root || undefined,
  }),
  wakeflow_pod_close: (args) => runWakeflowRuntime({
    script: "wakeflow-pod",
    args: [
      "close",
      ...rootArgs(args),
      ...optionalValue("--demand-key", args.demandKey),
      ...(args.apply ? ["--write"] : []),
      "--json",
    ],
    cwd: args.root || undefined,
  }),
  wakeflow_pod_record_close_receipt: (args) => runWakeflowRuntime({
    script: "wakeflow-pod",
    args: [
      "record-close-receipt",
      ...rootArgs(args),
      "--receipt-json",
      JSON.stringify(args.receipt),
      ...(args.apply ? ["--write"] : []),
      "--json",
    ],
    cwd: args.root || undefined,
  }),
  wakeflow_pod_list: (args) => runWakeflowRuntime({
    script: "wakeflow-pod",
    args: [
      "list",
      ...rootArgs(args),
      "--json",
    ],
    cwd: args.root || undefined,
  }),
  wakeflow_prune_runtime: (args) => (args.target === "preserved"
    ? runWakeflowRuntime({
      script: "wakeflow-storage",
      args: [
        "prune-preserved",
        ...rootArgs(args),
        ...optionalValue("--before", args.before),
        ...(args.apply ? ["--apply"] : []),
        "--json",
      ],
      cwd: args.root || undefined,
    })
    : runWakeflowRuntime({
      script: "wakeflow-delivery",
      args: [
        "prune-runtime",
        ...rootArgs(args),
        ...optionalValue("--before", args.before),
        ...(args.apply ? ["--write"] : []),
        "--json",
      ],
      cwd: args.root || undefined,
    })),
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

function validateMcpTaskPackageContext(args, context) {
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    throw new Error(`${context} requires a task package object`);
  }
  try {
    normalizeTaskPackageContext({
      contextVersion: TASK_CONTEXT_VERSION,
      workType: args.workType,
      objective: args.objective,
      contextSummary: args.contextSummary,
      requirementRefs: args.requirementRefs,
      boundaries: args.boundaries,
      completionExpectations: args.completionExpectations,
      dependsOnTaskIds: args.dependsOnTaskIds ?? [],
      commitExpectation: args.commitExpectation,
      acceptanceAnchors: args.acceptanceAnchors,
    });
  } catch (error) {
    throw new Error(`${context} requires complete task context: ${error.message}`);
  }
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
  // CRITICAL: for every NON-controller window that dir is the window's OWN
  // repo/support dir, not the workspace — walk up to the nearest ancestor
  // carrying wakeflow.config.json (the workspace-root marker; legacy
  // workspace.config.json still counts), or a target's
  // first record/deliver/review call fails on a mislocated state root.
  for (const candidate of [process.env.WAKEFLOW_DEFAULT_ROOT, process.env.CLAUDE_PROJECT_DIR]) {
    if (!candidate || !path.isAbsolute(candidate) || !existsSync(candidate)) continue;
    let dir = candidate;
    for (let depth = 0; depth < 64; depth += 1) {
      if (existsSync(path.join(dir, "wakeflow.config.json")) || existsSync(path.join(dir, "workspace.config.json"))) return dir;
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    return candidate; // pre-init / standalone: keep the injected dir
  }
  return undefined;
}
