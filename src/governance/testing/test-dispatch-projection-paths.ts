import {
  parseWakeflowDurableIdOfKind,
  WakeflowDurableIdError,
  type WakeflowDurableId,
} from "../../contracts/identity/wakeflow-durable-id.js";
import {
  parsePortableResourcePath,
  type PortableResourcePath,
} from "../../foundation/filesystem/portable-resource-path.js";

/**
 * Wakeflow Governance / Testing：Test目标读取投影的固定Demand内路径。
 *
 * TestCard按自身身份只物化一次；Test dispatch packet与一个已经授权的
 * `targetDeliveryId`一一对应，因此不再引入第二个packet身份。路径函数只处理词法映射，
 * 不读取Event、文件或当前Delivery状态。
 */

export const TEST_CARD_PROJECTIONS_ROOT_REF = parsePortableResourcePath(
  "artifacts/test-cards",
);
export const TEST_DISPATCH_PACKET_PROJECTIONS_ROOT_REF =
  parsePortableResourcePath("artifacts/test-dispatch-packets");

const TEST_CARD_FILE_PATTERN =
  /^(?<id>test-card_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.json$/u;
const TEST_DISPATCH_PACKET_FILE_PATTERN =
  /^(?<id>target-delivery_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.json$/u;

export interface TestCardProjectionAddress {
  readonly testCardId: WakeflowDurableId<"test-card">;
  readonly fileName: string;
  readonly resourcePath: PortableResourcePath;
}

export interface TestDispatchPacketProjectionAddress {
  readonly targetDeliveryId: WakeflowDurableId<"target-delivery">;
  readonly fileName: string;
  readonly resourcePath: PortableResourcePath;
}

export type TestDispatchProjectionPathErrorReason = "identifier" | "file-name";

const ERROR_MESSAGES = {
  identifier: "Test dispatch projection identity is invalid.",
  "file-name": "Test dispatch projection filename is invalid.",
} as const satisfies Readonly<
  Record<TestDispatchProjectionPathErrorReason, string>
>;

/** Test目标读取投影路径无法形成唯一词法映射时的稳定错误。 */
export class TestDispatchProjectionPathError extends Error {
  override readonly name = "TestDispatchProjectionPathError";
  readonly code = "wakeflow-test-dispatch-projection-path" as const;
  readonly reason: TestDispatchProjectionPathErrorReason;
  readonly path: string;

  constructor(reason: TestDispatchProjectionPathErrorReason, path: string) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

function fail(
  reason: TestDispatchProjectionPathErrorReason,
  path: string,
): never {
  throw new TestDispatchProjectionPathError(reason, path);
}

function id<Kind extends "test-card" | "target-delivery">(
  value: unknown,
  kind: Kind,
  path: string,
): WakeflowDurableId<Kind> {
  try {
    return parseWakeflowDurableIdOfKind(value, kind, path);
  } catch (error: unknown) {
    if (error instanceof WakeflowDurableIdError) fail("identifier", path);
    throw error;
  }
}

/** 从TestCard身份派生唯一可读投影引用。 */
export function testCardProjectionRef(value: unknown): PortableResourcePath {
  const testCardId = id(value, "test-card", "$testCardId");
  return parsePortableResourcePath(
    `${TEST_CARD_PROJECTIONS_ROOT_REF}/${testCardId}.json`,
  );
}

/** 从Test Delivery身份派生唯一dispatch packet投影引用。 */
export function testDispatchPacketProjectionRef(
  value: unknown,
): PortableResourcePath {
  const targetDeliveryId = id(value, "target-delivery", "$targetDeliveryId");
  return parsePortableResourcePath(
    `${TEST_DISPATCH_PACKET_PROJECTIONS_ROOT_REF}/${targetDeliveryId}.json`,
  );
}

/** 从严格文件名恢复TestCard投影地址。 */
export function parseTestCardProjectionFileName(
  value: unknown,
): Readonly<TestCardProjectionAddress> {
  if (typeof value !== "string") fail("file-name", "$fileName");
  const text = TEST_CARD_FILE_PATTERN.exec(value)?.groups?.id;
  if (text === undefined) fail("file-name", "$fileName");
  let testCardId: WakeflowDurableId<"test-card">;
  try {
    testCardId = id(text, "test-card", "$fileName");
  } catch (error: unknown) {
    if (error instanceof TestDispatchProjectionPathError) {
      fail("file-name", "$fileName");
    }
    throw error;
  }
  const fileName = `${testCardId}.json`;
  if (fileName !== value) fail("file-name", "$fileName");
  return Object.freeze({
    testCardId,
    fileName,
    resourcePath: testCardProjectionRef(testCardId),
  });
}

/** 从严格文件名恢复Test dispatch packet投影地址。 */
export function parseTestDispatchPacketProjectionFileName(
  value: unknown,
): Readonly<TestDispatchPacketProjectionAddress> {
  if (typeof value !== "string") fail("file-name", "$fileName");
  const text = TEST_DISPATCH_PACKET_FILE_PATTERN.exec(value)?.groups?.id;
  if (text === undefined) fail("file-name", "$fileName");
  let targetDeliveryId: WakeflowDurableId<"target-delivery">;
  try {
    targetDeliveryId = id(text, "target-delivery", "$fileName");
  } catch (error: unknown) {
    if (error instanceof TestDispatchProjectionPathError) {
      fail("file-name", "$fileName");
    }
    throw error;
  }
  const fileName = `${targetDeliveryId}.json`;
  if (fileName !== value) fail("file-name", "$fileName");
  return Object.freeze({
    targetDeliveryId,
    fileName,
    resourcePath: testDispatchPacketProjectionRef(targetDeliveryId),
  });
}
