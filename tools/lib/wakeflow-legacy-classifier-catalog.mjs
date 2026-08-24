import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  readdirSync,
} from "node:fs";
import path from "node:path";

import {
  WAKEFLOW_LEGACY_CLASSIFIER_CATALOG_KIND,
  WAKEFLOW_LEGACY_CLASSIFIER_CATALOG_VERSION,
  validateWakeflowLegacyClassifierCatalog,
} from "../../core/scripts/lib/wakeflow-legacy-classifier.mjs";
import {
  canonicalJson,
  canonicalJsonDigest,
} from "../../core/scripts/lib/wakeflow-canonical-json.mjs";
import {
  inspectWakeflowLegacyOriginSourceMap,
} from "./wakeflow-legacy-origin-fixtures.mjs";

export const WAKEFLOW_LEGACY_CLASSIFIER_CATALOG_RELATIVE_PATH =
  "core/scripts/data/wakeflow-legacy-classifier-catalog.json";

const SYNTHETIC_NAMES = Object.freeze([
  Object.freeze({
    id: "product-repository",
    sensitivity: "portable",
    source: "ProductWorkspace",
    type: "repository-name",
  }),
  Object.freeze({
    id: "product-window",
    sensitivity: "portable",
    source: "ProductWindow",
    type: "window-name",
  }),
  Object.freeze({
    id: "workspace-name",
    sensitivity: "portable",
    source: "WakeflowFixture",
    type: "workspace-name",
  }),
]);
const DYNAMIC_TOKEN_PATTERN = /@wakeflow-(?:fixture|scenario)-[A-Za-z0-9._/-]+/gu;
const CONFIG_NAMES = new Set(["wakeflow.config.json", "workspace.config.json"]);
const MEMORY_NAMES = new Set(["AGENTS.md", "CLAUDE.md"]);
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const FIXTURE_FILE_MAX_BYTES = 32 * 1024 * 1024;
const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function assertCanonicalDirectory(value, name) {
  if (
    typeof value !== "string"
    || !path.isAbsolute(value)
    || path.resolve(value) !== value
    || value.includes("\0")
  ) {
    throw new TypeError(`${name} must be a normalized absolute directory`);
  }
  const stat = lstatSync(value);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new TypeError(`${name} must be a real directory`);
  }
  return value;
}

function sameFileIdentity(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.mode === right.mode
    && left.nlink === right.nlink
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs;
}

// source-map inspector先验证整棵fixture；compiler重读实际内容时仍独立保持有界、no-follow和稳定身份。
function readFixtureBytes(file, coordinate) {
  const before = lstatSync(file, { bigint: true });
  if (before.isSymbolicLink() || !before.isFile() || before.nlink !== 1n) {
    throw new Error(`legacy fixture source must be one regular non-symlink single-link file at ${coordinate}`);
  }
  if (before.size > BigInt(FIXTURE_FILE_MAX_BYTES)) {
    throw new Error(`legacy fixture source exceeds the byte limit at ${coordinate}`);
  }
  let descriptor;
  try {
    descriptor = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const opened = fstatSync(descriptor, { bigint: true });
    if (!opened.isFile() || opened.nlink !== 1n || !sameFileIdentity(before, opened)) {
      throw new Error(`legacy fixture source changed before open at ${coordinate}`);
    }
    const expected = Number(opened.size);
    const buffer = Buffer.allocUnsafe(expected + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const count = readSync(descriptor, buffer, offset, buffer.length - offset, null);
      if (count === 0) break;
      offset += count;
    }
    const afterDescriptor = fstatSync(descriptor, { bigint: true });
    const afterPath = lstatSync(file, { bigint: true });
    if (
      offset !== expected
      || !sameFileIdentity(opened, afterDescriptor)
      || !sameFileIdentity(opened, afterPath)
    ) {
      throw new Error(`legacy fixture source changed while reading at ${coordinate}`);
    }
    return buffer.subarray(0, offset);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function readJson(file, coordinate) {
  return JSON.parse(utf8Decoder.decode(readFixtureBytes(file, coordinate)));
}

function stripFixtureSurface(ref) {
  for (const [prefix, surfaceKind] of [
    ["WakeflowFixture/Design/", "design-support"],
    ["WakeflowFixture/Test/", "test-support"],
    ["ProductWorkspace/", "product-repository"],
    ["WakeflowFixture/", "controller"],
  ]) {
    if (ref.startsWith(prefix)) {
      return { relativePath: ref.slice(prefix.length), surfaceKind };
    }
  }
  if (ref === "AGENTS.md" || ref === "CLAUDE.md") {
    return { relativePath: ref, surfaceKind: "workspace-parent" };
  }
  return { relativePath: ref, surfaceKind: "controller" };
}

export function legacyClassifierFixtureSourceDescriptor({
  owner,
  ref,
  rootFamily,
  scenarioCategory = null,
} = {}) {
  if (typeof owner !== "string" || !owner || typeof ref !== "string" || !ref) {
    throw new TypeError("owner and ref are required fixture coordinates");
  }
  if (typeof rootFamily !== "string" || !rootFamily) {
    throw new TypeError("rootFamily is required");
  }
  if (scenarioCategory !== null && (typeof scenarioCategory !== "string" || !scenarioCategory)) {
    throw new TypeError("scenarioCategory must be null or a non-empty string");
  }
  const { relativePath, surfaceKind } = stripFixtureSurface(ref);
  const ownership = surfaceKind === "workspace-parent" || surfaceKind === "product-repository"
    ? "managed-block"
    : "wakeflow-managed";
  const gitIgnoreRoot = path.posix.basename(relativePath) !== ".gitignore"
    ? "unknown"
    : surfaceKind === "controller" || surfaceKind === "product-repository";
  return deepFreeze({
    gitIgnoreRoot,
    ownership,
    relativePath,
    surfaceKind,
  });
}

function formatFor(relativePath) {
  if (relativePath.endsWith(".jsonl")) return "jsonl";
  if (relativePath.endsWith(".json")) return "json";
  if (relativePath.endsWith(".md")) return "markdown";
  if (relativePath.endsWith(".mjs")) return "javascript";
  if (path.posix.basename(relativePath) === ".gitignore") return "gitignore";
  return "text";
}

function modeFor(relativePath, text) {
  const name = path.posix.basename(relativePath);
  if (CONFIG_NAMES.has(name)) return "config-schema";
  if (MEMORY_NAMES.has(name)) {
    return /<!-- wakeflow:(?:root-agents|scope):start -->/u.test(text)
      ? "memory-marker"
      : "memory-whole";
  }
  if (name === ".gitignore") return "gitignore-components";
  if (/^(?:.*\/)?\.claude\/settings(?:\.local)?\.json$/u.test(relativePath)) {
    return "claude-settings-components";
  }
  return "whole-file";
}

function markerFor({ id, sensitivity, type }) {
  return `@wakeflow-classifier-slot[${type}|${sensitivity}|${id}]@`;
}

function dynamicTokenBase(token) {
  if (/^@wakeflow-(?:fixture-root|scenario-(?:artifact-root|sandbox-root))\//u.test(token)) {
    return token;
  }
  const slashAt = token.indexOf("/");
  const segment = slashAt < 0 ? token : token.slice(0, slashAt);
  return segment.replace(/\.(?:jsonl?|md|mjs)$/u, "");
}

function dynamicSlot(token, ordinal) {
  const prefix = token
    .replace(/^@wakeflow-(?:fixture|scenario)-/u, "")
    .split("/")[0]
    .replace(/-[a-f0-9]{10}$/u, "")
    .replace(/[^a-z0-9-]+/gu, "-")
    .replace(/^-+|-+$/gu, "") || "value";
  let type = "artifact-id";
  let sensitivity = "portable";
  if (/(?:artifact-root|sandbox-root|fixture-root|root)/u.test(prefix)) {
    type = "absolute-path";
    sensitivity = "local";
  } else if (/(?:^|-)time(?:-|$)/u.test(prefix)) {
    type = "iso-time";
  } else if (/(?:^|-)digest(?:-|$)/u.test(prefix)) {
    type = "digest";
  } else if (/(?:^|-)(?:child-|worker-)?pid(?:-|$)/u.test(prefix)) {
    type = "process-id";
    sensitivity = "local";
  } else if (/(?:thread-id|session)/u.test(prefix)) {
    type = "host-handle";
    sensitivity = "secret";
  } else if (/(?:^|-)token(?:-|$)/u.test(prefix)) {
    type = "secret-token";
    sensitivity = "secret";
  }
  const id = `dynamic-${prefix}-${ordinal}`;
  return { id, marker: markerFor({ id, sensitivity, type }), sensitivity, type };
}

function applyTypedTemplates(relativePath, content) {
  const slots = new Map();
  const slotsByToken = new Map();
  let pathTemplate = relativePath;
  let contentTemplate = content;
  const semanticOrdinals = new Map();
  const dynamicTokensInOrder = [];
  for (const match of `${relativePath}\n${content}`.matchAll(DYNAMIC_TOKEN_PATTERN)) {
    const token = dynamicTokenBase(match[0]);
    if (slotsByToken.has(token)) continue;
    const prefix = token
      .replace(/^@wakeflow-(?:fixture|scenario)-/u, "")
      .split("/")[0]
      .replace(/-[a-f0-9]{10}$/u, "")
      .replace(/[^a-z0-9-]+/gu, "-")
      .replace(/^-+|-+$/gu, "") || "value";
    const ordinal = (semanticOrdinals.get(prefix) ?? 0) + 1;
    semanticOrdinals.set(prefix, ordinal);
    const slot = dynamicSlot(token, ordinal);
    slotsByToken.set(token, slot);
    dynamicTokensInOrder.push(token);
  }
  const dynamicTokens = [...dynamicTokensInOrder]
    .sort((left, right) => right.length - left.length || compareText(left, right));
  for (const token of dynamicTokens) {
    const slot = slotsByToken.get(token);
    slots.set(slot.id, slot);
    pathTemplate = pathTemplate.replaceAll(token, slot.marker);
    contentTemplate = contentTemplate.replaceAll(token, slot.marker);
  }
  const syntheticOrdinals = new Map();
  const machineWindowPath = /\/(?:locks|thread-registry|window-config|window-host)\//u.test(`/${relativePath}`);
  const syntheticItems = SYNTHETIC_NAMES
    .filter(({ source }) => pathTemplate.includes(source) || contentTemplate.includes(source))
    .map((item) => {
      const firstPath = pathTemplate.indexOf(item.source);
      const firstContent = contentTemplate.indexOf(item.source);
      const first = firstPath >= 0
        ? firstPath
        : relativePath.length + 1 + firstContent;
      const type = item.source === "WakeflowFixture" && machineWindowPath
        ? "window-name"
        : item.type;
      return { ...item, first, type };
    })
    .sort((left, right) => left.first - right.first || compareText(left.source, right.source));
  for (const item of syntheticItems) {
    const ordinal = (syntheticOrdinals.get(item.type) ?? 0) + 1;
    syntheticOrdinals.set(item.type, ordinal);
    const id = `synthetic-${item.type}-${ordinal}`;
    const slot = { id, sensitivity: item.sensitivity, type: item.type };
    const marker = markerFor(slot);
    const beforePath = pathTemplate;
    const beforeContent = contentTemplate;
    pathTemplate = pathTemplate.replaceAll(item.source, marker);
    contentTemplate = contentTemplate.replaceAll(item.source, marker);
    if (pathTemplate !== beforePath || contentTemplate !== beforeContent) {
      slots.set(id, { ...slot, marker });
    }
  }
  return {
    contentTemplate,
    pathTemplate,
    slots: [...slots.values()]
      .map(({ id, marker, sensitivity, type }) => ({ id, marker, sensitivity, type }))
      .sort((left, right) => compareText(left.id, right.id)),
  };
}

function memoryMarkerContent(text) {
  for (const [start, end] of [
    ["<!-- wakeflow:root-agents:start -->", "<!-- wakeflow:root-agents:end -->"],
    ["<!-- wakeflow:scope:start -->", "<!-- wakeflow:scope:end -->"],
  ]) {
    const startAt = text.indexOf(start);
    const endAt = text.indexOf(end);
    if (startAt >= 0 && endAt > startAt) return text.slice(startAt, endAt + end.length);
  }
  return text;
}

function configFamily(text) {
  const value = JSON.parse(text);
  return value.schemaVersion === 2 ? "nested-v2" : "flat-v1";
}

function artifactFor({ format, mode, relativePath, text }) {
  if (mode === "config-schema") {
    const schema = configFamily(text);
    return {
      kind: schema === "nested-v2" ? "wakeflow-config-v2" : "wakeflow-config-flat-v1",
      schema,
    };
  }
  if (mode === "memory-marker" || mode === "memory-whole") {
    return { kind: "wakeflow-memory", schema: null };
  }
  if (mode === "gitignore-components") return { kind: "wakeflow-gitignore", schema: null };
  if (mode === "claude-settings-components") {
    return {
      kind: relativePath.endsWith("settings.local.json") ? "claude-settings-local" : "claude-settings",
      schema: null,
    };
  }
  if (format === "json" || format === "jsonl") {
    try {
      const value = format === "json"
        ? JSON.parse(text)
        : JSON.parse(text.trimEnd().split("\n")[0]);
      const kind = typeof value?.kind === "string"
        ? value.kind
        : typeof value?.artifactKind === "string"
          ? value.artifactKind
          : `legacy-${path.posix.basename(relativePath).replace(/\.[^.]+$/u, "")}`;
      const version = value?.schemaVersion ?? value?.version;
      return { kind, schema: Number.isSafeInteger(version) ? `version:${version}` : null };
    } catch {
      // Exact fixture validation owns JSON validity; retain a stable fallback here.
    }
  }
  return {
    kind: `legacy-${path.posix.basename(relativePath).replace(/\.[^.]+$/u, "").replace(/[^A-Za-z0-9-]+/gu, "-").toLowerCase() || "text"}`,
    schema: null,
  };
}

function baseDispositionPolicy({ mode, relativePath, surfaceKind }) {
  if (mode === "config-schema") {
    return relativePath.startsWith(".wakeflow-local/") ? "local-derived-config" : "tracked-config";
  }
  if (mode === "memory-marker" || mode === "memory-whole") {
    return surfaceKind === "design-support" || surfaceKind === "test-support"
      ? "support-memory"
      : "mixed-memory";
  }
  if (mode === "gitignore-components") return "mixed-gitignore";
  if (mode === "claude-settings-components") return "mixed-claude-settings";
  if (surfaceKind === "design-support" || surfaceKind === "test-support") return "support-scaffold";
  if (/^(?:\.wakeflow-local|\.workspace-local)\/preserved\//u.test(relativePath)) return "preservation";
  if (/\/pod-reservations\//u.test(relativePath)) return "pod-reservation";
  if (/\/pod-(?:bindings|manifests|operations)\//u.test(relativePath)) return "pod-aggregate";
  if (/\/thread-registry\//u.test(relativePath)) return "thread-registry";
  if (/\/window-config\//u.test(relativePath)) return "window-config";
  if (/\/window-host\//u.test(relativePath)) return "claude-window-host";
  if (/\/keep-live\//u.test(relativePath)) return "keep-live";
  if (/\/locks\//u.test(relativePath)) return "lease";
  if (/\/target-results\//u.test(relativePath)) return "local-result";
  if (/\/(?:delivery-envelopes|delivery-runs|dispatch-groups|dispatch-packets)\//u.test(relativePath)) return "transport-chain";
  if (/\/worktrees\//u.test(relativePath)) return "worktree";
  if (/wakeflow-next-work\.json$/u.test(relativePath)) return "next-work-cache";
  if (/\/stop\.json$/u.test(relativePath)) return "stop-marker";
  if (/wakeflow-statusline\.mjs$/u.test(relativePath)) return "statusline-asset";
  if (/^(?:\.wakeflow-active|\.workspace-active)\/(?:current|workspace\/current)\/[^/]+\//u.test(relativePath)) return "active-demand";
  if (/global-todo-board\.md$/u.test(relativePath)) return "active-todo";
  if (/test-exchange\.md$/u.test(relativePath)) return "active-test-exchange";
  if (/^(?:\.wakeflow-active\/README|\.wakeflow-active\/current\/index|\.workspace-active\/workspace\/current\/index)\.md$/u.test(relativePath)) return "legacy-starter";
  if (/^(?:\.wakeflow-active|\.workspace-active)\//u.test(relativePath)) return "active-derived";
  if (/^wakeflow-ledger\/workspace\/pending-merges\.md$/u.test(relativePath)) return "pending-merge";
  if (/^wakeflow-ledger\/workspace\/(?:archive\/index|workspace-record-map)\.md$/u.test(relativePath)) return "ledger-derived";
  if (/^wakeflow-ledger\//u.test(relativePath)) return "legacy-starter";
  if (/^(?:\.wakeflow-local|\.workspace-local)\/.*README\.md$/u.test(relativePath)) return "local-readme";
  if (relativePath === "README.md") return "legacy-starter";
  return "ledger-derived";
}

function producerRoute({ owner, scenario }) {
  return scenario
    ? `scenario-${scenario.category}-${scenario.materializationMode}`
    : `setup-${owner}`;
}

function semanticEntry({
  bytes,
  descriptor,
  origin,
  owner,
  scenario,
}) {
  const text = bytes.toString("utf8");
  const format = formatFor(descriptor.relativePath);
  const classifierMode = modeFor(descriptor.relativePath, text);
  const classifiedContent = classifierMode === "memory-marker" ? memoryMarkerContent(text) : text;
  const templated = applyTypedTemplates(
    descriptor.relativePath,
    classifierMode === "config-schema" ? "" : classifiedContent,
  );
  const artifact = artifactFor({
    format,
    mode: classifierMode,
    relativePath: descriptor.relativePath,
    text,
  });
  const dispositionPolicy = baseDispositionPolicy({
    mode: classifierMode,
    relativePath: descriptor.relativePath,
    surfaceKind: descriptor.surfaceKind,
  });
  const semantic = {
    artifact,
    classifierMode,
    contentTemplateBase64: classifierMode === "config-schema"
      ? null
      : Buffer.from(templated.contentTemplate, "utf8").toString("base64"),
    dispositionPolicy,
    format,
    pathTemplate: templated.pathTemplate,
    slots: templated.slots,
    surfaceKind: descriptor.surfaceKind,
  };
  const canonicalClassifierDigest = canonicalJsonDigest(semantic);
  return {
    ...semantic,
    canonicalClassifierDigest,
    entryId: `legacy-template-${canonicalClassifierDigest.slice(7, 27)}`,
    originCandidate: origin.originId,
    producerRoute: producerRoute({ owner, scenario }),
    rawFixtureDigest: sha256(bytes),
    rootFamily: origin.rootFamily,
  };
}

function addRecord(groups, record) {
  const key = canonicalJson({
    artifact: record.artifact,
    canonicalClassifierDigest: record.canonicalClassifierDigest,
    classifierMode: record.classifierMode,
    contentTemplateBase64: record.contentTemplateBase64,
    dispositionPolicy: record.dispositionPolicy,
    entryId: record.entryId,
    format: record.format,
    pathTemplate: record.pathTemplate,
    slots: record.slots,
    surfaceKind: record.surfaceKind,
  });
  const group = groups.get(key) ?? {
    ...record,
    originCandidates: new Set(),
    producerRoutes: new Set(),
    rawFixtureDigests: new Set(),
    rootFamilies: new Set(),
  };
  group.originCandidates.add(record.originCandidate);
  group.producerRoutes.add(record.producerRoute);
  if (record.classifierMode !== "config-schema") group.rawFixtureDigests.add(record.rawFixtureDigest);
  group.rootFamilies.add(record.rootFamily);
  groups.set(key, group);
}

function finalizeEntry(group) {
  const rootFamilies = [...group.rootFamilies].sort(compareText);
  const dispositionPolicy = rootFamilies.every((family) => family === "old-root-flat")
    ? "old-root"
    : group.dispositionPolicy;
  const semantic = {
    artifact: group.artifact,
    classifierMode: group.classifierMode,
    contentTemplateBase64: group.contentTemplateBase64,
    dispositionPolicy,
    format: group.format,
    pathTemplate: group.pathTemplate,
    slots: group.slots,
    surfaceKind: group.surfaceKind,
  };
  const canonicalClassifierDigest = canonicalJsonDigest(semantic);
  return {
    artifact: group.artifact,
    canonicalClassifierDigest,
    classifierMode: group.classifierMode,
    contentTemplateBase64: group.contentTemplateBase64,
    dispositionPolicy,
    entryId: `legacy-template-${canonicalClassifierDigest.slice(7, 27)}`,
    format: group.format,
    originCandidates: [...group.originCandidates].sort(compareText),
    pathTemplate: group.pathTemplate,
    producerRoutes: [...group.producerRoutes].sort(compareText),
    rawFixtureDigests: [...group.rawFixtureDigests].sort(compareText),
    rootFamilies,
    slots: group.slots,
    surfaceKind: group.surfaceKind,
  };
}

function assertDigest(bytes, expected, coordinate) {
  const actual = sha256(bytes);
  if (!SHA256_PATTERN.test(expected) || actual !== expected) {
    throw new Error(`legacy fixture digest mismatch at ${coordinate}`);
  }
}

export function buildWakeflowLegacyClassifierCatalog({ fixturesRoot } = {}) {
  const root = assertCanonicalDirectory(fixturesRoot, "fixturesRoot");
  const inspected = inspectWakeflowLegacyOriginSourceMap({ fixturesRoot: root });
  const groups = new Map();
  let staticFileReferences = 0;
  let scenarioFileReferences = 0;

  for (const originId of inspected.materializedOriginIds) {
    const originRoot = path.join(root, originId);
    const origin = readJson(path.join(originRoot, "origin.json"), `${originId}:origin.json`);
    for (const layer of origin.staticLayers) {
      for (const entry of layer.expectedEntries) {
        if (entry.afterType !== "file") continue;
        const coordinate = `${originId}:${layer.layerId}:${entry.path}`;
        const bytes = readFixtureBytes(
          path.join(originRoot, "static", layer.layerId, ...entry.path.split("/")),
          coordinate,
        );
        assertDigest(bytes, entry.afterDigest, coordinate);
        const descriptor = legacyClassifierFixtureSourceDescriptor({
          owner: layer.owner,
          ref: entry.path,
          rootFamily: origin.rootFamily,
        });
        addRecord(groups, semanticEntry({
          bytes,
          descriptor,
          origin,
          owner: layer.owner,
          scenario: null,
        }));
        staticFileReferences += 1;
      }
    }
    for (const scenarioRef of origin.scenarios) {
      const scenarioId = scenarioRef.split("/")[0];
      const scenario = readJson(
        path.join(originRoot, "scenarios", scenarioRef),
        `${originId}:${scenarioRef}`,
      );
      for (const entry of scenario.outputManifest.files) {
        const coordinate = `${originId}:${scenarioId}:${entry.ref}`;
        const bytes = readFixtureBytes(
          path.join(originRoot, "scenarios", scenarioId, "output", ...entry.ref.split("/")),
          coordinate,
        );
        assertDigest(bytes, entry.digest, coordinate);
        const descriptor = legacyClassifierFixtureSourceDescriptor({
          owner: scenario.materializationMode,
          ref: entry.ref,
          rootFamily: origin.rootFamily,
          scenarioCategory: scenario.category,
        });
        addRecord(groups, semanticEntry({
          bytes,
          descriptor,
          origin,
          owner: scenario.materializationMode,
          scenario,
        }));
        scenarioFileReferences += 1;
      }
    }
  }

  const entries = [...groups.values()]
    .map(finalizeEntry)
    .sort((left, right) => compareText(left.entryId, right.entryId));
  const coverage = {
    originCount: inspected.materializedHostArtifacts,
    pendingOriginCount: inspected.pendingHostArtifacts,
    scenarioFileReferences,
    staticFileReferences,
    templateCount: entries.length,
  };
  const payload = {
    artifactKind: WAKEFLOW_LEGACY_CLASSIFIER_CATALOG_KIND,
    coverage,
    entries,
    schemaVersion: WAKEFLOW_LEGACY_CLASSIFIER_CATALOG_VERSION,
  };
  return validateWakeflowLegacyClassifierCatalog({
    ...payload,
    catalogDigest: canonicalJsonDigest(payload),
  });
}
