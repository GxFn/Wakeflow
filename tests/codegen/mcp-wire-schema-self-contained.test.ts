import { deepEqual, equal } from "node:assert/strict";
import { opendirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

interface JsonObject {
  readonly [key: string]: unknown;
}

function readSchema(relative: string): JsonObject {
  return JSON.parse(
    readFileSync(path.join(process.cwd(), relative), "utf8"),
  ) as JsonObject;
}

function externalReferences(value: unknown, result: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const entry of value) externalReferences(entry, result);
  } else if (value !== null && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      if (key === "$ref" && typeof entry === "string" && !entry.startsWith("#")) {
        result.push(entry);
      }
      externalReferences(entry, result);
    }
  }
  return result;
}

function definition(schema: JsonObject, name: string): JsonObject {
  const definitions = schema.$defs;
  if (definitions === null || typeof definitions !== "object") {
    throw new Error("Expected local Schema definitions.");
  }
  const value = (definitions as Record<string, unknown>)[name];
  if (value === null || typeof value !== "object") {
    throw new Error(`Expected local Schema definition ${name}.`);
  }
  return value as JsonObject;
}

test("MCP wire Schema 自包含且本地词法镜像 Foundation 权威", () => {
  const schemaRoot = path.join(
    process.cwd(),
    "src/contracts/schemas/entrypoints",
  );
  const handle = opendirSync(schemaRoot);
  const names: string[] = [];
  try {
    while (true) {
      const entry = handle.readSync();
      if (entry === null) break;
      if (entry.isFile() && entry.name.endsWith(".schema.json")) {
        names.push(entry.name);
      }
    }
  } finally {
    handle.closeSync();
  }
  for (const name of names.sort()) {
    equal(
      externalReferences(readSchema(
        `src/contracts/schemas/entrypoints/${name}`,
      )).length,
      0,
      `${name} must not advertise unresolved external refs`,
    );
  }

  const sha = readSchema(
    "src/contracts/schemas/foundation/sha256-digest.schema.json",
  );
  const utc = readSchema(
    "src/contracts/schemas/foundation/utc-instant.schema.json",
  );
  const expectedSha = {
    type: sha.type,
    pattern: sha.pattern,
  };
  const expectedUtc = {
    type: utc.type,
    minLength: utc.minLength,
    maxLength: utc.maxLength,
    pattern: utc.pattern,
  };
  for (const name of [
    "wakeflow-window-host-binding-registration-request.schema.json",
    "wakeflow-window-host-binding-registration-result.schema.json",
    "wakeflow-target-task-planning-request.schema.json",
    "wakeflow-target-task-planning-result.schema.json",
  ]) {
    const schema = readSchema(`src/contracts/schemas/entrypoints/${name}`);
    deepEqual(definition(schema, "sha256Digest"), expectedSha);
    deepEqual(definition(schema, "utcInstant"), expectedUtc);
  }

  const planningRequest = readSchema(
    "src/contracts/schemas/entrypoints/wakeflow-target-task-planning-request.schema.json",
  );
  const planningResult = readSchema(
    "src/contracts/schemas/entrypoints/wakeflow-target-task-planning-result.schema.json",
  );
  for (const sharedDefinition of [
    "plan",
    "taskPackage",
    "authorityMemberReference",
    "assignment",
    "boundaries",
    "acceptanceAnchor",
    "nonEmptyTextList",
    "textList",
    "humanText",
    "portableResourcePath",
    "sha256Digest",
    "utcInstant",
    "programId",
    "demandId",
    "repositoryId",
    "windowId",
    "taskPackageId",
    "targetTaskId",
    "eventId",
    "commitId",
  ]) {
    deepEqual(
      definition(planningRequest, sharedDefinition),
      definition(planningResult, sharedDefinition),
      `Planning wire definition ${sharedDefinition} must not drift`,
    );
  }
  const domainTaskPackage = readSchema(
    "src/contracts/schemas/governance/tasking/task-package.schema.json",
  );
  const publicTaskPackage = definition(planningRequest, "taskPackage");
  deepEqual(publicTaskPackage.required, domainTaskPackage.required);
  deepEqual(
    Object.keys(publicTaskPackage.properties as Record<string, unknown>).sort(),
    Object.keys(domainTaskPackage.properties as Record<string, unknown>).sort(),
    "Planning public TaskPackage fields must mirror the domain contract",
  );
});
