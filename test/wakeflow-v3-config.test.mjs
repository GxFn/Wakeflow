import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const repositoryRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const fixtureRoot = path.join(repositoryRoot, "test/fixtures/wakeflow-config-v3");
const identifiersModule = "../core/scripts/lib/wakeflow-identifiers.mjs";
const configModule = "../core/scripts/lib/wakeflow-config-v3.mjs";
const publicSchemaId = "https://raw.githubusercontent.com/GxFn/Wakeflow/main/core/schemas/wakeflow-config.schema.json";

function fixture(name) {
  return JSON.parse(readFileSync(path.join(fixtureRoot, name), "utf8"));
}

function clone(value) {
  return structuredClone(value);
}

function publicSchema() {
  return JSON.parse(readFileSync(path.join(repositoryRoot, "core/schemas/wakeflow-config.schema.json"), "utf8"));
}

function schemaStringDefinitionAccepts(schema, definitionName, value) {
  function accepts(node) {
    if (node.$ref) {
      const prefix = "#/$defs/";
      assert.equal(node.$ref.startsWith(prefix), true, `unsupported test-only schema ref ${node.$ref}`);
      return accepts(schema.$defs[node.$ref.slice(prefix.length)]);
    }
    if (Array.isArray(node.allOf) && !node.allOf.every(accepts)) return false;
    if (node.type === "string" && typeof value !== "string") return false;
    if (Number.isInteger(node.minLength) && [...value].length < node.minLength) return false;
    if (Number.isInteger(node.maxLength) && [...value].length > node.maxLength) return false;
    if (typeof node.pattern === "string" && !new RegExp(node.pattern, "u").test(value)) return false;
    if (node.format === "regex") {
      try {
        new RegExp(value, "u");
      } catch {
        return false;
      }
    }
    return true;
  }
  return accepts(schema.$defs[definitionName]);
}

function resolvedDocumentation(schema, node) {
  if (!node.$ref) return node;
  const prefix = "#/$defs/";
  assert.equal(node.$ref.startsWith(prefix), true, `unsupported documentation ref ${node.$ref}`);
  return { ...schema.$defs[node.$ref.slice(prefix.length)], ...node };
}

function schemaWindowCardinalityAccepts(schema, windows) {
  const contract = schema.$defs.topology.properties.windows;
  if (!Array.isArray(windows) || windows.length < contract.minItems) return false;
  return contract.allOf.every((constraint) => {
    const role = constraint.contains?.properties?.role?.const;
    assert.equal(typeof role, "string", "window cardinality constraint must select an exact role");
    const count = windows.filter((window) => window?.role === role).length;
    const minimum = constraint.minContains ?? 1;
    const maximum = constraint.maxContains ?? Number.POSITIVE_INFINITY;
    return count >= minimum && count <= maximum;
  });
}

function schemaSupportSurfaceCardinalityAccepts(schema, surfaces) {
  const contract = schema.$defs.topology.properties.supportSurfaces;
  if (
    !Array.isArray(surfaces)
    || surfaces.length < contract.minItems
    || surfaces.length > contract.maxItems
  ) return false;
  return contract.allOf.every((constraint) => {
    const capability = constraint.contains?.properties?.capability?.const;
    assert.equal(typeof capability, "string", "support surface cardinality must select an exact capability");
    const count = surfaces.filter((surface) => surface?.capability === capability).length;
    return count >= constraint.minContains && count <= constraint.maxContains;
  });
}

function expectCode(fn, code) {
  assert.throws(fn, (error) => {
    assert.equal(error?.code, code, error?.stack ?? String(error));
    assert.equal(typeof error?.path, "string");
    return true;
  });
}

test("typed Wakeflow identifiers are lowercase UUID v4 values and refs are type checked", async () => {
  const {
    assertWakeflowId,
    assertWakeflowRef,
    createWakeflowIdIndex,
    generateWakeflowId,
    parseWakeflowId,
  } = await import(identifiersModule);
  const uuid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  assert.equal(generateWakeflowId("program", () => uuid), `program_${uuid}`);
  assert.deepEqual(parseWakeflowId(`repository_${uuid}`), {
    type: "repository",
    uuid,
    value: `repository_${uuid}`,
  });
  assert.equal(assertWakeflowId(`surface_${uuid}`, "surface", "/surfaceId"), `surface_${uuid}`);
  expectCode(
    () => assertWakeflowId(`window_${uuid.toUpperCase()}`, "window", "/windowId"),
    "wakeflow-identifier-invalid",
  );
  expectCode(
    () => assertWakeflowId(`repository_${uuid}`, "window", "/windowId"),
    "wakeflow-identifier-type-mismatch",
  );
  const index = createWakeflowIdIndex([
    { id: `repository_${uuid}`, type: "repository", path: "/repositories/0/repositoryId", value: { ok: true } },
  ]);
  assert.deepEqual(assertWakeflowRef(`repository_${uuid}`, "repository", index, "/root/repositoryId"), { ok: true });
  expectCode(
    () => assertWakeflowRef("repository_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "repository", index, "/root/repositoryId"),
    "wakeflow-reference-missing",
  );
  expectCode(
    () => createWakeflowIdIndex([
      { id: `repository_${uuid}`, type: "repository", path: "/repositories/0/repositoryId", value: {} },
      { id: `repository_${uuid}`, type: "repository", path: "/repositories/1/repositoryId", value: {} },
    ]),
    "wakeflow-identifier-duplicate",
  );
  expectCode(
    () => createWakeflowIdIndex([
      { id: `program_${uuid}`, type: "program", path: "/program/programId", value: {} },
      { id: `repository_${uuid}`, type: "repository", path: "/repositories/0/repositoryId", value: {} },
    ]),
    "wakeflow-identifier-uuid-collision",
  );
});

test("typed identifier indexes admit only passive entries and cannot be forged", async () => {
  const {
    assertWakeflowRef,
    createWakeflowIdIndex,
    generateWakeflowId,
  } = await import(identifiersModule);
  const uuid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const validEntry = {
    id: `repository_${uuid}`,
    type: "repository",
    path: "/repositories/0/repositoryId",
    value: { ok: true },
  };

  const decoratedEntries = [validEntry];
  Object.setPrototypeOf(decoratedEntries, Object.create(Array.prototype));
  expectCode(() => createWakeflowIdIndex(decoratedEntries), "wakeflow-identifier-index-invalid");

  let entryGetterCalls = 0;
  const behavioralEntry = {
    type: "repository",
    path: "/repositories/0/repositoryId",
    value: { ok: true },
  };
  Object.defineProperty(behavioralEntry, "id", {
    enumerable: true,
    get() {
      entryGetterCalls += 1;
      return `repository_${uuid}`;
    },
  });
  expectCode(() => createWakeflowIdIndex([behavioralEntry]), "wakeflow-identifier-index-invalid");
  assert.equal(entryGetterCalls, 0);

  const hiddenEntry = { ...validEntry };
  Object.defineProperty(hiddenEntry, "authority", { value: "forged", enumerable: false });
  expectCode(() => createWakeflowIdIndex([hiddenEntry]), "wakeflow-identifier-index-invalid");

  let fakeIndexGetterCalls = 0;
  const fakeIndex = {};
  Object.defineProperty(fakeIndex, "has", {
    get() {
      fakeIndexGetterCalls += 1;
      return () => true;
    },
  });
  expectCode(
    () => assertWakeflowRef(`repository_${uuid}`, "repository", fakeIndex, "/repositoryId"),
    "wakeflow-reference-index-invalid",
  );
  assert.equal(fakeIndexGetterCalls, 0);

  let coercionCalls = 0;
  expectCode(
    () => generateWakeflowId("program", () => ({
      [Symbol.toPrimitive]() {
        coercionCalls += 1;
        return uuid;
      },
    })),
    "wakeflow-identifier-generator-invalid",
  );
  assert.equal(coercionCalls, 0);
});

test("minimal and full public v3 configs build typed indexes without flattening", async () => {
  const {
    buildWakeflowConfigV3Indexes,
    parseWakeflowConfigV3,
  } = await import(configModule);
  for (const name of ["valid-minimal.json", "valid-full.json"]) {
    const model = parseWakeflowConfigV3(fixture(name));
    assert.equal(Object.isFrozen(model), true);
    assert.equal(model.schemaVersion, 3);
    assert.equal("repoNames" in model, false);
    assert.equal("activeRoot" in model.storage, false);
    assert.equal("localRoot" in model.storage, false);
    const indexes = buildWakeflowConfigV3Indexes(model);
    assert.equal(indexes.controllerWindow.role, "controller");
    assert.equal(indexes.designWindow.role, "design");
    assert.equal(indexes.testWindow.role, "test");
    assert.equal(indexes.resolveWindowRoot(indexes.controllerWindow.windowId).kind, "program");
    const repositoryId = model.topology.repositories[0].repositoryId;
    assert.equal(indexes.repositoryById[repositoryId].path, "../ProductA");
    assert.equal(indexes.windowsByRepositoryId[repositoryId].length, name === "valid-full.json" ? 2 : 1);
    assert.deepEqual(indexes.hostPreferences("missing-host"), {});
  }
});

test("Design and Test independently support both confirmed ownership contracts", async () => {
  const { parseWakeflowConfigV3 } = await import(configModule);
  for (const designOwnership of ["wakeflow-managed", "external-owned"]) {
    for (const testOwnership of ["wakeflow-managed", "external-owned"]) {
      const value = fixture("valid-minimal.json");
      for (const surface of value.topology.supportSurfaces) {
        const ownership = surface.capability === "design" ? designOwnership : testOwnership;
        surface.ownership = ownership;
        if (ownership === "external-owned") surface.instructionManagement = "owner-managed";
        else delete surface.instructionManagement;
      }
      assert.doesNotThrow(() => parseWakeflowConfigV3(value));
    }
  }
});

test("public v3 validation rejects unknown fields, bad IDs, bad refs, cardinality, and host leakage", async () => {
  const { parseWakeflowConfigV3 } = await import(configModule);
  const cases = [
    ["wakeflow-config-v3-unknown-field", (value) => { value.metadata = {}; }],
    ["wakeflow-config-v3-unknown-field", (value) => { value.program.generatedAt = "now"; }],
    ["wakeflow-identifier-invalid", (value) => { value.program.programId = "Example Program"; }],
    ["wakeflow-identifier-duplicate", (value) => { value.topology.windows[1].windowId = value.topology.windows[0].windowId; }],
    ["wakeflow-identifier-uuid-collision", (value) => {
      const repositoryId = `repository_${value.program.programId.slice("program_".length)}`;
      value.topology.repositories[0].repositoryId = repositoryId;
      value.topology.windows[3].root.repositoryId = repositoryId;
    }],
    ["wakeflow-reference-missing", (value) => { value.topology.windows[3].root.repositoryId = "repository_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"; }],
    ["wakeflow-identifier-type-mismatch", (value) => { value.topology.windows[3].root.repositoryId = value.topology.windows[3].windowId; }],
    ["wakeflow-config-v3-cardinality", (value) => { value.topology.windows.push(clone(value.topology.windows[0])); value.topology.windows.at(-1).windowId = "window_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"; }],
    ["wakeflow-config-v3-cardinality", (value) => {
      value.topology.supportSurfaces.push({
        ...clone(value.topology.supportSurfaces[0]),
        surfaceId: "surface_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        path: "DesignExtra",
        displayName: "Design Extra",
      });
    }],
    ["wakeflow-config-v3-cardinality", (value) => { value.topology.supportSurfaces[1].capability = "design"; }],
    ["wakeflow-config-v3-topology", (value) => { value.topology.windows[1].root.surfaceId = value.topology.supportSurfaces[1].surfaceId; }],
    ["wakeflow-config-v3-type", (value) => { value.topology.windows.pop(); }],
    ["wakeflow-config-v3-ownership", (value) => { value.topology.supportSurfaces[0].instructionManagement = "managed-block"; }],
    ["wakeflow-config-v3-ownership", (value) => { value.topology.supportSurfaces[0].ownership = "external-owned"; }],
    ["wakeflow-config-v3-path", (value) => { value.storage.ledgerRoot = "/private/ledger"; }],
    ["wakeflow-config-v3-path", (value) => { value.storage.ledgerRoot = "C:ledger"; }],
    ["wakeflow-config-v3-path", (value) => { value.topology.repositories[0].path = "../ProductA/../ProductB"; }],
    ["wakeflow-config-v3-path", (value) => { value.topology.repositories[0].path = "z:../ProductB"; }],
    ["wakeflow-config-v3-host", (value) => { value.hosts.github = {}; }],
    ["wakeflow-config-v3-host", (value) => { value.hosts.codex = { launch: { modelByRole: { worker: "model" } } }; }],
    ["wakeflow-config-v3-host", (value) => { value.hosts["claude-code"] = { launch: { permissionMode: "dontAsk" } }; }],
  ];
  for (const [code, mutate] of cases) {
    const value = fixture("valid-minimal.json");
    mutate(value);
    expectCode(() => parseWakeflowConfigV3(value), code);
  }
});

test("public v3 parser rejects sparse arrays before they serialize as null items", async () => {
  const { parseWakeflowConfigV3 } = await import(configModule);
  const cases = [
    {
      path: "$/governance/validation/runtimeResidue/matchers/0",
      mutate(value) {
        value.governance.validation = {
          runtimeResidue: {
            label: "product runtime",
            matchers: new Array(1),
          },
        };
      },
    },
    {
      path: "$/topology/repositories/0/validation/residueExceptions/0",
      mutate(value) {
        value.topology.repositories[0].validation = {
          residueExceptions: new Array(1),
        };
      },
    },
  ];

  for (const { path: expectedPath, mutate } of cases) {
    const value = fixture("valid-minimal.json");
    mutate(value);
    assert.throws(() => parseWakeflowConfigV3(value), (error) => {
      assert.equal(error?.code, "wakeflow-config-v3-type", error?.stack ?? String(error));
      assert.equal(error?.path, expectedPath);
      return true;
    });
  }
});

test("governance review age is bounded consistently and omission remains explicit", async () => {
  const { parseWakeflowConfigV3 } = await import(configModule);
  const schema = publicSchema();
  const property = schema.$defs.auditGovernance.properties.preservedReviewAfterDays;
  assert.equal(property.minimum, 1);
  assert.equal(property.maximum, 36_500);
  assert.match(schema.$defs.governance.description, /fails closed/iu);

  for (const [accepted, days] of [
    [true, 1],
    [true, 36_500],
    [false, 0],
    [false, 36_501],
    [false, 1.5],
    [false, Number.MAX_SAFE_INTEGER + 1],
  ]) {
    const value = fixture("valid-minimal.json");
    value.governance.audit = { preservedReviewAfterDays: days };
    if (accepted) {
      assert.equal(parseWakeflowConfigV3(value).governance.audit.preservedReviewAfterDays, days);
    } else {
      expectCode(() => parseWakeflowConfigV3(value), "wakeflow-config-v3-value");
    }
  }

  const omitted = fixture("valid-minimal.json");
  assert.deepEqual(parseWakeflowConfigV3(omitted).governance, {});
});

test("public v3 schema lexical definitions agree with the strict loader", async () => {
  const { parseWakeflowConfigV3 } = await import(configModule);
  const schema = publicSchema();
  assert.equal(schema.$defs.repository.properties.path.$ref, "#/$defs/portableRelativePlacement");
  assert.equal(schema.$defs.wakeflowManagedSurface.properties.path.$ref, "#/$defs/portableRelativePlacement");
  assert.equal(schema.$defs.externalOwnedSurface.properties.path.$ref, "#/$defs/portableRelativePlacement");
  assert.equal(schema.$defs.storage.properties.ledgerRoot.$ref, "#/$defs/portableRelativePlacement");
  assert.equal(schema.$defs.residueException.properties.path.$ref, "#/$defs/repositoryChildPath");
  assert.equal(schema.$defs.regexRuntimeMatcher.properties.value.$ref, "#/$defs/regexPattern");
  assert.deepEqual(
    schema.$defs.runtimeMatcher.oneOf.map((entry) => entry.$ref),
    ["#/$defs/substringRuntimeMatcher", "#/$defs/regexRuntimeMatcher"],
  );
  const cases = [
    {
      definition: "trimmedNonEmptyString",
      values: ["Program", "two words", "", " ", " leading", "trailing "],
      mutate(value, candidate) { candidate.program.displayName = value; },
    },
    {
      definition: "portableRelativePlacement",
      values: [
        "wakeflow-ledger",
        "../wakeflow-ledger",
        "../../Shared Ledger",
        ".hidden",
        "",
        ".",
        "..",
        "/private/ledger",
        "C:/ledger",
        "C:ledger",
        "a\\b",
        "a//b",
        "a/./b",
        "a/../b",
        "../Product/..",
        "a/",
      ],
      mutate(value, candidate) { candidate.storage.ledgerRoot = value; },
    },
    {
      definition: "repositoryChildPath",
      values: [".cursor/skills", "generated/output", ".hidden", "", ".", "..", "../escape", "a/../b", "a\\b"],
      mutate(value, candidate) {
        candidate.topology.repositories[0].validation = {
          residueExceptions: [{ path: value, reason: "Explicit repository-owner exception." }],
        };
      },
    },
    {
      definition: "regexPattern",
      values: ["node\\s+server\\.mjs", "literal", "[", "(?<"],
      mutate(value, candidate) {
        candidate.governance.validation = {
          runtimeResidue: {
            label: "product runtime",
            matchers: [{ kind: "regex", value }],
          },
        };
      },
    },
    {
      definition: "claudeTmuxSessionName",
      values: [
        "wakeflow",
        "Wakeflow 会话",
        "a".repeat(128),
        "a".repeat(129),
        "😀".repeat(128),
        "😀".repeat(129),
        "",
        " leading",
        "trailing ",
        "wakeflow\nother",
      ],
      mutate(value, candidate) {
        candidate.hosts["claude-code"] = { tmux: { sessionName: value } };
      },
    },
    {
      definition: "claudeTmuxSocketName",
      values: [
        "wakeflow-example",
        ".wakeflow",
        "a".repeat(128),
        "a".repeat(129),
        "",
        ".",
        "..",
        "wakeflow/socket",
        "wakeflow socket",
        "wakeflow\nother",
      ],
      mutate(value, candidate) {
        candidate.hosts["claude-code"] = { tmux: { socketName: value } };
      },
    },
  ];

  for (const { definition, values, mutate } of cases) {
    assert.ok(schema.$defs[definition], `missing lexical schema definition ${definition}`);
    for (const value of values) {
      const candidate = fixture("valid-minimal.json");
      mutate(value, candidate);
      let loaderAccepted = true;
      try {
        parseWakeflowConfigV3(candidate);
      } catch {
        loaderAccepted = false;
      }
      assert.equal(
        schemaStringDefinitionAccepts(schema, definition, value),
        loaderAccepted,
        `${definition} diverged for ${JSON.stringify(value)}`,
      );
    }
  }
});

test("public v3 schema and loader agree on durable window role cardinality", async () => {
  const { parseWakeflowConfigV3 } = await import(configModule);
  const schema = publicSchema();
  const constraints = Object.fromEntries(
    schema.$defs.topology.properties.windows.allOf.map((entry) => [
      entry.contains.properties.role.const,
      {
        minContains: entry.minContains,
        maxContains: entry.maxContains ?? null,
      },
    ]),
  );
  assert.deepEqual(constraints, {
    controller: { minContains: 1, maxContains: 1 },
    design: { minContains: 1, maxContains: 1 },
    test: { minContains: 1, maxContains: 1 },
    product: { minContains: 1, maxContains: null },
  });
  const extraProduct = (value, id) => ({
    ...clone(value.topology.windows.find((window) => window.role === "product")),
    windowId: id,
  });
  const cases = [
    [true, (value) => value],
    [false, (value) => {
      const duplicate = clone(value.topology.windows.find((window) => window.role === "controller"));
      duplicate.windowId = "window_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
      value.topology.windows.push(duplicate);
    }],
    [false, (value) => {
      const duplicate = clone(value.topology.windows.find((window) => window.role === "design"));
      duplicate.windowId = "window_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
      value.topology.windows.push(duplicate);
    }],
    [false, (value) => {
      const duplicate = clone(value.topology.windows.find((window) => window.role === "test"));
      duplicate.windowId = "window_cccccccc-cccc-4ccc-8ccc-cccccccccccc";
      value.topology.windows.push(duplicate);
    }],
    ...[
      ["controller", "window_dddddddd-dddd-4ddd-8ddd-dddddddddddd"],
      ["design", "window_eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"],
      ["test", "window_ffffffff-ffff-4fff-8fff-ffffffffffff"],
    ].map(([missingRole, replacementId]) => [false, (value) => {
      value.topology.windows = value.topology.windows.filter((window) => window.role !== missingRole);
      value.topology.windows.push(extraProduct(value, replacementId));
    }]),
    [false, (value) => {
      value.topology.windows = value.topology.windows.filter((window) => window.role !== "product");
    }],
  ];

  for (const [expected, mutate] of cases) {
    const value = fixture("valid-minimal.json");
    mutate(value);
    assert.equal(schemaWindowCardinalityAccepts(schema, value.topology.windows), expected);
    let loaderAccepted = true;
    try {
      parseWakeflowConfigV3(value);
    } catch {
      loaderAccepted = false;
    }
    assert.equal(loaderAccepted, expected);
  }

  const full = fixture("valid-full.json");
  assert.equal(schemaWindowCardinalityAccepts(schema, full.topology.windows), true);
  assert.doesNotThrow(() => parseWakeflowConfigV3(full));
});

test("public v3 schema and loader require one referenced Design surface and one referenced Test surface", async () => {
  const { parseWakeflowConfigV3 } = await import(configModule);
  const schema = publicSchema();
  const constraints = Object.fromEntries(
    schema.$defs.topology.properties.supportSurfaces.allOf.map((entry) => [
      entry.contains.properties.capability.const,
      { minContains: entry.minContains, maxContains: entry.maxContains },
    ]),
  );
  assert.equal(schema.$defs.topology.properties.supportSurfaces.minItems, 2);
  assert.equal(schema.$defs.topology.properties.supportSurfaces.maxItems, 2);
  assert.deepEqual(constraints, {
    design: { minContains: 1, maxContains: 1 },
    test: { minContains: 1, maxContains: 1 },
  });

  const cases = [
    [true, (value) => value],
    [false, (value) => {
      value.topology.supportSurfaces.push({
        ...clone(value.topology.supportSurfaces[0]),
        surfaceId: "surface_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        path: "DesignExtra",
        displayName: "Design Extra",
      });
    }],
    [false, (value) => { value.topology.supportSurfaces[1].capability = "design"; }],
    [false, (value) => { value.topology.supportSurfaces[0].capability = "test"; }],
  ];
  for (const [expected, mutate] of cases) {
    const value = fixture("valid-minimal.json");
    mutate(value);
    assert.equal(schemaSupportSurfaceCardinalityAccepts(schema, value.topology.supportSurfaces), expected);
    let loaderAccepted = true;
    try {
      parseWakeflowConfigV3(value);
    } catch {
      loaderAccepted = false;
    }
    assert.equal(loaderAccepted, expected);
  }
});

test("public v3 schema documents every partition, definition, and field with safe examples", () => {
  const schema = publicSchema();
  for (const [name, definition] of Object.entries(schema.$defs)) {
    assert.equal(typeof definition.description, "string", `$defs/${name} needs a description`);
    assert.ok(definition.description.trim(), `$defs/${name} description must not be blank`);
    assert.equal(Array.isArray(definition.examples), true, `$defs/${name} needs safe examples`);
    assert.ok(definition.examples.length > 0, `$defs/${name} examples must not be empty`);
  }
  for (const [owner, properties] of [
    ["properties", schema.properties],
    ...Object.entries(schema.$defs)
      .filter(([, definition]) => definition.properties)
      .map(([name, definition]) => [`$defs/${name}/properties`, definition.properties]),
  ]) {
    for (const [name, node] of Object.entries(properties)) {
      const documented = resolvedDocumentation(schema, node);
      assert.equal(typeof documented.description, "string", `${owner}/${name} needs a description`);
      assert.ok(documented.description.trim(), `${owner}/${name} description must not be blank`);
      assert.equal(Array.isArray(documented.examples), true, `${owner}/${name} needs safe examples`);
      assert.ok(documented.examples.length > 0, `${owner}/${name} examples must not be empty`);
    }
  }
});

test("public v3 exact-file read, serializer, digest, and explain stay deterministic and runtime-free", async () => {
  const {
    explainWakeflowConfigV3,
    parseWakeflowConfigV3,
    readWakeflowConfigV3,
    serializeWakeflowConfigV3,
    wakeflowConfigV3Digest,
  } = await import(configModule);
  const root = mkdtempSync(path.join(os.tmpdir(), "wakeflow-v3-exact-"));
  const exact = path.join(root, "candidate.json");
  const value = fixture("valid-full.json");
  writeFileSync(exact, JSON.stringify(value, null, 2));
  writeFileSync(path.join(root, "workspace.config.json"), "{\"schemaVersion\":1}");
  const model = readWakeflowConfigV3(exact);
  assert.deepEqual(model, parseWakeflowConfigV3(value));
  assert.equal(serializeWakeflowConfigV3(model), `${JSON.stringify(value, null, 2)}\n`);
  const nestedReordered = clone(value);
  nestedReordered.hosts = Object.fromEntries(Object.entries(nestedReordered.hosts).reverse());
  nestedReordered.hosts.codex.launch.reasoningEffortByRole = Object.fromEntries(
    Object.entries(nestedReordered.hosts.codex.launch.reasoningEffortByRole).reverse(),
  );
  assert.equal(
    serializeWakeflowConfigV3(parseWakeflowConfigV3(nestedReordered)),
    serializeWakeflowConfigV3(model),
  );
  const reordered = Object.fromEntries(Object.entries(value).reverse());
  assert.equal(wakeflowConfigV3Digest(model), wakeflowConfigV3Digest(parseWakeflowConfigV3(reordered)));
  const explain = explainWakeflowConfigV3(model);
  assert.deepEqual(explain.fixedProtocolRoots, {
    active: ".wakeflow-active",
    local: ".wakeflow-local",
  });
  assert.equal(explain.storage.ledgerRoot.source, "durable-input");
  assert.equal(JSON.stringify(explain).includes(root), false);
  assert.equal("generatedAt" in explain, false);
});

test("the strict v3 contract is the only public config schema and default surface", async () => {
  const schema = publicSchema();
  assert.equal(schema.$id, publicSchemaId);
  const visit = (value, at = "#") => {
    if (!value || typeof value !== "object") return;
    if (value.type === "object") {
      assert.equal(value.additionalProperties, false, `${at} must reject unknown fields`);
    }
    for (const [key, child] of Object.entries(value)) visit(child, `${at}/${key}`);
  };
  visit(schema);

  for (const file of [
    "core/schemas/wakeflow-config.schema.json",
    "core/wakeflow.config.json",
    "core/wakeflow.config.example.json",
  ]) {
    const value = JSON.parse(readFileSync(path.join(repositoryRoot, file), "utf8"));
    assert.equal(
      file.includes("schemas/") ? value.$id : value.$schema,
      publicSchemaId,
      `${file} must bind the public schema URL`,
    );
    assert.equal(value.schemaVersion ?? value.properties?.schemaVersion?.const, 3);
    if (!file.includes("schemas/")) assert.equal(value.kind, "WakeflowConfig");
  }
  const publicSource = readFileSync(path.join(repositoryRoot, "core/scripts/lib/wakeflow-config-v3.mjs"), "utf8");
  assert.doesNotMatch(publicSource, /from\s+["'][^"']*wakeflow-config\.mjs["']/);
  assert.doesNotMatch(publicSource, /ConfigV3Candidate/u);

  const root = mkdtempSync(path.join(os.tmpdir(), "wakeflow-public-v3-"));
  writeFileSync(path.join(root, "wakeflow.config.json"), JSON.stringify(fixture("valid-minimal.json"), null, 2));
  const { loadWakeflowConfigV3Snapshot } = await import("../core/scripts/lib/wakeflow-config-v3-snapshot.mjs");
  const snapshot = loadWakeflowConfigV3Snapshot({ workspaceRoot: root });
  assert.equal(snapshot.model.$schema, publicSchemaId);
  assert.equal(snapshot.model.schemaVersion, 3);
});
