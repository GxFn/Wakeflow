import type { WakeflowConfigAuthoritySnapshot } from "../../configuration/wakeflow-config-authority-snapshot.js";
import type { WakeflowConfigRootPlacementEntry } from "../../configuration/wakeflow-config-root-placement.js";
import {
  RootedDirectory,
  RootedDirectoryError,
} from "../../foundation/filesystem/rooted-directory.js";
import { listPodWorktreeReceiptsAnyHost } from "../../kernel/pod-worktree-receipts.js";
import type { ManagedEvidenceManagedPathSource } from "./managed-evidence-source-selection.js";

/**
 * Wakeflow Governance / Evidence：把Manifest中的逻辑source root解析为当前Config根。
 *
 * 该能力只接受Config已经准入的repository或support surface，要求placement为present，
 * 并证明打开后的物理根仍等于Config记录的real path；`pod-worktree` 根按配置里的 pod
 * worktree 意图与宿主回执里的检出路径打开（ADR-0010）。它不读取source成员、不判断
 * payload内容，也不持有Publication事务状态。
 */

export type ManagedEvidenceConfiguredSourceRootErrorReason =
  | "placement"
  | "root-scope";

const ERROR_MESSAGES = {
  placement: "Managed evidence source root has no current Config placement.",
  "root-scope": "Managed evidence source root differs from its Config placement.",
} as const satisfies Readonly<
  Record<ManagedEvidenceConfiguredSourceRootErrorReason, string>
>;

/** 逻辑source root无法闭合到当前Config物理根时的稳定错误。 */
export class ManagedEvidenceConfiguredSourceRootError extends Error {
  override readonly name = "ManagedEvidenceConfiguredSourceRootError";
  readonly code = "wakeflow-managed-evidence-configured-source-root" as const;
  readonly reason: ManagedEvidenceConfiguredSourceRootErrorReason;

  constructor(reason: ManagedEvidenceConfiguredSourceRootErrorReason) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
  }
}

function fail(reason: ManagedEvidenceConfiguredSourceRootErrorReason): never {
  throw new ManagedEvidenceConfiguredSourceRootError(reason);
}

type ConfiguredRoot = Exclude<
  ManagedEvidenceManagedPathSource["root"],
  { readonly kind: "pod-worktree" }
>;

function selectedRootKey(root: ConfiguredRoot): string {
  return root.kind === "repository"
    ? `repository.${root.repositoryId}.root`
    : `support.${root.surfaceId}.root`;
}

function sourcePlacement(
  config: Readonly<WakeflowConfigAuthoritySnapshot>,
  root: ConfiguredRoot,
): Readonly<WakeflowConfigRootPlacementEntry> {
  const entityExists =
    root.kind === "repository"
      ? config.indexes.repositoryById[root.repositoryId] !== undefined
      : config.indexes.surfaceById[root.surfaceId] !== undefined;
  if (!entityExists) fail("placement");
  const placement = config.placements.roots.find(
    (entry) => entry.key === selectedRootKey(root),
  );
  if (
    placement === undefined ||
    placement.state !== "present" ||
    placement.realPath === null
  ) {
    fail("placement");
  }
  return placement;
}

/** worktree 检出：pod 与仓库都在配置里，回执存在，且打开后的根等于回执路径。 */
async function openPodWorktreeRoot(
  workspaceRoot: RootedDirectory,
  config: Readonly<WakeflowConfigAuthoritySnapshot>,
  root: Extract<ManagedEvidenceManagedPathSource["root"], { readonly kind: "pod-worktree" }>,
): Promise<RootedDirectory> {
  const pod = config.indexes.podById[root.podId];
  if (pod === undefined || !pod.worktrees.some((entry) => entry.repositoryId === root.repositoryId)) {
    fail("placement");
  }
  const receipt = (await listPodWorktreeReceiptsAnyHost(workspaceRoot, root.podId)).find(
    (entry) => entry.repositoryId === root.repositoryId,
  );
  if (receipt === undefined) fail("placement");
  let opened: RootedDirectory | undefined;
  try {
    opened = await RootedDirectory.open(receipt.path, "$sourceRoot");
    if (opened.absolutePath !== receipt.path) fail("root-scope");
    return opened;
  } catch (error: unknown) {
    if (opened !== undefined) {
      try {
        await opened.close();
      } catch {
        // 首个根关系错误优先。
      }
    }
    if (error instanceof ManagedEvidenceConfiguredSourceRootError) throw error;
    if (error instanceof RootedDirectoryError) fail("root-scope");
    throw error;
  }
}

/** 打开并持有Manifest逻辑source对应的当前Config物理根。 */
export async function openConfiguredManagedEvidenceSourceRoot(
  workspaceRoot: RootedDirectory,
  config: Readonly<WakeflowConfigAuthoritySnapshot>,
  source: Readonly<ManagedEvidenceManagedPathSource>,
): Promise<RootedDirectory> {
  if (source.root.kind === "pod-worktree") {
    return openPodWorktreeRoot(workspaceRoot, config, source.root);
  }
  const placement = sourcePlacement(config, source.root);
  let root: RootedDirectory | undefined;
  try {
    root = await RootedDirectory.open(placement.absolutePath, "$sourceRoot");
    if (root.absolutePath !== placement.realPath) fail("root-scope");
    return root;
  } catch (error: unknown) {
    if (root !== undefined) {
      try {
        await root.close();
      } catch {
        // 首个placement或根关系错误优先。
      }
    }
    if (error instanceof ManagedEvidenceConfiguredSourceRootError) throw error;
    if (error instanceof RootedDirectoryError) fail("root-scope");
    throw error;
  }
}
