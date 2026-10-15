import { equal, ok, rejects } from "node:assert/strict";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { type TestContext, test } from "node:test";

import {
  AbsoluteNodeObservationError,
  observeAbsoluteNode,
  readAbsoluteRegularFileText,
} from "../../../src/foundation/filesystem/absolute-node-observation.js";

function fixture(t: TestContext): string {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "wakeflow-absolute-node-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(path.join(root, "f.txt"), "pointer\n");
  mkdirSync(path.join(root, "d"));
  symlinkSync(path.join(root, "f.txt"), path.join(root, "l"));
  return root;
}

async function expectError(
  action: () => Promise<unknown>,
  reason: AbsoluteNodeObservationError["reason"],
): Promise<AbsoluteNodeObservationError> {
  let caught: unknown;
  try {
    await action();
  } catch (error: unknown) {
    caught = error;
  }
  if (!(caught instanceof AbsoluteNodeObservationError))
    throw new Error("Expected AbsoluteNodeObservationError.");
  equal(caught.code, "wakeflow-absolute-node-observation");
  equal(caught.reason, reason);
  return caught;
}

test("观察绝对路径：文件、目录、符号链接（lstat 与 follow）、不存在与中途不是目录", async (t) => {
  const root = fixture(t);
  const file = await observeAbsoluteNode(path.join(root, "f.txt"));
  ok(file.state === "present");
  equal(file.node.kind, "file");
  equal(file.realPath, path.join(root, "f.txt"));
  const directory = await observeAbsoluteNode(path.join(root, "d"));
  ok(directory.state === "present" && directory.node.kind === "directory");
  const link = await observeAbsoluteNode(path.join(root, "l"));
  ok(link.state === "present");
  equal(link.node.kind, "symbolic-link");
  equal(link.realPath, path.join(root, "f.txt"));
  const followed = await observeAbsoluteNode(path.join(root, "l"), { follow: true });
  ok(followed.state === "present" && followed.node.kind === "file");
  equal((await observeAbsoluteNode(path.join(root, "missing"))).state, "missing");
  equal((await observeAbsoluteNode(path.join(root, "f.txt", "below"))).state, "missing");
});

test("输入必须是规范的绝对路径；无法观察的节点带 errno 的 inspection-failure", async (t) => {
  const root = fixture(t);
  await expectError(() => observeAbsoluteNode("relative/path"), "input");
  await expectError(() => observeAbsoluteNode(`${root}/`), "input");
  await expectError(() => observeAbsoluteNode(" "), "input");
  await expectError(
    () => observeAbsoluteNode(path.join(root, "f.txt"), { follow: "yes" as never }),
    "input",
  );
  if (typeof process.getuid === "function" && process.getuid() === 0) return;
  const sealed = path.join(root, "sealed");
  mkdirSync(sealed);
  writeFileSync(path.join(sealed, "inner.txt"), "x\n");
  chmodSync(sealed, 0o000);
  try {
    const failure = await expectError(
      () => observeAbsoluteNode(path.join(sealed, "inner.txt")),
      "inspection-failure",
    );
    equal((failure.cause as { code?: string }).code, "EACCES");
  } finally {
    chmodSync(sealed, 0o700);
  }
});

test("读绝对路径上的小普通文件：跟随链接、超限与非文件为 null、不存在为 null、读失败带 errno", async (t) => {
  const root = fixture(t);
  equal(await readAbsoluteRegularFileText(path.join(root, "f.txt"), 64), "pointer\n");
  equal(await readAbsoluteRegularFileText(path.join(root, "l"), 64), "pointer\n");
  equal(await readAbsoluteRegularFileText(path.join(root, "f.txt"), 3), null);
  equal(await readAbsoluteRegularFileText(path.join(root, "d"), 64), null);
  equal(await readAbsoluteRegularFileText(path.join(root, "missing"), 64), null);
  await expectError(() => readAbsoluteRegularFileText(path.join(root, "f.txt"), -1), "input");
  await rejects(readAbsoluteRegularFileText("f.txt", 64), AbsoluteNodeObservationError);
  if (typeof process.getuid === "function" && process.getuid() === 0) return;
  const unreadable = path.join(root, "unreadable.txt");
  writeFileSync(unreadable, "secret\n");
  chmodSync(unreadable, 0o000);
  try {
    const failure = await expectError(
      () => readAbsoluteRegularFileText(unreadable, 64),
      "read-failure",
    );
    equal((failure.cause as { code?: string }).code, "EACCES");
  } finally {
    chmodSync(unreadable, 0o600);
  }
});
