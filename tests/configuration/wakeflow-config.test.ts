import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";
import {
  buildWakeflowConfigIndexes,
  computeWakeflowConfigDigest,
  parseWakeflowConfig,
  parseWakeflowConfigPlacement,
  WAKEFLOW_DEFAULT_PRESENTATION_LANGUAGE,
  WakeflowConfigError,
  type WakeflowConfigErrorReason,
} from "../../src/configuration/wakeflow-config.js";
import { WAKEFLOW_CONFIG_SCHEMA } from "../../src/contracts/generated/configuration/wakeflow-config.generated.js";
import { createMinimalWakeflowConfig } from "./wakeflow-config.fixture.js";

function expectConfigError(
  action: () => unknown,
  reason: WakeflowConfigErrorReason,
): WakeflowConfigError {
  let caught: unknown;
  try {
    action();
  } catch (error: unknown) {
    caught = error;
  }
  if (!(caught instanceof WakeflowConfigError)) {
    throw new Error("Expected WakeflowConfigError.");
  }
  equal(caught.code, "wakeflow-config");
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

test("public model preserves one explicit presentation language and builds typed indexes", () => {
  const value = createMinimalWakeflowConfig();
  const model = parseWakeflowConfig(value);
  const indexes = buildWakeflowConfigIndexes(model);

  equal(
    computeWakeflowConfigDigest(model),
    "sha256:7509f2f4551d162aa9ecdbc55553895bdc5d91d49f2d8177c3acfdf59a59c15e",
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
  equal(isDeeplyFrozen(WAKEFLOW_CONFIG_SCHEMA), true);

  const reordered = Object.fromEntries(Object.entries(value).reverse());
  equal(
    computeWakeflowConfigDigest(parseWakeflowConfig(reordered)),
    computeWakeflowConfigDigest(model),
  );
});

test("presentation language is explicit, closed and never inferred", () => {
  const missing = createMinimalWakeflowConfig();
  delete missing.presentation;
  expectConfigError(() => parseWakeflowConfig(missing), "schema");

  const legacyAuto = createMinimalWakeflowConfig();
  (legacyAuto.presentation as Record<string, unknown>).language = "auto";
  expectConfigError(() => parseWakeflowConfig(legacyAuto), "schema");

  const simplifiedChinese = createMinimalWakeflowConfig();
  (simplifiedChinese.presentation as Record<string, unknown>).language =
    "zh-Hans";
  equal(
    parseWakeflowConfig(simplifiedChinese).presentation.language,
    "zh-Hans",
  );
});

test("Schema owns closed shape, cardinality, ownership, host constraints and the reserved governance object", () => {
  const cases: Array<(value: Record<string, unknown>) => void> = [
    (value) => { value.unknown = true; },
    (value) => { topology(value).windows.pop(); },
    (value) => {
      topology(value).supportSurfaces[0]!.instructionManagement = "managed-block";
    },
    (value) => { value.hosts = { github: {} }; },
    // governance 是保留的空对象：任何治理词汇都是未知字段（2026-09-21 裁决删除审阅期与运行残留）。
    (value) => { value.governance = { audit: { preservedReviewAfterDays: 30 } }; },
    (value) => {
      topology(value).repositories[0]!.validation = { residueExceptions: [] };
    },
  ];
  for (const mutate of cases) {
    const value = createMinimalWakeflowConfig();
    mutate(value);
    expectConfigError(() => parseWakeflowConfig(value), "schema");
  }
});

test("typed identity, references and topology relationships are validated together", () => {
  const collision = createMinimalWakeflowConfig();
  topology(collision).repositories[0]!.repositoryId =
    "repository_11111111-1111-4111-8111-111111111111";
  expectConfigError(
    () => parseWakeflowConfig(collision),
    "identifier-collision",
  );

  const missingReference = createMinimalWakeflowConfig();
  const productRoot = topology(missingReference).windows[3]!.root as Record<string, unknown>;
  productRoot.repositoryId =
    "repository_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  expectConfigError(() => parseWakeflowConfig(missingReference), "reference");

  const wrongCapability = createMinimalWakeflowConfig();
  const designRoot = topology(wrongCapability).windows[1]!.root as Record<string, unknown>;
  designRoot.surfaceId = "surface_44444444-4444-4444-8444-444444444444";
  expectConfigError(() => parseWakeflowConfig(wrongCapability), "topology");

  const unownedRepository = createMinimalWakeflowConfig();
  topology(unownedRepository).repositories.push({
    repositoryId: "repository_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    path: "../ProductB",
    displayName: "Product B",
    instructionManagement: "owner-managed",
  });
  expectConfigError(() => parseWakeflowConfig(unownedRepository), "topology");
});

test("placement adds Unicode and per-segment canonicality beyond the public Schema", () => {
  for (const placement of ["Design/ nested", "cafe\u0301"] as const) {
    const value = createMinimalWakeflowConfig();
    topology(value).supportSurfaces[0]!.path = placement;
    expectConfigError(() => parseWakeflowConfig(value), "placement");
  }
  for (const placement of ["C:\\workspace", "Design\\nested"] as const) {
    expectConfigError(
      () => parseWakeflowConfigPlacement(placement),
      "placement",
    );
  }
});

test("repositories 与 supportSurfaces 的 placement 至多一个前导 ..：拒绝一律由 Schema 触发，解析器的同名收紧够不到；一级接受；ledgerRoot 不受此限（§13.97 D2e）", () => {
  for (const [collection, placement] of [
    ["repositories", "../../ProductA"],
    ["supportSurfaces", "../../Design"],
    ["supportSurfaces", "../../../Design"],
  ] as const) {
    const value = createMinimalWakeflowConfig();
    topology(value)[collection][0]!.path = placement;
    // `parseWakeflowConfig` 先跑 Schema 再跑 placement 准入，所以实际触发的永远是 "schema"：
    // 解析器里同一条上限是纵深防御，不是第二条可达路径（下面用 Schema 的语法本身证明够不到）。
    expectConfigError(() => parseWakeflowConfig(value), "schema");
  }
  const pattern = (
    WAKEFLOW_CONFIG_SCHEMA as unknown as {
      readonly $defs: Readonly<Record<string, { readonly pattern?: string }>>;
    }
  ).$defs.siblingRelativePlacement?.pattern;
  if (pattern === undefined) throw new Error("siblingRelativePlacement pattern missing");
  const sibling = new RegExp(pattern, "u");
  deepEqual(
    ["Design", "../ProductA", "../a/b", "../../ProductA", "../", "..", "a/../b"].map((candidate) =>
      sibling.test(candidate),
    ),
    [true, true, true, false, false, false, false],
  );
  // 解析器的上限之所以够不到：Schema 放行的字符串里没有一个带两级以上前导 ..。枚举由 ".."、"."、
  // 空段与普通段拼出的至多三段候选，逐个核对"Schema 放行 ⇒ 前导 .. 至多一段"。
  const segments = ["..", ".", "", "a", "...", " a"] as const;
  const candidates = new Set<string>();
  for (const first of segments) {
    candidates.add(first);
    for (const second of segments) {
      candidates.add(`${first}/${second}`);
      for (const third of segments) candidates.add(`${first}/${second}/${third}`);
    }
  }
  const leadingParents = (candidate: string): number => {
    const parts = candidate.split("/");
    let count = 0;
    while (parts[count] === "..") count += 1;
    return count;
  };
  const admittedWithTwoParents = [...candidates].filter(
    (candidate) => sibling.test(candidate) && leadingParents(candidate) > 1,
  );
  deepEqual(admittedWithTwoParents, []);

  const oneLevel = createMinimalWakeflowConfig();
  topology(oneLevel).supportSurfaces[0]!.path = "../Design";
  equal(parseWakeflowConfig(oneLevel).topology.supportSurfaces[0]?.path, "../Design");

  // 只有拓扑放置收紧：账本根仍可以是更深的相对位置。
  const ledger = createMinimalWakeflowConfig();
  (ledger.storage as Record<string, unknown>).ledgerRoot = "../../shared/wakeflow-ledger";
  equal(parseWakeflowConfig(ledger).storage.ledgerRoot, "../../shared/wakeflow-ledger");
});

test("typed indexes group product windows in one topology pass", () => {
  const value = createMinimalWakeflowConfig();
  topology(value).repositories.push({
    repositoryId: "repository_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    path: "../ProductB",
    displayName: "Product B",
    instructionManagement: "owner-managed",
  });
  topology(value).windows.push({
    windowId: "window_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    podId: "pod_99999999-9999-4999-8999-999999999999",
    role: "product",
    displayName: "Product A 2",
    root: {
      kind: "repository",
      repositoryId: "repository_22222222-2222-4222-8222-222222222222",
    },
  }, {
    windowId: "window_cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    podId: "pod_99999999-9999-4999-8999-999999999999",
    role: "product",
    displayName: "Product B",
    root: {
      kind: "repository",
      repositoryId: "repository_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    },
  });

  const model = parseWakeflowConfig(value);
  const indexes = buildWakeflowConfigIndexes(model);
  const firstRepositoryId = model.topology.repositories[0]?.repositoryId;
  const secondRepositoryId = model.topology.repositories[1]?.repositoryId;
  if (firstRepositoryId === undefined || secondRepositoryId === undefined) {
    throw new Error("Expected two repositories.");
  }
  equal(indexes.productWindows.length, 3);
  equal(
    indexes.windowsByRepositoryId[firstRepositoryId]?.length,
    2,
  );
  equal(
    indexes.windowsByRepositoryId[secondRepositoryId]?.length,
    1,
  );
});

test("in-memory admission is passive and never executes decorated input", () => {
  let getterCalls = 0;
  const value = createMinimalWakeflowConfig();
  Object.defineProperty(value, "kind", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return "WakeflowConfig";
    },
  });
  expectConfigError(() => parseWakeflowConfig(value), "json-value");
  equal(getterCalls, 0);

  const plain = createMinimalWakeflowConfig();
  deepEqual(
    parseWakeflowConfig(plain).program.displayName,
    "Example Program",
  );
});
