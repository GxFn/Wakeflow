import {
  computeCanonicalJsonSha256Digest,
} from "../crypto/canonical-json-sha256.js";
import {
  parseSha256Digest,
  Sha256Error,
  type Sha256Digest,
} from "../crypto/sha256.js";
import {
  parseDenseArray,
  parsePlainRecord,
  PassiveOwnDataError,
} from "../data/passive-own-data.js";
import {
  planDirectoryTreeCandidateFromFileDescriptors,
  parseDirectoryTreeCandidatePlan,
  DurableDirectoryTreeCandidateError,
  type DirectoryTreeCandidatePlan,
  type DirectoryTreeCandidatePlanFile,
} from "../filesystem/durable-directory-tree-candidate.js";
import {
  joinDirectoryTreeCandidatePath,
} from "../filesystem/directory-tree-candidate-plan.js";
import {
  parsePortableResourcePath,
  PortableResourcePathError,
  type PortableResourcePath,
} from "../filesystem/portable-resource-path.js";
import {
  LOADED_ARTIFACT_TREE_IDENTITY_LIMITS,
  validateLoadedArtifactTreeManifest,
  LoadedArtifactTreeIdentityError,
  type LoadedArtifactTreeManifest,
} from "./loaded-artifact-tree-identity.js";

/**
 * Wakeflow Foundation / Artifact：已加载制品清单到目标目录树候选的纯计划。
 *
 * 本模块严格重验 `LoadedArtifactTreeManifest`，把 executable bit 映射为调用方确认的
 * 最终文件 mode，并复用唯一 `DirectoryTreeCandidatePlan` 生成目录闭包、总量和 tree
 * digest。copy mapping 只绑定来源 ref 与目标根内候选 ref；它不打开来源、不创建目录、
 * 不复制字节、不发布目标，也不把 manifest digest 当成来源节点仍然稳定的证明。
 */

export const LOADED_ARTIFACT_TREE_TRANSFER_PLAN_KIND =
  "wakeflow-loaded-artifact-tree-transfer-plan" as const;
export const LOADED_ARTIFACT_TREE_TRANSFER_PLAN_SCHEMA_VERSION = 1 as const;

interface LoadedArtifactTreeTransferPlanOptions {
  readonly directoryMode: number;
  readonly executableFileMode: number;
  readonly regularFileMode: number;
}

interface LoadedArtifactTreeTransferCopy {
  readonly sourceResourcePath: PortableResourcePath;
  readonly candidateResourcePath: PortableResourcePath;
}

export interface LoadedArtifactTreeTransferPlan {
  readonly artifactKind: typeof LOADED_ARTIFACT_TREE_TRANSFER_PLAN_KIND;
  readonly schemaVersion:
    typeof LOADED_ARTIFACT_TREE_TRANSFER_PLAN_SCHEMA_VERSION;
  readonly artifactDigest: Sha256Digest;
  readonly candidateRootPath: PortableResourcePath;
  readonly manifest: Readonly<LoadedArtifactTreeManifest>;
  readonly directoryPlan: Readonly<DirectoryTreeCandidatePlan>;
  readonly copies: readonly Readonly<LoadedArtifactTreeTransferCopy>[];
  readonly planDigest: Sha256Digest;
}

export type LoadedArtifactTreeTransferPlanErrorReason =
  | "input"
  | "manifest"
  | "mode"
  | "capacity"
  | "plan";

const ERROR_MESSAGES = {
  input: "Loaded artifact tree transfer plan input is invalid.",
  manifest: "Loaded artifact tree transfer manifest is invalid.",
  mode: "Loaded artifact tree transfer modes do not preserve executable semantics.",
  capacity: "Loaded artifact tree transfer exceeds its admitted capacity.",
  plan: "Loaded artifact tree transfer could not form one closed candidate plan.",
} as const satisfies Readonly<Record<
  LoadedArtifactTreeTransferPlanErrorReason,
  string
>>;

/** Loaded Artifact Tree transfer 计划失败的稳定、脱敏错误。 */
export class LoadedArtifactTreeTransferPlanError extends Error {
  override readonly name = "LoadedArtifactTreeTransferPlanError";
  readonly code = "wakeflow-loaded-artifact-tree-transfer-plan" as const;
  readonly reason: LoadedArtifactTreeTransferPlanErrorReason;
  readonly path: string;

  constructor(reason: LoadedArtifactTreeTransferPlanErrorReason, path: string) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

interface ParsedModes {
  readonly directoryMode: number;
  readonly executableFileMode: number;
  readonly regularFileMode: number;
}

function fail(
  reason: LoadedArtifactTreeTransferPlanErrorReason,
  path: string,
): never {
  throw new LoadedArtifactTreeTransferPlanError(reason, path);
}

function parseMode(value: unknown, path: string): number {
  if (
    typeof value !== "number"
    || !Number.isInteger(value)
    || value < 0
    || value > 0o777
  ) {
    fail("input", path);
  }
  return value;
}

function parseModes(value: unknown): Readonly<ParsedModes> {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value, "$options");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", "$options");
    throw error;
  }
  const keys = Object.keys(record).sort();
  if (
    keys.length !== 3
    || keys[0] !== "directoryMode"
    || keys[1] !== "executableFileMode"
    || keys[2] !== "regularFileMode"
  ) {
    fail("input", "$options");
  }
  const modes = Object.freeze({
    directoryMode: parseMode(record.directoryMode, "$options.directoryMode"),
    executableFileMode: parseMode(
      record.executableFileMode,
      "$options.executableFileMode",
    ),
    regularFileMode: parseMode(
      record.regularFileMode,
      "$options.regularFileMode",
    ),
  });
  if (
    (modes.directoryMode & 0o700) !== 0o700
    || (modes.regularFileMode & 0o400) !== 0o400
    || (modes.executableFileMode & 0o500) !== 0o500
    || (modes.regularFileMode & 0o111) !== 0
  ) {
    fail("mode", "$options");
  }
  return modes;
}

function parseCandidateRootPath(value: unknown): PortableResourcePath {
  try {
    return parsePortableResourcePath(value, "$candidateRootPath");
  } catch (error: unknown) {
    if (error instanceof PortableResourcePathError) {
      fail("input", "$candidateRootPath");
    }
    throw error;
  }
}

function parseManifest(value: unknown): Readonly<LoadedArtifactTreeManifest> {
  try {
    return validateLoadedArtifactTreeManifest(value);
  } catch (error: unknown) {
    if (error instanceof LoadedArtifactTreeIdentityError) {
      if (
        error.reason === "entry-limit"
        || error.reason === "depth-limit"
        || error.reason === "file-count"
        || error.reason === "file-bytes"
        || error.reason === "total-bytes"
        || error.reason === "ref-bytes"
      ) {
        fail("capacity", "$manifest");
      }
      fail("manifest", "$manifest");
    }
    throw error;
  }
}

function planFiles(
  manifest: Readonly<LoadedArtifactTreeManifest>,
  modes: Readonly<ParsedModes>,
): readonly Readonly<DirectoryTreeCandidatePlanFile>[] {
  return Object.freeze(manifest.files.map((file) => Object.freeze({
    path: file.ref,
    byteCount: file.bytes,
    digest: file.digest,
    mode: file.executable
      ? modes.executableFileMode
      : modes.regularFileMode,
  })));
}

function createDirectoryPlan(
  files: readonly Readonly<DirectoryTreeCandidatePlanFile>[],
  modes: Readonly<ParsedModes>,
): Readonly<DirectoryTreeCandidatePlan> {
  try {
    return planDirectoryTreeCandidateFromFileDescriptors(files, {
      directoryMode: modes.directoryMode,
      maximumDepth: LOADED_ARTIFACT_TREE_IDENTITY_LIMITS.maxDepth,
      maximumEntries: LOADED_ARTIFACT_TREE_IDENTITY_LIMITS.maxEntries,
      maximumFileBytes: LOADED_ARTIFACT_TREE_IDENTITY_LIMITS.maxFileBytes,
      maximumFiles: LOADED_ARTIFACT_TREE_IDENTITY_LIMITS.maxFiles,
      maximumTotalBytes: LOADED_ARTIFACT_TREE_IDENTITY_LIMITS.maxTotalBytes,
    });
  } catch (error: unknown) {
    if (error instanceof DurableDirectoryTreeCandidateError) {
      if (error.reason === "capacity") fail("capacity", "$manifest");
      fail("plan", "$manifest");
    }
    throw error;
  }
}

function planDigestBasis(
  artifactDigest: Sha256Digest,
  candidateRootPath: PortableResourcePath,
  directoryPlan: Readonly<DirectoryTreeCandidatePlan>,
  copies: readonly Readonly<LoadedArtifactTreeTransferCopy>[],
) {
  return Object.freeze({
    artifactKind: LOADED_ARTIFACT_TREE_TRANSFER_PLAN_KIND,
    schemaVersion: LOADED_ARTIFACT_TREE_TRANSFER_PLAN_SCHEMA_VERSION,
    artifactDigest,
    candidateRootPath,
    directoryPlan,
    copies,
  });
}

function parseDigest(value: unknown, path: string): Sha256Digest {
  try {
    return parseSha256Digest(value, path);
  } catch (error: unknown) {
    if (error instanceof Sha256Error) fail("input", path);
    throw error;
  }
}

function parseDirectoryPlan(
  value: unknown,
): Readonly<DirectoryTreeCandidatePlan> {
  try {
    return parseDirectoryTreeCandidatePlan(value, {
      maximumDepth: LOADED_ARTIFACT_TREE_IDENTITY_LIMITS.maxDepth,
      maximumEntries: LOADED_ARTIFACT_TREE_IDENTITY_LIMITS.maxEntries,
      maximumFileBytes: LOADED_ARTIFACT_TREE_IDENTITY_LIMITS.maxFileBytes,
      maximumFiles: LOADED_ARTIFACT_TREE_IDENTITY_LIMITS.maxFiles,
      maximumTotalBytes: LOADED_ARTIFACT_TREE_IDENTITY_LIMITS.maxTotalBytes,
    });
  } catch (error: unknown) {
    if (error instanceof DurableDirectoryTreeCandidateError) {
      if (error.reason === "capacity") fail("capacity", "$plan.directoryPlan");
      fail("plan", "$plan.directoryPlan");
    }
    throw error;
  }
}

function parseCopyPath(value: unknown, path: string): PortableResourcePath {
  try {
    return parsePortableResourcePath(value, path);
  } catch (error: unknown) {
    if (error instanceof PortableResourcePathError) fail("plan", path);
    throw error;
  }
}

function parseCopies(
  value: unknown,
  maximumLength: number,
): readonly Readonly<LoadedArtifactTreeTransferCopy>[] {
  let values: readonly unknown[];
  try {
    values = parseDenseArray(value, maximumLength, "$plan.copies");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("plan", "$plan.copies");
    throw error;
  }
  return Object.freeze(values.map((entry, index) => {
    let record: Readonly<Record<string, unknown>>;
    try {
      record = parsePlainRecord(entry, `$plan.copies.${index}`);
    } catch (error: unknown) {
      if (error instanceof PassiveOwnDataError) {
        fail("plan", `$plan.copies.${index}`);
      }
      throw error;
    }
    const keys = Object.keys(record).sort();
    if (
      keys.length !== 2
      || keys[0] !== "candidateResourcePath"
      || keys[1] !== "sourceResourcePath"
    ) {
      fail("plan", `$plan.copies.${index}`);
    }
    return Object.freeze({
      sourceResourcePath: parseCopyPath(
        record.sourceResourcePath,
        `$plan.copies.${index}.sourceResourcePath`,
      ),
      candidateResourcePath: parseCopyPath(
        record.candidateResourcePath,
        `$plan.copies.${index}.candidateResourcePath`,
      ),
    });
  }));
}

/** 严格重验 transfer plan 的 manifest、目录计划、copy 映射和完整摘要。 */
export function parseLoadedArtifactTreeTransferPlan(
  value: unknown,
): Readonly<LoadedArtifactTreeTransferPlan> {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value, "$plan");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", "$plan");
    throw error;
  }
  const keys = Object.keys(record).sort();
  if (
    keys.length !== 8
    || keys[0] !== "artifactDigest"
    || keys[1] !== "artifactKind"
    || keys[2] !== "candidateRootPath"
    || keys[3] !== "copies"
    || keys[4] !== "directoryPlan"
    || keys[5] !== "manifest"
    || keys[6] !== "planDigest"
    || keys[7] !== "schemaVersion"
    || record.artifactKind !== LOADED_ARTIFACT_TREE_TRANSFER_PLAN_KIND
    || record.schemaVersion !== LOADED_ARTIFACT_TREE_TRANSFER_PLAN_SCHEMA_VERSION
  ) {
    fail("input", "$plan");
  }
  const manifest = parseManifest(record.manifest);
  const candidateRootPath = parseCandidateRootPath(record.candidateRootPath);
  const directoryPlan = parseDirectoryPlan(record.directoryPlan);
  const copies = parseCopies(record.copies, manifest.fileCount);
  const artifactDigest = parseDigest(
    record.artifactDigest,
    "$plan.artifactDigest",
  );
  const planDigest = parseDigest(record.planDigest, "$plan.planDigest");
  if (
    copies.length !== manifest.files.length
    || directoryPlan.files.length !== manifest.files.length
    || directoryPlan.totalBytes !== manifest.totalBytes
    || artifactDigest !== computeCanonicalJsonSha256Digest(
      manifest,
      "$plan.manifest",
    )
  ) {
    fail("plan", "$plan");
  }
  for (const [index, manifestFile] of manifest.files.entries()) {
    const plannedFile = directoryPlan.files[index];
    const copy = copies[index];
    if (
      plannedFile === undefined
      || copy === undefined
      || plannedFile.path !== manifestFile.ref
      || plannedFile.byteCount !== manifestFile.bytes
      || plannedFile.digest !== manifestFile.digest
      || (
        manifestFile.executable
          ? (plannedFile.mode & 0o500) !== 0o500
          : (
            (plannedFile.mode & 0o400) !== 0o400
            || (plannedFile.mode & 0o111) !== 0
          )
      )
      || copy.sourceResourcePath !== manifestFile.ref
      || copy.candidateResourcePath !== joinDirectoryTreeCandidatePath(
        candidateRootPath,
        manifestFile.ref,
      )
    ) {
      fail("plan", `$plan.copies.${index}`);
    }
  }
  const basis = planDigestBasis(
    artifactDigest,
    candidateRootPath,
    directoryPlan,
    copies,
  );
  if (planDigest !== computeCanonicalJsonSha256Digest(basis, "$plan")) {
    fail("plan", "$plan.planDigest");
  }
  return Object.freeze({
    ...basis,
    manifest,
    planDigest,
  });
}

/**
 * 把一份严格 Loaded Artifact Tree manifest 编译为确定性目标 candidate 计划。
 */
export function planLoadedArtifactTreeTransfer(
  manifestValue: LoadedArtifactTreeManifest,
  candidateRootPathValue: PortableResourcePath,
  optionsValue: LoadedArtifactTreeTransferPlanOptions,
): Readonly<LoadedArtifactTreeTransferPlan> {
  const manifest = parseManifest(manifestValue);
  const candidateRootPath = parseCandidateRootPath(candidateRootPathValue);
  const modes = parseModes(optionsValue);
  const files = planFiles(manifest, modes);
  const directoryPlan = createDirectoryPlan(files, modes);
  const copies = Object.freeze(manifest.files.map((file) => Object.freeze({
    sourceResourcePath: file.ref,
    candidateResourcePath: joinDirectoryTreeCandidatePath(
      candidateRootPath,
      file.ref,
    ),
  })));
  const artifactDigest = computeCanonicalJsonSha256Digest(
    manifest,
    "$manifest",
  );
  const basis = planDigestBasis(
    artifactDigest,
    candidateRootPath,
    directoryPlan,
    copies,
  );
  return parseLoadedArtifactTreeTransferPlan({
    ...basis,
    manifest,
    planDigest: computeCanonicalJsonSha256Digest(basis, "$plan"),
  });
}
