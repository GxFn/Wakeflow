import { createHash } from "node:crypto";
import { lstatSync } from "node:fs";
import path from "node:path";
import { verifyArtifactAgainstManifest } from "./check-plugin-artifacts.js";
import { isMainModule } from "../main-module.js";

/** Read-only preflight, not a reservation. The actual installer must publish create-only. */
export function inspectLocalInstallation(source: string, destination: string) {
  const candidate = verifyArtifactAgainstManifest(source);
  const version = candidate.manifest.version;
  const hostId = candidate.manifest.hostId;
  if (
    typeof version !== "string" ||
    !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(version) ||
    (hostId !== "codex" && hostId !== "claude-code")
  )
    throw new Error("Invalid versioned plugin artifact.");
  if (path.basename(destination) !== version)
    throw new Error("Installation directory must equal the artifact version.");
  const node = lstatSync(destination, { throwIfNoEntry: false });
  let disposition: "new-version" | "already-current" = "new-version";
  if (node !== undefined) {
    if (!node.isDirectory() || node.isSymbolicLink())
      throw new Error("Installation target is not a regular version directory.");
    const existing = verifyArtifactAgainstManifest(destination);
    if (!candidate.manifestBytes.equals(existing.manifestBytes)) {
      throw new Error(
        "Same-version replacement refused: choose a new version and retain the old installation for live processes and recovery.",
      );
    }
    disposition = "already-current";
  }
  return {
    hostId,
    version,
    disposition,
    fileCount: candidate.fileCount + 1,
    manifestDigest: `sha256:${createHash("sha256").update(candidate.manifestBytes).digest("hex")}`,
    publicationRequirement: "exclusive-create" as const,
    activation: "not-performed" as const,
  };
}

if (isMainModule(import.meta.url)) {
  const [source, destination, ...extra] = process.argv.slice(2);
  if (source === undefined || destination === undefined || extra.length !== 0)
    throw new Error(
      "Usage: inspect-local-installation <validated-artifact-directory> <versioned-destination>",
    );
  process.stdout.write(
    `${JSON.stringify(inspectLocalInstallation(source, destination), null, 2)}\n`,
  );
}
