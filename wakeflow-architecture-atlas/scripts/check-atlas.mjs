import crypto from "node:crypto";
import fs, { globSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parse as parseYaml } from "yaml";

const atlasRoot = fileURLToPath(new URL("..", import.meta.url));
const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));
const requireCurrentFingerprints = process.argv.includes("--require-current");
const atlasRelativePath = path.relative(repositoryRoot, atlasRoot)
  .split(path.sep)
  .join("/");
const mapsRoot = path.join(atlasRoot, "maps");
const documents = globSync("**/*.md", { cwd: mapsRoot }).sort();
const sourceFiles = globSync("src/**/*.ts", { cwd: repositoryRoot });
const sourceFileSet = new Set(sourceFiles);
const sourceBasenames = new Set(sourceFiles.map((file) => path.basename(file)));
const sourcePathsByBasename = new Map();
for (const sourceFile of sourceFiles) {
  const basename = path.basename(sourceFile);
  const paths = sourcePathsByBasename.get(basename) ?? [];
  paths.push(sourceFile);
  sourcePathsByBasename.set(basename, paths);
}
const sourceImports = new Map();
for (const sourceFile of sourceFiles) {
  const raw = fs.readFileSync(path.join(repositoryRoot, sourceFile), "utf8");
  const specifiers = [
    ...[...raw.matchAll(/\bfrom\s+["']([^"']+)["']/gu)]
      .map((match) => match[1]),
    ...[...raw.matchAll(/\bimport\s+["']([^"']+)["']/gu)]
      .map((match) => match[1]),
  ];
  const resolved = new Set();
  for (const specifier of specifiers) {
    if (typeof specifier !== "string" || !specifier.startsWith(".")) continue;
    const candidate = path.normalize(path.join(
      path.dirname(sourceFile),
      specifier,
    )).split(path.sep).join("/").replace(/\.(?:c|m)?js$/u, ".ts");
    if (sourceFileSet.has(candidate)) resolved.add(candidate);
  }
  sourceImports.set(sourceFile, resolved);
}
const errors = [];
let mermaidBlocks = 0;
let fingerprints = 0;
let verifiedDirectImportEdges = 0;
let skippedDirectImportEdges = 0;
let verifiedEvidenceEdges = 0;
const staleFingerprints = [];

function diagramNodeSource(label) {
  const normalized = label.replaceAll("\\n", "\n");
  const explicit = normalized.match(/\bsrc\/[a-z0-9_./-]+\.ts\b/u)?.[0];
  if (explicit !== undefined && sourceFileSet.has(explicit)) return explicit;
  const basenames = [...normalized.matchAll(/([a-z][a-z0-9-]+\.ts)\b/gu)]
    .map((match) => match[1]);
  if (basenames.length !== 1) return null;
  const candidates = sourcePathsByBasename.get(basenames[0]) ?? [];
  return candidates.length === 1 ? candidates[0] : null;
}

function checkDirectImportClaims(relativeDocument, diagramIndex, source) {
  if (!relativeDocument.endsWith("/file-dependencies.md")) return;
  const nodes = new Map();
  for (const match of source.matchAll(
    /^\s+([A-Z][A-Z0-9_]*)\["([^"\n]*)"\]\s*$/gmu,
  )) {
    const sourceFile = diagramNodeSource(match[2]);
    if (sourceFile !== null) nodes.set(match[1], sourceFile);
  }
  for (const match of source.matchAll(
    /^\s+([A-Z][A-Z0-9_]*)\s+(?:-->|-\.->|==>)\|"([^"]+)"\|\s+([A-Z][A-Z0-9_]*)\s*$/gmu,
  )) {
    const from = nodes.get(match[1]);
    const to = nodes.get(match[3]);
    if (from === undefined || to === undefined) {
      skippedDirectImportEdges += 1;
      continue;
    }
    verifiedDirectImportEdges += 1;
    if (!sourceImports.get(from)?.has(to)) {
      errors.push(
        `${relativeDocument}#${diagramIndex + 1}: direct import claim ${match[2]} is absent (${from} -> ${to})`,
      );
    }
  }
}

function checkEdgeEvidence(relativeDocument, diagramIndex, source, after) {
  const occurrences = [...source.matchAll(/\bE-[A-Z0-9]+-\d{2}\b/gu)]
    .map((match) => match[0]);
  const edgeIds = new Set(occurrences);
  if (edgeIds.size !== occurrences.length) {
    errors.push(`${relativeDocument}#${diagramIndex + 1}: duplicate edge id in diagram`);
  }
  const evidence = new Set(
    [...after.matchAll(/\bE-[A-Z0-9]+-\d{2}\b/gu)]
      .map((match) => match[0]),
  );
  for (const range of after.matchAll(
    /\b(E-[A-Z0-9]+-)(\d{2})`?\s*[–-]\s*`?(E-[A-Z0-9]+-)(\d{2})\b/gu,
  )) {
    if (range[1] !== range[3]) continue;
    for (let index = Number(range[2]); index <= Number(range[4]); index += 1) {
      evidence.add(`${range[1]}${String(index).padStart(2, "0")}`);
    }
  }
  for (const edgeId of edgeIds) {
    if (!evidence.has(edgeId)) {
      errors.push(
        `${relativeDocument}#${diagramIndex + 1}: missing adjacent evidence for ${edgeId}`,
      );
      continue;
    }
    verifiedEvidenceEdges += 1;
  }
}

const agentInstructionsPath = path.join(atlasRoot, "AGENTS.md");
const claudeInstructionsPath = path.join(atlasRoot, "CLAUDE.md");
const instructionLayer = {
  agentsPresent: fs.existsSync(agentInstructionsPath),
  claudePresent: fs.existsSync(claudeInstructionsPath),
  claudeReferencesAgents: false,
};
if (!instructionLayer.agentsPresent) errors.push("atlas AGENTS.md is missing");
if (!instructionLayer.claudePresent) errors.push("atlas CLAUDE.md is missing");
if (instructionLayer.claudePresent) {
  instructionLayer.claudeReferencesAgents = fs.readFileSync(
    claudeInstructionsPath,
    "utf8",
  ).includes("AGENTS.md");
  if (!instructionLayer.claudeReferencesAgents) {
    errors.push("atlas CLAUDE.md must reference the canonical local AGENTS.md");
  }
}

const rootPackage = JSON.parse(fs.readFileSync(
  path.join(repositoryRoot, "package.json"),
  "utf8",
));
const rootWorkspaces = Array.isArray(rootPackage.workspaces)
  ? rootPackage.workspaces
  : [];
const rootScripts = Object.values(rootPackage.scripts ?? {});
const rootIntegrationFiles = [
  "tsconfig.json",
  ".dependency-cruiser.cjs",
].filter((file) => fs.existsSync(path.join(repositoryRoot, file)));
const rootIntegrationMentions = rootIntegrationFiles.filter((file) => (
  fs.readFileSync(path.join(repositoryRoot, file), "utf8")
    .includes(atlasRelativePath)
));
const gitignore = fs.readFileSync(path.join(repositoryRoot, ".gitignore"), "utf8");
const isolation = {
  atlasRelativePath,
  atlasAtRepositoryTopLevel: path.dirname(atlasRelativePath) === ".",
  rootWorkspaceMember: rootWorkspaces.some((workspace) => (
    String(workspace).includes(atlasRelativePath)
  )),
  rootScriptReference: rootScripts.some((script) => (
    String(script).includes(atlasRelativePath)
  )),
  rootIntegrationMentions,
  buildOutputIgnored: gitignore.split("\n").includes(".build/"),
  nestedDependenciesIgnored: gitignore.split("\n").includes("node_modules/"),
};

if (!isolation.atlasAtRepositoryTopLevel) {
  errors.push("atlas must remain an independent repository-top-level package");
}
if (isolation.rootWorkspaceMember) errors.push("atlas must not be a root npm workspace");
if (isolation.rootScriptReference) errors.push("atlas must not be invoked by root npm scripts");
if (isolation.rootIntegrationMentions.length > 0) {
  errors.push(`atlas leaked into root integration: ${isolation.rootIntegrationMentions.join(", ")}`);
}
if (!isolation.buildOutputIgnored) errors.push("root .build output is not ignored");
if (!isolation.nestedDependenciesIgnored) errors.push("nested node_modules is not ignored");

for (const relativeDocument of documents) {
  const absoluteDocument = path.join(mapsRoot, relativeDocument);
  const raw = fs.readFileSync(absoluteDocument, "utf8");
  const diagrams = [...raw.matchAll(/```mermaid\n([\s\S]*?)```/gu)];
  mermaidBlocks += diagrams.length;

  for (const [index, match] of diagrams.entries()) {
    const source = match[1] ?? "";
    checkDirectImportClaims(relativeDocument, index, source);
    if (!/accTitle:/u.test(source) || !/accDescr:/u.test(source)) {
      errors.push(`${relativeDocument}#${index + 1}: missing accTitle/accDescr`);
    }
    const nextIndex = diagrams[index + 1]?.index ?? raw.length;
    const after = raw.slice((match.index ?? 0) + match[0].length, nextIndex);
    checkEdgeEvidence(relativeDocument, index, source, after);
    if (!/本图术语说明/u.test(after)) {
      errors.push(`${relativeDocument}#${index + 1}: missing adjacent terminology`);
    }
    for (const edge of source.matchAll(/\bE-[A-Z0-9]+-([^\s"|:]+)/gu)) {
      if (!/^\d{2}$/u.test(edge[1] ?? "")) {
        errors.push(`${relativeDocument}: invalid edge id ${edge[0]}`);
      }
    }
    for (const reference of source.matchAll(/(?:\\n|\n)([a-z][a-z0-9-]+\.ts)\b/gu)) {
      const basename = reference[1] ?? "";
      if (!sourceBasenames.has(basename)) {
        errors.push(`${relativeDocument}: missing TypeScript source ${basename}`);
      }
    }
  }

  for (const link of raw.matchAll(/\[[^\]]*\]\(([^)]+\.md)(?:#[^)]+)?\)/gu)) {
    const target = path.resolve(path.dirname(absoluteDocument), link[1] ?? "");
    if (!fs.existsSync(target)) {
      errors.push(`${relativeDocument}: missing Markdown link ${link[1]}`);
    }
  }

  if (!raw.startsWith("---\n")) continue;
  const end = raw.indexOf("\n---\n", 4);
  if (end < 0) {
    errors.push(`${relativeDocument}: unterminated frontmatter`);
    continue;
  }
  const frontmatter = parseYaml(raw.slice(4, end));
  if (typeof frontmatter !== "object" || frontmatter === null) {
    errors.push(`${relativeDocument}: invalid frontmatter`);
    continue;
  }
  if (typeof frontmatter.sourceFingerprint !== "string") continue;

  const patterns = [
    ...(frontmatter.sourcePaths ?? []),
    ...(frontmatter.schemaPaths ?? []),
    ...(frontmatter.testPaths ?? []),
  ];
  const files = [...new Set(patterns.flatMap((pattern) => (
    globSync(pattern, { cwd: repositoryRoot })
  )))].filter((file) => fs.statSync(path.join(repositoryRoot, file)).isFile()).sort();
  const digest = crypto.createHash("sha256");
  for (const file of files) {
    digest.update(file);
    digest.update("\0");
    digest.update(fs.readFileSync(path.join(repositoryRoot, file)));
    digest.update("\0");
  }
  const actual = `sha256:${digest.digest("hex")}`;
  fingerprints += 1;
  if (actual !== frontmatter.sourceFingerprint) {
    staleFingerprints.push(relativeDocument);
    if (frontmatter.truthKind !== "stale") {
      errors.push(`${relativeDocument}: source fingerprint mismatch is not marked stale`);
    } else if (requireCurrentFingerprints) {
      errors.push(`${relativeDocument}: source fingerprint is stale`);
    }
  } else if (frontmatter.truthKind === "stale") {
    errors.push(`${relativeDocument}: current source fingerprint is still marked stale`);
  }
}

const result = {
  ok: errors.length === 0,
  documents: documents.length,
  mermaidBlocks,
  fingerprints,
  requireCurrentFingerprints,
  allFingerprintsCurrent: staleFingerprints.length === 0,
  staleFingerprints,
  directImportClaims: {
    verified: verifiedDirectImportEdges,
    skipped: skippedDirectImportEdges,
  },
  evidenceEdges: {
    verified: verifiedEvidenceEdges,
  },
  instructionLayer,
  isolation,
  errors,
};

if (documents.length < 33) errors.push("document coverage regressed below 33");
if (mermaidBlocks < 42) errors.push("Mermaid coverage regressed below 42");
if (fingerprints < 30) errors.push("fingerprint coverage regressed below 30");
result.ok = errors.length === 0;
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (!result.ok) process.exitCode = 1;
