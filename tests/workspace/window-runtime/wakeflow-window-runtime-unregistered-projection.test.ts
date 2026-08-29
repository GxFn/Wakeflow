import { deepEqual, equal, notEqual } from "node:assert/strict";
import { test } from "node:test";

import {
  claudeCodeWorkspaceHostResourceProfile,
} from "../../../src/hosts/claude-code/wakeflow-workspace-host-resource-profile.js";
import {
  codexWorkspaceHostResourceProfile,
} from "../../../src/hosts/codex/wakeflow-workspace-host-resource-profile.js";
import {
  compileWakeflowWindowRuntimeUnregisteredProjectionSet,
  parseWakeflowWindowRuntimeUnregisteredProjection,
  parseWakeflowWindowRuntimeUnregisteredProjectionDocument,
  renderWakeflowWindowRuntimeUnregisteredProjection,
  WakeflowWindowRuntimeUnregisteredProjectionRecordError,
  type WakeflowWindowRuntimeUnregisteredProjectionErrorReason,
} from "../../../src/workspace/window-runtime/wakeflow-window-runtime-unregistered-projection.js";
import {
  createWakeflowWindowRuntimeProjectionResourceCatalog,
} from "../../../src/workspace/window-runtime/wakeflow-window-runtime-resource-catalog.js";
import {
  compileWakeflowFreshWindowRuntimeAuthority,
} from "../../../src/workspace/window-runtime/wakeflow-window-runtime-fresh-authority.js";
import {
  createMinimalWakeflowConfigV3,
} from "../../configuration/wakeflow-config-v3.fixture.js";

function expectRecordError(
  action: () => unknown,
  reason: WakeflowWindowRuntimeUnregisteredProjectionErrorReason,
): void {
  let caught: unknown;
  try {
    action();
  } catch (error: unknown) {
    caught = error;
  }
  equal(
    caught instanceof WakeflowWindowRuntimeUnregisteredProjectionRecordError,
    true,
  );
  if (caught instanceof WakeflowWindowRuntimeUnregisteredProjectionRecordError) {
    equal(caught.reason, reason);
  }
}

test("fresh Window Runtime projections are deterministic and explicitly unregistered", () => {
  const config = createMinimalWakeflowConfigV3();
  const left = compileWakeflowWindowRuntimeUnregisteredProjectionSet(
    config,
    codexWorkspaceHostResourceProfile,
  );
  const right = compileWakeflowWindowRuntimeUnregisteredProjectionSet(
    config,
    codexWorkspaceHostResourceProfile,
  );
  deepEqual(right, left);
  equal(left.entries.length, 4);
  equal(
    left.projectionRootRef,
    ".wakeflow-local/runtime/hosts/codex/projections/window-runtime",
  );
  equal(left.entries.every((entry) => (
    entry.projection.identity.status === "unregistered"
    && entry.projection.rootObservation.status === "unobserved"
    && entry.projection.preflight.status === "blocked"
    && entry.projection.preflight.blockingReasons[0].code
      === "identity-unregistered"
    && entry.document.endsWith("\n")
    && !entry.document.endsWith("\n\n")
  )), true);
  equal(left.entries.every((entry) => (
    entry.resourceRef.endsWith(`/${entry.windowId}.json`)
  )), true);
  const serialized = JSON.stringify(left);
  for (const forbidden of [
    "displayName",
    "dispatchEligibility",
    "hostAvailability",
    "absolutePath",
    "bindingId",
    "handle",
    "generatedAt",
  ]) {
    equal(serialized.includes(forbidden), false);
  }

  const catalog = createWakeflowWindowRuntimeProjectionResourceCatalog(
    config,
    codexWorkspaceHostResourceProfile,
  );
  equal(catalog.length, left.entries.length);
  deepEqual(
    catalog.map((entry) => entry.placement.relativePath),
    left.entries.map((entry) => entry.resourceRef),
  );
  equal(catalog.every((entry) => (
    entry.ownerId === "window-runtime-projection"
    && entry.nodePolicy.kind === "file"
    && entry.nodePolicy.mode === "0600"
    && entry.processing.kind === "resource"
    && entry.processing.role === "derived-projection"
  )), true);

  const authority = compileWakeflowFreshWindowRuntimeAuthority(
    config,
    codexWorkspaceHostResourceProfile,
  );
  equal(authority.layoutDeclarations.length, 6);
  equal(authority.projectionDeclarations.length, left.entries.length);
  equal(authority.projectionSet.projectionSetDigest, left.projectionSetDigest);
  equal(/^sha256:[0-9a-f]{64}$/u.test(authority.authorityDigest), true);
});

test("projection set changes only with runtime topology or current host", () => {
  const baselineValue = createMinimalWakeflowConfigV3();
  const baseline = compileWakeflowWindowRuntimeUnregisteredProjectionSet(
    baselineValue,
    codexWorkspaceHostResourceProfile,
  );
  const textChanged = createMinimalWakeflowConfigV3();
  (textChanged.presentation as Record<string, unknown>).language = "zh-Hans";
  const windows = (textChanged.topology as {
    windows: Record<string, unknown>[];
  }).windows;
  const controller = windows[0];
  if (controller === undefined) throw new Error("Expected Controller window.");
  controller.displayName = "总控窗口";
  const sameRuntime = compileWakeflowWindowRuntimeUnregisteredProjectionSet(
    textChanged,
    codexWorkspaceHostResourceProfile,
  );
  equal(sameRuntime.projectionSetDigest, baseline.projectionSetDigest);

  const movedValue = createMinimalWakeflowConfigV3();
  const surfaces = (movedValue.topology as {
    supportSurfaces: Record<string, unknown>[];
  }).supportSurfaces;
  const design = surfaces[0];
  if (design === undefined) throw new Error("Expected Design surface.");
  design.path = "DesignMoved";
  const moved = compileWakeflowWindowRuntimeUnregisteredProjectionSet(
    movedValue,
    codexWorkspaceHostResourceProfile,
  );
  notEqual(moved.projectionSetDigest, baseline.projectionSetDigest);

  const claude = compileWakeflowWindowRuntimeUnregisteredProjectionSet(
    baselineValue,
    claudeCodeWorkspaceHostResourceProfile,
  );
  notEqual(claude.projectionSetDigest, baseline.projectionSetDigest);
  equal(
    claude.projectionRootRef,
    ".wakeflow-local/runtime/hosts/claude-code/projections/window-runtime",
  );
});

test("persisted unregistered projection rejects relation, digest, and representation drift", () => {
  const set = compileWakeflowWindowRuntimeUnregisteredProjectionSet(
    createMinimalWakeflowConfigV3(),
    codexWorkspaceHostResourceProfile,
  );
  const entry = set.entries[0];
  if (entry === undefined) throw new Error("Expected Controller projection.");
  deepEqual(
    parseWakeflowWindowRuntimeUnregisteredProjectionDocument(entry.document),
    entry.projection,
  );
  equal(
    renderWakeflowWindowRuntimeUnregisteredProjection(entry.projection),
    entry.document,
  );

  const digestDrift = JSON.parse(entry.document) as Record<string, unknown>;
  digestDrift.projectionDigest = `sha256:${"0".repeat(64)}`;
  expectRecordError(
    () => parseWakeflowWindowRuntimeUnregisteredProjection(digestDrift),
    "digest",
  );

  const relationDrift = JSON.parse(entry.document) as Record<string, unknown>;
  relationDrift.role = "product";
  expectRecordError(
    () => parseWakeflowWindowRuntimeUnregisteredProjection(relationDrift),
    "relation",
  );

  const unknownField = JSON.parse(entry.document) as Record<string, unknown>;
  unknownField.handle = "forbidden";
  expectRecordError(
    () => parseWakeflowWindowRuntimeUnregisteredProjection(unknownField),
    "schema",
  );

  expectRecordError(
    () => parseWakeflowWindowRuntimeUnregisteredProjectionDocument(
      JSON.stringify(entry.projection),
    ),
    "representation",
  );
});
