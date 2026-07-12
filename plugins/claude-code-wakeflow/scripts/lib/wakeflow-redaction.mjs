// Archive privacy guard: scan a controller state-root tree for real host
// session/thread ids and non-portable workspace/home absolute paths. Refuse by
// default so archive-demand cannot relocate those values into the committed
// ledger.
//
// Per the dual-edition audit, persisted delivery envelopes already store a
// `threadIdRedacted` marker instead of the raw id, and the only raw id lives in the
// gitignored `hosts/<host>/thread-registry/` tree OUTSIDE the state root (and is never moved
// by archive-demand). So this is defense-in-depth free-text anomaly scanning, not a
// structural envelope decode. Redaction NEVER rewrites in place — it only ever writes a
// cleaned COPY, so the original evidence is preserved for a human audit.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const SKIP_DIRS = new Set([".git", "node_modules"]);
// Opaque/binary extensions are copied verbatim and never scanned as text.
const SKIP_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".pdf", ".zip", ".gz", ".tgz", ".woff", ".woff2", ".ico"]);
const MAX_FINDINGS = 100;
const REDACTION_TOKEN = "<redacted>";
const WORKSPACE_ROOT_TOKEN = "<workspace-root>";
const HOME_ROOT_TOKEN = "~";

// The real-id shape is declared per host edition on host-profile (handleId.idShape), because
// the host-profile is host-local and not byte-synced; check:core cannot cross-check it.
export function realIdPattern(hostProfile) {
  const shape = hostProfile?.handleId?.idShape;
  return shape ? new RegExp(shape, "gi") : null;
}

function placeholderSet(hostProfile) {
  return new Set((hostProfile?.handleId?.placeholders ?? []).map((value) => String(value).toLowerCase()));
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function pathPrefixPattern(value) {
  if (!value || !path.isAbsolute(value)) return null;
  const normalized = path.resolve(value).replace(/[\\/]+$/, "");
  if (!normalized) return null;
  // Match only a complete path prefix. `/Users/a` must not match
  // `/Users/another`; the next byte is a separator, JSON/text boundary, or EOF.
  return new RegExp(`${escapeRegExp(normalized)}(?=$|[\\/\\s\"'\`,;:)\\]}])`, "g");
}

function archivePathRules({ workspaceRoot, userHome = homedir() } = {}) {
  const rules = [];
  const workspacePattern = pathPrefixPattern(workspaceRoot);
  if (workspacePattern) {
    rules.push({ kind: "workspace-absolute-path", pattern: workspacePattern, replacement: WORKSPACE_ROOT_TOKEN });
  }
  const homePattern = pathPrefixPattern(userHome);
  if (homePattern) {
    rules.push({ kind: "home-absolute-path", pattern: homePattern, replacement: HOME_ROOT_TOKEN });
  }
  return rules;
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

// Scan every text file under stateRoot. Returns { clean, scanned, findings }.
// clean is false when the selected real-id/path categories are present, when
// the host profile cannot audit IDs, or when the root is missing.
function scanStateRoot(stateRoot, { hostProfile, workspaceRoot, userHome, includePaths = false } = {}) {
  const pattern = realIdPattern(hostProfile);
  if (!pattern) {
    return { clean: false, scanned: 0, findings: [{ reason: "host profile declares no handleId.idShape; cannot audit." }] };
  }
  if (!existsSync(stateRoot)) {
    return { clean: false, scanned: 0, findings: [{ reason: `state root does not exist: ${stateRoot}` }] };
  }
  const placeholders = placeholderSet(hostProfile);
  const pathRules = includePaths ? archivePathRules({ workspaceRoot, userHome }) : [];
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
        findings.push({ kind: "real-id", file: relative, line: index + 1, match: match[0] });
        if (findings.length >= MAX_FINDINGS) {
          return { clean: false, scanned, findings, truncated: true };
        }
      }
      let remaining = lines[index];
      for (const rule of pathRules) {
        for (const match of remaining.matchAll(new RegExp(rule.pattern.source, "g"))) {
          findings.push({ kind: rule.kind, file: relative, line: index + 1, match: match[0], replacement: rule.replacement });
          if (findings.length >= MAX_FINDINGS) {
            return { clean: false, scanned, findings, truncated: true };
          }
        }
        // Workspace paths are also under HOME on common installations. Replace
        // each earlier category before scanning the next so one path produces
        // exactly one finding with the most specific normalization.
        remaining = remaining.replace(new RegExp(rule.pattern.source, "g"), rule.replacement);
      }
    }
  }
  return { clean: findings.length === 0, scanned, findings };
}

export function scanStateRootForRealIds(stateRoot, { hostProfile } = {}) {
  return scanStateRoot(stateRoot, { hostProfile, includePaths: false });
}

export function scanStateRootForArchivePrivacy(stateRoot, { hostProfile, workspaceRoot, userHome = homedir() } = {}) {
  return scanStateRoot(stateRoot, { hostProfile, workspaceRoot, userHome, includePaths: true });
}

export function archivePrivacyFindingCounts(findings = []) {
  return findings.reduce((counts, finding) => {
    const kind = finding.kind || "unknown";
    counts[kind] = (counts[kind] ?? 0) + 1;
    return counts;
  }, {});
}

// Copy stateRoot into destination, replacing real IDs with <redacted>, the
// workspace prefix with <workspace-root>, and other home prefixes with ~. The
// source tree is never mutated. redactedFields records counts by category.
export function redactStateRootIntoCopy(stateRoot, destination, { hostProfile, workspaceRoot, userHome = homedir() } = {}) {
  const pattern = realIdPattern(hostProfile);
  if (!pattern) throw new Error("host profile declares no handleId.idShape; cannot redact.");
  if (!existsSync(stateRoot)) throw new Error(`state root does not exist: ${stateRoot}`);
  const placeholders = placeholderSet(hostProfile);
  const pathRules = archivePathRules({ workspaceRoot, userHome });
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
    const kinds = {};
    const cleaned = content.replace(new RegExp(pattern.source, "gi"), (match) => {
      if (placeholders.has(match.toLowerCase())) return match;
      kinds["real-id"] = (kinds["real-id"] ?? 0) + 1;
      return REDACTION_TOKEN;
    });
    let portable = cleaned;
    for (const rule of pathRules) {
      portable = portable.replace(new RegExp(rule.pattern.source, "g"), () => {
        kinds[rule.kind] = (kinds[rule.kind] ?? 0) + 1;
        return rule.replacement;
      });
    }
    const count = Object.values(kinds).reduce((sum, value) => sum + value, 0);
    if (count > 0) redactedFields.push({ file: relative, count, kinds });
    writeFileSync(destFile, portable);
  }
  return { redactedFields };
}
