import { equal, rejects } from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  loadCreateOnlyDeterministicJsonResource,
  materializeCreateOnlyDeterministicJsonResource,
  CreateOnlyDeterministicJsonResourceError,
} from "../../../src/foundation/filesystem/create-only-deterministic-json-resource.js";
import { parsePortableResourcePath } from "../../../src/foundation/filesystem/portable-resource-path.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { parseByteCount } from "../../../src/foundation/numeric/byte-count.js";

const POLICY = Object.freeze({
  directoryPath: parsePortableResourcePath("private/projections"),
  resourcePath: parsePortableResourcePath("private/projections/example.json"),
  directoryMode: 0o700,
  fileMode: 0o600,
  maximumBytes: parseByteCount(4096),
});
const DOCUMENT = '{\n  "answer": 42\n}\n';

test("只创建确定性JSON资源创建、复读和同字节重试保持一个目标", async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "wakeflow-json-projection-"),
  );
  const root = await RootedDirectory.open(directory);
  try {
    const created = await materializeCreateOnlyDeterministicJsonResource(
      root,
      POLICY,
      DOCUMENT,
    );
    equal(created.disposition, "created");
    equal(created.source.text, DOCUMENT);
    equal(created.source.node.permissionBits, 0o600);
    equal(created.source.node.linkCount, 1n);

    const current = await materializeCreateOnlyDeterministicJsonResource(
      root,
      POLICY,
      DOCUMENT,
    );
    equal(current.disposition, "current");
    equal(
      (await loadCreateOnlyDeterministicJsonResource(root, POLICY)).text,
      DOCUMENT,
    );
  } finally {
    await root.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("只创建确定性JSON资源拒绝覆盖不同字节", async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "wakeflow-json-projection-"),
  );
  const root = await RootedDirectory.open(directory);
  try {
    await materializeCreateOnlyDeterministicJsonResource(
      root,
      POLICY,
      DOCUMENT,
    );
    await writeFile(
      path.join(directory, "private/projections/example.json"),
      '{\n  "answer": 43\n}\n',
      { mode: 0o600 },
    );
    await rejects(
      materializeCreateOnlyDeterministicJsonResource(root, POLICY, DOCUMENT),
      (error: unknown) =>
        error instanceof CreateOnlyDeterministicJsonResourceError &&
        error.reason === "conflict",
    );
  } finally {
    await root.close();
    await rm(directory, { recursive: true, force: true });
  }
});
