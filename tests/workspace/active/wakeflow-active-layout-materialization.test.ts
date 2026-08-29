import { deepEqual, equal } from "node:assert/strict";
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";

import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import {
  inspectWakeflowActiveLayout,
} from "../../../src/workspace/active/wakeflow-active-layout-inspection.js";
import {
  materializeWakeflowActiveLayout,
  WakeflowActiveLayoutMaterializationError,
} from "../../../src/workspace/active/wakeflow-active-layout-materialization.js";
import {
  WAKEFLOW_ACTIVE_LAYOUT_RESOURCE_CATALOG,
} from "../../../src/workspace/active/wakeflow-active-resource-catalog.js";

async function fixture(t: TestContext) {
  const absolutePath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-active-layout-"));
  const root = await RootedDirectory.open(absolutePath);
  t.after(async () => {
    await root.close();
    rmSync(absolutePath, { recursive: true, force: true });
  });
  return Object.freeze({ absolutePath, root });
}

test("Active Layout owns and materializes both shared private containers", async (t) => {
  deepEqual(WAKEFLOW_ACTIVE_LAYOUT_RESOURCE_CATALOG.map((entry) => ({
    declarationId: entry.declarationId,
    ownerId: entry.ownerId,
    path: entry.placement.relativePath,
  })), [{
    declarationId: "active.root",
    ownerId: "active-layout",
    path: ".wakeflow-active",
  }, {
    declarationId: "active.current-root",
    ownerId: "active-layout",
    path: ".wakeflow-active/current",
  }]);

  const value = await fixture(t);
  equal((await inspectWakeflowActiveLayout(value.root)).status, "absent");
  const created = await materializeWakeflowActiveLayout(value.root, {
    recoveringFreshLayout: false,
  });
  equal(created.disposition, "created");
  deepEqual(created.entries.map((entry) => entry.disposition), [
    "created",
    "created",
  ]);
  equal((await inspectWakeflowActiveLayout(value.root)).status, "current");

  let normalError: unknown;
  try {
    await materializeWakeflowActiveLayout(value.root, {
      recoveringFreshLayout: false,
    });
  } catch (error: unknown) {
    normalError = error;
  }
  equal(normalError instanceof WakeflowActiveLayoutMaterializationError, true);
  if (normalError instanceof WakeflowActiveLayoutMaterializationError) {
    equal(normalError.reason, "strict-absent");
  }
  const recovered = await materializeWakeflowActiveLayout(value.root, {
    recoveringFreshLayout: true,
  });
  equal(recovered.disposition, "current");
});

test("Active Layout recovery fills only an exact partial prefix", async (t) => {
  const partial = await fixture(t);
  mkdirSync(path.join(partial.absolutePath, ".wakeflow-active"), { mode: 0o700 });
  chmodSync(path.join(partial.absolutePath, ".wakeflow-active"), 0o700);
  equal((await inspectWakeflowActiveLayout(partial.root)).status, "incomplete");
  const recovered = await materializeWakeflowActiveLayout(partial.root, {
    recoveringFreshLayout: true,
  });
  deepEqual(recovered.entries.map((entry) => entry.disposition), [
    "current",
    "created",
  ]);

  chmodSync(
    path.join(partial.absolutePath, ".wakeflow-active", "current"),
    0o755,
  );
  equal((await inspectWakeflowActiveLayout(partial.root)).status, "conflict");
  let conflict: unknown;
  try {
    await materializeWakeflowActiveLayout(partial.root, {
      recoveringFreshLayout: true,
    });
  } catch (error: unknown) {
    conflict = error;
  }
  equal(conflict instanceof WakeflowActiveLayoutMaterializationError, true);
  if (conflict instanceof WakeflowActiveLayoutMaterializationError) {
    equal(conflict.reason, "node-policy");
  }
});
