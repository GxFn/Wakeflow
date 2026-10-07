import { spawnSync } from "node:child_process";
import { devNull } from "node:os";
import path from "node:path";
import { assertCanonicalDirectory } from "../lab/inventory.js";
import { sha256 } from "../verification/files.js";
import {
  array,
  canonicalDigest,
  object,
  readObservedFile,
  relativeFile,
  requireCapture,
  textValue,
  within,
} from "./io.js";

/** No hooks, credential prompts, optional index refresh or inherited Git routing overrides. */
function git(cwd: string, args: readonly string[]): Buffer {
  const result = spawnSync(
    "git",
    ["-c", `core.hooksPath=${devNull}`, "-c", "core.fsmonitor=false", ...args],
    {
      cwd,
      shell: false,
      timeout: 15_000,
      maxBuffer: 16 * 1024 * 1024,
      env: {
        PATH: process.env.PATH ?? "",
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: devNull,
        GIT_OPTIONAL_LOCKS: "0",
        GIT_TERMINAL_PROMPT: "0",
        ...(process.env.SystemRoot === undefined ? {} : { SystemRoot: process.env.SystemRoot }),
      },
    },
  );
  requireCapture(result.error === undefined && result.status === 0, "capture-git-unavailable");
  return result.stdout;
}

function gitText(cwd: string, args: readonly string[]) {
  return git(cwd, args).toString("utf8").trim();
}

export interface ProductInput {
  readonly repositoryId: string;
  readonly checkout: string;
  readonly repositoryRoot: string;
  readonly placement: "primary" | "worktree";
  readonly commit: string;
  readonly branch: string | null;
  readonly files: readonly string[];
}

export function observeProduct(input: ProductInput) {
  assertCanonicalDirectory(input.checkout);
  assertCanonicalDirectory(input.repositoryRoot);
  requireCapture(
    gitText(input.repositoryRoot, ["rev-parse", "--show-toplevel"]) === input.repositoryRoot,
    "capture-not-repository-root",
  );
  requireCapture(
    gitText(input.checkout, ["rev-parse", "--show-toplevel"]) === input.checkout,
    "capture-not-checkout-root",
  );
  const commonDir = path.resolve(
    input.checkout,
    gitText(input.checkout, ["rev-parse", "--git-common-dir"]),
  );
  const primaryCommon = path.resolve(
    input.repositoryRoot,
    gitText(input.repositoryRoot, ["rev-parse", "--git-common-dir"]),
  );
  const gitDir = path.resolve(input.checkout, gitText(input.checkout, ["rev-parse", "--git-dir"]));
  assertCanonicalDirectory(commonDir);
  requireCapture(commonDir === primaryCommon, "capture-foreign-repository");
  requireCapture(
    input.placement === "primary"
      ? input.checkout === input.repositoryRoot
      : input.checkout !== input.repositoryRoot && gitDir !== commonDir,
    "capture-wrong-placement",
  );
  const head = gitText(input.checkout, ["rev-parse", "HEAD"]);
  const ref = gitText(input.checkout, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const branch = ref === "HEAD" ? null : ref;
  const dirty = git(input.checkout, ["status", "--porcelain=v1", "--untracked-files=all"]);
  requireCapture(
    head === input.commit && branch === input.branch && dirty.length === 0,
    "capture-baseline-drift",
  );
  const files = input.files.map((file) => {
    relativeFile(file);
    git(input.checkout, ["ls-files", "--error-unmatch", "--", file]);
    const observed = readObservedFile(path.join(input.checkout, file));
    const committed = git(input.repositoryRoot, ["show", `${input.commit}:${file}`]);
    requireCapture(observed.bytes.equals(committed), "capture-blob-drift");
    return { path: file, ...observed.observation, commitBlobDigest: sha256(committed) };
  });
  return {
    repositoryId: input.repositoryId,
    checkout: input.checkout,
    commonDir,
    gitDir,
    head,
    branch,
    dirty: false,
    files,
  };
}

export function executionContext(
  config: Record<string, unknown>,
  pkg: Record<string, unknown>,
  workspace: string,
) {
  requireCapture(object(config.program).programId === pkg.programId, "capture-workspace-mismatch");
  const topology = object(config.topology);
  const windows = array(topology.windows).map(object);
  const window = windows.find((entry) => entry.windowId === object(pkg.assignment).windowId);
  requireCapture(window?.role === "test", "capture-test-window-required");
  const root = object(window.root);
  const surface = array(topology.supportSurfaces)
    .map(object)
    .find((entry) => entry.surfaceId === root.surfaceId);
  requireCapture(
    root.kind === "support-surface" && surface?.capability === "test",
    "capture-test-surface-required",
  );
  const executionRoot = path.resolve(workspace, textValue(surface.path));
  assertCanonicalDirectory(executionRoot);
  const pod = array(config.pods)
    .map(object)
    .find((entry) => entry.podId === window.podId);
  requireCapture(
    pod?.lifecycle === "open" && ["primary", "worktree"].includes(String(pod.placement)),
    "capture-open-pod-required",
  );
  return {
    executionRoot,
    podId: textValue(window.podId),
    placement: pod.placement as "primary" | "worktree",
    windows,
    repositories: array(topology.repositories).map(object),
  };
}

export function productLocation(
  context: ReturnType<typeof executionContext>,
  workspace: string,
  baseline: Record<string, unknown>,
  checkout: string,
) {
  const repository = context.repositories.find(
    (entry) => entry.repositoryId === baseline.repositoryId,
  );
  const window = context.windows.find((entry) => entry.windowId === baseline.windowId);
  requireCapture(
    repository !== undefined &&
      window?.podId === context.podId &&
      window.role === "product" &&
      object(window.root).repositoryId === baseline.repositoryId,
    "capture-baseline-topology",
  );
  const repositoryRoot = path.resolve(workspace, textValue(repository.path));
  requireCapture(
    !within(checkout, context.executionRoot) &&
      !within(context.executionRoot, checkout) &&
      !within(repositoryRoot, context.executionRoot),
    "capture-overlapping-test-root",
  );
  return { repositoryRoot, placement: context.placement };
}

export function observationsEqual(left: unknown, right: unknown): boolean {
  return canonicalDigest(left) === canonicalDigest(right);
}
