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

import { createHash } from "node:crypto";
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
// scanned for ASCII-compatible ID/path strings. A portable redacted copy omits
// an opaque file that contains such a value and writes a safe placeholder
// manifest instead. Clean opaque bytes are copied only with explicit
// allowOpaque consent; otherwise they receive the same preserve-and-placeholder
// treatment. The caller remains responsible for preserving the untouched
// source tree in the local audit tier.
const OPAQUE_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".pdf", ".zip", ".gz", ".tgz", ".woff", ".woff2", ".ico"]);
const MAX_FINDINGS = 100;
const REDACTION_TOKEN = "<redacted>";
const WORKSPACE_ROOT_TOKEN = "<workspace-root>";
const HOME_ROOT_TOKEN = "~";
const OPAQUE_PLACEHOLDER_SUFFIX = ".wakeflow-preserved.json";
const PATH_PLACEHOLDER_FILE = ".wakeflow-preserved.json";
const PATH_REDACTION_PREFIX = "redacted-id";

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

function opaqueFileInventory(entries) {
  const files = [];
  for (const entry of entries) {
    if (entry.type !== "file") continue;
    let content;
    try {
      content = readFileSync(entry.absolute);
    } catch {
      continue;
    }
    if (!isOpaqueFile(entry.absolute, content)) continue;
    files.push({
      file: entry.relative,
      algorithm: "sha256",
      sha256: createHash("sha256").update(content).digest("hex"),
      bytes: content.length,
    });
  }
  return files;
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
}) {
  const findings = [];
  for (const entry of entries) {
    for (const match of entry.relative.matchAll(new RegExp(pattern.source, "gi"))) {
      if (placeholders.has(match[0].toLowerCase())) continue;
      findings.push({
        kind: "real-id-filename",
        file: entry.relative,
        match: match[0],
        reason: "sensitive path must be represented by a preserved-subtree placeholder in a portable archive",
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
    try {
      readFileSync(entry.absolute);
    } catch (error) {
      findings.push({
        kind: "unreadable-file",
        file: entry.relative,
        reason: `cannot audit file before archival: ${error.message}`,
      });
      if (findings.length >= MAX_FINDINGS) return findings;
      continue;
    }
  }
  return findings;
}

function sensitiveMatches(value, pattern, placeholders) {
  return [...String(value).matchAll(new RegExp(pattern.source, "gi"))]
    .map((match) => match[0])
    .filter((match) => !placeholders.has(match.toLowerCase()));
}

function isSameOrDescendant(candidate, root) {
  return candidate === root || candidate.startsWith(`${root}/`);
}

function replaceSensitiveIds(value, pattern, placeholders, aliases, fallback = REDACTION_TOKEN) {
  return String(value).replace(new RegExp(pattern.source, "gi"), (match) => {
    if (placeholders.has(match.toLowerCase())) return match;
    return aliases.get(match.toLowerCase()) ?? fallback;
  });
}

function preservedSubtreeSummary(rootEntry, members) {
  const digest = createHash("sha256");
  let files = 0;
  let directories = 0;
  let bytes = 0;
  for (const entry of members) {
    const memberPath = entry.relative === rootEntry.relative
      ? "."
      : entry.relative.slice(rootEntry.relative.length + 1);
    if (entry.type === "directory") {
      directories += 1;
      digest.update(`${JSON.stringify(["directory", memberPath])}\n`);
      continue;
    }
    if (entry.type !== "file") continue;
    const raw = readFileSync(entry.absolute);
    const contentHash = createHash("sha256").update(raw).digest("hex");
    files += 1;
    bytes += raw.length;
    digest.update(`${JSON.stringify(["file", memberPath, raw.length, contentHash])}\n`);
  }
  return {
    algorithm: "sha256",
    sha256: digest.digest("hex"),
    bytes,
    files,
    directories,
    entries: members.length,
  };
}

function sensitivePathPreservationPlan(entries, { pattern, placeholders }) {
  const sensitiveIds = new Set();
  for (const entry of entries) {
    for (const match of sensitiveMatches(entry.relative, pattern, placeholders)) {
      sensitiveIds.add(match.toLowerCase());
    }
  }
  const aliases = new Map(
    [...sensitiveIds]
      .sort()
      .map((id, index) => [id, `${PATH_REDACTION_PREFIX}-${index + 1}`]),
  );
  const roots = new Map();
  for (const entry of entries) {
    const parts = entry.relative.split("/");
    for (let index = 0; index < parts.length; index += 1) {
      if (sensitiveMatches(parts[index], pattern, placeholders).length === 0) continue;
      const root = parts.slice(0, index + 1).join("/");
      if (!roots.has(root)) {
        const rootEntry = entries.find((candidate) => candidate.relative === root);
        if (!rootEntry) throw new Error(`archive could not resolve sensitive path root: ${root}`);
        roots.set(root, rootEntry);
      }
      break;
    }
  }

  const plans = [...roots.values()].map((rootEntry) => {
    const members = entries.filter((entry) => isSameOrDescendant(entry.relative, rootEntry.relative));
    const portablePath = replaceSensitiveIds(rootEntry.relative, pattern, placeholders, aliases);
    const placeholderFile = rootEntry.type === "directory"
      ? `${portablePath}/${PATH_PLACEHOLDER_FILE}`
      : `${portablePath}${OPAQUE_PLACEHOLDER_SUFFIX}`;
    const findingCount = members.reduce(
      (count, entry) => count + sensitiveMatches(entry.relative, pattern, placeholders).length,
      0,
    );
    return {
      root: rootEntry.relative,
      rootType: rootEntry.type,
      portablePath,
      placeholderFile,
      findingCount,
      members,
    };
  }).sort((a, b) => a.root.localeCompare(b.root));

  const ordinaryEntries = entries.filter((entry) => (
    !plans.some((plan) => isSameOrDescendant(entry.relative, plan.root))
  ));
  for (const plan of plans) {
    const ordinaryCollision = ordinaryEntries.find((entry) => (
      isSameOrDescendant(entry.relative, plan.portablePath)
      || isSameOrDescendant(entry.relative, plan.placeholderFile)
      || (entry.type === "file" && plan.portablePath.startsWith(`${entry.relative}/`))
      || (entry.type === "file" && plan.placeholderFile.startsWith(`${entry.relative}/`))
    ));
    if (ordinaryCollision) {
      throw new Error(
        `archive cannot create preserved path placeholder ${plan.placeholderFile}: portable path collides with source entry ${ordinaryCollision.relative}`,
      );
    }
    const mappedCollision = plans.find((candidate) => (
      candidate !== plan
      && (isSameOrDescendant(candidate.portablePath, plan.portablePath)
        || isSameOrDescendant(plan.portablePath, candidate.portablePath))
    ));
    if (mappedCollision) {
      throw new Error(
        `archive cannot create preserved path placeholder ${plan.placeholderFile}: multiple sensitive paths map to the same portable subtree`,
      );
    }
  }
  return { aliases, plans };
}

function pathPlaceholderRecord(plan) {
  return {
    kind: "WakeflowPreservedPathEvidence",
    version: 1,
    portablePath: plan.portablePath,
    placeholderFile: plan.placeholderFile,
    sourceEntryType: plan.rootType,
    ...preservedSubtreeSummary(plan.members[0], plan.members),
    findingKinds: { "real-id-filename": plan.findingCount },
    disposition: "subtree-omitted-from-portable-archive",
    preservedOriginalPointer: "archive-manifest.json#originalPreservedAt",
  };
}

function opaqueSensitiveFindingsByFile(entries, {
  pattern,
  placeholders,
  pathRules,
}) {
  const grouped = new Map();
  for (const entry of entries) {
    if (entry.type !== "file") continue;
    let content;
    try {
      content = readFileSync(entry.absolute);
    } catch {
      // The structural scan records unreadable files as blockers.
      continue;
    }
    if (!isOpaqueFile(entry.absolute, content)) continue;
    const findings = [];
    const truncated = scanText({
      text: content.toString("utf8"),
      file: entry.relative,
      pattern,
      placeholders,
      pathRules,
      opaque: true,
      findings,
    });
    if (findings.length > 0) grouped.set(entry.relative, { findings, truncated });
  }
  return grouped;
}

// Scan every text file under stateRoot. Returns { clean, scanned, findings }.
// clean is false when the selected real-id/path categories are present, when
// the host profile cannot audit IDs, or when the root is missing.
function scanStateRoot(stateRoot, {
  hostProfile,
  workspaceRoot,
  userHome,
  includePaths = false,
  enforceOpaque = false,
  allowOpaque = false,
} = {}) {
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
  }));
  const opaqueSensitive = opaqueSensitiveFindingsByFile(entries, {
    pattern,
    placeholders,
    pathRules,
  });
  const sensitiveOpaqueFiles = [...opaqueSensitive.keys()].sort();
  for (const sensitive of opaqueSensitive.values()) {
    if (findings.length >= MAX_FINDINGS) break;
    findings.push(...sensitive.findings.slice(0, MAX_FINDINGS - findings.length));
  }
  const opaqueFiles = opaqueFileInventory(entries);
  if (enforceOpaque && !allowOpaque) {
    findings.push(...opaqueFiles.map((item) => ({
      kind: "opaque-file",
      file: item.file,
      reason: "opaque archive evidence requires explicit --allow-opaque and a recorded per-file hash",
      algorithm: item.algorithm,
      sha256: item.sha256,
      bytes: item.bytes,
    })));
  }
  if (findings.length >= MAX_FINDINGS) {
    return {
      clean: false,
      scanned,
      findings: findings.slice(0, MAX_FINDINGS),
      opaqueFiles,
      sensitiveOpaqueFiles,
      truncated: true,
    };
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
        return { clean: false, scanned, findings, opaqueFiles, sensitiveOpaqueFiles, truncated: true };
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
    if (truncated) return { clean: false, scanned, findings, opaqueFiles, sensitiveOpaqueFiles, truncated: true };
  }
  return { clean: findings.length === 0, scanned, findings, opaqueFiles, sensitiveOpaqueFiles };
}

export function scanStateRootForRealIds(stateRoot, { hostProfile } = {}) {
  return scanStateRoot(stateRoot, { hostProfile, includePaths: false });
}

export function scanStateRootForArchivePrivacy(stateRoot, {
  hostProfile,
  workspaceRoot,
  userHome = homedir(),
  allowOpaque = false,
} = {}) {
  return scanStateRoot(stateRoot, {
    hostProfile,
    workspaceRoot,
    userHome,
    includePaths: true,
    enforceOpaque: true,
    allowOpaque,
  });
}

export function archivePrivacyFindingCounts(findings = []) {
  return findings.reduce((counts, finding) => {
    const kind = finding.kind || "unknown";
    counts[kind] = (counts[kind] ?? 0) + 1;
    return counts;
  }, {});
}

function opaquePlaceholderRecord(entry, raw, findings, findingsTruncated) {
  const findingKinds = archivePrivacyFindingCounts(findings);
  return {
    kind: "WakeflowPreservedOpaqueEvidence",
    version: 1,
    originalFile: entry.relative,
    placeholderFile: `${entry.relative}${OPAQUE_PLACEHOLDER_SUFFIX}`,
    algorithm: "sha256",
    sha256: createHash("sha256").update(raw).digest("hex"),
    bytes: raw.length,
    findingKinds,
    findingsTruncated,
    disposition: "omitted-from-portable-archive",
    preservedOriginalPointer: "archive-manifest.json#originalPreservedAt",
  };
}

// Copy stateRoot into destination, replacing real IDs with <redacted>, the
// workspace prefix with <workspace-root>, and other home prefixes with ~. The
// source tree is never mutated. redactedFields records counts by category.
export function redactStateRootIntoCopy(stateRoot, destination, {
  hostProfile,
  workspaceRoot,
  userHome = homedir(),
  allowOpaque = false,
} = {}) {
  const pattern = realIdPattern(hostProfile);
  if (!pattern) throw new Error("host profile declares no handleId.idShape; cannot redact.");
  if (!existsSync(stateRoot)) throw new Error(`state root does not exist: ${stateRoot}`);
  const placeholders = placeholderSet(hostProfile);
  const pathRules = archivePathRules({ workspaceRoot, userHome });
  const entries = listTreeEntries(stateRoot);
  const blockers = nonRedactableFindings(entries, {
    pattern,
    placeholders,
  }).filter((finding) => finding.kind !== "real-id-filename");
  const pathPlan = sensitivePathPreservationPlan(entries, {
    pattern,
    placeholders,
  });
  const opaqueSensitive = opaqueSensitiveFindingsByFile(entries, {
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
  const omittedByPathPlaceholder = (relative) => pathPlan.plans.some((plan) => (
    isSameOrDescendant(relative, plan.root)
  ));
  const sourcePaths = new Set(entries
    .filter((entry) => !omittedByPathPlaceholder(entry.relative))
    .map((entry) => entry.relative));
  const opaqueFilesToPlaceholder = new Set(opaqueSensitive.keys());
  if (!allowOpaque) {
    for (const item of opaqueFileInventory(entries)) opaqueFilesToPlaceholder.add(item.file);
  }
  for (const sourceFile of opaqueFilesToPlaceholder) {
    if (omittedByPathPlaceholder(sourceFile)) continue;
    const placeholderFile = `${sourceFile}${OPAQUE_PLACEHOLDER_SUFFIX}`;
    if (sourcePaths.has(placeholderFile)) {
      throw new Error(
        `archive cannot create opaque evidence placeholder ${placeholderFile}: the source tree already contains that path`,
      );
    }
  }
  const redactedFields = [];
  const opaquePlaceholders = [];
  const pathPlaceholders = [];
  for (const plan of pathPlan.plans) {
    const placeholder = pathPlaceholderRecord(plan);
    pathPlaceholders.push(placeholder);
    redactedFields.push({
      file: placeholder.placeholderFile,
      count: plan.findingCount,
      kinds: placeholder.findingKinds,
    });
    const placeholderDest = path.join(destination, placeholder.placeholderFile);
    mkdirSync(path.dirname(placeholderDest), { recursive: true });
    writeFileSync(placeholderDest, `${JSON.stringify(placeholder, null, 2)}\n`);
  }
  for (const entry of entries) {
    if (omittedByPathPlaceholder(entry.relative)) continue;
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
      const sensitive = opaqueSensitive.get(entry.relative);
      if (sensitive || !allowOpaque) {
        const findings = sensitive?.findings ?? [{
          kind: "opaque-file",
          file: entry.relative,
          reason: "clean opaque evidence omitted because portable byte inclusion was not authorized",
        }];
        const placeholder = opaquePlaceholderRecord(entry, raw, findings, sensitive?.truncated ?? false);
        const count = findings.length;
        redactedFields.push({
          file: entry.relative,
          count,
          kinds: placeholder.findingKinds,
        });
        opaquePlaceholders.push(placeholder);
        writeFileSync(
          path.join(destination, placeholder.placeholderFile),
          `${JSON.stringify(placeholder, null, 2)}\n`,
        );
        continue;
      }
      writeFileSync(destFile, raw);
      continue;
    }
    const content = raw.toString("utf8");
    const kinds = {};
    const cleaned = content.replace(new RegExp(pattern.source, "gi"), (match) => {
      if (placeholders.has(match.toLowerCase())) return match;
      kinds["real-id"] = (kinds["real-id"] ?? 0) + 1;
      return pathPlan.aliases.get(match.toLowerCase()) ?? REDACTION_TOKEN;
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
  return { redactedFields, opaquePlaceholders, pathPlaceholders };
}
