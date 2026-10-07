import type { JsonObject } from "../../foundation/data/json-value.js";
import type { WakeflowWindowLaunchInstructionInput } from "../../workspace/window-runtime/wakeflow-window-launch-instructions.js";

/** Codex owns project selection, tool arguments and the separation from product Git worktrees. */
export function renderCodexWindowLaunchInstructions(
  input: WakeflowWindowLaunchInstructionInput,
): JsonObject {
  const { model, intent, profile, attachedWorktrees: attached } = input;
  const role = intent.role;
  const worktree =
    intent.worktree === null
      ? null
      : {
          repositoryId: intent.worktree.repositoryId,
          suggestedName: intent.worktree.suggestedName,
          basePolicy: intent.worktree.basePolicy,
          launch: profile.surfaces.worktree.launch,
          hostBranch: intent.worktree.suggestedName,
          registration:
            "report the project chat handle and worktree.executionRoot from pwd in the assigned checkout, plus verbatim git worktree list --porcelain and git rev-parse --git-common-dir from that checkout",
          note: "create the product checkout inside the workspace root, beside it in the same outer directory, or inside the product repository with git worktree add from the configured repository local HEAD; keep the chat in the outer workspace project with a local environment. A project worktree environment would check out the outer repository, not the product repository",
        };
  const launch = model.hosts?.codex?.launch;
  return {
    kind: profile.hostId,
    tool: "create_thread",
    title: intent.displayTitle,
    target: {
      type: "project",
      projectId: "<project id returned by list_projects for the workspace root and current host>",
      environment: { type: "local" },
    },
    projectRoot: ".",
    sessionRoot: ".",
    executionRoot:
      intent.worktree === null ? intent.root.configuredPlacement : "<registered product worktree>",
    projectSelection:
      "list_projects: match the canonical workspace root and current host, never a role directory or display name; if missing or ambiguous, resolve the outer project before creating any chat",
    startupPrompt:
      "include workspace root, windowId, role, execution root, required role skill and return pointer; explicitly read instructions for the execution root and set command workdir there",
    verification:
      "retain the create result; resolve a pending clientThreadId to a ready threadId; verify the host-reported projectId and SessionStart in the workspace root before registration. If project membership is unavailable, obtain direct UI confirmation and report that limit; never infer membership from cwd or title",
    model: launch?.modelByRole?.[role] ?? launch?.modelByRole?.default ?? null,
    thinking:
      launch?.reasoningEffortByRole?.[role] ?? launch?.reasoningEffortByRole?.default ?? null,
    parameterPolicy:
      "pass only target, title, prompt and explicitly user-configured model/thinking to create_thread; omit null overrides; cwd is not a create_thread argument",
    followUp: "set_thread_title",
    registration: "report handle kind codex-thread with the created ready threadId",
    worktree,
    attachedWorktrees: attached,
  };
}
