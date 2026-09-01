import { equal, rejects } from "node:assert/strict";
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
import { DemandFileEventStore } from "../../../src/governance/demand/event-sourcing/demand-file-event-store.js";
import {
  inspectDemandEventSourcingRootInventory,
  DemandEventSourcingRootInventoryError,
} from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-root-inventory.js";

test("Demand Event Sourcing root inventory 同时证明允许项与未知项不存在", async () => {
  const fixtureRoot = mkdtempSync(
    path.join(os.tmpdir(), "wakeflow-demand-root-inventory-"),
  );
  chmodSync(fixtureRoot, 0o700);
  const root = await RootedDirectory.open(fixtureRoot);
  try {
    const store = new DemandFileEventStore(root);
    await store.initialize();
    writeFileSync(path.join(fixtureRoot, "identity.json"), "{}\n", {
      mode: 0o600,
    });
    writeFileSync(path.join(fixtureRoot, "authority.json"), "{}\n", {
      mode: 0o600,
    });
    mkdirSync(path.join(fixtureRoot, "artifacts"), { mode: 0o700 });
    mkdirSync(path.join(fixtureRoot, "artifacts", "task-packages"), {
      mode: 0o700,
    });
    mkdirSync(path.join(fixtureRoot, "transactions"), { mode: 0o700 });

    const inventory = await inspectDemandEventSourcingRootInventory(root);
    equal(inventory.commitCount, 0);
    equal(inventory.snapshotCount, 0);
    equal(inventory.artifactCount, 0);

    const projectionPath = path.join(
      fixtureRoot,
      "artifacts",
      "task-packages",
      "task-package_11111111-1111-4111-8111-111111111111.json",
    );
    writeFileSync(projectionPath, "{}\n", { mode: 0o600 });
    equal(
      (await inspectDemandEventSourcingRootInventory(root)).artifactCount,
      1,
    );
    rmSync(projectionPath);

    mkdirSync(path.join(fixtureRoot, "artifacts", "test-cards"), {
      mode: 0o700,
    });
    mkdirSync(path.join(fixtureRoot, "artifacts", "test-dispatch-packets"), {
      mode: 0o700,
    });
    const testCardPath = path.join(
      fixtureRoot,
      "artifacts",
      "test-cards",
      "test-card_22222222-2222-4222-8222-222222222222.json",
    );
    const packetPath = path.join(
      fixtureRoot,
      "artifacts",
      "test-dispatch-packets",
      "target-delivery_33333333-3333-4333-8333-333333333333.json",
    );
    writeFileSync(testCardPath, "{}\n", { mode: 0o600 });
    writeFileSync(packetPath, "{}\n", { mode: 0o600 });
    const testingInventory =
      await inspectDemandEventSourcingRootInventory(root);
    equal(testingInventory.artifactCount, 2);
    equal(testingInventory.nodes.testCards?.kind, "directory");
    equal(testingInventory.nodes.testDispatchPackets?.kind, "directory");
    rmSync(testCardPath);
    rmSync(packetPath);
    const invalidTestCardPath = path.join(
      fixtureRoot,
      "artifacts",
      "test-cards",
      "foreign.json",
    );
    writeFileSync(invalidTestCardPath, "{}\n", { mode: 0o600 });
    await rejects(
      inspectDemandEventSourcingRootInventory(root),
      (error: unknown) =>
        error instanceof DemandEventSourcingRootInventoryError &&
        error.reason === "tree-shape",
    );
    rmSync(invalidTestCardPath);

    const invalidProjectionPath = path.join(
      fixtureRoot,
      "artifacts",
      "task-packages",
      "foreign.json",
    );
    writeFileSync(invalidProjectionPath, "{}\n", { mode: 0o600 });
    await rejects(
      inspectDemandEventSourcingRootInventory(root),
      (error: unknown) =>
        error instanceof DemandEventSourcingRootInventoryError &&
        error.reason === "tree-shape",
    );
    rmSync(invalidProjectionPath);

    const unknownArtifactRoot = path.join(fixtureRoot, "artifacts", "foreign");
    mkdirSync(unknownArtifactRoot, { mode: 0o700 });
    await rejects(
      inspectDemandEventSourcingRootInventory(root),
      (error: unknown) =>
        error instanceof DemandEventSourcingRootInventoryError &&
        error.reason === "tree-shape",
    );
    rmSync(unknownArtifactRoot, { recursive: true });

    writeFileSync(path.join(fixtureRoot, "unknown.txt"), "not-owned\n", {
      mode: 0o600,
    });
    await rejects(
      inspectDemandEventSourcingRootInventory(root),
      (error: unknown) =>
        error instanceof DemandEventSourcingRootInventoryError &&
        error.reason === "tree-shape",
    );
    rmSync(path.join(fixtureRoot, "unknown.txt"));
    writeFileSync(
      path.join(
        fixtureRoot,
        "event-sourcing",
        "append-candidates",
        "residue.json",
      ),
      "residue\n",
      { mode: 0o600 },
    );
    await rejects(
      inspectDemandEventSourcingRootInventory(root),
      (error: unknown) =>
        error instanceof DemandEventSourcingRootInventoryError &&
        error.reason === "tree-shape",
    );
  } finally {
    await root.close();
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});
