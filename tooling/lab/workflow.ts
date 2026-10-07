import path from "node:path";
import { runReadinessScenario } from "./scenarios.js";
import { decommissionSyntheticWindow, syntheticHost } from "./synthetic-host.js";
import {
  assertLab,
  type BusinessScenario,
  type LabCall,
  readLabConfig,
  recordAt,
  rowsAt,
  type WorkflowContext,
} from "./workflow-context.js";
import { completeLabDemand, publishLabDemand } from "./workflow-demand.js";
import { closeLabPod, registerLabWindows } from "./workflow-pod.js";
import { implementLabProduct, type ProductEvidence } from "./workflow-target.js";
import { testLabProducts } from "./workflow-test.js";

/** A fixed protocol experiment inside a newly allocated lab, before its inventory is sealed.
 * Never accepts an existing workspace or turns imported/native observations into acceptance. */
export async function runWorkflowScenario(
  labRoot: string,
  artifactDigest: string,
  hostId: string,
  scenario: BusinessScenario,
  call: LabCall,
  signal?: AbortSignal,
) {
  const acts = [...(await runReadinessScenario(labRoot, artifactDigest, call))];
  const root = path.join(labRoot, "Workspace");
  const primary = readLabConfig(root).pods.find((pod) => pod.placement === "primary");
  assertLab(primary, "lab-primary-pod-missing");
  const context: WorkflowContext = {
    labRoot,
    root,
    artifact: path.join(labRoot, "Artifact"),
    call,
    scenario,
    signal,
    acts,
    windows: [],
    podId: primary.podId,
    demandId: "",
    requirementId: "",
    recordDigest: "",
    members: [],
  };
  const host = await syntheticHost(context.artifact, hostId);
  await registerLabWindows(context, host);
  await publishLabDemand(context);
  const products: ProductEvidence[] = [];
  for (const [index, product] of context.windows
    .filter((window) => window.role === "product")
    .entries())
    products.push(await implementLabProduct(context, host, product, index));
  if (scenario !== "single-product") await testLabProducts(context, host, products);
  const archive = await completeLabDemand(context);
  const boundVerification = await call("wakeflow_verify", { root });
  const boundGates = rowsAt(boundVerification, "gates");
  // Synthetic hooks never become a native MCP association: every bound window stays reported as
  // unverified on the passing runtime-artifact gate (not stale, not failed).
  const runtimeGate = boundGates.find((gate) => gate.name === "runtime-artifact");
  assertLab(
    boundVerification.ok === true &&
      recordAt(boundVerification, "summary").fail === 0 &&
      recordAt(boundVerification, "summary").unavailable === 0 &&
      runtimeGate?.status === "pass" &&
      runtimeGate.code === `window-runtime-unverified:${context.windows.length}`,
    "lab-synthetic-runtime-boundary-mismatch",
  );
  acts.push("synthetic-window-runtime-remains-unverified");
  if (scenario === "worktree") await closeLabPod(context, host, products);
  else {
    for (const window of context.windows) await decommissionSyntheticWindow(context, host, window);
    acts.push("synthetic-bindings-retired");
  }
  const final = await call("wakeflow_verify", { root });
  assertLab(
    final.ok === true &&
      recordAt(final, "summary").fail === 0 &&
      recordAt(final, "summary").unavailable === 0,
    "lab-final-verification-failed",
  );
  acts.push("final-workspace-verification");
  return {
    scenario,
    acts,
    archive,
    verificationBeforeRetirement: boundVerification,
    implementations: products.length,
    independentTest: scenario !== "single-product",
    hostObservations: "synthetic-generated-hooks" as const,
    nativeHostAcceptance: "unverified" as const,
  };
}
