import { readFileSync, unlinkSync } from "node:fs";
import path from "node:path";
import { assertSameInventory, labGit, snapshotLabTree } from "./inventory.js";
import {
  decommissionSyntheticWindow,
  registerSyntheticWindow,
  type SyntheticHost,
} from "./synthetic-host.js";
import {
  assertLab,
  previewApply,
  readLabConfig,
  recordAt,
  type WorkflowContext,
} from "./workflow-context.js";
import { type ProductEvidence, recheckProduct } from "./workflow-target.js";

export async function registerLabWindows(context: WorkflowContext, host: SyntheticHost) {
  if (context.scenario === "worktree") {
    const created = await previewApply(context, "wakeflow_pod", {
      intent: { kind: "create", name: "lab-worktree", idempotencyKey: "lab-pod-create" },
    });
    assertLab(created.disposition === "created", "lab-pod-not-created");
    const podId = recordAt(created, "pod").podId;
    assertLab(typeof podId === "string", "lab-pod-id-missing");
    context.podId = podId;
  }
  const config = readLabConfig(context.root);
  const roleOrder = ["controller", "design", "product", "test"];
  const windows = config.topology.windows
    .filter((window) => window.podId === context.podId)
    .sort((left, right) => roleOrder.indexOf(left.role) - roleOrder.indexOf(right.role));
  for (const [index, window] of windows.entries()) {
    let checkout: { root: string; branch: string; name: string } | undefined;
    if (context.scenario === "worktree" && window.root.kind === "repository") {
      const repositoryId = window.root.repositoryId;
      const repository = config.topology.repositories.find(
        (entry) => entry.repositoryId === repositoryId,
      );
      assertLab(repository, "lab-pod-repository-missing");
      const name = repository.displayName;
      assertLab(name === "Alpha" || name === "Beta", "lab-pod-repository-unknown");
      checkout = {
        root: path.join(context.labRoot, `Worktree-${name}`),
        branch: `codex/lab-${name.toLowerCase()}`,
        name,
      };
      labGit(path.resolve(context.root, repository.path), [
        "worktree",
        "add",
        "--quiet",
        "-b",
        checkout.branch,
        checkout.root,
        "HEAD",
      ]);
    }
    context.windows.push(
      await registerSyntheticWindow(context, host, window.windowId, index, checkout),
    );
  }
  if (context.scenario === "worktree") {
    const pod = await context.call("wakeflow_pod", {
      root: context.root,
      mode: "recover",
      podId: context.podId,
    });
    assertLab(
      pod.disposition === "healthy" && recordAt(pod, "pod").state === "ready",
      "lab-pod-not-ready",
    );
    context.acts.push("git-worktrees-registered-and-pod-ready");
  }
  context.acts.push("synthetic-window-bindings");
}

export async function closeLabPod(
  context: WorkflowContext,
  host: SyntheticHost,
  products: readonly ProductEvidence[],
) {
  const intent = {
    kind: "close",
    podId: context.podId,
    branches: products.map(({ product }) => ({
      repositoryId: product.repositoryId,
      disposition: "abandoned",
    })),
  };
  const closing = await previewApply(context, "wakeflow_pod", { intent });
  assertLab(closing.disposition === "closing", "lab-pod-not-closing");
  const stillBound = await context.call("wakeflow_pod", {
    root: context.root,
    mode: "preview",
    intent: { ...intent, branches: [] },
  });
  assertLab(stillBound.status === "blocked", "lab-pod-closed-with-bound-windows");
  for (const window of context.windows) await decommissionSyntheticWindow(context, host, window);
  for (const evidence of products) {
    recheckProduct(context, evidence);
    const product = evidence.product;
    const primary = path.join(context.labRoot, product.repositoryName ?? "");
    const entries = snapshotLabTree(product.cwd);
    const expected = ["", ".git", "README.md", "summarize.mjs", "verification.json"];
    assertLab(
      entries.length === expected.length && entries.every((entry) => expected.includes(entry.path)),
      "lab-worktree-unknown-resource",
    );
    assertLab(
      readFileSync(path.join(product.cwd, "README.md")).equals(
        readFileSync(path.join(primary, "README.md")),
      ) && labGit(product.cwd, ["rev-parse", "HEAD"]) === labGit(primary, ["rev-parse", "HEAD"]),
      "lab-worktree-baseline-changed",
    );
    // Only our two fixed, revalidated untracked outputs are removed. Git's non-force removal
    // remains responsible for refusing any remaining changed/unknown checkout contents.
    let owned = evidence.checkoutInventory;
    assertLab(owned !== null, "lab-worktree-inventory-missing");
    for (const file of ["summarize.mjs", "verification.json"]) {
      assertSameInventory(owned, snapshotLabTree(product.cwd));
      unlinkSync(path.join(product.cwd, file));
      owned = owned.filter((entry) => entry.path !== file);
    }
    labGit(primary, ["worktree", "remove", product.cwd]);
    assertLab(product.branch !== null, "lab-worktree-branch-missing");
    labGit(primary, ["branch", "-d", product.branch]);
  }
  const closed = await previewApply(context, "wakeflow_pod", {
    intent: { ...intent, branches: [] },
  });
  assertLab(closed.disposition === "closed" && closed.pod === null, "lab-pod-not-closed");
  assertLab(readLabConfig(context.root).pods.length === 1, "lab-pod-config-residue");
  context.acts.push("pod-two-stage-close", "owned-worktrees-and-branches-removed");
}
