import path from "node:path";
import { isRecord } from "../verification/files.js";
import { assertSameInventory, LabError, snapshotLabTree } from "./inventory.js";

type Call = (name: string, args: Record<string, unknown>) => Promise<Record<string, unknown>>;
const MAINTAIN = "wakeflow_maintain_workspace";

function productSelection(products: readonly string[]): Record<string, unknown> {
  return {
    program: { displayName: "Disposable Lab" },
    presentation: {},
    topology: {
      repositories: products.map((name) => ({
        selectionKey: name.toLowerCase(),
        path: `../${name}`,
        displayName: name,
        instructionManagement: "owner-managed",
      })),
      supportSurfaces: ["Design", "Test"].map((name) => ({
        selectionKey: name.toLowerCase(),
        capability: name.toLowerCase(),
        path: name,
        displayName: name,
        ownership: "wakeflow-managed",
      })),
      windows: [
        {
          selectionKey: "controller",
          role: "controller",
          displayName: "Controller",
          root: { kind: "program" },
        },
        ...["Design", "Test"].map((name) => ({
          selectionKey: `window-${name.toLowerCase()}`,
          role: name.toLowerCase(),
          displayName: name,
          root: { kind: "support-surface", selectionKey: name.toLowerCase() },
        })),
        ...products.map((name) => ({
          selectionKey: `window-${name.toLowerCase()}`,
          role: "product",
          displayName: name,
          root: { kind: "repository", selectionKey: name.toLowerCase() },
        })),
      ],
    },
    storage: { ledgerRoot: "../ledger" },
    governance: {},
    hosts: {},
  };
}

export async function initializeLab(
  root: string,
  call: Call,
  products: readonly string[] = ["Alpha", "Beta"],
): Promise<void> {
  const workspace = path.join(root, "Workspace");
  const request = { selection: productSelection(products) };
  const before = snapshotLabTree(root);
  const preview = await call(MAINTAIN, {
    root: workspace,
    action: "fresh-initialize",
    mode: "preview",
    request,
  });
  assertSameInventory(before, snapshotLabTree(root));
  if (preview.status !== "ready" || typeof preview.planDigest !== "string")
    throw new LabError("lab-initialize-preview-blocked");
  const applied = await call(MAINTAIN, {
    root: workspace,
    action: "fresh-initialize",
    mode: "apply",
    request,
    planDigest: preview.planDigest,
  });
  if (applied.status !== "completed") throw new LabError("lab-initialize-incomplete");
}

/** Read-only readiness of a fresh, unbound workspace. This makes no delivery/acceptance claim. */
export async function runReadinessScenario(
  root: string,
  artifactDigest: string,
  call: Call,
): Promise<readonly string[]> {
  const workspace = path.join(root, "Workspace");
  const before = snapshotLabTree(root);
  const passed: string[] = [];
  const status = await call("wakeflow_status", { root: workspace });
  if (
    status.overall !== "idle" ||
    !isRecord(status.runtime) ||
    status.runtime.artifactManifestDigest !== artifactDigest ||
    status.runtime.artifactOnDisk !== "same"
  )
    throw new LabError("lab-runtime-or-status-mismatch");
  passed.push("fresh-process-artifact-identity", "idle-workspace");
  const verify = await call("wakeflow_verify", { root: workspace });
  if (
    verify.ok !== true ||
    !isRecord(verify.summary) ||
    verify.summary.fail !== 0 ||
    verify.summary.unavailable !== 0
  )
    throw new LabError("lab-verify-failed");
  passed.push("workspace-verification");
  const preview = await call(MAINTAIN, {
    root: workspace,
    action: "reconcile",
    mode: "preview",
    request: {},
  });
  if (
    preview.status !== "ready" ||
    !isRecord(preview.plan) ||
    !Array.isArray(preview.plan.steps) ||
    preview.plan.steps.length !== 0 ||
    typeof preview.planDigest !== "string"
  )
    throw new LabError("lab-reconcile-not-empty");
  const applied = await call(MAINTAIN, {
    root: workspace,
    action: "reconcile",
    mode: "apply",
    request: {},
    planDigest: preview.planDigest,
  });
  if (applied.status !== "no-op" || applied.operationId !== null)
    throw new LabError("lab-reconcile-not-noop");
  passed.push("reconcile-no-op");
  const pod = await call("wakeflow_pod", {
    root: workspace,
    mode: "preview",
    intent: { kind: "create", name: "lab-preview", idempotencyKey: "lab-preview-1" },
  });
  if (pod.status !== "ready" || !isRecord(pod.plan) || pod.plan.kind !== "create")
    throw new LabError("lab-pod-preview-blocked");
  passed.push("pod-create-preview");
  assertSameInventory(before, snapshotLabTree(root));
  passed.push("zero-workspace-writes");
  return passed;
}
