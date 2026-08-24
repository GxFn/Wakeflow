#!/usr/bin/env node

import {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  validateWakeflowLegacyClassifierCatalog,
} from "../core/scripts/lib/wakeflow-legacy-classifier.mjs";
import {
  WAKEFLOW_LEGACY_CLASSIFIER_CATALOG_RELATIVE_PATH,
  buildWakeflowLegacyClassifierCatalog,
} from "./lib/wakeflow-legacy-classifier-catalog.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixturesRoot = path.join(repositoryRoot, "test/fixtures/legacy-origins");
const catalogFile = path.join(repositoryRoot, WAKEFLOW_LEGACY_CLASSIFIER_CATALOG_RELATIVE_PATH);
const MAX_CATALOG_BYTES = 4 * 1024 * 1024;
const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

function sameFileIdentity(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.mode === right.mode
    && left.nlink === right.nlink
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs;
}

function readStableCatalog(file, { allowMissing }) {
  let before;
  try {
    before = lstatSync(file, { bigint: true });
  } catch (error) {
    if (allowMissing && error?.code === "ENOENT") return null;
    throw error;
  }
  if (before.isSymbolicLink() || !before.isFile() || before.nlink !== 1n) {
    throw new Error("catalog output must be one regular non-symlink single-link file");
  }
  if (before.size > BigInt(MAX_CATALOG_BYTES)) throw new Error("catalog output exceeds the installed reader limit");
  let descriptor;
  try {
    descriptor = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const opened = fstatSync(descriptor, { bigint: true });
    if (!opened.isFile() || opened.nlink !== 1n || !sameFileIdentity(before, opened)) {
      throw new Error("catalog output changed before it could be read");
    }
    const expectedBytes = Number(opened.size);
    const buffer = Buffer.allocUnsafe(expectedBytes + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const count = readSync(descriptor, buffer, offset, buffer.length - offset, null);
      if (count === 0) break;
      offset += count;
    }
    const afterDescriptor = fstatSync(descriptor, { bigint: true });
    const afterPath = lstatSync(file, { bigint: true });
    if (
      offset !== expectedBytes
      || !sameFileIdentity(opened, afterDescriptor)
      || !sameFileIdentity(opened, afterPath)
    ) {
      throw new Error("catalog output changed while it was being read");
    }
    return buffer.subarray(0, offset);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function assertRealParent(file) {
  const parent = path.dirname(file);
  const stat = lstatSync(parent);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error("catalog output parent must be one real directory");
  }
}

function writeAtomicCatalog(file, bytes) {
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.wakeflow-catalog-${process.pid}`);
  let descriptor;
  try {
    descriptor = openSync(
      temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
      0o644,
    );
    writeFileSync(descriptor, bytes);
    fchmodSync(descriptor, 0o644);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temporary, file);
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    try {
      unlinkSync(temporary);
    } catch (cleanupError) {
      if (cleanupError?.code !== "ENOENT") throw cleanupError;
    }
    throw error;
  }
}

/** 仅负责catalog字节的安全落盘；catalog语义仍由validator拥有。 */
export function writeWakeflowLegacyClassifierCatalogBytes({ catalogFile: file, bytes }) {
  if (typeof file !== "string" || !path.isAbsolute(file) || path.resolve(file) !== file) {
    throw new TypeError("catalogFile must be one normalized absolute path");
  }
  const content = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (content.length === 0 || content.length > MAX_CATALOG_BYTES) {
    throw new Error("generated catalog bytes exceed the installed reader limit");
  }
  const generated = JSON.parse(utf8Decoder.decode(content));
  validateWakeflowLegacyClassifierCatalog(generated);
  assertRealParent(file);
  const current = readStableCatalog(file, { allowMissing: true });
  if (current) validateWakeflowLegacyClassifierCatalog(JSON.parse(utf8Decoder.decode(current)));
  if (current?.equals(content)) return "unchanged";
  writeAtomicCatalog(file, content);
  return "written";
}

function ensureCatalogDirectory() {
  let current = repositoryRoot;
  for (const segment of ["core", "scripts", "data"]) {
    current = path.join(current, segment);
    let stat;
    try {
      stat = lstatSync(current);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      mkdirSync(current, { mode: 0o755 });
      stat = lstatSync(current);
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error(`${path.relative(repositoryRoot, current)} must be one real directory`);
    }
  }
}

function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--write") || args.filter((arg) => arg === "--write").length > 1) {
    throw new Error("usage: node tools/build-legacy-classifier-catalog.mjs [--write]");
  }
  const catalog = buildWakeflowLegacyClassifierCatalog({ fixturesRoot });
  const bytes = Buffer.from(`${JSON.stringify(catalog, null, 2)}\n`);
  let status = "preview";
  if (args.includes("--write")) {
    ensureCatalogDirectory();
    status = writeWakeflowLegacyClassifierCatalogBytes({ catalogFile, bytes });
  }
  process.stdout.write(`${JSON.stringify({
    bytes: bytes.length,
    catalogDigest: catalog.catalogDigest,
    entries: catalog.entries.length,
    origins: catalog.coverage.originCount,
    status,
  })}\n`);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) main();
