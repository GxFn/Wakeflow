import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { labGit } from "./inventory.js";
import {
  assertLab,
  type LabWindow,
  recordAt,
  rowsAt,
  textAt,
  type WorkflowContext,
} from "./workflow-context.js";

/** Test-only host observations. No native sessions, projects, tmux panes or sends are created. */
export async function syntheticHost(artifact: string, hostId: string) {
  assertLab(hostId === "codex" || hostId === "claude-code", "lab-unsupported-artifact-host");
  const load = async (name: string, kind: string) => {
    const module: Record<string, unknown> = await import(
      pathToFileURL(path.join(artifact, "lib/hosts", hostId, `${name}.js`)).href
    );
    const values = Object.values(module).filter((value) => {
      return typeof value === "object" && value !== null && "kind" in value && value.kind === kind;
    });
    assertLab(values.length === 1, "lab-host-profile-unavailable");
    return values[0];
  };
  const identity = recordAt(
    await load(`${hostId}-window-host-identity-profile`, "WakeflowWindowHostIdentityProfile"),
  );
  const resources = recordAt(
    await load("wakeflow-workspace-host-resource-profile", "WakeflowWorkspaceHostResourceProfile"),
  );
  assertLab(identity.hostId === hostId && resources.hostId === hostId, "lab-host-profile-mismatch");
  const launchKind = textAt(resources, "launch", "kind");
  const windowLocator = recordAt(resources, "surfaces").windowLocator;
  assertLab(
    (launchKind === "project-thread" || launchKind === "tmux-session") &&
      typeof windowLocator === "boolean",
    "lab-host-capability-unsupported",
  );
  return {
    hostId,
    handleKind: textAt(identity, "handleKind"),
    projectThread: launchKind === "project-thread",
    windowLocator,
  };
}

export type SyntheticHost = Awaited<ReturnType<typeof syntheticHost>>;

export function observeSyntheticHook(
  context: WorkflowContext,
  host: SyntheticHost,
  window: Pick<LabWindow, "handle" | "cwd">,
  event: "SessionStart" | "UserPromptSubmit" | "Stop" | "SessionEnd",
  prompt?: string,
) {
  context.signal?.throwIfAborted();
  const result = spawnSync(
    process.execPath,
    [
      path.join(context.artifact, "hooks/observe.mjs"),
      "--wakeflow-hook-observer-v1",
      "--host",
      host.hostId,
    ],
    {
      cwd: context.root,
      env: { PATH: process.env.PATH ?? "" },
      input: JSON.stringify({
        session_id: window.handle,
        cwd: window.cwd,
        transcript_path: null,
        hook_event_name: event,
        ...(prompt === undefined ? {} : { prompt }),
      }),
      encoding: "utf8",
      shell: false,
      timeout: 20_000,
      maxBuffer: 64 * 1024,
    },
  );
  assertLab(
    !result.error && result.status === 0 && result.stdout === "" && result.stderr === "",
    "lab-synthetic-hook-failed",
  );
  context.signal?.throwIfAborted();
}

export async function registerSyntheticWindow(
  context: WorkflowContext,
  host: SyntheticHost,
  id: string,
  index: number,
  checkout?: { readonly root: string; readonly branch: string; readonly name: string },
): Promise<LabWindow> {
  const inspected = await context.call("wakeflow_register_window_binding", {
    root: context.root,
    operation: "inspect",
    windowId: id,
  });
  assertLab(
    recordAt(inspected, "binding").status === "unregistered",
    "lab-synthetic-window-already-bound",
  );
  const intent = recordAt(inspected, "launchIntent");
  if (context.scenario === "worktree" && inspected.role === "test") {
    const products = context.windows.filter((window) => window.role === "product");
    const attached = rowsAt(recordAt(intent, "execution"), "attachedWorktrees");
    assertLab(
      products.length > 0 &&
        attached.length === products.length &&
        attached.every(
          (entry) =>
            entry.status === "receipt-present" &&
            products.some(
              (product) =>
                entry.repositoryId === product.repositoryId &&
                path.resolve(context.root, textAt(entry, "pathFromWorkspaceRoot")) === product.cwd,
            ),
        ),
      "lab-test-worktree-attachment-missing",
    );
    context.acts.push("test-worktree-attachments-verified");
  }
  const placement = textAt(intent, "root", "configuredPlacement");
  const cwd = checkout?.root ?? path.resolve(context.root, placement);
  const relative = path.relative(context.labRoot, cwd);
  assertLab(
    relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative),
    "lab-window-outside-fixture",
  );
  const handle = randomUUID();
  const projectThread = host.projectThread;
  observeSyntheticHook(
    context,
    host,
    { handle, cwd: projectThread ? context.root : cwd },
    "SessionStart",
  );
  const observation = {
    handle: { kind: host.handleKind, value: handle },
    launchIntentDigest: textAt(intent, "intentDigest"),
    observedAt: new Date().toISOString(),
    ...(host.windowLocator
      ? {
          tmux: {
            socketName: null,
            sessionName: "wakeflow-synthetic-lab",
            windowId: `@${index + 1}`,
            paneId: `%${index + 1}`,
          },
        }
      : {}),
    ...(checkout === undefined
      ? {}
      : {
          worktree: {
            porcelain: labGit(cwd, ["worktree", "list", "--porcelain"]),
            commonDir: labGit(cwd, ["rev-parse", "--git-common-dir"]),
            ...(projectThread ? { executionRoot: cwd } : {}),
          },
        }),
  };
  const registered = await context.call("wakeflow_register_window_binding", {
    root: context.root,
    operation: "register",
    windowId: id,
    observation,
  });
  assertLab(registered.disposition === "registered", "lab-synthetic-registration-failed");
  return {
    id,
    role: textAt(inspected, "role"),
    handle,
    cwd,
    bindingId: textAt(registered, "binding", "bindingId"),
    bindingDigest: textAt(registered, "binding", "bindingDigest"),
    repositoryId:
      textAt(intent, "root", "kind") === "repository" ? textAt(intent, "root", "rootId") : null,
    repositoryName:
      checkout?.name ?? (textAt(inspected, "role") === "product" ? path.basename(cwd) : null),
    branch: checkout?.branch ?? null,
  };
}

export async function decommissionSyntheticWindow(
  context: WorkflowContext,
  host: SyntheticHost,
  window: LabWindow,
) {
  observeSyntheticHook(context, host, window, "SessionEnd");
  const closure = host.windowLocator
    ? {
        preClose: { kind: "tmux-panes", panes: [] },
        closeResult: { status: "closed" },
        postClose: { kind: "tmux-panes", panes: [] },
      }
    : {
        preClose: { kind: host.handleKind, status: "active" },
        closeResult: { status: "closed" },
        postClose: { kind: host.handleKind, status: "archived" },
      };
  const result = await context.call("wakeflow_register_window_binding", {
    root: context.root,
    operation: "decommission",
    windowId: window.id,
    expectedBindingId: window.bindingId,
    expectedBindingDigest: window.bindingDigest,
    closure,
  });
  assertLab(result.disposition === "decommissioned", "lab-synthetic-decommission-failed");
}
