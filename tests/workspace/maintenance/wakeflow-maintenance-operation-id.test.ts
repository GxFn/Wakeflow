import { equal } from "node:assert/strict";
import { test } from "node:test";

import {
  createWakeflowMaintenanceOperationId,
  parseWakeflowMaintenanceOperationId,
  wakeflowMaintenanceIntentRef,
  wakeflowMaintenanceJournalRef,
  wakeflowMaintenanceOperationUuid,
  WakeflowMaintenanceOperationIdError,
} from "../../../src/workspace/maintenance/wakeflow-maintenance-operation-id.js";

const UUID = "11111111-1111-4111-8111-111111111111";

test("maintenance operation ID is domain-local UUID identity", () => {
  const operationId = createWakeflowMaintenanceOperationId(() => UUID);
  equal(operationId, `maintenance_operation_${UUID}`);
  equal(parseWakeflowMaintenanceOperationId(operationId), operationId);
  equal(wakeflowMaintenanceOperationUuid(operationId), UUID);
  equal(
    wakeflowMaintenanceIntentRef(operationId),
    `.wakeflow-local/runtime/maintenance/transactions/${operationId}.intent.json`,
  );
  equal(
    wakeflowMaintenanceJournalRef(operationId),
    `.wakeflow-local/runtime/maintenance/transactions/${operationId}.journal.json`,
  );
});

test("maintenance operation ID rejects aliases and invalid factories", () => {
  for (const action of [
    () => parseWakeflowMaintenanceOperationId(UUID),
    () => parseWakeflowMaintenanceOperationId(
      "maintenance_operation_11111111-1111-5111-8111-111111111111",
    ),
    () => createWakeflowMaintenanceOperationId(() => "invalid"),
  ]) {
    let caught: unknown;
    try {
      action();
    } catch (error: unknown) {
      caught = error;
    }
    equal(caught instanceof WakeflowMaintenanceOperationIdError, true);
  }
});
