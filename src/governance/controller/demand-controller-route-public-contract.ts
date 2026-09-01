import {
  WAKEFLOW_DEMAND_CONTROLLER_ROUTE_REQUEST_SCHEMA,
  type WakeflowDemandControllerRouteRequestV1 as RouteRequestWire,
} from "../../contracts/generated/entrypoints/wakeflow-demand-controller-route-request.generated.js";
import {
  parseWakeflowDurableIdOfKind,
  WakeflowDurableIdError,
  type WakeflowDurableId,
} from "../../contracts/identity/wakeflow-durable-id.js";
import { encodeCanonicalJson } from "../../foundation/data/canonical-json.js";
import {
  JsonValueError,
  parseJsonValue,
  type JsonValue,
} from "../../foundation/data/json-value.js";
import { createRuntimeJsonSchemaValidator } from "../../foundation/schema/runtime-json-schema.js";

/** Wakeflow Governance / Controller：公共只读Demand Route查询请求合同。 */

export const WAKEFLOW_DEMAND_CONTROLLER_ROUTE_PUBLIC_TOOL_NAME =
  "wakeflow_inspect_demand_route" as const;
export const WAKEFLOW_DEMAND_CONTROLLER_ROUTE_PUBLIC_SCHEMA_VERSION =
  1 as const;
const WAKEFLOW_DEMAND_CONTROLLER_ROUTE_PUBLIC_MAXIMUM_REQUEST_BYTES = 64 * 1024;

export interface DemandControllerRoutePublicRequest {
  readonly root: string;
  readonly demandId: WakeflowDurableId<"demand">;
}

export type DemandControllerRoutePublicContractErrorReason =
  "json" | "capacity" | "schema" | "identifier";

const ERROR_MESSAGES = {
  json: "Demand Controller Route public request is not passive JSON data.",
  capacity: "Demand Controller Route public request exceeds its capacity.",
  schema: "Demand Controller Route public request does not satisfy its Schema.",
  identifier:
    "Demand Controller Route public request contains an invalid Demand identity.",
} as const satisfies Readonly<
  Record<DemandControllerRoutePublicContractErrorReason, string>
>;

export class DemandControllerRoutePublicContractError extends Error {
  override readonly name = "DemandControllerRoutePublicContractError";
  readonly code = "wakeflow-demand-controller-route-public-contract" as const;
  readonly reason: DemandControllerRoutePublicContractErrorReason;
  readonly path: string;

  constructor(
    reason: DemandControllerRoutePublicContractErrorReason,
    path: string,
  ) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

const validateRequest = createRuntimeJsonSchemaValidator<RouteRequestWire>(
  WAKEFLOW_DEMAND_CONTROLLER_ROUTE_REQUEST_SCHEMA,
);

function fail(
  reason: DemandControllerRoutePublicContractErrorReason,
  path: string,
): never {
  throw new DemandControllerRoutePublicContractError(reason, path);
}

/** MCP SDK校验后重新建立递归冻结、带typed Demand ID的请求快照。 */
export function parseDemandControllerRoutePublicRequest(
  value: unknown,
): Readonly<DemandControllerRoutePublicRequest> {
  let json: JsonValue;
  try {
    json = parseJsonValue(value, "$request");
    if (
      encodeCanonicalJson(json, "$request").byteLength >
      WAKEFLOW_DEMAND_CONTROLLER_ROUTE_PUBLIC_MAXIMUM_REQUEST_BYTES
    ) {
      fail("capacity", "$request");
    }
  } catch (error: unknown) {
    if (error instanceof JsonValueError) fail("json", error.path);
    if (error instanceof DemandControllerRoutePublicContractError) throw error;
    throw error;
  }
  const result = validateRequest(json);
  if (!result.ok) fail("schema", result.path);
  let demandId: WakeflowDurableId<"demand">;
  try {
    demandId = parseWakeflowDurableIdOfKind(
      result.value.demandId,
      "demand",
      "$/demandId",
    );
  } catch (error: unknown) {
    if (error instanceof WakeflowDurableIdError) {
      fail("identifier", "$/demandId");
    }
    throw error;
  }
  return Object.freeze({
    root: result.value.root,
    demandId,
  });
}
