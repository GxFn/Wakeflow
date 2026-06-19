// P1-0 redaction guard: scan a controller state-root tree for strings that look like real
// host session/thread ids and REFUSE by default, so archive-demand can never relocate a raw
// id into the committed ledger.
//
// Per the dual-edition audit, persisted delivery envelopes already store a
// `threadIdRedacted` marker instead of the raw id, and the only raw id lives in the
// gitignored `hosts/<host>/thread-registry/` tree OUTSIDE the state root (and is never moved
// by archive-demand). So this is defense-in-depth free-text anomaly scanning, not a
// structural envelope decode. Redaction NEVER rewrites in place — it only ever writes a
// cleaned COPY, so the original evidence is preserved for a human audit.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const SKIP_DIRS = new Set([".git", "node_modules"]);
// Opaque/binary extensions are copied verbatim and never scanned as text.
const SKIP_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".pdf", ".zip", ".gz", ".tgz", ".woff", ".woff2", ".ico"]);
const MAX_FINDINGS = 100;
const REDACTION_TOKEN = "<redacted>";

// The real-id shape is declared per host edition on host-profile (handleId.idShape), because
// the host-profile is host-local and not byte-synced; check:core cannot cross-check it.
export function realIdPattern(hostProfile) {
  const shape = hostProfile?.handleId?.idShape;
  return shape ? new RegExp(shape, "gi") : null;
}

function placeholderSet(hostProfile) {
  return new Set((hostProfile?.handleId?.placeholders ?? []).map((value) => String(value).toLowerCase()));
}

function listFilesRecursive(root) {
  const files = [];
  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === ".DS_Store") continue;
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(absolute);
      } else if (entry.isFile()) {
        files.push(absolute);
      }
    }
  }
  walk(root);
  return files.sort();
}

// Scan every text file under stateRoot. Returns { clean, scanned, findings }. clean is false
// (refuse) if any non-placeholder real-id-shaped string is present, OR if the host profile
// declares no id shape (cannot audit -> refuse rather than silently pass), OR the root is
// missing.
export function scanStateRootForRealIds(stateRoot, { hostProfile } = {}) {
  const pattern = realIdPattern(hostProfile);
  if (!pattern) {
    return { clean: false, scanned: 0, findings: [{ reason: "host profile declares no handleId.idShape; cannot audit." }] };
  }
  if (!existsSync(stateRoot)) {
    return { clean: false, scanned: 0, findings: [{ reason: `state root does not exist: ${stateRoot}` }] };
  }
  const placeholders = placeholderSet(hostProfile);
  const findings = [];
  let scanned = 0;
  for (const file of listFilesRecursive(stateRoot)) {
    if (SKIP_EXT.has(path.extname(file).toLowerCase())) continue;
    let content;
    try {
      content = readFileSync(file, "utf8");
    } catch {
      continue; // unreadable/binary -> skip (copied verbatim by the redactor, never scanned)
    }
    scanned += 1;
    const relative = path.relative(stateRoot, file);
    const lines = content.split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      for (const match of lines[index].matchAll(new RegExp(pattern.source, "gi"))) {
        if (placeholders.has(match[0].toLowerCase())) continue;
        findings.push({ file: relative, line: index + 1, match: match[0] });
        if (findings.length >= MAX_FINDINGS) {
          return { clean: false, scanned, findings, truncated: true };
        }
      }
    }
  }
  return { clean: findings.length === 0, scanned, findings };
}

// Copy stateRoot into destination, replacing every non-placeholder real-id match with
// <redacted>. The source tree is never mutated. Returns { redactedFields } where each entry
// records the relative file and how many ids were redacted.
export function redactStateRootIntoCopy(stateRoot, destination, { hostProfile } = {}) {
  const pattern = realIdPattern(hostProfile);
  if (!pattern) throw new Error("host profile declares no handleId.idShape; cannot redact.");
  if (!existsSync(stateRoot)) throw new Error(`state root does not exist: ${stateRoot}`);
  const placeholders = placeholderSet(hostProfile);
  const redactedFields = [];
  for (const file of listFilesRecursive(stateRoot)) {
    const relative = path.relative(stateRoot, file);
    const destFile = path.join(destination, relative);
    mkdirSync(path.dirname(destFile), { recursive: true });
    if (SKIP_EXT.has(path.extname(file).toLowerCase())) {
      writeFileSync(destFile, readFileSync(file));
      continue;
    }
    let content;
    try {
      content = readFileSync(file, "utf8");
    } catch {
      writeFileSync(destFile, readFileSync(file));
      continue;
    }
    let count = 0;
    const cleaned = content.replace(new RegExp(pattern.source, "gi"), (match) => {
      if (placeholders.has(match.toLowerCase())) return match;
      count += 1;
      return REDACTION_TOKEN;
    });
    if (count > 0) redactedFields.push({ file: relative, count });
    writeFileSync(destFile, cleaned);
  }
  return { redactedFields };
}
