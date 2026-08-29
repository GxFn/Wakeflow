import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";

import {
  compileWakeflowFreshConfigSelection,
  WakeflowFreshConfigSelectionError,
} from "../../src/configuration/wakeflow-fresh-config-selection.js";
import {
  createMinimalWakeflowFreshConfigSelection,
  createSequenceUuidV4Factory,
  MINIMAL_WAKEFLOW_FRESH_SELECTION_UUIDS as UUIDS,
} from "./wakeflow-fresh-config-selection.fixture.js";

test("Fresh selection allocates typed IDs and resolves request-local roots", () => {
  const input = createMinimalWakeflowFreshConfigSelection();
  const before = structuredClone(input);
  const compiled = compileWakeflowFreshConfigSelection(input, {
    uuidFactory: createSequenceUuidV4Factory(),
  });
  deepEqual(input, before);
  equal(compiled.config.program.programId, `program_${UUIDS[0]}`);
  equal(compiled.config.presentation.language, "en");
  deepEqual(compiled.allocations.repositories, [{
    selectionKey: "repository-1",
    id: `repository_${UUIDS[1]}`,
  }]);
  deepEqual(compiled.allocations.supportSurfaces, [{
    selectionKey: "design",
    id: `surface_${UUIDS[2]}`,
  }, {
    selectionKey: "test",
    id: `surface_${UUIDS[3]}`,
  }]);
  deepEqual(compiled.allocations.windows.map((entry) => entry.id), [
    `window_${UUIDS[4]}`,
    `window_${UUIDS[5]}`,
    `window_${UUIDS[6]}`,
    `window_${UUIDS[7]}`,
  ]);
  const product = compiled.config.topology.windows.find((entry) => (
    entry.role === "product"
  ));
  equal(product?.root.kind, "repository");
  if (product?.root.kind === "repository") {
    equal(product.root.repositoryId, `repository_${UUIDS[1]}`);
  }
  equal(/^sha256:[0-9a-f]{64}$/u.test(compiled.selectionDigest), true);
  equal(/^sha256:[0-9a-f]{64}$/u.test(compiled.configDigest), true);
});

test("Fresh selection is deterministic with an injected UUID sequence", () => {
  const first = compileWakeflowFreshConfigSelection(
    createMinimalWakeflowFreshConfigSelection(), {
    uuidFactory: createSequenceUuidV4Factory(),
  });
  const second = compileWakeflowFreshConfigSelection(
    createMinimalWakeflowFreshConfigSelection(), {
    uuidFactory: createSequenceUuidV4Factory(),
  });
  deepEqual(second, first);
});

test("Fresh selection rejects duplicate keys, unresolved roots, and UUID collision", () => {
  const duplicate = createMinimalWakeflowFreshConfigSelection();
  const duplicateWindow = duplicate.topology.windows[0];
  if (duplicateWindow === undefined) throw new Error("Expected window.");
  duplicateWindow.selectionKey = "repository-1";
  const unresolved = createMinimalWakeflowFreshConfigSelection();
  const unresolvedWindow = unresolved.topology.windows[3];
  if (unresolvedWindow === undefined) throw new Error("Expected product window.");
  unresolvedWindow.root = {
    kind: "repository",
    selectionKey: "missing",
  };
  for (const [candidate, factory, reason] of [
    [duplicate, createSequenceUuidV4Factory(), "selection-key"],
    [unresolved, createSequenceUuidV4Factory(), "reference"],
    [
      createMinimalWakeflowFreshConfigSelection(),
      () => UUIDS[0] ?? "invalid",
      "id-collision",
    ],
  ] as const) {
    let caught: unknown;
    try {
      compileWakeflowFreshConfigSelection(candidate, { uuidFactory: factory });
    } catch (error: unknown) {
      caught = error;
    }
    equal(caught instanceof WakeflowFreshConfigSelectionError, true);
    if (caught instanceof WakeflowFreshConfigSelectionError) {
      equal(caught.reason, reason);
    }
  }
});

test("Fresh selection snapshots all data and validates before ID allocation", () => {
  const baseline = compileWakeflowFreshConfigSelection(
    createMinimalWakeflowFreshConfigSelection(),
    { uuidFactory: createSequenceUuidV4Factory() },
  );
  const mutable = createMinimalWakeflowFreshConfigSelection();
  const sequence = createSequenceUuidV4Factory();
  let calls = 0;
  const mutatingFactory = () => {
    calls += 1;
    mutable.program.displayName = "Mutated after snapshot";
    mutable.topology.windows.length = 0;
    return sequence();
  };
  const compiled = compileWakeflowFreshConfigSelection(mutable, {
    uuidFactory: mutatingFactory,
  });
  equal(calls, 8);
  deepEqual(compiled, baseline);

  const unresolved = createMinimalWakeflowFreshConfigSelection();
  const product = unresolved.topology.windows[3];
  if (product === undefined) throw new Error("Expected product window.");
  product.root = { kind: "repository", selectionKey: "missing" };
  let invalidFactoryCalls = 0;
  let caught: unknown;
  try {
    compileWakeflowFreshConfigSelection(unresolved, {
      uuidFactory: () => {
        invalidFactoryCalls += 1;
        return UUIDS[0] ?? "invalid";
      },
    });
  } catch (error: unknown) {
    caught = error;
  }
  equal(caught instanceof WakeflowFreshConfigSelectionError, true);
  equal(invalidFactoryCalls, 0);

  const overCapacity = createMinimalWakeflowFreshConfigSelection();
  const repositories = overCapacity.topology.repositories as
    Record<string, unknown>[];
  for (let index = 0; index < 250; index += 1) {
    repositories.push({
      selectionKey: `extra-${index}`,
      path: `Repositories/Extra-${index}`,
      displayName: `Extra ${index}`,
      instructionManagement: "owner-managed",
    });
  }
  caught = undefined;
  try {
    compileWakeflowFreshConfigSelection(overCapacity, {
      uuidFactory: () => {
        invalidFactoryCalls += 1;
        return UUIDS[0] ?? "invalid";
      },
    });
  } catch (error: unknown) {
    caught = error;
  }
  equal(caught instanceof WakeflowFreshConfigSelectionError, true);
  if (caught instanceof WakeflowFreshConfigSelectionError) {
    equal(caught.reason, "capacity");
  }
  equal(invalidFactoryCalls, 0);
});
