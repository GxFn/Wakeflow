import type { WakeflowConfigAuthoritySnapshot } from "../../configuration/wakeflow-config-authority-snapshot.js";
import type { WakeflowDurableId } from "../../contracts/identity/wakeflow-durable-id.js";
import { canonicalizeJson } from "../../foundation/data/canonical-json.js";
import type { PortableResourcePath } from "../../foundation/filesystem/portable-resource-path.js";
import { RootedDirectory } from "../../foundation/filesystem/rooted-directory.js";
import {
  assertDemandOperationConfigCurrent,
  closeDemandOperationAuthorityContext,
  closeDemandOperationRoot,
  openDemandOperationAuthorityContext,
  openDemandOperationRoot,
  DemandOperationAuthorityContextError,
  type DemandOperationAuthorityContext,
} from "../demand/demand-operation-authority-context.js";
import type { LedgerAuthorityMemberReference } from "../ledger/ledger-authority-store.js";
import type { TaskPackage } from "./task-package.js";

/** Target Task Planning 对 Config、Demand、Ledger 与物理根的组合权威准入。 */

export interface TargetTaskPlanningAuthorityContext extends DemandOperationAuthorityContext {}

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
  topology:
    "Target Task Planning assignment is not in current Config topology.",
  reference: "Target Task Planning selected authority references are invalid.",
  plan: "Target Task Planning authority no longer matches the plan.",
  aborted: "Target Task Planning authority loading was aborted.",
} as const satisfies Readonly<
  Record<TargetTaskPlanningAuthorityErrorReason, string>
>;

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
  return descriptor !== undefined &&
    Object.hasOwn(descriptor, "value") &&
    typeof descriptor.value === "string"
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

function mapContextError(error: DemandOperationAuthorityContextError): never {
  if (error.reason === "root") fail("root", error);
  if (error.reason === "config") fail("config", error);
  if (error.reason === "demand-authority") {
    fail("demand-authority", error);
  }
  if (error.reason === "stale-config") fail("plan", error);
  fail("aborted", error);
}

export async function openTargetTaskPlanningDemandRoot(
  workspaceRoot: RootedDirectory,
  demandId: WakeflowDurableId<"demand">,
): Promise<RootedDirectory> {
  try {
    return await openDemandOperationRoot(workspaceRoot, demandId);
  } catch (error: unknown) {
    if (error instanceof DemandOperationAuthorityContextError) {
      mapContextError(error);
    }
    throw error;
  }
}

export async function closeTargetTaskPlanningRoot(
  root: RootedDirectory,
): Promise<void> {
  try {
    await closeDemandOperationRoot(root);
  } catch (error: unknown) {
    if (error instanceof DemandOperationAuthorityContextError) {
      mapContextError(error);
    }
    throw error;
  }
}

export async function openTargetTaskPlanningAuthorityContext(
  workspaceRoot: RootedDirectory,
  demandId: WakeflowDurableId<"demand">,
  signal: AbortSignal | undefined,
): Promise<Readonly<TargetTaskPlanningAuthorityContext>> {
  try {
    return await openDemandOperationAuthorityContext(
      workspaceRoot,
      demandId,
      signal,
    );
  } catch (error: unknown) {
    if (error instanceof DemandOperationAuthorityContextError) {
      mapContextError(error);
    }
    throw error;
  }
}

export async function closeTargetTaskPlanningAuthorityContext(
  context: Readonly<TargetTaskPlanningAuthorityContext>,
): Promise<void> {
  try {
    await closeDemandOperationAuthorityContext(context);
  } catch (error: unknown) {
    if (error instanceof DemandOperationAuthorityContextError) {
      mapContextError(error);
    }
    throw error;
  }
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
  if (taskPackage.workType !== "implementation") fail("topology");
  if (
    loaded.identity.demandId !== taskPackage.demandId ||
    loaded.identity.programId !== taskPackage.programId ||
    loaded.authorityDigest !== taskPackage.demandAuthorityDigest ||
    loaded.identity.demandType === "research"
  ) {
    fail("demand-authority");
  }
  if (config.model.program.programId !== taskPackage.programId) fail("config");
  if (config.configDigest !== taskPackage.configDigest) fail("plan");
  const repository =
    config.indexes.repositoryById[taskPackage.assignment.repositoryId];
  const window = config.indexes.windowById[taskPackage.assignment.windowId];
  if (
    repository === undefined ||
    window === undefined ||
    window.role !== "product" ||
    window.root.kind !== "repository" ||
    window.root.repositoryId !== repository.repositoryId
  ) {
    fail("topology");
  }
  for (const reference of taskPackage.selectedAuthorityRefs) {
    if (
      !loaded.authority.authorityRefs.some((candidate) =>
        sameAuthorityReference(candidate, reference),
      )
    ) {
      fail("reference");
    }
  }
}

export async function assertTargetTaskPlanningConfigCurrent(
  workspaceRoot: RootedDirectory,
  expected: Readonly<WakeflowConfigAuthoritySnapshot>,
  signal: AbortSignal | undefined,
): Promise<void> {
  try {
    await assertDemandOperationConfigCurrent(workspaceRoot, expected, signal);
  } catch (error: unknown) {
    if (error instanceof DemandOperationAuthorityContextError) {
      mapContextError(error);
    }
    throw error;
  }
}
