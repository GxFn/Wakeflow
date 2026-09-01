import {
  WAKEFLOW_DEMAND_CONTROLLER_ROUTE_RESULT_SCHEMA,
  type WakeflowDemandControllerRouteResultV1 as RouteResultWire,
} from "../../contracts/generated/entrypoints/wakeflow-demand-controller-route-result.generated.js";
import { encodeCanonicalJson } from "../../foundation/data/canonical-json.js";
import {
  JsonValueError,
  parseJsonValue,
  type JsonValue,
} from "../../foundation/data/json-value.js";
import {
  RootedDirectory,
  RootedDirectoryError,
} from "../../foundation/filesystem/rooted-directory.js";
import { createRuntimeJsonSchemaValidator } from "../../foundation/schema/runtime-json-schema.js";
import {
  buildDemandControllerRoute,
  DemandControllerRouteError,
} from "./demand-controller-route.js";
import {
  assertDemandOperationConfigCurrent,
  closeDemandOperationAuthorityContext,
  openDemandOperationAuthorityContext,
  DemandOperationAuthorityContextError,
  type DemandOperationAuthorityContext,
} from "../demand/demand-operation-authority-context.js";
import {
  readDemandResultReviewSnapshot,
  DemandResultReviewSnapshotError,
} from "../review/demand-result-review-snapshot.js";
import {
  parseDemandControllerRoutePublicRequest,
  DemandControllerRoutePublicContractError,
  WAKEFLOW_DEMAND_CONTROLLER_ROUTE_PUBLIC_SCHEMA_VERSION,
  WAKEFLOW_DEMAND_CONTROLLER_ROUTE_PUBLIC_TOOL_NAME,
} from "./demand-controller-route-public-contract.js";

/**
 * Wakeflow Governance / Controller：公共只读Demand Route的根目录与脱敏边界。
 *
 * Coordinator只组合当前Config、Demand Authority、Review Snapshot和纯Route。它不缓存
 * workspace状态、不调用写owner，也不把Route升级为后续mutation的许可。
 */

export type DemandControllerRoutePublicResult = Readonly<RouteResultWire>;

const WAKEFLOW_DEMAND_CONTROLLER_ROUTE_PUBLIC_MAXIMUM_RESULT_BYTES =
  24 * 1024 * 1024;

export type DemandControllerRoutePublicCoordinatorErrorReason =
  "root" | "route" | "output";

const ERROR_MESSAGES = {
  root: "Demand Controller Route public workspace root is invalid.",
  route: "Demand Controller Route public inspection failed.",
  output:
    "Demand Controller Route public result violated its redacted boundary.",
} as const satisfies Readonly<
  Record<DemandControllerRoutePublicCoordinatorErrorReason, string>
>;

export class DemandControllerRoutePublicCoordinatorError extends Error {
  override readonly name = "DemandControllerRoutePublicCoordinatorError";
  readonly code =
    "wakeflow-demand-controller-route-public-coordinator" as const;
  readonly reason: DemandControllerRoutePublicCoordinatorErrorReason;
  readonly causeCode: string | null;
  readonly causeReason: string | null;

  constructor(
    reason: DemandControllerRoutePublicCoordinatorErrorReason,
    causeCode: string | null = null,
    causeReason: string | null = null,
  ) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.causeCode = causeCode;
    this.causeReason = causeReason;
  }
}

const validateResult = createRuntimeJsonSchemaValidator<RouteResultWire>(
  WAKEFLOW_DEMAND_CONTROLLER_ROUTE_RESULT_SCHEMA,
);

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
  reason: DemandControllerRoutePublicCoordinatorErrorReason,
  cause?: unknown,
): never {
  throw new DemandControllerRoutePublicCoordinatorError(
    reason,
    ownString(cause, "code"),
    ownString(cause, "reason"),
  );
}

function containsPrivateText(
  value: JsonValue,
  privateValues: ReadonlySet<string>,
): boolean {
  if (typeof value === "string") {
    for (const privateValue of privateValues) {
      if (value.includes(privateValue)) return true;
    }
    return false;
  }
  if (value === null || typeof value !== "object") return false;
  return Object.values(value).some((entry) =>
    containsPrivateText(entry, privateValues),
  );
}

function publicResult(
  value: unknown,
  privateValues: ReadonlySet<string>,
): DemandControllerRoutePublicResult {
  let json: JsonValue;
  try {
    json = parseJsonValue(value, "$result");
  } catch (error: unknown) {
    if (error instanceof JsonValueError) fail("output", error);
    throw error;
  }
  if (
    encodeCanonicalJson(json, "$result").byteLength >
      WAKEFLOW_DEMAND_CONTROLLER_ROUTE_PUBLIC_MAXIMUM_RESULT_BYTES ||
    containsPrivateText(json, privateValues) ||
    !validateResult(json).ok
  ) {
    fail("output");
  }
  return json as unknown as DemandControllerRoutePublicResult;
}

function routePrivateValues(
  requestRoot: string,
  workspaceRoot: RootedDirectory,
  context: Readonly<DemandOperationAuthorityContext>,
): ReadonlySet<string> {
  return new Set([
    requestRoot,
    workspaceRoot.absolutePath,
    context.config.ledgerRoot,
    context.demandRoot.absolutePath,
    context.ledgerRoot.absolutePath,
  ]);
}

function mapRouteError(error: unknown): never {
  if (
    error instanceof DemandOperationAuthorityContextError ||
    error instanceof DemandResultReviewSnapshotError ||
    error instanceof DemandControllerRouteError
  ) {
    fail("route", error);
  }
  throw error;
}

/** 执行一次零写、同源复验并返回严格脱敏的当前Demand Controller Route。 */
export async function executeDemandControllerRoutePublicRequest(
  value: unknown,
): Promise<DemandControllerRoutePublicResult> {
  const request = parseDemandControllerRoutePublicRequest(value);
  let workspaceRoot: RootedDirectory;
  try {
    workspaceRoot = await RootedDirectory.open(request.root, "$request.root");
  } catch (error: unknown) {
    if (error instanceof RootedDirectoryError) fail("root", error);
    throw error;
  }

  let context: Readonly<DemandOperationAuthorityContext> | undefined;
  let result: DemandControllerRoutePublicResult | undefined;
  let failure: unknown;
  try {
    try {
      context = await openDemandOperationAuthorityContext(
        workspaceRoot,
        request.demandId,
        undefined,
      );
      const snapshot = await readDemandResultReviewSnapshot(context.demandRoot);
      const route = buildDemandControllerRoute(context.loaded, snapshot);
      await assertDemandOperationConfigCurrent(
        workspaceRoot,
        context.config,
        undefined,
      );
      result = publicResult(
        {
          kind: "WakeflowDemandControllerRouteInspectionResult",
          schemaVersion: WAKEFLOW_DEMAND_CONTROLLER_ROUTE_PUBLIC_SCHEMA_VERSION,
          tool: WAKEFLOW_DEMAND_CONTROLLER_ROUTE_PUBLIC_TOOL_NAME,
          status: "current",
          route,
        },
        routePrivateValues(request.root, workspaceRoot, context),
      );
    } catch (error: unknown) {
      mapRouteError(error);
    }
  } catch (error: unknown) {
    failure = error;
  }

  if (context !== undefined) {
    try {
      await closeDemandOperationAuthorityContext(context);
    } catch (error: unknown) {
      if (failure === undefined) {
        if (error instanceof DemandOperationAuthorityContextError) {
          failure = new DemandControllerRoutePublicCoordinatorError(
            "route",
            error.code,
            error.reason,
          );
        } else {
          failure = error;
        }
      }
    }
  }
  try {
    await workspaceRoot.close();
  } catch (error: unknown) {
    if (failure === undefined) {
      failure =
        error instanceof RootedDirectoryError
          ? new DemandControllerRoutePublicCoordinatorError(
              "root",
              error.code,
              error.reason,
            )
          : error;
    }
  }

  if (failure !== undefined) throw failure;
  if (result === undefined) fail("output");
  return result;
}

export { DemandControllerRoutePublicContractError };
