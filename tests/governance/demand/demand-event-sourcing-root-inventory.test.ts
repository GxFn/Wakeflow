import {
  equal,
  rejects,
} from "node:assert/strict";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import {
  DemandFileEventStore,
} from "../../../src/governance/demand/event-sourcing/demand-file-event-store.js";
import {
  inspectDemandEventSourcingRootInventory,
  DemandEventSourcingRootInventoryError,
} from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-root-inventory.js";

test("Demand Event Sourcing root inventory 同时证明允许项与未知项不存在", async () => {
  const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), "wakeflow-demand-root-inventory-"));
  chmodSync(fixtureRoot, 0o700);
  const root = await RootedDirectory.open(fixtureRoot);
  try {
    const store = new DemandFileEventStore(root);
    await store.initialize();
    writeFileSync(path.join(fixtureRoot, "identity.json"), "{}\n", { mode: 0o600 });
    writeFileSync(path.join(fixtureRoot, "authority.json"), "{}\n", { mode: 0o600 });
    mkdirSync(path.join(fixtureRoot, "artifacts"), { mode: 0o700 });
    mkdirSync(path.join(fixtureRoot, "transactions"), { mode: 0o700 });

    const inventory = await inspectDemandEventSourcingRootInventory(root);
    equal(inventory.commitCount, 0);
    equal(inventory.snapshotCount, 0);
    equal(inventory.artifactCount, 0);

    writeFileSync(path.join(fixtureRoot, "unknown.txt"), "not-owned\n", {
      mode: 0o600,
    });
    await rejects(
      inspectDemandEventSourcingRootInventory(root),
      (error: unknown) => (
        error instanceof DemandEventSourcingRootInventoryError
        && error.reason === "tree-shape"
      ),
    );
    rmSync(path.join(fixtureRoot, "unknown.txt"));
    writeFileSync(path.join(
      fixtureRoot,
      "event-sourcing",
      "append-candidates",
      "residue.json",
    ), "residue\n", { mode: 0o600 });
    await rejects(
      inspectDemandEventSourcingRootInventory(root),
      (error: unknown) => (
        error instanceof DemandEventSourcingRootInventoryError
        && error.reason === "tree-shape"
      ),
    );
  } finally {
    await root.close();
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});
