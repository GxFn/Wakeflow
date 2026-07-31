#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  archivePrivacyFindingCounts,
  scanStateRootForRealIds,
  scanStateRootForArchivePrivacy,
  redactStateRootIntoCopy,
  realIdPattern,
} from "../core/scripts/lib/wakeflow-redaction.mjs";
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

test("archive privacy scan categorizes workspace and home paths and produces a portable copy", () => {
  const userHome = "/Users/wakeflow-test-user";
  const workspaceRoot = `${userHome}/Documents/Wake Workspace`;
  const root = makeStateRoot({
    "target-results/result.json": JSON.stringify({
      trace: { root: workspaceRoot },
      workspaceEvidence: `${workspaceRoot}/reports/result.json`,
      externalEvidence: `${userHome}/.asd/history.sqlite`,
    }),
  });
  const scan = scanStateRootForArchivePrivacy(root, { hostProfile: stubProfile, workspaceRoot, userHome });
  assert.equal(scan.clean, false);
  assert.deepEqual(archivePrivacyFindingCounts(scan.findings), {
    "workspace-absolute-path": 2,
    "home-absolute-path": 1,
  });

  const dest = mkdtempSync(path.join(os.tmpdir(), "wakeflow-archive-privacy-dest-"));
  const result = redactStateRootIntoCopy(root, dest, { hostProfile: stubProfile, workspaceRoot, userHome });
  const copied = readFileSync(path.join(dest, "target-results/result.json"), "utf8");
  assert.doesNotMatch(copied, /\/Users\/wakeflow-test-user/);
  assert.match(copied, /<workspace-root>/);
  assert.match(copied, /~\/.asd\/history\.sqlite/);
  assert.equal(readFileSync(path.join(root, "target-results/result.json"), "utf8").includes(userHome), true, "source stays byte-for-byte available");
  assert.ok(result.redactedFields.some((field) => field.kinds["workspace-absolute-path"] === 2));
  assert.equal(scanStateRootForArchivePrivacy(dest, { hostProfile: stubProfile, workspaceRoot, userHome }).clean, true);
});

test("sensitive opaque evidence becomes a portable placeholder while source bytes stay untouched", () => {
  const root = makeStateRoot({
    "evidence/report.pdf": Buffer.from(`%PDF-1.4\0thread=${REAL_UUID}\nworkspace=PLACEHOLDER\0`),
    "evidence/raw.bin": Buffer.concat([
      Buffer.from([0xff, 0xfe]),
      Buffer.from(`thread=${REAL_UUID}\n`),
    ]),
  });
  const file = path.join(root, "evidence/report.pdf");
  writeFileSync(
    file,
    readFileSync(file).toString("utf8").replace("PLACEHOLDER", `${root}/private/result.json`),
  );
  const scan = scanStateRootForArchivePrivacy(root, {
    hostProfile: stubProfile,
    workspaceRoot: root,
  });
  assert.equal(scan.clean, false);
  assert.ok(scan.findings.some((finding) => finding.kind === "opaque-real-id"));
  assert.ok(scan.findings.some((finding) => (
    finding.kind === "opaque-real-id"
    && finding.file === "evidence/raw.bin"
  )));
  assert.ok(scan.findings.some((finding) => finding.kind === "opaque-workspace-absolute-path"));

  const dest = mkdtempSync(path.join(os.tmpdir(), "wakeflow-opaque-redaction-"));
  const reportBefore = readFileSync(file);
  const rawBefore = readFileSync(path.join(root, "evidence/raw.bin"));
  const result = redactStateRootIntoCopy(root, dest, {
    hostProfile: stubProfile,
    workspaceRoot: root,
  });
  assert.equal(existsSync(path.join(dest, "evidence/report.pdf")), false);
  assert.equal(existsSync(path.join(dest, "evidence/raw.bin")), false);
  assert.equal(readFileSync(file).equals(reportBefore), true, "report source bytes stay untouched");
  assert.equal(readFileSync(path.join(root, "evidence/raw.bin")).equals(rawBefore), true, "raw source bytes stay untouched");
  assert.equal(result.opaquePlaceholders.length, 2);
  const reportPlaceholder = result.opaquePlaceholders.find((item) => item.originalFile === "evidence/report.pdf");
  assert.ok(reportPlaceholder);
  assert.deepEqual(reportPlaceholder.findingKinds, {
    "opaque-real-id": 1,
    "opaque-workspace-absolute-path": 1,
  });
  assert.match(reportPlaceholder.sha256, /^[a-f0-9]{64}$/);
  const portablePlaceholder = readFileSync(
    path.join(dest, "evidence/report.pdf.wakeflow-preserved.json"),
    "utf8",
  );
  assert.doesNotMatch(portablePlaceholder, new RegExp(REAL_UUID));
  assert.doesNotMatch(portablePlaceholder, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.equal(scanStateRootForArchivePrivacy(dest, {
    hostProfile: stubProfile,
    workspaceRoot: root,
  }).clean, true);
  assert.match(readFileSync(file, "utf8"), new RegExp(REAL_UUID));
});

test("clean opaque archive evidence requires explicit allowance and always returns its hash", () => {
  const bytes = Buffer.from([0xff, 0xfe, 0x00, 0x41, 0x42, 0x43]);
  const root = makeStateRoot({ "evidence/clean.bin": bytes });
  const refused = scanStateRootForArchivePrivacy(root, {
    hostProfile: stubProfile,
    workspaceRoot: root,
  });
  assert.equal(refused.clean, false);
  assert.ok(refused.findings.some((finding) => finding.kind === "opaque-file"));
  assert.equal(refused.opaqueFiles.length, 1);
  assert.match(refused.opaqueFiles[0].sha256, /^[a-f0-9]{64}$/);
  assert.equal(refused.opaqueFiles[0].bytes, bytes.length);

  const allowed = scanStateRootForArchivePrivacy(root, {
    hostProfile: stubProfile,
    workspaceRoot: root,
    allowOpaque: true,
  });
  assert.equal(allowed.clean, true, JSON.stringify(allowed.findings));
  assert.deepEqual(allowed.opaqueFiles, refused.opaqueFiles);

  const omittedDest = mkdtempSync(path.join(os.tmpdir(), "wakeflow-clean-opaque-omitted-"));
  const omitted = redactStateRootIntoCopy(root, omittedDest, {
    hostProfile: stubProfile,
    workspaceRoot: root,
  });
  assert.equal(existsSync(path.join(omittedDest, "evidence/clean.bin")), false);
  assert.equal(existsSync(path.join(omittedDest, "evidence/clean.bin.wakeflow-preserved.json")), true);
  assert.equal(omitted.opaquePlaceholders[0].findingKinds["opaque-file"], 1);
  assert.equal(scanStateRootForArchivePrivacy(omittedDest, {
    hostProfile: stubProfile,
    workspaceRoot: root,
  }).clean, true);

  const includedDest = mkdtempSync(path.join(os.tmpdir(), "wakeflow-clean-opaque-included-"));
  const included = redactStateRootIntoCopy(root, includedDest, {
    hostProfile: stubProfile,
    workspaceRoot: root,
    allowOpaque: true,
  });
  assert.equal(readFileSync(path.join(includedDest, "evidence/clean.bin")).equals(bytes), true);
  assert.deepEqual(included.opaquePlaceholders, []);
  assert.equal(scanStateRootForArchivePrivacy(includedDest, {
    hostProfile: stubProfile,
    workspaceRoot: root,
    allowOpaque: true,
  }).clean, true);
});

test("opaque placeholder creation fails closed on a source-path collision", () => {
  const root = makeStateRoot({
    "evidence/report.pdf": Buffer.from(`%PDF-1.4\0thread=${REAL_UUID}\n`),
    "evidence/report.pdf.wakeflow-preserved.json": "{}\n",
  });
  const dest = mkdtempSync(path.join(os.tmpdir(), "wakeflow-placeholder-collision-"));
  assert.throws(
    () => redactStateRootIntoCopy(root, dest, {
      hostProfile: stubProfile,
      workspaceRoot: root,
    }),
    /already contains that path/i,
  );
  assert.equal(existsSync(path.join(dest, "evidence/report.pdf.wakeflow-preserved.json")), false);
});

test("sensitive opaque file discovery is complete even when detailed findings are truncated", () => {
  const repeated = Array.from({ length: 101 }, () => `thread=${REAL_UUID}`).join("\n");
  const root = makeStateRoot({
    "evidence/first.bin": Buffer.concat([Buffer.from([0x00]), Buffer.from(repeated)]),
    "evidence/second.bin": Buffer.concat([Buffer.from([0x00]), Buffer.from(`thread=${REAL_UUID}`)]),
  });
  const scan = scanStateRootForArchivePrivacy(root, {
    hostProfile: stubProfile,
    workspaceRoot: root,
  });
  assert.equal(scan.truncated, true);
  assert.deepEqual(scan.sensitiveOpaqueFiles, ["evidence/first.bin", "evidence/second.bin"]);

  const dest = mkdtempSync(path.join(os.tmpdir(), "wakeflow-opaque-truncated-"));
  const result = redactStateRootIntoCopy(root, dest, {
    hostProfile: stubProfile,
    workspaceRoot: root,
  });
  assert.deepEqual(
    result.opaquePlaceholders.map((item) => item.originalFile),
    ["evidence/first.bin", "evidence/second.bin"],
  );
  assert.equal(result.opaquePlaceholders[0].findingsTruncated, true);
  assert.equal(result.opaquePlaceholders[1].findingsTruncated, false);
  assert.equal(scanStateRootForArchivePrivacy(dest, {
    hostProfile: stubProfile,
    workspaceRoot: root,
  }).clean, true);
});

test("sensitive file paths become portable placeholders with aligned text references", () => {
  const root = makeStateRoot({
    [`target-results/${REAL_UUID}.json`]: "{}\n",
    "review.md": `Evidence: target-results/${REAL_UUID}.json\n`,
  });
  const scan = scanStateRootForArchivePrivacy(root, {
    hostProfile: stubProfile,
    workspaceRoot: root,
  });
  assert.equal(scan.clean, false);
  assert.ok(scan.findings.some((finding) => (
    finding.kind === "real-id-filename"
    && finding.file === `target-results/${REAL_UUID}.json`
  )));

  const dest = mkdtempSync(path.join(os.tmpdir(), "wakeflow-filename-redaction-"));
  const result = redactStateRootIntoCopy(root, dest, {
    hostProfile: stubProfile,
    workspaceRoot: root,
  });
  const portableFile = "target-results/redacted-id-1.json";
  const placeholderFile = `${portableFile}.wakeflow-preserved.json`;
  assert.equal(existsSync(path.join(dest, `target-results/${REAL_UUID}.json`)), false);
  assert.equal(existsSync(path.join(dest, placeholderFile)), true);
  assert.match(readFileSync(path.join(dest, "review.md"), "utf8"), new RegExp(portableFile));
  assert.match(readFileSync(path.join(root, "review.md"), "utf8"), new RegExp(REAL_UUID));
  assert.equal(result.pathPlaceholders.length, 1);
  assert.equal(result.pathPlaceholders[0].portablePath, portableFile);
  assert.equal(result.pathPlaceholders[0].placeholderFile, placeholderFile);
  assert.equal(result.pathPlaceholders[0].sourceEntryType, "file");
  assert.equal(result.pathPlaceholders[0].files, 1);
  assert.doesNotMatch(JSON.stringify(result.pathPlaceholders), new RegExp(REAL_UUID));
  assert.equal(scanStateRootForArchivePrivacy(dest, {
    hostProfile: stubProfile,
    workspaceRoot: root,
  }).clean, true);
});

test("a sensitive opaque filename uses a JSON-suffixed placeholder that remains portable", () => {
  const root = makeStateRoot({
    [`evidence/${REAL_UUID}.pdf`]: Buffer.from("%PDF-1.4\0opaque evidence"),
  });
  const dest = mkdtempSync(path.join(os.tmpdir(), "wakeflow-opaque-path-redaction-"));
  const result = redactStateRootIntoCopy(root, dest, {
    hostProfile: stubProfile,
    workspaceRoot: root,
  });
  const placeholderFile = "evidence/redacted-id-1.pdf.wakeflow-preserved.json";
  assert.equal(result.pathPlaceholders[0].placeholderFile, placeholderFile);
  assert.equal(existsSync(path.join(dest, placeholderFile)), true);
  assert.equal(scanStateRootForArchivePrivacy(dest, {
    hostProfile: stubProfile,
    workspaceRoot: root,
  }).clean, true);
});

test("a sensitive directory and all descendants collapse to one preserved-subtree placeholder", () => {
  const sensitiveDir = `evidence/generation-${REAL_UUID}`;
  const root = makeStateRoot({
    [`${sensitiveDir}/manifest.json`]: `{"generation":"${REAL_UUID}"}\n`,
    [`${sensitiveDir}/store/index.json`]: "{\"ok\":true}\n",
    "public-route.json": JSON.stringify({
      manifest: `${sensitiveDir}/manifest.json`,
      index: `${sensitiveDir}/store/index.json`,
    }),
  });
  const dest = mkdtempSync(path.join(os.tmpdir(), "wakeflow-subtree-redaction-"));
  const result = redactStateRootIntoCopy(root, dest, {
    hostProfile: stubProfile,
    workspaceRoot: root,
  });

  const portableDir = "evidence/generation-redacted-id-1";
  const placeholderFile = `${portableDir}/.wakeflow-preserved.json`;
  assert.equal(existsSync(path.join(dest, sensitiveDir)), false);
  assert.equal(existsSync(path.join(dest, placeholderFile)), true);
  assert.equal(existsSync(path.join(root, `${sensitiveDir}/manifest.json`)), true, "source subtree stays untouched");
  assert.equal(result.pathPlaceholders.length, 1, "descendant matches do not create duplicate placeholders");
  const placeholder = result.pathPlaceholders[0];
  assert.equal(placeholder.portablePath, portableDir);
  assert.equal(placeholder.placeholderFile, placeholderFile);
  assert.equal(placeholder.sourceEntryType, "directory");
  assert.equal(placeholder.files, 2);
  assert.equal(placeholder.directories, 2);
  assert.equal(placeholder.findingKinds["real-id-filename"], 4);
  assert.match(placeholder.sha256, /^[a-f0-9]{64}$/);
  const portableReference = readFileSync(path.join(dest, "public-route.json"), "utf8");
  assert.match(portableReference, /evidence\/generation-redacted-id-1\/manifest\.json/);
  assert.doesNotMatch(portableReference, new RegExp(REAL_UUID));
  assert.doesNotMatch(readFileSync(path.join(dest, placeholderFile), "utf8"), new RegExp(REAL_UUID));
  assert.equal(scanStateRootForArchivePrivacy(dest, {
    hostProfile: stubProfile,
    workspaceRoot: root,
  }).clean, true);
});

test("sensitive path placeholder creation fails closed on a portable-path collision", () => {
  const root = makeStateRoot({
    [`evidence/generation-${REAL_UUID}/manifest.json`]: "{}\n",
    "evidence/generation-redacted-id-1/existing.json": "{}\n",
  });
  const dest = mkdtempSync(path.join(os.tmpdir(), "wakeflow-path-collision-"));
  assert.throws(
    () => redactStateRootIntoCopy(root, dest, {
      hostProfile: stubProfile,
      workspaceRoot: root,
    }),
    /portable path collides with source entry/i,
  );
  assert.equal(existsSync(path.join(dest, "evidence/generation-redacted-id-1/.wakeflow-preserved.json")), false);
});

test("state-root symlinks are reported without following or copying their target", () => {
  const root = makeStateRoot({ "wakeflow-state.json": "{}\n" });
  const external = mkdtempSync(path.join(os.tmpdir(), "wakeflow-symlink-target-"));
  writeFileSync(path.join(external, "secret.json"), `{"thread":"${REAL_UUID}"}\n`);
  symlinkSync(external, path.join(root, "linked-evidence"), "dir");

  const scan = scanStateRootForArchivePrivacy(root, {
    hostProfile: stubProfile,
    workspaceRoot: root,
  });
  assert.equal(scan.clean, false);
  assert.ok(scan.findings.some((finding) => (
    finding.kind === "symbolic-link"
    && finding.file === "linked-evidence"
  )));
  assert.equal(
    scan.findings.some((finding) => finding.file === "linked-evidence/secret.json"),
    false,
    "scanner must not traverse the symlink target",
  );

  const dest = mkdtempSync(path.join(os.tmpdir(), "wakeflow-symlink-redaction-"));
  assert.throws(
    () => redactStateRootIntoCopy(root, dest, {
      hostProfile: stubProfile,
      workspaceRoot: root,
    }),
    /symbolic-link|cannot be safely redacted/i,
  );
  assert.equal(existsSync(path.join(dest, "linked-evidence")), false);
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
