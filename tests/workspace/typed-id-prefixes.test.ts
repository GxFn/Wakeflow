import { equal } from "node:assert/strict";
import { test } from "node:test";
import { WAKEFLOW_TYPED_ID_PREFIXES } from "../../src/contracts/identity/wakeflow-typed-id-prefixes.js";
import { DEFAULT_ALLOWED_ID_PREFIXES, scanPrivacy } from "../../src/kernel/privacy-scan.js";
import { createWakeflowMaintenanceOperationId } from "../../src/workspace/maintenance/wakeflow-maintenance-operation-id.js";
import { createWakeflowWindowHostBindingId } from "../../src/workspace/window-runtime/wakeflow-window-host-binding-id.js";

test("每个带前缀身份的生产者都登记在 contracts 的前缀清单里，隐私扫描放行它们的输出（§13.161 B9-1）", () => {
  equal(DEFAULT_ALLOWED_ID_PREFIXES, WAKEFLOW_TYPED_ID_PREFIXES);
  for (const id of [createWakeflowWindowHostBindingId(), createWakeflowMaintenanceOperationId()]) {
    equal(WAKEFLOW_TYPED_ID_PREFIXES.some((prefix) => id.startsWith(prefix)), true, id);
    equal(
      scanPrivacy(`id ${id}`, { allowedPathRoots: [], allowedIdPrefixes: DEFAULT_ALLOWED_ID_PREFIXES }).length,
      0,
      id,
    );
  }
});
