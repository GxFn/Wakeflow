import { equal, throws } from "node:assert/strict";
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
