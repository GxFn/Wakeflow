import { equal, rejects } from "node:assert/strict";
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { createFileNodeSnapshot } from "../../../src/foundation/filesystem/file-node-snapshot.js";
import {
  parsePortableResourcePath,
  type PortableResourcePath,
} from "../../../src/foundation/filesystem/portable-resource-path.js";
import {
  classifyPrivateNode,
  convergePrivateNodeMode,
  PrivateModeConvergenceError,
  type PrivateModeConvergenceErrorReason,
} from "../../../src/foundation/filesystem/private-mode-convergence.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";

function withTempRoot(
  action: (rootPath: string, root: RootedDirectory) => Promise<void>,
): () => Promise<void> {
  return async () => {
    const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-private-mode-"));
    const root = await RootedDirectory.open(rootPath);
    try {
      await action(rootPath, root);
    } finally {
      await root.close();
      rmSync(rootPath, { recursive: true, force: true });
    }
  };
}

function ref(value: string): PortableResourcePath {
  return parsePortableResourcePath(value);
}

async function snapshot(root: RootedDirectory, value: string) {
  return (await root.inspectExistingResource(ref(value))).node;
}

function expectConvergenceError(reason: PrivateModeConvergenceErrorReason) {
  return (error: unknown): boolean =>
    error instanceof PrivateModeConvergenceError && error.reason === reason;
}

test(
  "classifyPrivateNode separates current, safe drift and unsafe nodes",
  withTempRoot(async (rootPath, root) => {
    const directories: readonly (readonly [number, string])[] = [
      [0o700, "current"],
      [0o755, "safe-drift"],
      [0o750, "safe-drift"],
      [0o777, "unsafe"],
      [0o775, "unsafe"],
      [0o500, "unsafe"],
    ];
    const files: readonly (readonly [number, string])[] = [
      [0o600, "current"],
      [0o644, "safe-drift"],
      [0o640, "safe-drift"],
      [0o744, "safe-drift"],
      [0o666, "unsafe"],
      [0o620, "unsafe"],
      [0o4755, "unsafe"],
    ];
    for (const [mode, expected] of directories) {
      const name = `d${mode.toString(8)}`;
      mkdirSync(path.join(rootPath, name));
      chmodSync(path.join(rootPath, name), mode);
      equal(classifyPrivateNode(await snapshot(root, name)), expected, name);
    }
    for (const [mode, expected] of files) {
      const name = `f${mode.toString(8)}`;
      writeFileSync(path.join(rootPath, name), "x");
      chmodSync(path.join(rootPath, name), mode);
      equal(classifyPrivateNode(await snapshot(root, name)), expected, name);
    }
    writeFileSync(path.join(rootPath, "target"), "x");
    chmodSync(path.join(rootPath, "target"), 0o600);
    symlinkSync("target", path.join(rootPath, "link"));
    const link = createFileNodeSnapshot(lstatSync(path.join(rootPath, "link"), { bigint: true }));
    equal(classifyPrivateNode(link), "unsafe");
    for (const [mode] of directories) chmodSync(path.join(rootPath, `d${mode.toString(8)}`), 0o700);
  }),
);

test(
  "convergePrivateNodeMode narrows a drifted directory and file on the same inode",
  withTempRoot(async (rootPath, root) => {
    mkdirSync(path.join(rootPath, "dir"));
    chmodSync(path.join(rootPath, "dir"), 0o755);
    writeFileSync(path.join(rootPath, "file"), "x");
    chmodSync(path.join(rootPath, "file"), 0o644);
    for (const [name, target] of [["dir", 0o700], ["file", 0o600]] as const) {
      const before = await snapshot(root, name);
      equal(await convergePrivateNodeMode(root, ref(name), before), "converged");
      const after = await snapshot(root, name);
      equal(after.permissionBits, target);
      equal(after.inodeId, before.inodeId);
      equal(await convergePrivateNodeMode(root, ref(name), before), "current");
    }
  }),
);

test(
  "convergePrivateNodeMode refuses changed, unsafe and symlinked nodes",
  withTempRoot(async (rootPath, root) => {
    writeFileSync(path.join(rootPath, "file"), "x");
    chmodSync(path.join(rootPath, "file"), 0o644);
    const planned = await snapshot(root, "file");
    writeFileSync(path.join(rootPath, "other"), "y");
    chmodSync(path.join(rootPath, "other"), 0o644);
    renameSync(path.join(rootPath, "other"), path.join(rootPath, "file"));
    await rejects(
      convergePrivateNodeMode(root, ref("file"), planned),
      expectConvergenceError("resource-changed"),
    );
    const replaced = await snapshot(root, "file");
    chmodSync(path.join(rootPath, "file"), 0o640);
    await rejects(
      convergePrivateNodeMode(root, ref("file"), replaced),
      expectConvergenceError("resource-changed"),
    );
    mkdirSync(path.join(rootPath, "open"));
    chmodSync(path.join(rootPath, "open"), 0o777);
    await rejects(
      convergePrivateNodeMode(root, ref("open"), await snapshot(root, "open")),
      expectConvergenceError("resource-unsafe"),
    );
    equal(lstatSync(path.join(rootPath, "open")).mode & 0o777, 0o777);
    writeFileSync(path.join(rootPath, "target"), "x");
    chmodSync(path.join(rootPath, "target"), 0o644);
    const target = await snapshot(root, "target");
    symlinkSync("target", path.join(rootPath, "link"));
    await rejects(convergePrivateNodeMode(root, ref("link"), target), PrivateModeConvergenceError);
    equal(lstatSync(path.join(rootPath, "target")).mode & 0o777, 0o644);
  }),
);
