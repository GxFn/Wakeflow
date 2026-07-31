import path from "node:path";
import { existsSync, realpathSync } from "node:fs";

function canonicalLocalPath(value) {
  const resolved = path.resolve(String(value ?? ""));
  if (!existsSync(resolved)) return resolved;
  return realpathSync.native(resolved);
}

function launchCorrelationMarker(launchCorrelationId) {
  const value = String(launchCorrelationId ?? "").trim();
  if (!value) {
    throw new Error("Codex Pod recovery requires launchCorrelationId");
  }
  return `Wakeflow launch correlation: ${value}`;
}

export function exactCodexRecoveryThread(threadResponse, launchCorrelationId) {
  const threads = Array.isArray(threadResponse)
    ? threadResponse
    : Array.isArray(threadResponse?.threads)
      ? threadResponse.threads
      : [];
  const marker = launchCorrelationMarker(launchCorrelationId);
  const matches = threads.filter((thread) => (
    thread
    && typeof thread.threadId === "string"
    && thread.threadId.trim()
    && typeof thread.preview === "string"
    && thread.preview
      .split(/\r?\n/u)
      .some((line) => line.trim() === marker)
  ));
  if (matches.length !== 1) {
    const error = new Error(
      `recovery-not-unique: expected exactly one final Codex task preview matching ${marker}; found ${matches.length}`,
    );
    error.code = "recovery-not-unique";
    error.matchCount = matches.length;
    throw error;
  }
  return matches[0];
}

export function exactCodexProject(projectResponse, repositoryRoot) {
  const projects = Array.isArray(projectResponse)
    ? projectResponse
    : Array.isArray(projectResponse?.projects)
      ? projectResponse.projects
      : [];
  const expectedPath = canonicalLocalPath(repositoryRoot);
  const matches = projects.filter((project) => {
    if (!project || project.projectKind !== "local" || typeof project.path !== "string") {
      return false;
    }
    return canonicalLocalPath(project.path) === expectedPath;
  });

  if (matches.length === 0) {
    const error = new Error(`project-not-registered: no saved Codex project exactly matches ${expectedPath}`);
    error.code = "project-not-registered";
    throw error;
  }
  if (matches.length > 1) {
    const error = new Error(`project-ambiguous: more than one saved Codex project exactly matches ${expectedPath}`);
    error.code = "project-ambiguous";
    throw error;
  }
  return matches[0];
}

export function codexPodEntryExtras(operation, { workspaceRoot, stateRoot = null } = {}) {
  const product = operation?.role === "product";
  const projectRoot = product ? operation?.repositoryRoot : workspaceRoot;
  if (!projectRoot) {
    throw new Error(`Codex Pod launch intent ${operation?.windowName ?? "<unknown>"} is missing its exact project root`);
  }
  if (product && !operation?.expectedBaseHead) {
    throw new Error(`Codex Pod product launch intent ${operation.windowName} is missing expectedBaseHead`);
  }
  if (!operation?.registrationBindingId) {
    throw new Error(`Codex Pod launch intent ${operation?.windowName ?? "<unknown>"} is missing registrationBindingId`);
  }

  const environment = product
    ? {
        type: "worktree",
        startingState: {
          type: "branch",
          // create_thread accepts an existing branch or ref. The frozen local
          // HEAD is an exact ref and is verified again by the entry receipt.
          branchName: operation.expectedBaseHead,
        },
      }
    : { type: "local" };
  const stateRootRelative = operation.stateRootRelative
    ?? (stateRoot && workspaceRoot
      ? path.relative(workspaceRoot, stateRoot).split(path.sep).join("/")
      : null);

  return {
    codexProjectResolution: {
      hostTool: "list_projects",
      exactPath: canonicalLocalPath(projectRoot),
      matchPolicy: "normalized-exact-path",
      onMissing: "project-not-registered",
      parentProjectFallback: false,
      localEnvironmentFallback: false,
    },
    hostCreateThread: {
      required: true,
      hostTool: "create_thread",
      promptField: "createPrompt",
      targetTemplate: {
        type: "project",
        projectId: "<exact-project-id>",
        environment,
      },
      asynchronousHandlePolicy: {
        rejectClientThreadId: true,
        waitForFinalThreadId: true,
        registerOnlyFinalThreadId: true,
      },
      materializationProtocol: {
        recordTool: "wakeflow_pod_record_materialization",
        beforeCreateStatus: "creating",
        asynchronousStatus: "pending",
        finalStatus: "finalized",
        hostRequestIdField: "create_thread.clientThreadId",
        recoveryTool: "list_threads",
        recoveryListArguments: {
          limit: 50,
        },
        recoveryMatch: {
          field: "preview",
          marker: launchCorrelationMarker(operation.launchCorrelationId),
          cardinality: "exactly-one",
          zeroMatches: "wait-or-block-without-create",
          multipleMatches: "block-without-finalize",
        },
        optionalQueryOptimization: {
          useOnlyWhenHostSchemaSupportsIt: true,
          required: false,
          query: operation.launchCorrelationId,
        },
        searchBeforeCreate: true,
        noBlindRetry: true,
        temporaryHandleRegistrationForbidden: true,
      },
    },
    localRegistration: {
      required: true,
      hostTool: "wakeflow_register_window",
      applyRequired: true,
      handleSource: "create_thread.threadId",
      callTemplate: {
        root: workspaceRoot,
        window: operation.windowName,
        windowHandle: "<create_thread.threadId>",
        launchCorrelationId: operation.launchCorrelationId,
        bindingId: operation.registrationBindingId,
        stateRoot: stateRootRelative ?? "<canonical Pod state root from launch plan>",
        apply: true,
      },
      finalHandleOnly: true,
    },
    entrySync: product
      ? {
          purpose: "identity-receipt-only",
          requiredFacts: [
            "pwd",
            "gitTopLevel",
            "gitCommonDir",
            "head",
            "branch",
            "detached",
            "mainCheckout",
          ],
          expectedBaseHead: operation.expectedBaseHead,
          taskDispatchAllowed: false,
        }
      : {
          purpose: "pod-control-session-identity",
          stateRootScope: "current-pod-only",
          taskDispatchAllowed: false,
        },
  };
}
