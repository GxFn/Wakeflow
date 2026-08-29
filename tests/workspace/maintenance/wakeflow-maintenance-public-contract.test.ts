import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";

import {
  parseWakeflowMaintenancePublicRequest,
  WakeflowMaintenancePublicContractError,
} from "../../../src/workspace/maintenance/wakeflow-maintenance-public-contract.js";

const ROOT = "/tmp/wakeflow-public-contract";
const DIGEST = `sha256:${"1".repeat(64)}`;
const OPERATION_ID =
  "maintenance_operation_11111111-1111-4111-8111-111111111111";

function plain(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

test("Public maintenance contract admits only the three closed mode shapes", () => {
  deepEqual(plain(parseWakeflowMaintenancePublicRequest({
    root: ROOT,
    action: "fresh-initialize",
    mode: "preview",
    request: { selection: { program: {} } },
  })), {
    root: ROOT,
    action: "fresh-initialize",
    mode: "preview",
    request: { selection: { program: {} } },
  });
  deepEqual(plain(parseWakeflowMaintenancePublicRequest({
    root: ROOT,
    mode: "apply",
    confirmation: { kind: "example" },
    confirmationDigest: DIGEST,
  })), {
    root: ROOT,
    mode: "apply",
    confirmation: { kind: "example" },
    confirmationDigest: DIGEST,
  });
  deepEqual(plain(parseWakeflowMaintenancePublicRequest({
    root: ROOT,
    mode: "recover",
    operationId: OPERATION_ID,
  })), {
    root: ROOT,
    mode: "recover",
    operationId: OPERATION_ID,
  });
});

test("Apply cannot select an action and recover cannot replay caller-owned plan data", () => {
  for (const value of [{
    root: ROOT,
    action: "fresh-initialize",
    mode: "apply",
    confirmation: { kind: "example" },
    confirmationDigest: DIGEST,
  }, {
    root: ROOT,
    mode: "recover",
    operationId: OPERATION_ID,
    confirmation: { kind: "example" },
    confirmationDigest: DIGEST,
  }]) {
    let caught: unknown;
    try {
      parseWakeflowMaintenancePublicRequest(value);
    } catch (error: unknown) {
      caught = error;
    }
    equal(caught instanceof WakeflowMaintenancePublicContractError, true);
    if (caught instanceof WakeflowMaintenancePublicContractError) {
      equal(caught.reason, "shape");
    }
  }
});

test("Public request rejects accessor input and bounded oversized JSON", () => {
  const accessor = {
    root: ROOT,
    action: "reconcile",
    mode: "preview",
  } as Record<string, unknown>;
  Object.defineProperty(accessor, "request", {
    enumerable: true,
    get() {
      throw new Error("must not execute");
    },
  });
  for (const value of [accessor, {
    root: ROOT,
    action: "fresh-initialize",
    mode: "preview",
    request: {
      selection: { oversized: "x".repeat(4 * 1024 * 1024) },
    },
  }]) {
    let caught: unknown;
    try {
      parseWakeflowMaintenancePublicRequest(value);
    } catch (error: unknown) {
      caught = error;
    }
    equal(caught instanceof WakeflowMaintenancePublicContractError, true);
  }
});
