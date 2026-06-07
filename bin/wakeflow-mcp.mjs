#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer as SdkMcpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { runWakeflowRuntime } from "../lib/wakeflow-runtime.mjs";

const moduleDir = dirname(fileURLToPath(import.meta.url));

const tools = [
  {
    name: "wakeflow_initialize_workspace",
    description: "Initialize a Wakeflow runtime: discover siblings, generate/apply workspace config, install AGENTS blocks, create sibling Design/Test surfaces, and record derived local window configuration. Dry-run unless apply is true. If repositories/useDiscovered are omitted, the tool returns read-only discovery plus an agent-selection protocol; Codex must judge clean versus messy from those facts, pass explicit repositories for a clean workspace, or ask the user in a messy workspace. Returns a localized host create_thread launch plan; replaceWindows limits the plan to selected windows. Real thread ids are registered only in the local thread registry by host-controlled follow-up, not tracked docs or this MCP schema; window config is derived from workspace config plus registry presence.",
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
          description: "Only return/create/update these replacement window entries; real replacement thread ids are still recorded in the local thread registry after host create_thread succeeds.",
        },
        repositories: {
          type: "array",
          description: "Agent/user-confirmed work-window mappings. In clean workspaces Codex should pass these explicitly after discovery instead of relying on hidden heuristics.",
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
    description: "Prepare one direct-thread delivery envelope. Use direction=target for controller-to-window dispatch, or direction=controller-return for target-to-controller return. This never sends the host thread message.",
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
        decision: { type: "string", enum: ["accept", "rework", "blocked"] },
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
        source: { type: "string", enum: ["all", "design", "todo"] },
        limit: { type: "number" },
        afterCompletion: { type: "boolean" },
        apply: { type: "boolean" },
      },
    },
  },
  {
    name: "wakeflow_verify",
    description: "Run embedded Wakeflow runtime verification for an installed workspace or the Wakeflow source repository.",
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
  wakeflow_verify: (args) => runWakeflowRuntime({
    script: "wakeflow-cli",
    args: ["verify", ...rootArgs(args), ...(args.scriptTests ? ["--script-tests"] : []), "--json"],
    cwd: args.root || undefined,
    timeoutMs: args.scriptTests ? 180000 : 120000,
  }),
};

await main();

async function main() {
  const sdkServer = new SdkMcpServer(
    { name: "wakeflow", version: readPackageVersion() },
    { capabilities: { tools: {} } },
  );

  sdkServer.server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
  sdkServer.server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params || {};
    const handler = handlers[name];
    if (!handler) {
      return toolError(`Unknown Wakeflow tool: ${name}`);
    }
    try {
      return toolContent(await handler(args || {}));
    } catch (error) {
      return toolError(error.message);
    }
  });

  await sdkServer.connect(new StdioServerTransport());
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
  return optionalValue("--root", args.root);
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

function toolError(message) {
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: JSON.stringify({ ok: false, error: message }, null, 2),
      },
    ],
  };
}

function readPackageVersion() {
  try {
    const packageJson = JSON.parse(readFileSync(join(moduleDir, "../package.json"), "utf8"));
    return packageJson.version || "0.0.0";
  } catch {
    return "0.0.0";
  }
}
