import {
  equal,
  rejects,
} from "node:assert/strict";
import {
  mkdtempSync,
  readdirSync,
  rmSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  createFileCandidateDurably,
  DurableFileCandidateError,
} from "../../../src/foundation/filesystem/durable-file-candidate.js";
import { parsePortableResourcePath } from "../../../src/foundation/filesystem/portable-resource-path.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { encodeUtf8 } from "../../../src/foundation/text/utf8.js";

test("durable file candidate 直接创建具名非权威文件且不产生匿名 stage", async () => {
  const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), "wakeflow-file-candidate-"));
  const root = await RootedDirectory.open(fixtureRoot);
  try {
    const ref = parsePortableResourcePath("candidate.json");
    const created = await createFileCandidateDurably(
      root,
      ref,
      encodeUtf8("candidate\n"),
      { mode: 0o600 },
    );
    equal(created.resourcePath, ref);
    equal(created.node.permissionBits, 0o600);
    equal(created.node.linkCount, 1n);
    equal(readdirSync(fixtureRoot).join(","), "candidate.json");

    await rejects(
      createFileCandidateDurably(root, ref, encodeUtf8("other\n"), {
        mode: 0o600,
      }),
      (error: unknown) => (
        error instanceof DurableFileCandidateError
        && error.reason === "target-exists"
      ),
    );
  } finally {
    await root.close();
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("durable file candidate 在任何写入前拒绝取消和共享字节", async () => {
  const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), "wakeflow-file-candidate-input-"));
  const root = await RootedDirectory.open(fixtureRoot);
  try {
    const ref = parsePortableResourcePath("candidate.bin");
    const controller = new AbortController();
    controller.abort();
    await rejects(
      createFileCandidateDurably(root, ref, new Uint8Array([1]), {
        mode: 0o600,
        signal: controller.signal,
      }),
      (error: unknown) => (
        error instanceof DurableFileCandidateError
        && error.reason === "aborted"
      ),
    );

    await rejects(
      createFileCandidateDurably(
        root,
        ref,
        new Uint8Array(new SharedArrayBuffer(1)),
        { mode: 0o600 },
      ),
      (error: unknown) => (
        error instanceof DurableFileCandidateError
        && error.reason === "input"
      ),
    );

    await rejects(
      createFileCandidateDurably(
        root,
        ref,
        new Proxy(new Uint8Array([1]), {}),
        { mode: 0o600 },
      ),
      (error: unknown) => (
        error instanceof DurableFileCandidateError
        && error.reason === "input"
      ),
    );
    equal(readdirSync(fixtureRoot).length, 0);
  } finally {
    await root.close();
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("durable file candidate 将缺失父目录稳定映射为 parent", async () => {
  const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), "wakeflow-file-candidate-parent-"));
  const root = await RootedDirectory.open(fixtureRoot);
  try {
    await rejects(
      createFileCandidateDurably(
        root,
        parsePortableResourcePath("missing/candidate.bin"),
        new Uint8Array([1]),
        { mode: 0o600 },
      ),
      (error: unknown) => (
        error instanceof DurableFileCandidateError
        && error.reason === "parent"
      ),
    );
    equal(readdirSync(fixtureRoot).length, 0);
  } finally {
    await root.close();
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});
