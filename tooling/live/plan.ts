import { existsSync } from "node:fs";
import path from "node:path";
import { verifyArtifactAgainstManifest } from "../artifacts/check-plugin-artifacts.js";
import { assertCanonicalDirectory } from "../lab/inventory.js";
import { type LabToolObservation, withLabMcp } from "../lab/mcp-session.js";
import {
  isRecord,
  privateDirectory,
  readBoundedFile,
  sha256,
  writeReport,
} from "../verification/files.js";
import {
  DIGEST,
  LiveError,
  type LivePlan,
  type LiveWindow,
  parsePlan,
  readDocument,
  record,
  textField,
  unwrapResult,
  WINDOW_ID,
} from "./contracts.js";

function projectFor(root: string, projectsFile: string, hostId: string) {
  const imported = unwrapResult(readDocument(projectsFile));
  if (!Array.isArray(imported.projects) || imported.projects.length > 1024)
    throw new LiveError("live-invalid-project-list");
  const matches = imported.projects.filter(
    (value: unknown) =>
      isRecord(value) &&
      value.path === root &&
      value.hostId === hostId &&
      value.projectKind === "local",
  );
  if (matches.length !== 1) throw new LiveError("live-project-missing-or-ambiguous");
  return { id: textField(record(matches[0]).projectId), hostId: textField(hostId), root };
}

function windowFromInspection(value: Record<string, unknown>, root: string): LiveWindow {
  const intent = record(value.launchIntent);
  const instruction = record(intent.execution);
  if (!isRecord(instruction.target)) throw new LiveError("live-project-bootstrap-unsupported");
  const target = instruction.target;
  // Consume a declared project/local capability, not a host-name switch.
  if (
    target.type !== "project" ||
    record(target.environment).type !== "local" ||
    instruction.projectRoot !== "." ||
    instruction.sessionRoot !== "." ||
    intent.podPlacement !== "primary" ||
    intent.worktree !== null
  )
    throw new LiveError("live-project-bootstrap-unsupported");
  const placement = textField(record(intent.root).configuredPlacement);
  if (instruction.executionRoot !== placement) throw new LiveError("live-execution-root-mismatch");
  const binding = record(value.binding);
  if (binding.status !== "registered" && binding.status !== "unregistered")
    throw new LiveError("live-invalid-binding");
  if (record(value.claim).status !== "absent") throw new LiveError("live-window-has-claim");
  return {
    windowId: textField(value.windowId),
    role: textField(value.role),
    intentDigest: textField(intent.intentDigest),
    executionRoot: path.resolve(root, placement),
    bindingStatus: binding.status,
    bindingId: binding.status === "registered" ? textField(binding.bindingId) : null,
    instruction,
  };
}

export async function observeLiveWorkspace(root: string, candidate: string, signal?: AbortSignal) {
  assertCanonicalDirectory(root);
  assertCanonicalDirectory(candidate);
  const checked = verifyArtifactAgainstManifest(candidate);
  const artifactDigest = sha256(checked.manifestBytes);
  const configFile = path.join(root, "wakeflow.config.json");
  const configBytes = readBoundedFile(configFile);
  const config = record(JSON.parse(configBytes.toString("utf8")));
  const windows = record(config.topology).windows;
  if (!Array.isArray(windows) || windows.length === 0 || windows.length > 64)
    throw new LiveError("live-window-capacity");
  const ids = windows.map((w: unknown) => textField(record(w).windowId));
  if (new Set(ids).size !== ids.length || ids.some((id) => !WINDOW_ID.test(id)))
    throw new LiveError("live-invalid-window-list");
  const observations: LabToolObservation[] = [];
  const result = await withLabMcp(
    candidate,
    root,
    observations,
    async (call) => {
      const status = await call("wakeflow_status", { root });
      const runtime = record(status.runtime);
      if (runtime.artifactManifestDigest !== artifactDigest || runtime.artifactOnDisk !== "same")
        throw new LiveError("live-observer-artifact-mismatch");
      const configDigest = textField(record(status.config).configDigest);
      if (!DIGEST.test(configDigest)) throw new LiveError("live-invalid-config-digest");
      const inspected: LiveWindow[] = [];
      for (const windowId of ids)
        inspected.push(
          windowFromInspection(
            await call("wakeflow_register_window_binding", {
              root,
              operation: "inspect",
              windowId,
            }),
            root,
          ),
        );
      return {
        artifactDigest,
        configFileDigest: sha256(configBytes),
        configDigest,
        host: textField(checked.manifest.hostId),
        windows: inspected,
      };
    },
    signal,
  );
  if (
    sha256(readBoundedFile(configFile)) !== result.configFileDigest ||
    sha256(verifyArtifactAgainstManifest(candidate).manifestBytes) !== artifactDigest
  )
    throw new LiveError("live-input-changed");
  return result;
}

export function livePlanLocation(repository: string, id: string): string {
  if (!/^live-[a-f0-9]{64}$/u.test(id)) throw new LiveError("live-invalid-plan-id");
  const directory = path.join(repository, ".build/live", id);
  assertCanonicalDirectory(directory);
  return directory;
}

export function loadLivePlan(repository: string, id: string): LivePlan {
  const plan = parsePlan(readDocument(path.join(livePlanLocation(repository, id), "plan.json")));
  if (`live-${plan.planDigest.slice(7)}` !== id) throw new LiveError("live-plan-id-mismatch");
  return plan;
}

export async function planLiveProject(
  repository: string,
  root: string,
  candidate: string,
  projectsFile: string,
  hostId: string,
  signal?: AbortSignal,
) {
  assertCanonicalDirectory(repository);
  assertCanonicalDirectory(root);
  const project = projectFor(root, projectsFile, hostId);
  const observed = await observeLiveWorkspace(root, candidate, signal);
  const body = {
    kind: "WakeflowLivePlan" as const,
    schemaVersion: 1 as const,
    scenario: "project-bootstrap" as const,
    root,
    candidate,
    ...observed,
    project,
  };
  const planDigest = sha256(JSON.stringify(body));
  const plan: LivePlan = { ...body, planDigest };
  const id = `live-${planDigest.slice(7)}`;
  const directory = privateDirectory(repository, `.build/live/${id}`);
  const file = path.join(directory, "plan.json");
  if (existsSync(file)) {
    if (loadLivePlan(repository, id).planDigest !== planDigest)
      throw new LiveError("live-plan-digest-mismatch");
  } else writeReport(file, plan);
  const template = path.join(directory, "evidence-template.json");
  if (!existsSync(template))
    writeReport(template, {
      kind: "WakeflowLiveEvidence",
      schemaVersion: 1,
      planDigest,
      records: [],
    });
  return {
    kind: "WakeflowLivePlanResult",
    schemaVersion: 1,
    status: "passed" as const,
    id,
    plan: `.build/live/${id}/plan.json`,
    evidenceTemplate: `.build/live/${id}/evidence-template.json`,
    windows: plan.windows.length,
    alreadyBound: plan.windows.filter((w) => w.bindingStatus === "registered").length,
    observationSource: "generated-stdio",
    projectInventorySource: "imported-unverified",
    authorization: "not-granted-by-plan",
    hostEffectsPerformed: false,
    nativeHostAcceptance: "unverified",
  };
}
