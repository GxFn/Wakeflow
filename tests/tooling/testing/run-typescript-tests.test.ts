import { equal, throws } from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  compiledTypeScriptTests,
} from "../../../tooling/testing/run-typescript-tests.js";

test("TypeScript test runner 从当前源文件映射 focused 输出", () => {
  const repositoryRoot = process.cwd();
  const source = "tests/workspace/window-runtime/wakeflow-window-host-binding.test.ts";
  const selected = compiledTypeScriptTests(repositoryRoot, [source]);
  equal(selected.length, 1);
  equal(
    selected[0],
    path.join(
      repositoryRoot,
      ".build/tests/workspace/window-runtime/wakeflow-window-host-binding.test.js",
    ),
  );
  throws(
    () => compiledTypeScriptTests(repositoryRoot, [
      "tests/workspace/window-runtime/removed-stale.test.ts",
    ]),
    /current regular file/u,
  );
  throws(
    () => compiledTypeScriptTests(repositoryRoot, [source, source]),
    /duplicates/u,
  );
  throws(
    () => compiledTypeScriptTests(repositoryRoot, ["test/legacy.test.mjs"]),
    /below tests/u,
  );
});

test("focused test runner拒绝tests根内的symlink祖先", (t) => {
  const repositoryRoot = mkdtempSync(path.join(
    os.tmpdir(),
    "wakeflow-typescript-test-runner-",
  ));
  t.after(() => rmSync(repositoryRoot, { recursive: true, force: true }));
  const testsRoot = path.join(repositoryRoot, "tests");
  const outside = path.join(repositoryRoot, "outside");
  mkdirSync(testsRoot);
  mkdirSync(outside);
  writeFileSync(path.join(outside, "escaped.test.ts"), "");
  symlinkSync(outside, path.join(testsRoot, "linked"), "dir");

  throws(
    () => compiledTypeScriptTests(repositoryRoot, [
      "tests/linked/escaped.test.ts",
    ]),
    /parent chain/u,
  );
});
