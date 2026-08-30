import {
  readWakeflowConfigAuthoritySnapshot,
  WakeflowConfigAuthoritySnapshotError,
  type WakeflowConfigAuthoritySnapshot,
} from "../../configuration/wakeflow-config-authority-snapshot.js";
import type {
  WakeflowDurableId,
} from "../../contracts/identity/wakeflow-durable-id.js";
import { canonicalizeJson } from "../../foundation/data/canonical-json.js";
import {
  sameFileNodeIdentity,
  sameFileNodeSnapshot,
} from "../../foundation/filesystem/file-node-snapshot.js";
import type { PortableResourcePath } from "../../foundation/filesystem/portable-resource-path.js";
import {
  RootedDirectory,
  RootedDirectoryError,
} from "../../foundation/filesystem/rooted-directory.js";
import {
  loadDemandEventSourcingRootAuthority,
  DemandEventSourcingRootAuthorityError,
  type LoadedDemandEventSourcingRootAuthority,
} from "../demand/event-sourcing/demand-event-sourcing-root-authority.js";
import {
  DEMAND_FILE_EVENT_STORE_DIRECTORY_MODE,
} from "../demand/event-sourcing/demand-file-event-store-contract.js";
import { demandFinalRootRef } from "../demand/publication/demand-publication-paths.js";
import {
  LedgerAuthorityStore,
  LedgerAuthorityStoreError,
  type LedgerAuthorityMemberReference,
} from "../ledger/ledger-authority-store.js";
import type { TaskPackage } from "./task-package.js";

/** Target Task Planning 对 Config、Demand、Ledger 与物理根的组合权威准入。 */

export interface TargetTaskPlanningAuthorityContext {
  readonly config: Readonly<WakeflowConfigAuthoritySnapshot>;
  readonly demandRoot: RootedDirectory;
  readonly ledgerRoot: RootedDirectory;
  readonly loaded: Readonly<LoadedDemandEventSourcingRootAuthority>;
}

export type TargetTaskPlanningAuthorityErrorReason =
  | "root"
  | "config"
  | "demand-authority"
  | "topology"
  | "reference"
  | "plan"
  | "aborted";

const ERROR_MESSAGES = {
  root: "Target Task Planning root could not be held safely.",
  config: "Target Task Planning Config authority is invalid.",
  "demand-authority": "Target Task Planning Demand authority is invalid.",
  topology: "Target Task Planning assignment is not in current Config topology.",
  reference: "Target Task Planning selected authority references are invalid.",
  plan: "Target Task Planning authority no longer matches the plan.",
  aborted: "Target Task Planning authority loading was aborted.",
} as const satisfies Readonly<Record<
  TargetTaskPlanningAuthorityErrorReason,
  string
>>;

export class TargetTaskPlanningAuthorityError extends Error {
  override readonly name = "TargetTaskPlanningAuthorityError";
  readonly code = "wakeflow-target-task-planning-authority" as const;
  readonly reason: TargetTaskPlanningAuthorityErrorReason;
  readonly causeCode: string | null;
  readonly causeReason: string | null;

  constructor(
    reason: TargetTaskPlanningAuthorityErrorReason,
    causeCode: string | null = null,
    causeReason: string | null = null,
  ) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.causeCode = causeCode;
    this.causeReason = causeReason;
  }
}

function ownString(value: unknown, key: string): string | null {
  if (typeof value !== "object" || value === null) return null;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor !== undefined
    && Object.hasOwn(descriptor, "value")
    && typeof descriptor.value === "string"
    ? descriptor.value
    : null;
}

function fail(
  reason: TargetTaskPlanningAuthorityErrorReason,
  cause?: unknown,
): never {
  throw new TargetTaskPlanningAuthorityError(
    reason,
    ownString(cause, "code"),
    ownString(cause, "reason"),
  );
}

function currentUserId(): bigint | null {
  return typeof process.geteuid === "function"
    ? BigInt(process.geteuid())
    : null;
}

export async function openTargetTaskPlanningDemandRoot(
  workspaceRoot: RootedDirectory,
  demandId: WakeflowDurableId<"demand">,
): Promise<RootedDirectory> {
  let observation;
  try {
    observation = await workspaceRoot.inspectExistingResource(
      demandFinalRootRef(demandId),
      "$demandRoot",
    );
  } catch (error: unknown) {
    if (error instanceof RootedDirectoryError) fail("root", error);
    throw error;
  }
  if (
    observation.node.kind !== "directory"
    || observation.node.permissionBits !== DEMAND_FILE_EVENT_STORE_DIRECTORY_MODE
    || (currentUserId() !== null && observation.node.userId !== currentUserId())
  ) {
    fail("root");
  }
  let demandRoot: RootedDirectory | undefined;
  try {
    demandRoot = await RootedDirectory.open(
      observation.physicalPath,
      "$demandRoot",
    );
    const current = await demandRoot.assertCurrent("$demandRoot");
    if (!sameFileNodeIdentity(observation.node, current)) fail("root");
    return demandRoot;
  } catch (error: unknown) {
    if (demandRoot !== undefined) {
      try {
        await demandRoot.close();
      } catch {
        // 首个打开或身份准入错误优先。
      }
    }
    if (error instanceof TargetTaskPlanningAuthorityError) throw error;
    if (error instanceof RootedDirectoryError) fail("root", error);
    throw error;
  }
}

export async function closeTargetTaskPlanningRoot(
  root: RootedDirectory,
): Promise<void> {
  try {
    await root.close();
  } catch (error: unknown) {
    fail("root", error);
  }
}

export async function openTargetTaskPlanningAuthorityContext(
  workspaceRoot: RootedDirectory,
  demandId: WakeflowDurableId<"demand">,
  signal: AbortSignal | undefined,
): Promise<Readonly<TargetTaskPlanningAuthorityContext>> {
  let config: Readonly<WakeflowConfigAuthoritySnapshot>;
  try {
    config = await readWakeflowConfigAuthoritySnapshot(
      workspaceRoot,
      signal === undefined ? undefined : { signal },
    );
  } catch (error: unknown) {
    if (error instanceof WakeflowConfigAuthoritySnapshotError) {
      if (error.reason === "aborted") fail("aborted", error);
      fail("config", error);
    }
    throw error;
  }
  let ledgerRoot: RootedDirectory | undefined;
  let demandRoot: RootedDirectory | undefined;
  try {
    ledgerRoot = await RootedDirectory.open(config.ledgerRoot, "$ledgerRoot");
    demandRoot = await openTargetTaskPlanningDemandRoot(workspaceRoot, demandId);
    const loaded = await loadDemandEventSourcingRootAuthority(
      demandRoot,
      new LedgerAuthorityStore(ledgerRoot),
      {
        audit: true,
        ...(signal === undefined ? {} : { signal }),
      },
    );
    return Object.freeze({ config, demandRoot, ledgerRoot, loaded });
  } catch (error: unknown) {
    if (demandRoot !== undefined) {
      try {
        await demandRoot.close();
      } catch {
        // 首个权威加载错误优先。
      }
    }
    if (ledgerRoot !== undefined) {
      try {
        await ledgerRoot.close();
      } catch {
        // 首个权威加载错误优先。
      }
    }
    if (error instanceof TargetTaskPlanningAuthorityError) throw error;
    if (error instanceof RootedDirectoryError) fail("root", error);
    if (
      error instanceof DemandEventSourcingRootAuthorityError
      || error instanceof LedgerAuthorityStoreError
    ) {
      if (error.reason === "aborted") fail("aborted", error);
      fail("demand-authority", error);
    }
    throw error;
  }
}

export async function closeTargetTaskPlanningAuthorityContext(
  context: Readonly<TargetTaskPlanningAuthorityContext>,
): Promise<void> {
  let failure: unknown;
  try {
    await context.demandRoot.close();
  } catch (error: unknown) {
    failure = error;
  }
  try {
    await context.ledgerRoot.close();
  } catch (error: unknown) {
    if (failure === undefined) failure = error;
  }
  if (failure !== undefined) fail("root", failure);
}

function sameAuthorityReference(
  left: Readonly<LedgerAuthorityMemberReference>,
  right: Readonly<LedgerAuthorityMemberReference>,
): boolean {
  return canonicalizeJson(left, "$left") === canonicalizeJson(right, "$right");
}

export function resolveTargetTaskPlanningAuthorityReferences(
  context: Readonly<TargetTaskPlanningAuthorityContext>,
  memberRefs: readonly [PortableResourcePath, ...PortableResourcePath[]],
): TaskPackage["selectedAuthorityRefs"] {
  const resolved = memberRefs.map((memberRef) => {
    const reference = context.loaded.authority.authorityRefs.find(
      (candidate) => candidate.memberRef === memberRef,
    );
    if (reference === undefined) fail("reference");
    return reference;
  });
  const first = resolved[0];
  if (first === undefined) fail("reference");
  return Object.freeze([first, ...resolved.slice(1)]);
}

export function assertTargetTaskPlanningAuthorityAndTopology(
  context: Readonly<TargetTaskPlanningAuthorityContext>,
  taskPackage: Readonly<TaskPackage>,
): void {
  const { config, loaded } = context;
  if (
    loaded.identity.demandId !== taskPackage.demandId
    || loaded.identity.programId !== taskPackage.programId
    || loaded.authorityDigest !== taskPackage.demandAuthorityDigest
    || loaded.identity.demandType === "research"
  ) {
    fail("demand-authority");
  }
  if (config.model.program.programId !== taskPackage.programId) fail("config");
  if (config.configDigest !== taskPackage.configDigest) fail("plan");
  const repository = config.indexes.repositoryById[
    taskPackage.assignment.repositoryId
  ];
  const window = config.indexes.windowById[taskPackage.assignment.windowId];
  if (
    repository === undefined
    || window === undefined
    || window.role !== "product"
    || window.root.kind !== "repository"
    || window.root.repositoryId !== repository.repositoryId
  ) {
    fail("topology");
  }
  for (const reference of taskPackage.selectedAuthorityRefs) {
    if (!loaded.authority.authorityRefs.some((candidate) => (
      sameAuthorityReference(candidate, reference)
    ))) {
      fail("reference");
    }
  }
}

export async function assertTargetTaskPlanningConfigCurrent(
  workspaceRoot: RootedDirectory,
  expected: Readonly<WakeflowConfigAuthoritySnapshot>,
  signal: AbortSignal | undefined,
): Promise<void> {
  let current;
  try {
    current = await readWakeflowConfigAuthoritySnapshot(
      workspaceRoot,
      signal === undefined ? undefined : { signal },
    );
  } catch (error: unknown) {
    if (error instanceof WakeflowConfigAuthoritySnapshotError) {
      if (error.reason === "aborted") fail("aborted", error);
      fail("config", error);
    }
    throw error;
  }
  if (
    current.configDigest !== expected.configDigest
    || current.source.digest !== expected.source.digest
    || !sameFileNodeSnapshot(current.source.node, expected.source.node)
  ) {
    fail("plan");
  }
}
