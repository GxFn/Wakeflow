import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";

import { WAKEFLOW_CONFIG_V3_SCHEMA } from "../../src/contracts/generated/configuration/wakeflow-config-v3.generated.js";
import {
  buildWakeflowConfigV3Indexes,
  computeWakeflowConfigV3Digest,
  parseWakeflowConfigV3,
  WAKEFLOW_DEFAULT_PRESENTATION_LANGUAGE,
  WakeflowConfigV3Error,
  type WakeflowConfigV3ErrorReason,
} from "../../src/configuration/wakeflow-config-v3.js";
import { createMinimalWakeflowConfigV3 } from "./wakeflow-config-v3.fixture.js";

function expectConfigError(
  action: () => unknown,
  reason: WakeflowConfigV3ErrorReason,
): WakeflowConfigV3Error {
  let caught: unknown;
  try {
    action();
  } catch (error: unknown) {
    caught = error;
  }
  if (!(caught instanceof WakeflowConfigV3Error)) {
    throw new Error("Expected WakeflowConfigV3Error.");
  }
  equal(caught.code, "wakeflow-config-v3");
  equal(caught.reason, reason);
  return caught;
}

function isDeeplyFrozen(value: unknown): boolean {
  if (value === null || typeof value !== "object") return true;
  return Object.isFrozen(value)
    && Object.values(value).every((child) => isDeeplyFrozen(child));
}

function topology(value: Record<string, unknown>) {
  return value.topology as {
    repositories: Record<string, unknown>[];
    supportSurfaces: Record<string, unknown>[];
    windows: Record<string, unknown>[];
  };
}

test("public v3 model preserves one explicit presentation language and builds typed indexes", () => {
  const value = createMinimalWakeflowConfigV3();
  const model = parseWakeflowConfigV3(value);
  const indexes = buildWakeflowConfigV3Indexes(model);

  equal(
    computeWakeflowConfigV3Digest(model),
    "sha256:54a5976cbac7c3f7e14ac76e405d04f8e534fd820f8bf1ce16768d6514db7007",
  );
  equal(WAKEFLOW_DEFAULT_PRESENTATION_LANGUAGE, "en");
  equal(model.presentation.language, "en");
  equal(indexes.controllerWindow.role, "controller");
  equal(indexes.designWindow.role, "design");
  equal(indexes.testWindow.role, "test");
  equal(indexes.productWindows.length, 1);
  const repositoryId = model.topology.repositories[0]?.repositoryId;
  if (repositoryId === undefined) throw new Error("Expected one repository.");
  equal(
    indexes.windowsByRepositoryId[repositoryId]?.length,
    1,
  );
  equal(isDeeplyFrozen(model), true);
  equal(isDeeplyFrozen(indexes), true);
  equal(isDeeplyFrozen(WAKEFLOW_CONFIG_V3_SCHEMA), true);

  const reordered = Object.fromEntries(Object.entries(value).reverse());
  equal(
    computeWakeflowConfigV3Digest(parseWakeflowConfigV3(reordered)),
    computeWakeflowConfigV3Digest(model),
  );
});

test("presentation language is explicit, closed and never inferred", () => {
  const missing = createMinimalWakeflowConfigV3();
  delete missing.presentation;
  expectConfigError(() => parseWakeflowConfigV3(missing), "schema");

  const legacyAuto = createMinimalWakeflowConfigV3();
  (legacyAuto.presentation as Record<string, unknown>).language = "auto";
  expectConfigError(() => parseWakeflowConfigV3(legacyAuto), "schema");

  const simplifiedChinese = createMinimalWakeflowConfigV3();
  (simplifiedChinese.presentation as Record<string, unknown>).language =
    "zh-Hans";
  equal(
    parseWakeflowConfigV3(simplifiedChinese).presentation.language,
    "zh-Hans",
  );
});

test("Schema owns closed shape, cardinality, ownership, host and regex constraints", () => {
  const cases: Array<(value: Record<string, unknown>) => void> = [
    (value) => { value.unknown = true; },
    (value) => { topology(value).windows.pop(); },
    (value) => {
      topology(value).supportSurfaces[0]!.instructionManagement = "managed-block";
    },
    (value) => { value.hosts = { github: {} }; },
    (value) => {
      value.governance = {
        validation: {
          runtimeResidue: {
            label: "runtime",
            matchers: [{ kind: "regex", value: "[" }],
          },
        },
      };
    },
  ];
  for (const mutate of cases) {
    const value = createMinimalWakeflowConfigV3();
    mutate(value);
    expectConfigError(() => parseWakeflowConfigV3(value), "schema");
  }
});

test("typed identity, references and topology relationships are validated together", () => {
  const collision = createMinimalWakeflowConfigV3();
  topology(collision).repositories[0]!.repositoryId =
    "repository_11111111-1111-4111-8111-111111111111";
  expectConfigError(
    () => parseWakeflowConfigV3(collision),
    "identifier-collision",
  );

  const missingReference = createMinimalWakeflowConfigV3();
  const productRoot = topology(missingReference).windows[3]!.root as Record<string, unknown>;
  productRoot.repositoryId =
    "repository_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  expectConfigError(() => parseWakeflowConfigV3(missingReference), "reference");

  const wrongCapability = createMinimalWakeflowConfigV3();
  const designRoot = topology(wrongCapability).windows[1]!.root as Record<string, unknown>;
  designRoot.surfaceId = "surface_44444444-4444-4444-8444-444444444444";
  expectConfigError(() => parseWakeflowConfigV3(wrongCapability), "topology");

  const unownedRepository = createMinimalWakeflowConfigV3();
  topology(unownedRepository).repositories.push({
    repositoryId: "repository_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    path: "../ProductB",
    displayName: "Product B",
    instructionManagement: "owner-managed",
  });
  expectConfigError(() => parseWakeflowConfigV3(unownedRepository), "topology");

  const duplicateResidue = createMinimalWakeflowConfigV3();
  topology(duplicateResidue).repositories[0]!.validation = {
    residueExceptions: [
      { path: ".cursor/skills", reason: "first" },
      { path: ".cursor/skills", reason: "second" },
    ],
  };
  expectConfigError(() => parseWakeflowConfigV3(duplicateResidue), "topology");
});

test("placement adds Unicode and per-segment canonicality beyond the public Schema", () => {
  for (const placement of ["Design/ nested", "cafe\u0301"] as const) {
    const value = createMinimalWakeflowConfigV3();
    topology(value).supportSurfaces[0]!.path = placement;
    expectConfigError(() => parseWakeflowConfigV3(value), "placement");
  }
});

test("in-memory admission is passive and never executes decorated input", () => {
  let getterCalls = 0;
  const value = createMinimalWakeflowConfigV3();
  Object.defineProperty(value, "kind", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return "WakeflowConfig";
    },
  });
  expectConfigError(() => parseWakeflowConfigV3(value), "json-value");
  equal(getterCalls, 0);

  const plain = createMinimalWakeflowConfigV3();
  deepEqual(
    parseWakeflowConfigV3(plain).program.displayName,
    "Example Program",
  );
});
