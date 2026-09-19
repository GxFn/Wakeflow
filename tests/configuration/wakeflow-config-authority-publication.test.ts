import {
  equal,
} from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  publishWakeflowConfigAuthority,
  WakeflowConfigAuthorityPublicationError,
  type WakeflowConfigAuthorityPublicationErrorReason,
} from "../../src/configuration/wakeflow-config-authority-publication.js";
import {
  computeWakeflowConfigDigest,
  parseWakeflowConfig,
} from "../../src/configuration/wakeflow-config.js";
import { renderWakeflowConfig } from "../../src/configuration/wakeflow-config-document.js";
import { sameFileNodeSnapshot } from "../../src/foundation/filesystem/file-node-snapshot.js";
import { RootedDirectory } from "../../src/foundation/filesystem/rooted-directory.js";
import { createMinimalWakeflowConfig } from "./wakeflow-config.fixture.js";

interface WorkspaceFixture {
  readonly temporaryRoot: string;
  readonly workspaceRoot: string;
  readonly configPath: string;
}

function createWorkspace(): WorkspaceFixture {
  const temporaryRoot = realpathSync(mkdtempSync(path.join(
    os.tmpdir(),
    "wakeflow-config-publication-",
  )));
  const workspaceRoot = path.join(temporaryRoot, "WakeflowProgram");
  mkdirSync(workspaceRoot, { mode: 0o755 });
  mkdirSync(path.join(temporaryRoot, "ProductA"), { mode: 0o755 });
  mkdirSync(path.join(temporaryRoot, "wakeflow-ledger"), { mode: 0o755 });
  return {
    temporaryRoot,
    workspaceRoot,
    configPath: path.join(workspaceRoot, "wakeflow.config.json"),
  };
}

async function expectPublicationError(
  action: () => unknown | Promise<unknown>,
  reason: WakeflowConfigAuthorityPublicationErrorReason,
): Promise<void> {
  let caught: unknown;
  try {
    await action();
  } catch (error: unknown) {
    caught = error;
  }
  if (!(caught instanceof WakeflowConfigAuthorityPublicationError)) {
    throw new Error("Expected WakeflowConfigAuthorityPublicationError.");
  }
  equal(caught.code, "wakeflow-config-authority-publication");
  equal(caught.reason, reason);
}

test("Config authority publication 持久创建0644文件并由Snapshot readback闭合", async () => {
  const fixture = createWorkspace();
  const root = await RootedDirectory.open(fixture.workspaceRoot);
  const value = createMinimalWakeflowConfig();
  try {
    const receipt = await publishWakeflowConfigAuthority(root, value);
    const expectedModel = parseWakeflowConfig(value);
    const expectedText = renderWakeflowConfig(expectedModel);

    equal(receipt.publication.publication, "created");
    equal(receipt.publication.resourcePath, "wakeflow.config.json");
    equal(receipt.publication.node.kind, "file");
    equal(receipt.publication.node.permissionBits, 0o644);
    equal(receipt.publication.node.linkCount, 1n);
    equal(receipt.authority.source.digest, receipt.publication.digest);
    equal(receipt.authority.source.byteCount, receipt.publication.byteCount);
    equal(
      sameFileNodeSnapshot(
        receipt.authority.source.node,
        receipt.publication.node,
      ),
      true,
    );
    equal(
      receipt.authority.configDigest,
      computeWakeflowConfigDigest(expectedModel),
    );
    equal(readFileSync(fixture.configPath, "utf8"), expectedText);
    equal(statSync(fixture.configPath).mode & 0o777, 0o644);
    equal(
      readdirSync(fixture.workspaceRoot).some(
        (name) => name.startsWith(".wakeflow-atomic-"),
      ),
      false,
    );
    equal(Object.isFrozen(receipt), true);
    equal(Object.isFrozen(receipt.publication), true);
    equal(Object.isFrozen(receipt.authority), true);
  } finally {
    await root.close();
    rmSync(fixture.temporaryRoot, { recursive: true, force: true });
  }
});

test("Config authority publication 是absent-only且不覆盖任何现存目标", async () => {
  const fixture = createWorkspace();
  const root = await RootedDirectory.open(fixture.workspaceRoot);
  try {
    const original = createMinimalWakeflowConfig();
    await publishWakeflowConfigAuthority(root, original);
    const before = readFileSync(fixture.configPath, "utf8");
    const changed = createMinimalWakeflowConfig();
    (changed.program as Record<string, unknown>).displayName = "Changed";

    await expectPublicationError(
      () => publishWakeflowConfigAuthority(root, changed),
      "target-exists",
    );
    equal(readFileSync(fixture.configPath, "utf8"), before);
  } finally {
    await root.close();
    rmSync(fixture.temporaryRoot, { recursive: true, force: true });
  }

  const unknownFixture = createWorkspace();
  writeFileSync(unknownFixture.configPath, "external-owner-bytes\n", {
    mode: 0o600,
  });
  const unknownRoot = await RootedDirectory.open(unknownFixture.workspaceRoot);
  try {
    await expectPublicationError(
      () => publishWakeflowConfigAuthority(
        unknownRoot,
        createMinimalWakeflowConfig(),
      ),
      "target-exists",
    );
    equal(
      readFileSync(unknownFixture.configPath, "utf8"),
      "external-owner-bytes\n",
    );
  } finally {
    await unknownRoot.close();
    rmSync(unknownFixture.temporaryRoot, { recursive: true, force: true });
  }
});

test("Config authority publication 在非法、超限或取消输入下保持零effect", async () => {
  const invalidFixture = createWorkspace();
  const invalidRoot = await RootedDirectory.open(invalidFixture.workspaceRoot);
  try {
    await expectPublicationError(
      () => publishWakeflowConfigAuthority(invalidRoot, {
        ...createMinimalWakeflowConfig(),
        kind: "WrongConfig",
      }),
      "config",
    );
    equal(existsSync(invalidFixture.configPath), false);
  } finally {
    await invalidRoot.close();
    rmSync(invalidFixture.temporaryRoot, { recursive: true, force: true });
  }

  const placementFixture = createWorkspace();
  const placementRoot = await RootedDirectory.open(
    placementFixture.workspaceRoot,
  );
  try {
    const value = createMinimalWakeflowConfig();
    (value.storage as Record<string, unknown>).ledgerRoot = ".wakeflow-active";
    await expectPublicationError(
      () => publishWakeflowConfigAuthority(placementRoot, value),
      "placement",
    );
    equal(existsSync(placementFixture.configPath), false);
  } finally {
    await placementRoot.close();
    rmSync(placementFixture.temporaryRoot, { recursive: true, force: true });
  }

  const capacityFixture = createWorkspace();
  const capacityRoot = await RootedDirectory.open(capacityFixture.workspaceRoot);
  try {
    const value = createMinimalWakeflowConfig();
    (value.program as Record<string, unknown>).description = "x".repeat(
      1024 * 1024,
    );
    await expectPublicationError(
      () => publishWakeflowConfigAuthority(capacityRoot, value),
      "capacity",
    );
    equal(existsSync(capacityFixture.configPath), false);
  } finally {
    await capacityRoot.close();
    rmSync(capacityFixture.temporaryRoot, { recursive: true, force: true });
  }

  const abortedFixture = createWorkspace();
  const abortedRoot = await RootedDirectory.open(abortedFixture.workspaceRoot);
  try {
    const controller = new AbortController();
    controller.abort("private-abort-reason");
    await expectPublicationError(
      () => publishWakeflowConfigAuthority(
        abortedRoot,
        createMinimalWakeflowConfig(),
        { signal: controller.signal },
      ),
      "aborted",
    );
    equal(existsSync(abortedFixture.configPath), false);

    let getterCalls = 0;
    const decorated = {};
    Object.defineProperty(decorated, "signal", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return undefined;
      },
    });
    await expectPublicationError(
      () => publishWakeflowConfigAuthority(
        abortedRoot,
        createMinimalWakeflowConfig(),
        decorated as never,
      ),
      "input",
    );
    equal(getterCalls, 0);
    equal(existsSync(abortedFixture.configPath), false);
  } finally {
    await abortedRoot.close();
    rmSync(abortedFixture.temporaryRoot, { recursive: true, force: true });
  }
});
