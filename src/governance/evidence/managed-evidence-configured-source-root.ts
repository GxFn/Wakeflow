import type { WakeflowConfigAuthoritySnapshot } from "../../configuration/wakeflow-config-authority-snapshot.js";
import type { WakeflowConfigRootPlacementEntry } from "../../configuration/wakeflow-config-root-placement.js";
import {
  RootedDirectory,
  RootedDirectoryError,
} from "../../foundation/filesystem/rooted-directory.js";
import type { ManagedEvidenceSource } from "./managed-evidence-source-selection.js";

/**
 * Wakeflow Governance / Evidence：把Manifest中的逻辑source root解析为当前Config根。
 *
 * 该能力只接受Config已经准入的repository或support surface，要求placement为present，
 * 并证明打开后的物理根仍等于Config记录的real path。它不读取source成员、不判断
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

function selectedRootKey(source: Readonly<ManagedEvidenceSource>): string {
  return source.root.kind === "repository"
    ? `repository.${source.root.repositoryId}.root`
    : `support.${source.root.surfaceId}.root`;
}

function sourcePlacement(
  config: Readonly<WakeflowConfigAuthoritySnapshot>,
  source: Readonly<ManagedEvidenceSource>,
): Readonly<WakeflowConfigRootPlacementEntry> {
  const entityExists =
    source.root.kind === "repository"
      ? config.indexes.repositoryById[source.root.repositoryId] !== undefined
      : config.indexes.surfaceById[source.root.surfaceId] !== undefined;
  if (!entityExists) fail("placement");
  const placement = config.placements.roots.find(
    (entry) => entry.key === selectedRootKey(source),
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

/** 打开并持有Manifest逻辑source对应的当前Config物理根。 */
export async function openConfiguredManagedEvidenceSourceRoot(
  config: Readonly<WakeflowConfigAuthoritySnapshot>,
  source: Readonly<ManagedEvidenceSource>,
): Promise<RootedDirectory> {
  const placement = sourcePlacement(config, source);
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
