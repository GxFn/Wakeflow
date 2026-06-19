import { runSync } from "../plugins/codex-wakeflow/lib/wakeflow-process.mjs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

// Guards W0-6 / RA7 (P2-12/F14): running wakeflow-validate.mjs directly from core/ (a
// maintainer dev convenience) must give a clear "run from a synced edition" message instead
// of a bare ERR_MODULE_NOT_FOUND, because the host-local wakeflow-host-artifact-checks.mjs is
// not present in core/. A synced edition still resolves the real module normally.

const coreValidate = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../core/scripts/wakeflow-validate.mjs",
);

test("core-rooted wakeflow-validate explains the host-local gap instead of crashing", () => {
  const result = runSync(process.execPath, [coreValidate, "--root", path.dirname(coreValidate)], {
    encoding: "utf8",
  });
  const out = `${result.stdout}${result.stderr}`;
  assert.match(out, /host-artifact checks skipped/, "core-rooted validate must explain the host-local module is absent");
  assert.doesNotMatch(out, /ERR_MODULE_NOT_FOUND/, "core-rooted validate must not crash with a bare module-not-found error");
  assert.doesNotMatch(out, /Cannot find module/, "core-rooted validate must not crash with a bare module-not-found error");
});
