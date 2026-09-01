import { types } from "node:util";

import {
  parseWakeflowDurableIdOfKind,
  WakeflowDurableIdError,
  type WakeflowDurableId,
} from "../../contracts/identity/wakeflow-durable-id.js";
import {
  parseSha256Digest,
  Sha256Error,
  type Sha256Digest,
} from "../../foundation/crypto/sha256.js";
import {
  loadCreateOnlyDeterministicJsonResource,
  materializeCreateOnlyDeterministicJsonResource,
  CreateOnlyDeterministicJsonResourceError,
  type CreateOnlyDeterministicJsonResourceReceipt,
} from "../../foundation/filesystem/create-only-deterministic-json-resource.js";
import type { DeterministicJsonFileResult } from "../../foundation/filesystem/deterministic-json-file.js";
import { RootedDirectory } from "../../foundation/filesystem/rooted-directory.js";
import {
  parsePlainRecord,
  PassiveOwnDataError,
} from "../../foundation/data/passive-own-data.js";
import { parseByteCount } from "../../foundation/numeric/byte-count.js";
import {
  admitWakeflowResourceOperation,
  WakeflowResourceProcessingContractError,
} from "../../foundation/resource/resource-processing-contract.js";
import {
  createDemandEventSourcingResourceCatalog,
  createTestCardProjectionResourceDeclaration,
  createTestDispatchPacketProjectionResourceDeclaration,
} from "../demand/demand-resource-catalog.js";
import { computeDemandEventSourcingStoredEventDigest } from "../demand/event-sourcing/demand-event-sourcing-stored-event.js";
import {
  DemandEventSourcingRepository,
  DemandEventSourcingRepositoryError,
} from "../demand/event-sourcing/demand-event-sourcing-repository.js";
import {
  TaskPackageProjectionStore,
  TaskPackageProjectionStoreError,
  type LoadedTaskPackageProjection,
} from "../tasking/task-package-projection-store.js";
import {
  computeTestCardDigest,
  parseTestCardDocument,
  renderTestCard,
  TestCardError,
  type TestCard,
} from "./test-card.js";
import {
  assertTestDispatchPacketMatchesSources,
  computeTestDispatchPacketDigest,
  createTestDispatchPacket,
  parseTestDispatchPacketDocument,
  renderTestDispatchPacket,
  TestDispatchPacketError,
  type TestDispatchPacket,
} from "./test-dispatch-packet.js";
import {
  testCardProjectionRef,
  testDispatchPacketProjectionRef,
  TEST_CARD_PROJECTIONS_ROOT_REF,
  TEST_DISPATCH_PACKET_PROJECTIONS_ROOT_REF,
  TestDispatchProjectionPathError,
} from "./test-dispatch-projection-paths.js";

/**
 * Wakeflow Governance / Testing：Test目标读取投影的唯一物化owner。
 *
 * `materialize`先从Demand Event Stream定位prepared Test Delivery、原始TestCard和
 * Test TaskPackage，并构造完整期望packet；只有全部来源闭合后，才幂等修复
 * TaskPackage、TestCard和packet三个只创建投影。部分投影写入不是业务事务：它们均可从
 * Event重建，重试只允许相同字节，任何冲突都不会覆盖。
 */

export const TEST_DISPATCH_PROJECTION_DIRECTORY_MODE = 0o700;
export const TEST_DISPATCH_PROJECTION_FILE_MODE = 0o600;
export const TEST_CARD_PROJECTION_MAXIMUM_BYTES = parseByteCount(
  16 * 1024 * 1024,
  "$testCardProjection.maximumBytes",
);
export const TEST_DISPATCH_PACKET_PROJECTION_MAXIMUM_BYTES = parseByteCount(
  4 * 1024 * 1024,
  "$testDispatchPacketProjection.maximumBytes",
);

export interface LoadTestCardProjectionOptions {
  readonly expectedTestCardDigest: Sha256Digest;
  readonly signal?: AbortSignal;
}

export interface LoadTestDispatchPacketProjectionOptions {
  readonly expectedPacketDigest: Sha256Digest;
  readonly signal?: AbortSignal;
}

export interface MaterializeTestDispatchProjectionsOptions {
  readonly signal?: AbortSignal;
}

export interface LoadedTestCardProjection {
  readonly testCard: Readonly<TestCard>;
  readonly testCardDigest: Sha256Digest;
  readonly source: Readonly<DeterministicJsonFileResult>;
}

export interface LoadedTestDispatchPacketProjection {
  readonly packet: Readonly<TestDispatchPacket>;
  readonly packetDigest: Sha256Digest;
  readonly source: Readonly<DeterministicJsonFileResult>;
}

export interface TestDispatchProjectionMaterializationReceipt {
  readonly taskPackage: Readonly<{
    readonly disposition: "created" | "current";
    readonly projection: Readonly<LoadedTaskPackageProjection>;
  }>;
  readonly testCard: Readonly<{
    readonly disposition: "created" | "current";
    readonly sourceEvent: Readonly<{
      readonly eventId: WakeflowDurableId<"demand-event">;
      readonly streamRevision: number;
    }>;
    readonly projection: Readonly<LoadedTestCardProjection>;
  }>;
  readonly packet: Readonly<{
    readonly disposition: "created" | "current";
    readonly sourceEvent: Readonly<{
      readonly eventId: WakeflowDurableId<"demand-event">;
      readonly eventDigest: Sha256Digest;
      readonly streamRevision: number;
    }>;
    readonly projection: Readonly<LoadedTestDispatchPacketProjection>;
  }>;
}

export type TestDispatchProjectionStoreErrorReason =
  | "input"
  | "projection-not-found"
  | "authority-not-found"
  | "authority"
  | "conflict"
  | "node-policy"
  | "capacity"
  | "recovery-required"
  | "commit-uncertain"
  | "root-scope"
  | "aborted"
  | "operation-failure";

const ERROR_MESSAGES = {
  input: "Test dispatch projection store input is invalid.",
  "projection-not-found": "Test dispatch projection does not exist.",
  "authority-not-found":
    "Test dispatch projection source Event does not exist.",
  authority: "Test dispatch projection source Event Stream is invalid.",
  conflict: "Test dispatch projection conflicts with its Event authority.",
  "node-policy": "Test dispatch projection violates its private node policy.",
  capacity: "Test dispatch projection exceeds its capacity.",
  "recovery-required":
    "Test dispatch projection publication requires recovery.",
  "commit-uncertain":
    "Test dispatch projection publication cannot prove its commit.",
  "root-scope": "Test dispatch projection store lost its rooted scope.",
  aborted: "Test dispatch projection operation was aborted.",
  "operation-failure": "Test dispatch projection operation failed.",
} as const satisfies Readonly<
  Record<TestDispatchProjectionStoreErrorReason, string>
>;

/** Test目标读取投影无法安全读取、重建或发布时的稳定错误。 */
export class TestDispatchProjectionStoreError extends Error {
  override readonly name = "TestDispatchProjectionStoreError";
  readonly code = "wakeflow-test-dispatch-projection-store" as const;
  readonly reason: TestDispatchProjectionStoreErrorReason;
  readonly path: string;

  constructor(reason: TestDispatchProjectionStoreErrorReason, path: string) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

function fail(
  reason: TestDispatchProjectionStoreErrorReason,
  path: string,
): never {
  throw new TestDispatchProjectionStoreError(reason, path);
}

function id<Kind extends "test-card" | "target-delivery">(
  value: unknown,
  kind: Kind,
  path: string,
): WakeflowDurableId<Kind> {
  try {
    return parseWakeflowDurableIdOfKind(value, kind, path);
  } catch (error: unknown) {
    if (error instanceof WakeflowDurableIdError) fail("input", path);
    throw error;
  }
}

function digest(value: unknown, path: string): Sha256Digest {
  try {
    return parseSha256Digest(value, path);
  } catch (error: unknown) {
    if (error instanceof Sha256Error) fail("input", path);
    throw error;
  }
}

function options(
  value: unknown,
  digestField: "expectedPacketDigest" | "expectedTestCardDigest" | null,
): Readonly<{
  readonly signal: AbortSignal | undefined;
  readonly expectedDigest: Sha256Digest | undefined;
}> {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value, "$options");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", "$options");
    throw error;
  }
  const allowed = new Set([
    "signal",
    ...(digestField === null ? [] : [digestField]),
  ]);
  if (
    Object.keys(record).some((key) => !allowed.has(key)) ||
    (digestField !== null && !Object.hasOwn(record, digestField))
  ) {
    fail("input", "$options");
  }
  const signal = record.signal;
  if (
    signal !== undefined &&
    (typeof signal !== "object" ||
      signal === null ||
      types.isProxy(signal) ||
      !(signal instanceof AbortSignal))
  ) {
    fail("input", "$/signal");
  }
  return Object.freeze({
    signal: signal as AbortSignal | undefined,
    expectedDigest:
      digestField === null
        ? undefined
        : digest(record[digestField], `$/${digestField}`),
  });
}

function cardPolicy(testCardId: WakeflowDurableId<"test-card">) {
  return Object.freeze({
    directoryPath: TEST_CARD_PROJECTIONS_ROOT_REF,
    resourcePath: testCardProjectionRef(testCardId),
    directoryMode: TEST_DISPATCH_PROJECTION_DIRECTORY_MODE,
    fileMode: TEST_DISPATCH_PROJECTION_FILE_MODE,
    maximumBytes: TEST_CARD_PROJECTION_MAXIMUM_BYTES,
  });
}

function packetPolicy(targetDeliveryId: WakeflowDurableId<"target-delivery">) {
  return Object.freeze({
    directoryPath: TEST_DISPATCH_PACKET_PROJECTIONS_ROOT_REF,
    resourcePath: testDispatchPacketProjectionRef(targetDeliveryId),
    directoryMode: TEST_DISPATCH_PROJECTION_DIRECTORY_MODE,
    fileMode: TEST_DISPATCH_PROJECTION_FILE_MODE,
    maximumBytes: TEST_DISPATCH_PACKET_PROJECTION_MAXIMUM_BYTES,
  });
}

function mapStorageError(
  error: CreateOnlyDeterministicJsonResourceError,
): never {
  if (error.reason === "not-found") {
    fail("projection-not-found", error.path);
  }
  fail(error.reason, error.path);
}

function mapRepositoryError(error: DemandEventSourcingRepositoryError): never {
  if (error.reason === "aborted") fail("aborted", "$signal");
  if (error.reason === "input") fail("input", "$identity");
  fail("authority", "$events");
}

function mapTaskPackageStoreError(
  error: TaskPackageProjectionStoreError,
): never {
  if (error.reason === "aborted") fail("aborted", "$signal");
  if (error.reason === "authority-not-found") {
    fail("authority-not-found", "$events");
  }
  if (error.reason === "input") fail("input", "$taskPackage");
  if (error.reason === "projection-not-found") {
    fail("projection-not-found", "$taskPackage");
  }
  fail(error.reason, "$taskPackage");
}

function assertProjectionOperations(
  packet: Readonly<TestDispatchPacket>,
): void {
  try {
    const catalog = createDemandEventSourcingResourceCatalog(packet.demandId);
    const cardRoot = catalog.find(
      (entry) =>
        entry.declarationId ===
        `demand.event-sourcing.${packet.demandId}.test-cards-root`,
    );
    const packetRoot = catalog.find(
      (entry) =>
        entry.declarationId ===
        `demand.event-sourcing.${packet.demandId}.test-dispatch-packets-root`,
    );
    if (cardRoot === undefined || packetRoot === undefined) {
      fail("operation-failure", "$catalog");
    }
    admitWakeflowResourceOperation(
      cardRoot.processing,
      "materialize-directory",
    );
    admitWakeflowResourceOperation(
      packetRoot.processing,
      "materialize-directory",
    );
    admitWakeflowResourceOperation(
      createTestCardProjectionResourceDeclaration(
        packet.demandId,
        packet.target.testCard.testCardId,
      ).processing,
      "exclusive-create",
    );
    admitWakeflowResourceOperation(
      createTestDispatchPacketProjectionResourceDeclaration(
        packet.demandId,
        packet.targetDeliveryId,
      ).processing,
      "exclusive-create",
    );
  } catch (error: unknown) {
    if (error instanceof TestDispatchProjectionStoreError) throw error;
    if (
      error instanceof WakeflowResourceProcessingContractError ||
      error instanceof TestDispatchProjectionPathError ||
      error instanceof WakeflowDurableIdError
    ) {
      fail("operation-failure", "$catalog");
    }
    throw error;
  }
}

function parseLoadedCard(
  source: Readonly<DeterministicJsonFileResult>,
  testCardId: WakeflowDurableId<"test-card">,
  expectedDigest: Sha256Digest,
): Readonly<LoadedTestCardProjection> {
  let testCard: Readonly<TestCard>;
  try {
    testCard = parseTestCardDocument(source.text);
  } catch (error: unknown) {
    if (error instanceof TestCardError) fail("conflict", "$testCard");
    throw error;
  }
  const testCardDigest = computeTestCardDigest(testCard);
  if (testCard.testCardId !== testCardId || testCardDigest !== expectedDigest) {
    fail("conflict", "$testCard");
  }
  return Object.freeze({ testCard, testCardDigest, source });
}

function parseLoadedPacket(
  source: Readonly<DeterministicJsonFileResult>,
  targetDeliveryId: WakeflowDurableId<"target-delivery">,
  expectedDigest: Sha256Digest,
): Readonly<LoadedTestDispatchPacketProjection> {
  let packet: Readonly<TestDispatchPacket>;
  try {
    packet = parseTestDispatchPacketDocument(source.text);
  } catch (error: unknown) {
    if (error instanceof TestDispatchPacketError) {
      fail("conflict", "$packet");
    }
    throw error;
  }
  const packetDigest = computeTestDispatchPacketDigest(packet);
  if (
    packet.targetDeliveryId !== targetDeliveryId ||
    packetDigest !== expectedDigest
  ) {
    fail("conflict", "$packet");
  }
  return Object.freeze({ packet, packetDigest, source });
}

async function materializeCard(
  root: RootedDirectory,
  testCard: Readonly<TestCard>,
  signal: AbortSignal | undefined,
): Promise<
  Readonly<{
    readonly disposition: "created" | "current";
    readonly projection: Readonly<LoadedTestCardProjection>;
  }>
> {
  let receipt: Readonly<CreateOnlyDeterministicJsonResourceReceipt>;
  const text = renderTestCard(testCard);
  try {
    receipt = await materializeCreateOnlyDeterministicJsonResource(
      root,
      cardPolicy(testCard.testCardId),
      text,
      signal === undefined ? {} : { signal },
    );
  } catch (error: unknown) {
    if (error instanceof CreateOnlyDeterministicJsonResourceError) {
      mapStorageError(error);
    }
    throw error;
  }
  const projection = parseLoadedCard(
    receipt.source,
    testCard.testCardId,
    testCard.testCardDigest,
  );
  if (projection.source.text !== text) {
    fail(
      receipt.disposition === "created" ? "commit-uncertain" : "conflict",
      "$testCard",
    );
  }
  return Object.freeze({ disposition: receipt.disposition, projection });
}

async function materializePacket(
  root: RootedDirectory,
  packet: Readonly<TestDispatchPacket>,
  signal: AbortSignal | undefined,
): Promise<
  Readonly<{
    readonly disposition: "created" | "current";
    readonly projection: Readonly<LoadedTestDispatchPacketProjection>;
  }>
> {
  let receipt: Readonly<CreateOnlyDeterministicJsonResourceReceipt>;
  const text = renderTestDispatchPacket(packet);
  try {
    receipt = await materializeCreateOnlyDeterministicJsonResource(
      root,
      packetPolicy(packet.targetDeliveryId),
      text,
      signal === undefined ? {} : { signal },
    );
  } catch (error: unknown) {
    if (error instanceof CreateOnlyDeterministicJsonResourceError) {
      mapStorageError(error);
    }
    throw error;
  }
  const projection = parseLoadedPacket(
    receipt.source,
    packet.targetDeliveryId,
    packet.packetDigest,
  );
  if (projection.source.text !== text) {
    fail(
      receipt.disposition === "created" ? "commit-uncertain" : "conflict",
      "$packet",
    );
  }
  return Object.freeze({ disposition: receipt.disposition, projection });
}

export class TestDispatchProjectionStore {
  readonly #root: RootedDirectory;
  readonly #repository: DemandEventSourcingRepository;

  constructor(root: RootedDirectory) {
    if (
      typeof root !== "object" ||
      root === null ||
      types.isProxy(root) ||
      !(root instanceof RootedDirectory)
    ) {
      fail("input", "$root");
    }
    this.#root = root;
    this.#repository = new DemandEventSourcingRepository(root);
  }

  /** 按Event派生摘要预期快速读取一份已有TestCard投影。 */
  async loadTestCard(
    testCardIdValue: unknown,
    optionsValue: LoadTestCardProjectionOptions,
  ): Promise<Readonly<LoadedTestCardProjection>> {
    const testCardId = id(testCardIdValue, "test-card", "$testCardId");
    const parsed = options(optionsValue, "expectedTestCardDigest");
    let source;
    try {
      source = await loadCreateOnlyDeterministicJsonResource(
        this.#root,
        cardPolicy(testCardId),
        parsed.signal === undefined ? {} : { signal: parsed.signal },
      );
    } catch (error: unknown) {
      if (error instanceof CreateOnlyDeterministicJsonResourceError) {
        mapStorageError(error);
      }
      throw error;
    }
    return parseLoadedCard(source, testCardId, parsed.expectedDigest!);
  }

  /** 按Event派生摘要预期快速读取一份已有Test dispatch packet投影。 */
  async loadPacket(
    targetDeliveryIdValue: unknown,
    optionsValue: LoadTestDispatchPacketProjectionOptions,
  ): Promise<Readonly<LoadedTestDispatchPacketProjection>> {
    const targetDeliveryId = id(
      targetDeliveryIdValue,
      "target-delivery",
      "$targetDeliveryId",
    );
    const parsed = options(optionsValue, "expectedPacketDigest");
    let source;
    try {
      source = await loadCreateOnlyDeterministicJsonResource(
        this.#root,
        packetPolicy(targetDeliveryId),
        parsed.signal === undefined ? {} : { signal: parsed.signal },
      );
    } catch (error: unknown) {
      if (error instanceof CreateOnlyDeterministicJsonResourceError) {
        mapStorageError(error);
      }
      throw error;
    }
    return parseLoadedPacket(source, targetDeliveryId, parsed.expectedDigest!);
  }

  /**
   * 从唯一prepared Test Delivery Event幂等创建或复验全部目标读取投影。
   */
  async materialize(
    targetDeliveryIdValue: unknown,
    optionsValue: MaterializeTestDispatchProjectionsOptions = {},
  ): Promise<Readonly<TestDispatchProjectionMaterializationReceipt>> {
    const targetDeliveryId = id(
      targetDeliveryIdValue,
      "target-delivery",
      "$targetDeliveryId",
    );
    const { signal } = options(optionsValue, null);
    let deliveryEvent;
    try {
      deliveryEvent = await this.#repository.findTestDeliveryPreparedEvent(
        targetDeliveryId,
        signal === undefined ? undefined : { signal },
      );
    } catch (error: unknown) {
      if (error instanceof DemandEventSourcingRepositoryError) {
        mapRepositoryError(error);
      }
      throw error;
    }
    if (deliveryEvent === null) fail("authority-not-found", "$events");
    const intent = deliveryEvent.event.data.intent;
    let taskEvent;
    let cardEvent;
    try {
      [taskEvent, cardEvent] = await Promise.all([
        this.#repository.findTargetTaskPlannedEvent(
          intent.target.taskPackageId,
          signal === undefined ? undefined : { signal },
        ),
        this.#repository.findTestCardCreatedEvent(
          intent.target.testCard.testCardId,
          signal === undefined ? undefined : { signal },
        ),
      ]);
    } catch (error: unknown) {
      if (error instanceof DemandEventSourcingRepositoryError) {
        mapRepositoryError(error);
      }
      throw error;
    }
    if (taskEvent === null || cardEvent === null) {
      fail("authority-not-found", "$events");
    }
    if (taskEvent.event.data.taskPackage.workType !== "test") {
      fail("authority", "$events");
    }
    const taskPackage = taskEvent.event.data.taskPackage;
    const testCard = cardEvent.event.data.testCard;
    const eventDigest = computeDemandEventSourcingStoredEventDigest(
      deliveryEvent.storedEvent,
    );
    let packet: Readonly<TestDispatchPacket>;
    try {
      packet = createTestDispatchPacket({
        sourceEvent: {
          eventId: deliveryEvent.storedEvent.eventId,
          eventDigest,
          streamRevision: deliveryEvent.storedEvent.streamRevision,
        },
        intent,
        taskPackage,
        testCard,
      });
    } catch (error: unknown) {
      if (error instanceof TestDispatchPacketError) {
        fail("authority", "$events");
      }
      throw error;
    }
    assertProjectionOperations(packet);
    let taskPackageReceipt;
    try {
      taskPackageReceipt = await new TaskPackageProjectionStore(
        this.#root,
      ).materialize(
        taskPackage.taskPackageId,
        signal === undefined ? {} : { signal },
      );
    } catch (error: unknown) {
      if (error instanceof TaskPackageProjectionStoreError) {
        mapTaskPackageStoreError(error);
      }
      throw error;
    }
    const card = await materializeCard(this.#root, testCard, signal);
    const packetProjection = await materializePacket(
      this.#root,
      packet,
      signal,
    );
    try {
      assertTestDispatchPacketMatchesSources(
        packetProjection.projection.packet,
        intent,
        taskPackageReceipt.projection.taskPackage,
        card.projection.testCard,
        {
          eventId: deliveryEvent.storedEvent.eventId,
          eventDigest,
          streamRevision: deliveryEvent.storedEvent.streamRevision,
        },
      );
    } catch (error: unknown) {
      if (error instanceof TestDispatchPacketError) {
        fail("conflict", "$packet");
      }
      throw error;
    }
    return Object.freeze({
      taskPackage: Object.freeze({
        disposition: taskPackageReceipt.disposition,
        projection: taskPackageReceipt.projection,
      }),
      testCard: Object.freeze({
        disposition: card.disposition,
        sourceEvent: Object.freeze({
          eventId: cardEvent.storedEvent.eventId,
          streamRevision: cardEvent.storedEvent.streamRevision,
        }),
        projection: card.projection,
      }),
      packet: Object.freeze({
        disposition: packetProjection.disposition,
        sourceEvent: Object.freeze({
          eventId: deliveryEvent.storedEvent.eventId,
          eventDigest,
          streamRevision: deliveryEvent.storedEvent.streamRevision,
        }),
        projection: packetProjection.projection,
      }),
    });
  }
}
