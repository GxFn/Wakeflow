import { deepEqual, equal, notEqual } from "node:assert/strict";
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  parsePortableResourcePath,
  type PortableResourcePath,
} from "../../../src/foundation/filesystem/portable-resource-path.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import {
  convergeWakeflowPrivateModes,
  inspectWakeflowPrivateModes,
  wakeflowPrivateModeAreas,
} from "../../../src/workspace/maintenance/wakeflow-private-mode-census.js";

const PRIVATE_DIRECTORIES = [
  ".wakeflow-local",
  ".wakeflow-local/runtime",
  ".wakeflow-local/runtime/x",
  ".wakeflow-active",
] as const;
const PRIVATE_FILES = [".wakeflow-local/runtime/x/state.json", ".wakeflow-active/current"] as const;

function withWorkspace(
  action: (rootPath: string, root: RootedDirectory) => Promise<void>,
  options: Readonly<{ readonly active?: boolean }> = {},
): () => Promise<void> {
  return async () => {
    const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-private-census-"));
    for (const directory of PRIVATE_DIRECTORIES) {
      if (options.active === false && directory.startsWith(".wakeflow-active")) continue;
      mkdirSync(path.join(rootPath, directory), { mode: 0o700 });
      chmodSync(path.join(rootPath, directory), 0o700);
    }
    for (const file of PRIVATE_FILES) {
      if (options.active === false && file.startsWith(".wakeflow-active")) continue;
      writeFileSync(path.join(rootPath, file), "{}");
      chmodSync(path.join(rootPath, file), 0o600);
    }
    const root = await RootedDirectory.open(rootPath);
    try {
      await action(rootPath, root);
    } finally {
      await root.close();
      rmSync(rootPath, { recursive: true, force: true });
    }
  };
}

function refs(values: readonly string[]): PortableResourcePath[] {
  return values.map((value) => parsePortableResourcePath(value));
}

test(
  "a private workspace is current and drift is reported, converged and then current",
  withWorkspace(async (rootPath, root) => {
    const clean = await inspectWakeflowPrivateModes(root);
    equal(clean.status, "current");
    deepEqual(clean.drifted, []);
    deepEqual(clean.unsafe, []);
    equal(clean.issue, null);
    chmodSync(path.join(rootPath, ".wakeflow-local"), 0o755);
    chmodSync(path.join(rootPath, ".wakeflow-local/runtime/x"), 0o755);
    chmodSync(path.join(rootPath, ".wakeflow-local/runtime/x/state.json"), 0o644);
    chmodSync(path.join(rootPath, ".wakeflow-active/current"), 0o644);
    const drift = await inspectWakeflowPrivateModes(root);
    equal(drift.status, "safe-drift");
    deepEqual(
      drift.drifted.map((entry) => entry.resourcePath),
      refs([
        ".wakeflow-active/current",
        ".wakeflow-local",
        ".wakeflow-local/runtime/x",
        ".wakeflow-local/runtime/x/state.json",
      ]),
    );
    equal((await inspectWakeflowPrivateModes(root)).censusDigest, drift.censusDigest);
    notEqual(drift.censusDigest, clean.censusDigest);
    const receipt = await convergeWakeflowPrivateModes(root, drift);
    deepEqual({ ...receipt }, { converged: 4, current: 0, changed: 0 });
    equal(lstatSync(path.join(rootPath, ".wakeflow-local")).mode & 0o777, 0o700);
    const after = await inspectWakeflowPrivateModes(root);
    equal(after.status, "current");
    equal(after.censusDigest, clean.censusDigest);
  }),
);

test(
  "an unsafe node is reported and never converged",
  withWorkspace(async (rootPath, root) => {
    chmodSync(path.join(rootPath, ".wakeflow-local/runtime"), 0o755);
    mkdirSync(path.join(rootPath, ".wakeflow-local/runtime/open"));
    chmodSync(path.join(rootPath, ".wakeflow-local/runtime/open"), 0o777);
    const census = await inspectWakeflowPrivateModes(root);
    equal(census.status, "unsafe");
    deepEqual(census.unsafe, refs([".wakeflow-local/runtime/open"]));
    deepEqual(census.drifted.map((entry) => entry.resourcePath), refs([".wakeflow-local/runtime"]));
    const receipt = await convergeWakeflowPrivateModes(root, census);
    deepEqual({ ...receipt }, { converged: 1, current: 0, changed: 0 });
    equal(lstatSync(path.join(rootPath, ".wakeflow-local/runtime/open")).mode & 0o777, 0o777);
  }),
);

test(
  "a missing tree is skipped and a node changed after the census is counted, not forced",
  withWorkspace(
    async (rootPath, root) => {
      chmodSync(path.join(rootPath, ".wakeflow-local/runtime/x/state.json"), 0o644);
      const census = await inspectWakeflowPrivateModes(root);
      equal(census.status, "safe-drift");
      deepEqual(
        census.drifted.map((entry) => entry.resourcePath),
        refs([".wakeflow-local/runtime/x/state.json"]),
      );
      chmodSync(path.join(rootPath, ".wakeflow-local/runtime/x/state.json"), 0o640);
      const receipt = await convergeWakeflowPrivateModes(root, census);
      deepEqual({ ...receipt }, { converged: 0, current: 0, changed: 1 });
      equal(lstatSync(path.join(rootPath, ".wakeflow-local/runtime/x/state.json")).mode & 0o777, 0o640);
    },
    { active: false },
  ),
);

test("wakeflowPrivateModeAreas cuts paths to three segments, keeps a minimal cover and caps", () => {
  const paths = refs([
    ".wakeflow-local/runtime/x/state.json",
    ".wakeflow-local/runtime/x/other.json",
    ".wakeflow-active",
    ".wakeflow-local/runtime/y",
    ".wakeflow-local/sessions/a/b",
  ]);
  deepEqual(wakeflowPrivateModeAreas(paths), [
    ".wakeflow-active",
    ".wakeflow-local/runtime/x",
    ".wakeflow-local/runtime/y",
  ]);
  deepEqual(wakeflowPrivateModeAreas(paths, 5), [
    ".wakeflow-active",
    ".wakeflow-local/runtime/x",
    ".wakeflow-local/runtime/y",
    ".wakeflow-local/sessions/a",
  ]);
  // 最小覆盖：祖先已在列的区域不再重复。
  deepEqual(
    wakeflowPrivateModeAreas(
      refs([".wakeflow-local/runtime/x/y", ".wakeflow-local", ".wakeflow-active/current/board/z"]),
    ),
    [".wakeflow-active/current/board", ".wakeflow-local"],
  );
});
