import { randomUUID } from "node:crypto";
import {
  closeSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { verifyArtifactAgainstManifest } from "../artifacts/check-plugin-artifacts.js";
import {
  isRecord,
  privateDirectory,
  readBoundedFile,
  safeErrorCode,
  sha256,
  writeReport,
} from "../verification/files.js";
import {
  assertCanonicalDirectory,
  assertSameInventory,
  inventoryDigest,
  LabError,
  labGit,
  parseInventory,
  removeInventoriedTree,
  snapshotLabTree,
  type TreeEntry,
} from "./inventory.js";
import { type LabToolObservation, withLabMcp } from "./mcp-session.js";
import { initializeLab, runReadinessScenario } from "./scenarios.js";
import { runWorkflowScenario } from "./workflow.js";
import { BUSINESS_SCENARIOS, type BusinessScenario } from "./workflow-context.js";

const MARKER = ".wakeflow-lab.json";
const CLASSIFICATION = {
  environment: "synthetic",
  transport: "generated-stdio",
  durability: "fsync",
  nativeHostAcceptance: "unverified",
} as const;
const RUNNER_MODULES = [
  "lab",
  "inventory",
  "mcp-session",
  "scenarios",
  "synthetic-host",
  "workflow-context",
  "workflow-demand",
  "workflow-target",
  "workflow-test",
  "workflow-pod",
  "workflow",
] as const;

let runnerIdentity: Readonly<{
  readonly node: string;
  readonly platform: string;
  readonly modules: Readonly<Record<string, string>>;
}> | null = null;

/** Hashed on first use by a lab command, not at import: a missing or hard-linked compiled module must not take every other CLI command down. */
function runner() {
  runnerIdentity ??= Object.freeze({
    node: process.versions.node,
    platform: process.platform,
    modules: Object.freeze(
      Object.fromEntries(
        RUNNER_MODULES.map((name) => [
          name,
          sha256(readBoundedFile(fileURLToPath(new URL(`./${name}.js`, import.meta.url)))),
        ]),
      ),
    ),
  });
  return runnerIdentity;
}

interface LabResources {
  readonly id: string;
  readonly root: string;
  readonly preset: "single-product" | "dual-product";
  readonly artifact: {
    readonly manifestDigest: string;
    readonly hostId: string;
    readonly version: string;
  };
  readonly inventory: readonly TreeEntry[];
  readonly configDigest: string;
}

function reportDirectory(repository: string, id: string): string {
  if (!/^lab-[a-f0-9-]{36}$/u.test(id)) throw new LabError("lab-invalid-id");
  assertCanonicalDirectory(repository);
  const directory = path.join(repository, ".build/labs", id);
  assertCanonicalDirectory(directory);
  return directory;
}

function artifactIdentity(root: string) {
  const artifact = verifyArtifactAgainstManifest(root);
  const { hostId, version } = artifact.manifest;
  if ((hostId !== "codex" && hostId !== "claude-code") || typeof version !== "string")
    throw new LabError("lab-artifact-identity-unavailable");
  return { hostId, version, manifestDigest: sha256(artifact.manifestBytes) };
}

function assertOutsideRepository(repository: string, root: string): void {
  const relative = path.relative(repository, root);
  if (
    !relative.startsWith(`..${path.sep}`) ||
    root === path.parse(root).root ||
    root === realpathSync(os.homedir())
  )
    throw new LabError("lab-root-not-disposable");
}

function loadLab(repository: string, id: string): { directory: string; resources: LabResources } {
  const directory = reportDirectory(repository, id);
  const value: unknown = JSON.parse(
    readBoundedFile(path.join(directory, "resources.json")).toString("utf8"),
  );
  if (
    !isRecord(value) ||
    value.kind !== "WakeflowLabResources" ||
    value.schemaVersion !== 1 ||
    value.id !== id ||
    typeof value.root !== "string" ||
    (value.preset !== "single-product" && value.preset !== "dual-product") ||
    !isRecord(value.artifact) ||
    typeof value.artifact.hostId !== "string" ||
    typeof value.artifact.version !== "string" ||
    typeof value.artifact.manifestDigest !== "string" ||
    typeof value.configDigest !== "string"
  )
    throw new LabError("lab-invalid-resources");
  assertOutsideRepository(repository, value.root);
  if (existsSync(path.join(directory, "disposed.json"))) throw new LabError("lab-already-disposed");
  const inventory = parseInventory(value.inventory);
  const creation: unknown = JSON.parse(
    readBoundedFile(path.join(directory, "creation.json")).toString("utf8"),
  );
  // The resource file is written before the final receipt. A interrupted/failed receipt
  // publication must not make that intermediate inventory usable for destructive cleanup.
  if (
    !isRecord(creation) ||
    creation.kind !== "WakeflowLabCreation" ||
    creation.schemaVersion !== 1 ||
    creation.status !== "passed" ||
    creation.id !== id ||
    creation.root !== value.root ||
    creation.preset !== value.preset ||
    !isRecord(creation.artifact) ||
    creation.artifact.manifestDigest !== value.artifact.manifestDigest ||
    creation.inventoryDigest !== inventoryDigest(inventory)
  )
    throw new LabError("lab-creation-not-completed");
  return {
    directory,
    resources: {
      id,
      root: value.root,
      preset: value.preset,
      artifact: {
        hostId: value.artifact.hostId,
        version: value.artifact.version,
        manifestDigest: value.artifact.manifestDigest,
      },
      configDigest: value.configDigest,
      inventory,
    },
  };
}

function assertOwned(resources: LabResources): void {
  assertSameInventory(resources.inventory, snapshotLabTree(resources.root));
  const marker: unknown = JSON.parse(
    readBoundedFile(path.join(resources.root, MARKER), 1024).toString("utf8"),
  );
  if (!isRecord(marker) || marker.id !== resources.id || marker.kind !== "WakeflowDisposableLab")
    throw new LabError("lab-owner-mismatch");
}

/**
 * One lab command at a time. A lock left by an interrupted command is reported with its own
 * code and never taken over: after confirming no lab command still runs, the maintainer removes
 * `operation.lock` by hand. A lock whose owner changed while a successful action ran is recorded
 * beside the lab instead of overriding that action's result.
 */
async function exclusively<T>(directory: string, action: () => Promise<T>): Promise<T> {
  const lock = path.join(directory, "operation.lock");
  let fd: number;
  try {
    fd = openSync(lock, "wx", 0o600);
  } catch (error: unknown) {
    if (safeErrorCode(error) === "EEXIST")
      throw new LabError("lab-operation-in-progress-or-interrupted");
    throw error;
  }
  const identity = lstatSync(lock);
  const release = () => {
    closeSync(fd);
    const current = lstatSync(lock, { throwIfNoEntry: false });
    if (current?.dev !== identity.dev || current.ino !== identity.ino)
      throw new LabError("lab-lock-owner-changed");
    unlinkSync(lock);
  };
  let result: T;
  try {
    result = await action();
  } catch (error: unknown) {
    if (error instanceof LabError && error.code === "lab-mcp-shutdown-unverified") closeSync(fd);
    else {
      try {
        release();
      } catch {
        // The action's own failure is the result; a release anomaly must not replace it.
      }
    }
    throw error;
  }
  try {
    release();
  } catch (error: unknown) {
    writeReport(path.join(directory, `lock-anomaly-${randomUUID()}.json`), {
      kind: "WakeflowLabLockAnomaly",
      schemaVersion: 1,
      code: error instanceof LabError ? error.code : safeErrorCode(error),
      recordedAt: new Date().toISOString(),
    });
  }
  return result;
}

function gitFacts(root: string, preset: "single-product" | "dual-product") {
  return ["Workspace", "Alpha", ...(preset === "dual-product" ? ["Beta"] : [])].map((name) => {
    const cwd = path.join(root, name);
    return {
      name,
      head: labGit(cwd, ["rev-parse", "HEAD"]),
      branches: labGit(cwd, ["for-each-ref", "--format=%(refname):%(objectname)"]),
      status: labGit(cwd, ["status", "--porcelain=v1", "--untracked-files=all"]),
      worktrees: labGit(cwd, ["worktree", "list", "--porcelain"]),
    };
  });
}

function receiptSummary(
  id: string,
  action: string,
  file: string,
  status: "passed" | "failed" | "unavailable" | "interrupted",
  reason: string | null,
) {
  return {
    kind: "WakeflowLabResult",
    schemaVersion: 1,
    id,
    action,
    status,
    reason,
    classification: CLASSIFICATION,
    receipt: `.build/labs/${id}/${file}`,
    exitCode:
      status === "passed" ? 0 : status === "failed" ? 1 : status === "interrupted" ? 130 : 2,
  };
}

function outcome(error: unknown, signal?: AbortSignal): "failed" | "unavailable" | "interrupted" {
  return signal?.aborted ? "interrupted" : error instanceof LabError ? "failed" : "unavailable";
}

/** An explicit NEW root is authorization to create disposable files, never to create host projects/chats. */
export async function createLab(
  repository: string,
  root: string,
  candidate: string,
  signal?: AbortSignal,
  scenario?: BusinessScenario,
) {
  if (scenario !== undefined && !BUSINESS_SCENARIOS.includes(scenario))
    throw new LabError("lab-scenario-unsupported");
  const preset = scenario === "single-product" ? "single-product" : "dual-product";
  const products = preset === "single-product" ? ["Alpha"] : ["Alpha", "Beta"];
  signal?.throwIfAborted();
  assertCanonicalDirectory(repository);
  assertCanonicalDirectory(path.dirname(root));
  assertOutsideRepository(repository, root);
  if (existsSync(root) || lstatSync(root, { throwIfNoEntry: false }) !== undefined)
    throw new LabError("lab-root-already-exists");
  // A new child of an existing product repository is not a disposable lab location.
  let ancestor = path.dirname(root);
  while (ancestor !== path.parse(ancestor).root) {
    if (lstatSync(path.join(ancestor, ".git"), { throwIfNoEntry: false }) !== undefined)
      throw new LabError("lab-root-inside-git");
    ancestor = path.dirname(ancestor);
  }
  assertCanonicalDirectory(candidate);
  const artifact = artifactIdentity(candidate);
  const id = `lab-${randomUUID()}`;
  const directory = privateDirectory(repository, `.build/labs/${id}`);
  const observations: LabToolObservation[] = [];
  const base = {
    kind: "WakeflowLabCreation",
    schemaVersion: 1,
    id,
    preset,
    scenario: scenario ?? null,
    root,
    artifact,
    classification: CLASSIFICATION,
    runner: runner(),
    startedAt: new Date().toISOString(),
    observations,
  };
  writeReport(path.join(directory, "creation.json"), { ...base, status: "running" });
  return exclusively(directory, async () => {
    try {
      mkdirSync(root, { mode: 0o700 });
      writeFileSync(
        path.join(root, MARKER),
        JSON.stringify({ kind: "WakeflowDisposableLab", id }),
        { flag: "wx", mode: 0o600 },
      );
      cpSync(candidate, path.join(root, "Artifact"), {
        recursive: true,
        force: false,
        errorOnExist: true,
      });
      if (artifactIdentity(path.join(root, "Artifact")).manifestDigest !== artifact.manifestDigest)
        throw new LabError("lab-artifact-copy-drift");
      for (const name of ["Workspace", ...products]) {
        signal?.throwIfAborted();
        const cwd = path.join(root, name);
        mkdirSync(cwd, { mode: 0o700 });
        labGit(cwd, ["init", "--quiet", "--initial-branch=main", "--template="]);
        writeFileSync(
          path.join(cwd, "README.md"),
          `# Synthetic ${name}\n\nDisposable Wakeflow lab fixture; no product or user data.\n`,
          { flag: "wx", mode: 0o600 },
        );
        labGit(cwd, ["add", "README.md"]);
        labGit(cwd, [
          "-c",
          "user.name=Wakeflow Lab",
          "-c",
          "user.email=lab@example.invalid",
          "commit",
          "--quiet",
          "-m",
          "Create synthetic fixture",
        ]);
      }
      const business = await withLabMcp(
        path.join(root, "Artifact"),
        root,
        observations,
        async (call) => {
          await initializeLab(root, call, products);
          return scenario === undefined
            ? null
            : runWorkflowScenario(
                root,
                artifact.manifestDigest,
                artifact.hostId,
                scenario,
                call,
                signal,
              );
        },
        signal,
      );
      // No old inventory is refreshed. Only successful, newly allocated experiments are
      // sealed, after the MCP process has demonstrably exited. Failed runs stay unowned.
      if (artifactIdentity(path.join(root, "Artifact")).manifestDigest !== artifact.manifestDigest)
        throw new LabError("lab-artifact-copy-drift");
      const configDigest = sha256(
        readBoundedFile(path.join(root, "Workspace/wakeflow.config.json")),
      );
      const git = gitFacts(root, preset);
      const inventory = snapshotLabTree(root);
      writeReport(path.join(directory, "resources.json"), {
        kind: "WakeflowLabResources",
        schemaVersion: 1,
        id,
        root,
        preset,
        artifact,
        configDigest,
        git,
        inventory,
      });
      writeReport(path.join(directory, "creation.json"), {
        ...base,
        status: "passed",
        finishedAt: new Date().toISOString(),
        inventoryDigest: inventoryDigest(inventory),
        business,
      });
      return receiptSummary(
        id,
        scenario === undefined ? "create" : "run",
        "creation.json",
        "passed",
        null,
      );
    } catch (error: unknown) {
      const status = outcome(error, signal);
      const reason = safeErrorCode(error);
      writeReport(path.join(directory, "creation.json"), {
        ...base,
        status,
        reason,
        finishedAt: new Date().toISOString(),
        cleanup: "retained-for-manual-inspection",
      });
      if (reason === "lab-mcp-shutdown-unverified") throw error;
      return receiptSummary(
        id,
        scenario === undefined ? "create" : "run",
        "creation.json",
        status,
        reason,
      );
    }
  });
}

export function inspectLab(repository: string, id: string) {
  const { directory, resources } = loadLab(repository, id);
  try {
    if (existsSync(path.join(directory, "operation.lock")))
      throw new LabError("lab-operation-in-progress-or-interrupted");
    assertOwned(resources);
    const git = gitFacts(resources.root, resources.preset);
    assertOwned(resources);
    return {
      kind: "WakeflowLabInspection",
      schemaVersion: 1,
      id,
      status: "passed" as const,
      preset: resources.preset,
      artifact: resources.artifact,
      classification: CLASSIFICATION,
      inventoryDigest: inventoryDigest(resources.inventory),
      configDigest: resources.configDigest,
      repositories: git.map(({ name, head }) => ({ name, head })),
      changesApplied: false,
    };
  } catch (error: unknown) {
    return {
      kind: "WakeflowLabInspection",
      schemaVersion: 1,
      id,
      status: "unavailable" as const,
      reason: safeErrorCode(error),
      changesApplied: false,
    };
  }
}

export async function runLab(repository: string, id: string, signal?: AbortSignal) {
  const { directory, resources } = loadLab(repository, id);
  return exclusively(directory, async () => {
    const file = `readiness-${randomUUID()}.json`;
    const observations: LabToolObservation[] = [];
    const base = {
      kind: "WakeflowLabScenario",
      schemaVersion: 1,
      id,
      scenario: "readiness",
      classification: CLASSIFICATION,
      runner: runner(),
      artifact: resources.artifact,
      startedAt: new Date().toISOString(),
      observations,
    };
    writeReport(path.join(directory, file), { ...base, status: "running" });
    try {
      assertOwned(resources);
      const acts = await withLabMcp(
        path.join(resources.root, "Artifact"),
        resources.root,
        observations,
        (call) => runReadinessScenario(resources.root, resources.artifact.manifestDigest, call),
        signal,
      );
      assertOwned(resources);
      writeReport(path.join(directory, file), {
        ...base,
        status: "passed",
        acts,
        finishedAt: new Date().toISOString(),
      });
      return receiptSummary(id, "run", file, "passed", null);
    } catch (error: unknown) {
      const status = outcome(error, signal);
      const reason = safeErrorCode(error);
      writeReport(path.join(directory, file), {
        ...base,
        status,
        reason,
        finishedAt: new Date().toISOString(),
        cleanup: "retained",
      });
      if (reason === "lab-mcp-shutdown-unverified") throw error;
      return receiptSummary(id, "run", file, status, reason);
    }
  });
}

/** Preview digest binds the exact private ownership record and current resource inventory. */
export async function disposeLab(repository: string, id: string, planDigest?: string) {
  const { directory, resources } = loadLab(repository, id);
  return exclusively(directory, async () => {
    assertOwned(resources);
    const digest = sha256(readFileSync(path.join(directory, "resources.json")));
    if (planDigest === undefined)
      return {
        kind: "WakeflowLabDisposalPreview",
        schemaVersion: 1,
        id,
        status: "passed" as const,
        planDigest: digest,
        entries: resources.inventory.length,
        changesApplied: false,
        evidenceRetained: true,
      };
    if (planDigest !== digest) throw new LabError("lab-disposal-plan-stale");
    writeReport(path.join(directory, "disposal.json"), {
      kind: "WakeflowLabDisposal",
      schemaVersion: 1,
      id,
      status: "running",
      planDigest,
    });
    try {
      removeInventoriedTree(resources.root, resources.inventory);
      writeReport(path.join(directory, "disposed.json"), {
        kind: "WakeflowLabDisposal",
        schemaVersion: 1,
        id,
        status: "passed",
        planDigest,
        finishedAt: new Date().toISOString(),
        evidenceRetained: true,
      });
      writeReport(path.join(directory, "disposal.json"), {
        kind: "WakeflowLabDisposal",
        schemaVersion: 1,
        id,
        status: "passed",
        planDigest,
      });
      return receiptSummary(id, "dispose", "disposed.json", "passed", null);
    } catch (error: unknown) {
      writeReport(path.join(directory, "disposal.json"), {
        kind: "WakeflowLabDisposal",
        schemaVersion: 1,
        id,
        status: "unavailable",
        reason: safeErrorCode(error),
        planDigest,
        cleanup: "partial-disposal-requires-inspection",
      });
      return receiptSummary(id, "dispose", "disposal.json", "unavailable", safeErrorCode(error));
    }
  });
}
