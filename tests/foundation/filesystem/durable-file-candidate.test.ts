import {
  deepEqual,
  equal,
  rejects,
} from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
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
import { countFsyncs } from "./fsync-count-probe.js";

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

test("根的持久化级别与候选自己的 content-only 取更弱的一档", {
  concurrency: false,
}, async (t) => {
  const durablePath = mkdtempSync(path.join(
    os.tmpdir(),
    "wakeflow-file-candidate-durability-fsync-",
  ));
  const disposablePath = mkdtempSync(path.join(
    os.tmpdir(),
    "wakeflow-file-candidate-durability-none-",
  ));
  t.after(() => {
    rmSync(durablePath, { recursive: true, force: true });
    rmSync(disposablePath, { recursive: true, force: true });
  });

  const durableRoot = await RootedDirectory.open(durablePath, "$root", {
    durability: "fsync",
  });
  const disposableRoot = await RootedDirectory.open(disposablePath, "$root", {
    durability: "none",
  });
  const bytes = encodeUtf8("candidate\n");

  function createCountingSyncs(
    root: RootedDirectory,
    name: string,
    durability?: "fsync" | "content-only",
  ) {
    return countFsyncs(() =>
      createFileCandidateDurably(root, parsePortableResourcePath(name), bytes, {
        mode: 0o600,
        ...(durability === undefined ? {} : { durability }),
      }),
    );
  }

  try {
    // 两个名字不同的持久化选项组合在一起：内容同步归根管，父目录条目同步归选项管。
    const both = await createCountingSyncs(durableRoot, "both.json");
    const contentOnly = await createCountingSyncs(
      durableRoot,
      "content-only.json",
      "content-only",
    );
    const noneDefault = await createCountingSyncs(disposableRoot, "both.json");
    const noneContentOnly = await createCountingSyncs(
      disposableRoot,
      "content-only.json",
      "content-only",
    );

    equal(both.syncCount, 2);
    // `content-only` 只省掉父目录条目那一次；内容仍按根的级别同步。
    equal(contentOnly.syncCount, 1);
    // 根是 none：逐次选项抬不回来，内容与父目录一次都不同步。
    equal(noneDefault.syncCount, 0);
    equal(noneContentOnly.syncCount, 0);

    // 四种组合的可观察结果必须一致：字节、权限位、链接数与条目集合都不随级别变化。
    for (const name of ["both.json", "content-only.json"]) {
      deepEqual(readFileSync(path.join(disposablePath, name)), Buffer.from(bytes));
      deepEqual(
        readFileSync(path.join(disposablePath, name)),
        readFileSync(path.join(durablePath, name)),
      );
      equal(
        statSync(path.join(disposablePath, name)).mode & 0o777,
        statSync(path.join(durablePath, name)).mode & 0o777,
      );
    }
    equal(noneDefault.result.node.linkCount, both.result.node.linkCount);
    equal(noneDefault.result.digest, both.result.digest);
    deepEqual(
      readdirSync(disposablePath).sort(),
      readdirSync(durablePath).sort(),
    );
  } finally {
    await durableRoot.close();
    await disposableRoot.close();
  }
});
