import { types } from "node:util";

import {
  createWakeflowDurableId,
  parseWakeflowDurableIdOfKind,
  WakeflowDurableIdError,
  type WakeflowDurableId,
} from "../../contracts/identity/wakeflow-durable-id.js";
import {
  parseDenseArray,
  parsePlainRecord,
  PassiveOwnDataError,
} from "../../foundation/data/passive-own-data.js";
import {
  parsePortableResourcePath,
  PortableResourcePathError,
  type PortableResourcePath,
} from "../../foundation/filesystem/portable-resource-path.js";
import {
  createUuidV4,
  UuidV4Error,
  type UuidV4Factory,
} from "../../foundation/identity/uuid-v4.js";
import type { UtcWallClock } from "../../foundation/time/wall-clock.js";
import {
  parseTaskPackageAuthoredContentDraft,
  TaskPackageError,
  type TaskPackageAuthoredContentDraft,
} from "./task-package.js";

/** Target Task Planning 的无文件副作用输入准入与身份分配。 */

export interface TargetTaskPlanningAuthoredTaskPackage extends TaskPackageAuthoredContentDraft {
  readonly selectedAuthorityMemberRefs: readonly [
    PortableResourcePath,
    ...PortableResourcePath[],
  ];
}

export interface TestTaskPlanningTaskPackageRequest {
  readonly workType: "test";
}

export type TargetTaskPlanningRequestedTaskPackage =
  TargetTaskPlanningAuthoredTaskPackage | TestTaskPlanningTaskPackageRequest;

export interface TargetTaskPlanningPreviewRequest {
  readonly demandId: WakeflowDurableId<"demand">;
  readonly taskPackage: TargetTaskPlanningRequestedTaskPackage;
}

export interface TargetTaskPlanningPreviewOptions {
  readonly clock?: UtcWallClock;
  readonly uuidFactory?: UuidV4Factory;
  readonly signal?: AbortSignal;
}

export interface TargetTaskPlanningApplyOptions {
  readonly signal?: AbortSignal;
}

export interface ParsedTargetTaskPlanningPreviewOptions {
  readonly clock: UtcWallClock | undefined;
  readonly uuidFactory: UuidV4Factory | undefined;
  readonly signal: AbortSignal | undefined;
}

export interface AllocatedTargetTaskPlanningIds {
  readonly taskPackageId: WakeflowDurableId<"task-package">;
  readonly targetTaskId: WakeflowDurableId<"target-task">;
  readonly eventId: WakeflowDurableId<"demand-event">;
  readonly commitId: WakeflowDurableId<"demand-event-commit">;
}

export type TargetTaskPlanningInputErrorReason =
  "input" | "identity" | "aborted";

const ERROR_MESSAGES = {
  input: "Target Task Planning input is invalid.",
  identity: "Target Task Planning identity allocation failed.",
  aborted: "Target Task Planning input was aborted.",
} as const satisfies Readonly<
  Record<TargetTaskPlanningInputErrorReason, string>
>;

export class TargetTaskPlanningInputError extends Error {
  override readonly name = "TargetTaskPlanningInputError";
  readonly code = "wakeflow-target-task-planning-input" as const;
  readonly reason: TargetTaskPlanningInputErrorReason;

  constructor(reason: TargetTaskPlanningInputErrorReason) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
  }
}

const PREVIEW_REQUEST_FIELDS = Object.freeze([
  "demandId",
  "taskPackage",
] as const);
const AUTHORED_TASK_PACKAGE_FIELDS = Object.freeze([
  "acceptanceAnchors",
  "assignment",
  "boundaries",
  "commitExpectation",
  "completionExpectations",
  "confirmedContext",
  "objective",
  "selectedAuthorityMemberRefs",
  "workType",
] as const);
function fail(reason: TargetTaskPlanningInputErrorReason): never {
  throw new TargetTaskPlanningInputError(reason);
}

function parseAuthoredTaskPackage(
  value: unknown,
): TargetTaskPlanningRequestedTaskPackage {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value, "$/taskPackage");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input");
    throw error;
  }
  const keys = Object.keys(record).sort();
  if (record.workType === "test") {
    if (keys.length !== 1 || keys[0] !== "workType") fail("input");
    return Object.freeze({ workType: "test" as const });
  }
  if (
    keys.length !== AUTHORED_TASK_PACKAGE_FIELDS.length ||
    keys.some((key, index) => key !== AUTHORED_TASK_PACKAGE_FIELDS[index])
  ) {
    fail("input");
  }
  let memberRefValues: readonly unknown[];
  try {
    memberRefValues = parseDenseArray(
      record.selectedAuthorityMemberRefs,
      32,
      "$/taskPackage/selectedAuthorityMemberRefs",
    );
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input");
    throw error;
  }
  if (memberRefValues.length === 0) fail("input");
  const memberRefs: PortableResourcePath[] = [];
  const seen = new Set<string>();
  for (const [index, candidate] of memberRefValues.entries()) {
    let memberRef: PortableResourcePath;
    try {
      memberRef = parsePortableResourcePath(
        candidate,
        `$/taskPackage/selectedAuthorityMemberRefs/${index}`,
      );
    } catch (error: unknown) {
      if (error instanceof PortableResourcePathError) fail("input");
      throw error;
    }
    if (seen.has(memberRef)) fail("input");
    seen.add(memberRef);
    memberRefs.push(memberRef);
  }
  const firstMemberRef = memberRefs[0];
  if (firstMemberRef === undefined) fail("input");
  let content: TaskPackageAuthoredContentDraft;
  try {
    content = parseTaskPackageAuthoredContentDraft({
      assignment: record.assignment,
      workType: record.workType,
      objective: record.objective,
      confirmedContext: record.confirmedContext,
      boundaries: record.boundaries,
      completionExpectations: record.completionExpectations,
      commitExpectation: record.commitExpectation,
      acceptanceAnchors: record.acceptanceAnchors,
    });
  } catch (error: unknown) {
    if (error instanceof TaskPackageError) fail("input");
    throw error;
  }
  const selectedAuthorityMemberRefs: readonly [
    PortableResourcePath,
    ...PortableResourcePath[],
  ] = Object.freeze([firstMemberRef, ...memberRefs.slice(1)]);
  return Object.freeze({
    assignment: content.assignment,
    workType: content.workType,
    objective: content.objective,
    confirmedContext: content.confirmedContext,
    selectedAuthorityMemberRefs,
    boundaries: content.boundaries,
    completionExpectations: content.completionExpectations,
    commitExpectation: content.commitExpectation,
    acceptanceAnchors: content.acceptanceAnchors,
  });
}

export function parseTargetTaskPlanningPreviewRequest(
  value: unknown,
): Readonly<TargetTaskPlanningPreviewRequest> {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value, "$request");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input");
    throw error;
  }
  const keys = Object.keys(record).sort();
  if (
    keys.length !== PREVIEW_REQUEST_FIELDS.length ||
    keys.some((key, index) => key !== PREVIEW_REQUEST_FIELDS[index])
  ) {
    fail("input");
  }
  try {
    return Object.freeze({
      demandId: parseWakeflowDurableIdOfKind(
        record.demandId,
        "demand",
        "$/demandId",
      ),
      taskPackage: parseAuthoredTaskPackage(record.taskPackage),
    });
  } catch (error: unknown) {
    if (
      error instanceof WakeflowDurableIdError ||
      error instanceof TaskPackageError
    ) {
      fail("input");
    }
    throw error;
  }
}

export function parseTargetTaskPlanningPreviewOptions(
  value: unknown,
): Readonly<ParsedTargetTaskPlanningPreviewOptions> {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value === undefined ? {} : value, "$options");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input");
    throw error;
  }
  if (
    Object.keys(record).some(
      (key) => key !== "clock" && key !== "signal" && key !== "uuidFactory",
    ) ||
    (record.clock !== undefined &&
      (typeof record.clock !== "function" || types.isProxy(record.clock))) ||
    (record.uuidFactory !== undefined &&
      (typeof record.uuidFactory !== "function" ||
        types.isProxy(record.uuidFactory))) ||
    (record.signal !== undefined &&
      (typeof record.signal !== "object" ||
        record.signal === null ||
        types.isProxy(record.signal) ||
        !(record.signal instanceof AbortSignal)))
  ) {
    fail("input");
  }
  return Object.freeze({
    clock: record.clock as UtcWallClock | undefined,
    uuidFactory: record.uuidFactory as UuidV4Factory | undefined,
    signal: record.signal as AbortSignal | undefined,
  });
}

export function parseTargetTaskPlanningApplyOptions(
  value: unknown,
): Readonly<{ readonly signal: AbortSignal | undefined }> {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value === undefined ? {} : value, "$options");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input");
    throw error;
  }
  if (
    Object.keys(record).some((key) => key !== "signal") ||
    (record.signal !== undefined &&
      (typeof record.signal !== "object" ||
        record.signal === null ||
        types.isProxy(record.signal) ||
        !(record.signal instanceof AbortSignal)))
  ) {
    fail("input");
  }
  return Object.freeze({
    signal: record.signal as AbortSignal | undefined,
  });
}

export function assertTargetTaskPlanningNotAborted(
  signal: AbortSignal | undefined,
): void {
  if (signal?.aborted === true) fail("aborted");
}

export function allocateTargetTaskPlanningIds(
  factory: UuidV4Factory | undefined,
  reservedTargetTaskId?: WakeflowDurableId<"target-task">,
): Readonly<AllocatedTargetTaskPlanningIds> {
  const seen = new Set<string>();
  function allocate<
    Kind extends
      "task-package" | "target-task" | "demand-event" | "demand-event-commit",
  >(kind: Kind): WakeflowDurableId<Kind> {
    let uuid;
    try {
      uuid = createUuidV4(factory);
    } catch (error: unknown) {
      if (error instanceof UuidV4Error) fail("identity");
      throw error;
    }
    if (seen.has(uuid)) fail("identity");
    seen.add(uuid);
    return createWakeflowDurableId(kind, uuid);
  }
  return Object.freeze({
    taskPackageId: allocate("task-package"),
    targetTaskId: reservedTargetTaskId ?? allocate("target-task"),
    eventId: allocate("demand-event"),
    commitId: allocate("demand-event-commit"),
  });
}
