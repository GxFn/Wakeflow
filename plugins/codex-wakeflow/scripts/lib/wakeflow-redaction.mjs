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

import { isUtf8 } from "node:buffer";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

// Opaque/binary files are never rewritten: replacing bytes in an image, PDF,
// archive, font, or NUL-bearing file would corrupt evidence. They are still
// scanned for ASCII-compatible ID/path strings and fail closed when one is
// found.
const OPAQUE_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".pdf", ".zip", ".gz", ".tgz", ".woff", ".woff2", ".ico"]);
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
  return new RegExp(`${escapeRegExp(normalized)}(?=$|[\\/\\s\\x00\"'\`,;:)\\]}])`, "g");
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

function listTreeEntries(root) {
  const entries = [];
  const rootStat = lstatSync(root);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    return [{
      absolute: root,
      relative: ".",
      type: rootStat.isSymbolicLink() ? "symlink" : "unsupported",
      ...(rootStat.isSymbolicLink() ? { linkTarget: readlinkSync(root) } : {}),
    }];
  }
  function walk(dir, prefix = "") {
    for (const name of readdirSync(dir).sort()) {
      if (name === ".DS_Store") continue;
      const absolute = path.join(dir, name);
      const relative = prefix ? `${prefix}/${name}` : name;
      const stat = lstatSync(absolute);
      if (stat.isDirectory()) {
        entries.push({ absolute, relative, type: "directory" });
        walk(absolute, relative);
      } else if (stat.isFile()) {
        entries.push({ absolute, relative, type: "file" });
      } else if (stat.isSymbolicLink()) {
        entries.push({
          absolute,
          relative,
          type: "symlink",
          linkTarget: readlinkSync(absolute),
        });
      } else {
        entries.push({ absolute, relative, type: "unsupported" });
      }
    }
  }
  walk(root);
  return entries;
}

function isOpaqueFile(file, content) {
  return OPAQUE_EXT.has(path.extname(file).toLowerCase())
    || content.includes(0)
    || !isUtf8(content);
}

function findingKind(kind, opaque) {
  return opaque ? `opaque-${kind}` : kind;
}

function scanText({
  text,
  file,
  pattern,
  placeholders,
  pathRules,
  opaque,
  findings,
}) {
  const lines = text.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    for (const match of lines[index].matchAll(new RegExp(pattern.source, "gi"))) {
      if (placeholders.has(match[0].toLowerCase())) continue;
      findings.push({
        kind: findingKind("real-id", opaque),
        file,
        line: index + 1,
        match: match[0],
      });
      if (findings.length >= MAX_FINDINGS) return true;
    }
    let remaining = lines[index];
    for (const rule of pathRules) {
      for (const match of remaining.matchAll(new RegExp(rule.pattern.source, "g"))) {
        findings.push({
          kind: findingKind(rule.kind, opaque),
          file,
          line: index + 1,
          match: match[0],
          replacement: rule.replacement,
        });
        if (findings.length >= MAX_FINDINGS) return true;
      }
      // Workspace paths are also under HOME on common installations. Replace
      // each earlier category before scanning the next so one path produces
      // exactly one finding with the most specific normalization.
      remaining = remaining.replace(new RegExp(rule.pattern.source, "g"), rule.replacement);
    }
  }
  return false;
}

function nonRedactableFindings(entries, {
  pattern,
  placeholders,
  pathRules,
}) {
  const findings = [];
  for (const entry of entries) {
    for (const match of entry.relative.matchAll(new RegExp(pattern.source, "gi"))) {
      if (placeholders.has(match[0].toLowerCase())) continue;
      findings.push({
        kind: "real-id-filename",
        file: entry.relative,
        match: match[0],
        reason: "sensitive filenames cannot be rewritten without breaking evidence references",
      });
      if (findings.length >= MAX_FINDINGS) return findings;
    }
    if (entry.type === "symlink") {
      findings.push({
        kind: "symbolic-link",
        file: entry.relative,
        reason: "state-root symbolic links are not archived or followed",
      });
      if (findings.length >= MAX_FINDINGS) return findings;
      continue;
    }
    if (entry.type === "unsupported") {
      findings.push({
        kind: "unsupported-filesystem-entry",
        file: entry.relative,
        reason: "state-root filesystem entry is neither a regular file nor a directory",
      });
      if (findings.length >= MAX_FINDINGS) return findings;
      continue;
    }
    if (entry.type !== "file") continue;
    let content;
    try {
      content = readFileSync(entry.absolute);
    } catch (error) {
      findings.push({
        kind: "unreadable-file",
        file: entry.relative,
        reason: `cannot audit file before archival: ${error.message}`,
      });
      if (findings.length >= MAX_FINDINGS) return findings;
      continue;
    }
    if (!isOpaqueFile(entry.absolute, content)) continue;
    scanText({
      text: content.toString("utf8"),
      file: entry.relative,
      pattern,
      placeholders,
      pathRules,
      opaque: true,
      findings,
    });
    if (findings.length >= MAX_FINDINGS) return findings;
  }
  return findings;
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
  let entries;
  try {
    entries = listTreeEntries(stateRoot);
  } catch (error) {
    return {
      clean: false,
      scanned: 0,
      findings: [{ reason: `cannot enumerate state root without following links: ${error.message}` }],
    };
  }
  findings.push(...nonRedactableFindings(entries, {
    pattern,
    placeholders,
    pathRules,
  }));
  if (findings.length >= MAX_FINDINGS) {
    return { clean: false, scanned, findings: findings.slice(0, MAX_FINDINGS), truncated: true };
  }
  for (const entry of entries) {
    if (entry.type !== "file") continue;
    let content;
    try {
      content = readFileSync(entry.absolute);
    } catch (error) {
      findings.push({
        kind: "unreadable-file",
        file: entry.relative,
        reason: `cannot audit file before archival: ${error.message}`,
      });
      if (findings.length >= MAX_FINDINGS) {
        return { clean: false, scanned, findings, truncated: true };
      }
      continue;
    }
    scanned += 1;
    const opaque = isOpaqueFile(entry.absolute, content);
    if (opaque) continue; // already scanned above as non-redactable bytes
    const truncated = scanText({
      text: content.toString("utf8"),
      file: entry.relative,
      pattern,
      placeholders,
      pathRules,
      opaque: false,
      findings,
    });
    if (truncated) return { clean: false, scanned, findings, truncated: true };
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
  const entries = listTreeEntries(stateRoot);
  const blockers = nonRedactableFindings(entries, {
    pattern,
    placeholders,
    pathRules,
  });
  if (blockers.length > 0) {
    const summary = blockers.slice(0, 5)
      .map((finding) => `${finding.kind}:${finding.file}`)
      .join(", ");
    throw new Error(
      `archive contains ${blockers.length} finding(s) that cannot be safely redacted (${summary}); remove or replace these entries before retrying`,
    );
  }
  const redactedFields = [];
  for (const entry of entries) {
    const destFile = path.join(destination, entry.relative);
    if (entry.type === "directory") {
      mkdirSync(destFile, { recursive: true });
      continue;
    }
    if (entry.type !== "file") {
      throw new Error(`archive contains unsupported filesystem entry: ${entry.relative}`);
    }
    mkdirSync(path.dirname(destFile), { recursive: true });
    const raw = readFileSync(entry.absolute);
    if (isOpaqueFile(entry.absolute, raw)) {
      writeFileSync(destFile, raw);
      continue;
    }
    const content = raw.toString("utf8");
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
    if (count > 0) redactedFields.push({ file: entry.relative, count, kinds });
    writeFileSync(destFile, portable);
  }
  return { redactedFields };
}
