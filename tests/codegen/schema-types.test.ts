import {
  deepEqual,
  equal,
  match,
  rejects,
  throws,
} from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  buildSchemaTypes,
  checkSchemaTypes,
  loadSchemaCatalog,
  SchemaCodegenError,
} from "../../tooling/codegen/schema-types.js";

const repoRoot = process.cwd();
const identitySchemaRelativePath =
  "identity/wakeflow-durable-id-kind.schema.json";
const identityGeneratedRelativePath =
  "identity/wakeflow-durable-id-kind.generated.ts";
const utcInstantSchemaRelativePath =
  "foundation/utc-instant.schema.json";
const utcInstantGeneratedRelativePath =
  "foundation/utc-instant.generated.ts";
const portableResourcePathSchemaRelativePath =
  "foundation/portable-resource-path.schema.json";
const portableResourcePathGeneratedRelativePath =
  "foundation/portable-resource-path.generated.ts";
const artifactSchemaRelativePath =
  "foundation/loaded-artifact-tree-manifest.schema.json";
const configSchemaRelativePath =
  "configuration/wakeflow-config-v3.schema.json";

function generatedFiles(root: string): readonly string[] {
  const files: string[] = [];
  function visit(directory: string): void {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) files.push(absolute);
    }
  }
  visit(root);
  return files.sort();
}

function copyIdentitySchema(fixtureRoot: string): void {
  const source = path.join(
    repoRoot,
    "src/contracts/schemas",
    identitySchemaRelativePath,
  );
  const destination = path.join(
    fixtureRoot,
    "src/contracts/schemas",
    identitySchemaRelativePath,
  );
  mkdirSync(path.dirname(destination), { recursive: true });
  writeFileSync(destination, readFileSync(source));
}

test("new-project Schema catalog closes the current shared contracts", () => {
  const catalog = loadSchemaCatalog(repoRoot);

  equal(catalog.length > 0, true);
  const paths = catalog.map((record) => record.relativePath);
  deepEqual(paths, [...paths].sort());
  for (const required of [
    configSchemaRelativePath,
    artifactSchemaRelativePath,
    portableResourcePathSchemaRelativePath,
    utcInstantSchemaRelativePath,
    identitySchemaRelativePath,
  ]) {
    equal(paths.includes(required), true, required);
  }
  const identity = catalog.find(
    (record) => record.relativePath === identitySchemaRelativePath,
  );
  const utcInstant = catalog.find(
    (record) => record.relativePath === utcInstantSchemaRelativePath,
  );
  const portableResourcePath = catalog.find(
    (record) => record.relativePath === portableResourcePathSchemaRelativePath,
  );
  equal(
    identity?.id,
    "urn:wakeflow:identity:durable-id-kind:v1",
  );
  equal(
    utcInstant?.id,
    "urn:wakeflow:foundation:time:utc-instant:v1",
  );
  equal(
    portableResourcePath?.id,
    "urn:wakeflow:foundation:filesystem:portable-resource-path:v1",
  );
  equal(
    catalog.every((record) => record.externalRefs.every((reference) => (
      catalog.some((candidate) => reference.startsWith(candidate.id))
    ))),
    true,
  );
});

test("Schema generation emits portable runtime contracts under .build", async () => {
  const output = `.build/test-schema-types-${process.pid}`;
  const absolute = path.join(repoRoot, output);
  rmSync(absolute, { recursive: true, force: true });
  try {
    const catalog = loadSchemaCatalog(repoRoot);
    const result = await buildSchemaTypes(repoRoot, output);
    equal(result.schemaCount, catalog.length);
    equal(
      result.externalRefEdges,
      catalog.reduce((sum, record) => sum + record.externalRefs.length, 0),
    );
    match(result.digest, /^sha256:[0-9a-f]{64}$/u);

    const files = generatedFiles(absolute);
    equal(files.length, catalog.length);
    const relativeFiles = files.map((file) => (
      path.relative(absolute, file).split(path.sep).join("/")
    ));
    deepEqual(relativeFiles, catalog.map((record) => (
      record.relativePath.replace(/\.schema\.json$/u, ".generated.ts")
    )));

    const identityGenerated = readFileSync(
      path.join(absolute, identityGeneratedRelativePath),
      "utf8",
    );
    match(identityGenerated, /export const WAKEFLOW_DURABLE_ID_KINDS/u);
    match(identityGenerated, /export type WakeflowDurableIdKind/u);

    const utcInstantGenerated = readFileSync(
      path.join(absolute, utcInstantGeneratedRelativePath),
      "utf8",
    );
    match(utcInstantGenerated, /export const UTC_INSTANT_PATTERN_SOURCE/u);
    match(utcInstantGenerated, /export type WakeflowUtcInstantText/u);
    const utcSchema = JSON.parse(readFileSync(
      path.join(
        repoRoot,
        "src/contracts/schemas",
        utcInstantSchemaRelativePath,
      ),
      "utf8",
    )) as { readonly pattern?: unknown };
    equal(typeof utcSchema.pattern, "string");
    equal(
      utcInstantGenerated.includes(JSON.stringify(utcSchema.pattern)),
      true,
    );

    const portableResourcePathGenerated = readFileSync(
      path.join(absolute, portableResourcePathGeneratedRelativePath),
      "utf8",
    );
    match(
      portableResourcePathGenerated,
      /export const PORTABLE_RESOURCE_PATH_PATTERN_SOURCE/u,
    );
    match(
      portableResourcePathGenerated,
      /export type WakeflowPortableResourcePathText/u,
    );
    const portableResourcePathSchema = JSON.parse(readFileSync(
      path.join(
        repoRoot,
        "src/contracts/schemas",
        portableResourcePathSchemaRelativePath,
      ),
      "utf8",
    )) as { readonly pattern?: unknown };
    equal(typeof portableResourcePathSchema.pattern, "string");
    equal(
      portableResourcePathGenerated.includes(
        JSON.stringify(portableResourcePathSchema.pattern),
      ),
      true,
    );

    const configGenerated = readFileSync(
      path.join(
        absolute,
        configSchemaRelativePath.replace(/\.schema\.json$/u, ".generated.ts"),
      ),
      "utf8",
    );
    match(configGenerated, /export const WAKEFLOW_CONFIG_V3_SCHEMA/u);
    match(configGenerated, /export interface WakeflowConfigV3/u);
    match(configGenerated, /restoreGeneratedSchema/u);

    const combined = files.map((file) => readFileSync(file, "utf8")).join("\n");
    match(combined, /此文件由 Wakeflow JSON Schema 生成，禁止手工修改/u);
    equal(combined.includes(repoRoot), false);
  } finally {
    rmSync(absolute, { recursive: true, force: true });
  }
});

test("Schema check is deterministic and matches committed generated output", async () => {
  const output = `.build/test-schema-check-${process.pid}`;
  const absolute = path.join(repoRoot, output);
  rmSync(absolute, { recursive: true, force: true });
  try {
    const catalog = loadSchemaCatalog(repoRoot);
    const result = await checkSchemaTypes(repoRoot, output);
    equal(result.mode, "check");
    equal(result.schemaCount, catalog.length);
    equal(result.outputRoot, "src/contracts/generated");
  } finally {
    rmSync(absolute, { recursive: true, force: true });
  }
});

test("Schema catalog uses strict source semantics and closed references", async () => {
  const orderedRoot = mkdtempSync(path.join(tmpdir(), "wakeflow-schema-order-"));
  const orderedSchemas = path.join(orderedRoot, "src/contracts/schemas");
  mkdirSync(orderedSchemas, { recursive: true });
  writeFileSync(path.join(orderedSchemas, "Z.schema.json"), `{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "urn:wakeflow:test:prototype-record",
  "title": "WakeflowPrototypeRecord",
  "x-wakeflow-runtime-export": "WAKEFLOW_TEST_PROTO_SCHEMA",
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "__proto__": { "type": "string" }
  }
}\n`);
  writeFileSync(path.join(orderedSchemas, "a.schema.json"), `${JSON.stringify({
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "urn:wakeflow:test:plain-text",
    title: "WakeflowPlainText",
    type: "string",
  }, null, 2)}\n`);
  try {
    const catalog = loadSchemaCatalog(orderedRoot);
    deepEqual(
      catalog.map((record) => record.relativePath),
      ["Z.schema.json", "a.schema.json"],
    );
    await buildSchemaTypes(orderedRoot);
    const generated = readFileSync(path.join(
      orderedRoot,
      "src/contracts/generated/Z.generated.ts",
    ), "utf8");
    const restoreCall = generated.match(
      /export const WAKEFLOW_TEST_PROTO_SCHEMA = restoreGeneratedSchema\((.+)\);/u,
    );
    if (restoreCall?.[1] === undefined) {
      throw new Error("Expected serialized runtime Schema restore call.");
    }
    const serialized = JSON.parse(restoreCall[1]) as unknown;
    if (typeof serialized !== "string") {
      throw new Error("Expected serialized runtime Schema JSON text.");
    }
    const restored = JSON.parse(serialized) as {
      readonly properties?: Readonly<Record<string, unknown>>;
    };
    equal(
      restored.properties !== undefined
        && Object.hasOwn(restored.properties, "__proto__"),
      true,
    );
  } finally {
    rmSync(orderedRoot, { recursive: true, force: true });
  }

  const invalidRoot = mkdtempSync(path.join(tmpdir(), "wakeflow-schema-invalid-"));
  const invalidSchemas = path.join(invalidRoot, "src/contracts/schemas");
  mkdirSync(invalidSchemas, { recursive: true });
  try {
    writeFileSync(path.join(invalidSchemas, "invalid.schema.json"), `{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "urn:wakeflow:test:duplicate",
  "title": "WakeflowDuplicateSchema",
  "type": "object",
  "$defs": {
    "value": { "type": "string", "type": "number" }
  }
}\n`);
    throws(
      () => loadSchemaCatalog(invalidRoot),
      (error: unknown) => error instanceof SchemaCodegenError
        && error.code === "wakeflow-schema-json-duplicate-key",
    );

    writeFileSync(
      path.join(invalidSchemas, "invalid.schema.json"),
      `${JSON.stringify({
        $schema: "https://json-schema.org/draft/2020-12/schema",
        $id: "urn:wakeflow:test:root",
        title: "WakeflowUnknownReference",
        $ref: "https://example.invalid/not-in-catalog",
      })}\n`,
    );
    throws(
      () => loadSchemaCatalog(invalidRoot),
      (error: unknown) => error instanceof SchemaCodegenError
        && error.code === "wakeflow-schema-ref",
    );
  } finally {
    rmSync(invalidRoot, { recursive: true, force: true });
  }
});

test("Schema check rejects a modified committed generated vocabulary", async () => {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), "wakeflow-schema-drift-"));
  copyIdentitySchema(fixtureRoot);
  try {
    await buildSchemaTypes(fixtureRoot);
    const generated = path.join(
      fixtureRoot,
      "src/contracts/generated",
      identityGeneratedRelativePath,
    );
    writeFileSync(generated, `${readFileSync(generated, "utf8")}\n`);

    await rejects(
      checkSchemaTypes(fixtureRoot),
      (error: unknown) => error instanceof SchemaCodegenError
        && error.code === "wakeflow-schema-generated-drift",
    );
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("Schema check cannot use the committed generated directory as scratch", async () => {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), "wakeflow-schema-scope-"));
  copyIdentitySchema(fixtureRoot);
  try {
    await buildSchemaTypes(fixtureRoot);
    const generated = path.join(
      fixtureRoot,
      "src/contracts/generated",
      identityGeneratedRelativePath,
    );
    const before = readFileSync(generated, "utf8");

    await rejects(
      checkSchemaTypes(fixtureRoot, "src/contracts/generated"),
      (error: unknown) => error instanceof SchemaCodegenError
        && error.code === "wakeflow-schema-output-scope",
    );
    equal(readFileSync(generated, "utf8"), before);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});
