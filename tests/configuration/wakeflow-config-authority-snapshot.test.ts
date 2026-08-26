import { equal } from "node:assert/strict";
import {
  chmodSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  readWakeflowConfigAuthoritySnapshot,
  WakeflowConfigAuthoritySnapshotError,
  type WakeflowConfigAuthoritySnapshotErrorReason,
} from "../../src/configuration/wakeflow-config-authority-snapshot.js";
import { RootedDirectory } from "../../src/foundation/filesystem/rooted-directory.js";
import {
  createMinimalWakeflowConfigV3,
  serializeWakeflowConfigV3Fixture,
} from "./wakeflow-config-v3.fixture.js";

interface WorkspaceFixture {
  readonly temporaryRoot: string;
  readonly workspaceRoot: string;
  readonly configPath: string;
}

function createWorkspace(value: unknown = createMinimalWakeflowConfigV3()): WorkspaceFixture {
  const temporaryRoot = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "wakeflow-config-authority-ts-")),
  );
  const workspaceRoot = path.join(temporaryRoot, "WakeflowProgram");
  mkdirSync(workspaceRoot);
  mkdirSync(path.join(temporaryRoot, "ProductA"));
  mkdirSync(path.join(temporaryRoot, "wakeflow-ledger"));
  const configPath = path.join(workspaceRoot, "wakeflow.config.json");
  writeFileSync(configPath, serializeWakeflowConfigV3Fixture(value), {
    mode: 0o600,
  });
  return { temporaryRoot, workspaceRoot, configPath };
}

async function expectSnapshotError(
  action: () => unknown | Promise<unknown>,
  reason: WakeflowConfigAuthoritySnapshotErrorReason,
): Promise<void> {
  let caught: unknown;
  try {
    await action();
  } catch (error: unknown) {
    caught = error;
  }
  if (!(caught instanceof WakeflowConfigAuthoritySnapshotError)) {
    throw new Error("Expected WakeflowConfigAuthoritySnapshotError.");
  }
  equal(caught.code, "wakeflow-config-authority-snapshot");
  equal(caught.reason, reason);
}

test("snapshot binds the legacy source/config digests to one stable workspace read", async () => {
  const fixture = createWorkspace();
  const root = await RootedDirectory.open(fixture.workspaceRoot);
  try {
    const snapshot = await readWakeflowConfigAuthoritySnapshot(root);
    equal(snapshot.kind, "WakeflowConfigAuthoritySnapshot");
    equal(snapshot.schemaVersion, 1);
    equal(snapshot.workspaceRoot, fixture.workspaceRoot);
    equal(snapshot.source.resourcePath, "wakeflow.config.json");
    equal(snapshot.source.byteCount, 2190);
    equal(
      snapshot.source.digest,
      "sha256:a87e8f7248b8f90efaa07958b301fa2ab9e2b2a5e1795ad531e65d07c61b3cd4",
    );
    equal(
      snapshot.configDigest,
      "sha256:5a1a8b2ab2439d9add5942eea455ceba693a28f643af1631ea6f1d62f3997081",
    );
    equal(snapshot.indexes.controllerWindow.role, "controller");
    equal(snapshot.ledgerRoot, path.join(fixture.temporaryRoot, "wakeflow-ledger"));
    equal(
      snapshot.placements.roots.find((entry) => entry.key === "repository.repository_22222222-2222-4222-8222-222222222222.root")?.state,
      "present",
    );
    equal(Object.isFrozen(snapshot), true);
    equal(Object.isFrozen(snapshot.source), true);
  } finally {
    await root.close();
    rmSync(fixture.temporaryRoot, { recursive: true, force: true });
  }
});

test("domain field-order drift is rejected instead of becoming another config representation", async () => {
  const value = createMinimalWakeflowConfigV3();
  const fixture = createWorkspace(value);
  const root = await RootedDirectory.open(fixture.workspaceRoot);
  try {
    await readWakeflowConfigAuthoritySnapshot(root);
    const reordered = Object.fromEntries(Object.entries(value).reverse());
    writeFileSync(
      fixture.configPath,
      `${JSON.stringify(reordered, null, 2)}\n`,
      { mode: 0o600 },
    );
    await expectSnapshotError(
      () => readWakeflowConfigAuthoritySnapshot(root),
      "representation",
    );
  } finally {
    await root.close();
    rmSync(fixture.temporaryRoot, { recursive: true, force: true });
  }
});

test("encoding, JSON, Schema and source node policy remain distinct failures", async () => {
  const scenarios: Array<{
    readonly reason: WakeflowConfigAuthoritySnapshotErrorReason;
    readonly prepare: (fixture: WorkspaceFixture) => void;
  }> = [
    {
      reason: "encoding",
      prepare: (fixture) => writeFileSync(
        fixture.configPath,
        Buffer.from([0xc3, 0x28]),
      ),
    },
    {
      reason: "json",
      prepare: (fixture) => writeFileSync(fixture.configPath, "{not-json}\n"),
    },
    {
      reason: "config",
      prepare: (fixture) => writeFileSync(
        fixture.configPath,
        serializeWakeflowConfigV3Fixture({
          ...createMinimalWakeflowConfigV3(),
          unknown: true,
        }),
      ),
    },
    {
      reason: "source-policy",
      prepare: (fixture) => chmodSync(fixture.configPath, 0o700),
    },
  ];
  for (const scenario of scenarios) {
    const fixture = createWorkspace();
    const root = await RootedDirectory.open(fixture.workspaceRoot);
    try {
      scenario.prepare(fixture);
      await expectSnapshotError(
        () => readWakeflowConfigAuthoritySnapshot(root),
        scenario.reason,
      );
    } finally {
      await root.close();
      rmSync(fixture.temporaryRoot, { recursive: true, force: true });
    }
  }
});

test("config symlink and hard-link aliases cannot become authority", async () => {
  const linked = createWorkspace();
  const linkedRoot = await RootedDirectory.open(linked.workspaceRoot);
  try {
    const target = path.join(linked.temporaryRoot, "config-target.json");
    rmSync(linked.configPath);
    writeFileSync(target, serializeWakeflowConfigV3Fixture(createMinimalWakeflowConfigV3()));
    symlinkSync(target, linked.configPath);
    await expectSnapshotError(
      () => readWakeflowConfigAuthoritySnapshot(linkedRoot),
      "source",
    );
  } finally {
    await linkedRoot.close();
    rmSync(linked.temporaryRoot, { recursive: true, force: true });
  }

  const hardlinked = createWorkspace();
  const hardlinkedRoot = await RootedDirectory.open(hardlinked.workspaceRoot);
  try {
    const target = path.join(hardlinked.temporaryRoot, "config-hardlink.json");
    rmSync(hardlinked.configPath);
    writeFileSync(target, serializeWakeflowConfigV3Fixture(createMinimalWakeflowConfigV3()));
    linkSync(target, hardlinked.configPath);
    await expectSnapshotError(
      () => readWakeflowConfigAuthoritySnapshot(hardlinkedRoot),
      "source-policy",
    );
  } finally {
    await hardlinkedRoot.close();
    rmSync(hardlinked.temporaryRoot, { recursive: true, force: true });
  }
});

test("overlapping and symlinked configured roots fail before snapshot publication", async () => {
  const overlapValue = createMinimalWakeflowConfigV3();
  (overlapValue.storage as Record<string, unknown>).ledgerRoot = ".wakeflow-active";
  const overlap = createWorkspace(overlapValue);
  const overlapRoot = await RootedDirectory.open(overlap.workspaceRoot);
  try {
    await expectSnapshotError(
      () => readWakeflowConfigAuthoritySnapshot(overlapRoot),
      "placement",
    );
  } finally {
    await overlapRoot.close();
    rmSync(overlap.temporaryRoot, { recursive: true, force: true });
  }

  const symbolic = createWorkspace();
  const outside = path.join(symbolic.temporaryRoot, "outside-design");
  mkdirSync(outside);
  symlinkSync(outside, path.join(symbolic.workspaceRoot, "Design"), "dir");
  const symbolicRoot = await RootedDirectory.open(symbolic.workspaceRoot);
  try {
    await expectSnapshotError(
      () => readWakeflowConfigAuthoritySnapshot(symbolicRoot),
      "placement",
    );
  } finally {
    await symbolicRoot.close();
    rmSync(symbolic.temporaryRoot, { recursive: true, force: true });
  }
});

test("snapshot options are passive and support cancellation", async () => {
  const fixture = createWorkspace();
  const root = await RootedDirectory.open(fixture.workspaceRoot);
  try {
    const controller = new AbortController();
    controller.abort();
    await expectSnapshotError(
      () => readWakeflowConfigAuthoritySnapshot(root, {
        signal: controller.signal,
      }),
      "aborted",
    );
    await expectSnapshotError(
      () => readWakeflowConfigAuthoritySnapshot(root, null as never),
      "input",
    );
  } finally {
    await root.close();
    rmSync(fixture.temporaryRoot, { recursive: true, force: true });
  }
});
