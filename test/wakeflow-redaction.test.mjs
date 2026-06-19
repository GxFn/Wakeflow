#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  scanStateRootForRealIds,
  redactStateRootIntoCopy,
  realIdPattern,
} from "../plugins/codex-wakeflow/scripts/lib/wakeflow-redaction.mjs";
import { hostProfile as codexProfile } from "../plugins/codex-wakeflow/scripts/lib/wakeflow-host-profile.mjs";
import { hostProfile as claudeProfile } from "../plugins/claude-code-wakeflow/scripts/lib/wakeflow-host-profile.mjs";

const stubProfile = {
  handleId: {
    placeholders: ["<thread id>", "current thread", "unknown", ""],
    idShape: "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}",
  },
};

const REAL_UUID = "3f8a1c2b-9d4e-4f6a-8b1c-2d3e4f5a6b7c";

function makeStateRoot(files) {
  const root = mkdtempSync(path.join(os.tmpdir(), "wakeflow-redaction-"));
  for (const [rel, content] of Object.entries(files)) {
    const file = path.join(root, rel);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
  return root;
}

test("scan refuses on a real UUID-shaped id in a state-root file", () => {
  const root = makeStateRoot({
    "wakeflow-state.json": `{"demandKey":"X","note":"thread ${REAL_UUID}"}\n`,
    "developer-progress.md": "# clean\n",
  });
  const result = scanStateRootForRealIds(root, { hostProfile: stubProfile });
  assert.equal(result.clean, false);
  assert.ok(result.findings.some((f) => f.match === REAL_UUID), JSON.stringify(result.findings));
  assert.ok(result.findings.some((f) => f.file === "wakeflow-state.json"));
});

test("scan passes a clean state root with only placeholders", () => {
  const root = makeStateRoot({
    "wakeflow-state.json": `{"targetThread":{"threadId":"<thread id>","threadIdRedacted":true}}\n`,
    "controller-events.jsonl": `{"eventId":"evt-1","note":"current thread"}\n`,
  });
  const result = scanStateRootForRealIds(root, { hostProfile: stubProfile });
  assert.equal(result.clean, true, JSON.stringify(result.findings));
  assert.ok(result.scanned >= 2);
});

test("redactStateRootIntoCopy redacts into a copy and leaves the source untouched", () => {
  const root = makeStateRoot({ "wakeflow-state.json": `{"note":"thread ${REAL_UUID}"}\n` });
  const dest = mkdtempSync(path.join(os.tmpdir(), "wakeflow-redaction-dest-"));
  const result = redactStateRootIntoCopy(root, dest, { hostProfile: stubProfile });
  const copied = readFileSync(path.join(dest, "wakeflow-state.json"), "utf8");
  const original = readFileSync(path.join(root, "wakeflow-state.json"), "utf8");
  assert.match(copied, /<redacted>/);
  assert.doesNotMatch(copied, new RegExp(REAL_UUID));
  assert.match(original, new RegExp(REAL_UUID), "source must be left untouched");
  assert.ok(result.redactedFields.some((f) => f.file === "wakeflow-state.json" && f.count === 1));
  assert.equal(scanStateRootForRealIds(dest, { hostProfile: stubProfile }).clean, true);
});

test("scan refuses when the host profile declares no id shape (cannot audit)", () => {
  const root = makeStateRoot({ "wakeflow-state.json": "{}\n" });
  const result = scanStateRootForRealIds(root, { hostProfile: { handleId: { placeholders: [] } } });
  assert.equal(result.clean, false);
});

test("both per-edition host profiles declare a usable handleId.idShape (host-local, not synced)", () => {
  for (const profile of [codexProfile, claudeProfile]) {
    assert.equal(typeof profile.handleId.idShape, "string", "idShape must be declared");
    const pattern = realIdPattern(profile);
    assert.ok(pattern instanceof RegExp);
    assert.ok(new RegExp(pattern.source, "i").test(REAL_UUID), "idShape must match a UUID");
  }
});
