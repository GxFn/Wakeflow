import { spawnSync } from "node:child_process";
import { lstatSync, readlinkSync, realpathSync } from "node:fs";
import path from "node:path";
import { readBoundedFile, sha256 } from "./files.js";

function git(root: string, args: readonly string[]): string {
  const result = spawnSync("git", [...args], {
    cwd: root,
    encoding: "utf8",
    shell: false,
    timeout: 10_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error !== undefined || result.status !== 0)
    throw new Error("Git input inspection failed.");
  return result.stdout;
}

function isInput(file: string): boolean {
  return (
    !file.includes("/") ||
    /^(?:src|tests|tooling|assets|plugins|\.agents|\.claude-plugin|\.github)\//u.test(file)
  );
}

function assertParents(root: string, file: string): void {
  let parent = root;
  for (const segment of file.split("/").slice(0, -1)) {
    parent = path.join(parent, segment);
    const stat = lstatSync(parent, { throwIfNoEntry: false });
    if (stat === undefined) return;
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Unsafe input parent.");
  }
}

export function captureVerificationInput(rootInput: string) {
  const root = realpathSync(rootInput);
  if (realpathSync(git(root, ["rev-parse", "--show-toplevel"]).trim()) !== root)
    throw new Error("Verification requires the repository root.");
  const commit = git(root, ["rev-parse", "HEAD"]).trim();
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(commit))
    throw new Error("Invalid Git commit identity.");
  const paths = [
    ...new Set(
      git(root, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"])
        .split("\0")
        .filter((file) => file !== "" && isInput(file)),
    ),
  ].sort();
  if (paths.length === 0 || paths.length > 20_000)
    throw new Error("Invalid verification inventory.");
  const files = paths.map((file) => {
    if (path.isAbsolute(file) || file.split("/").includes(".."))
      throw new Error("Invalid Git path.");
    assertParents(root, file);
    const absolute = path.join(root, file);
    const stat = lstatSync(absolute, { throwIfNoEntry: false });
    if (stat === undefined) return { path: file, kind: "missing", mode: null, digest: null };
    if (stat.isSymbolicLink())
      return {
        path: file,
        kind: "symlink",
        mode: stat.mode & 0o777,
        digest: sha256(readlinkSync(absolute)),
      };
    if (!stat.isFile()) throw new Error("Input is not a regular source file.");
    return {
      path: file,
      kind: "file",
      mode: stat.mode & 0o777,
      digest: sha256(readBoundedFile(absolute, 64 * 1024 * 1024)),
    };
  });
  // A link can refer to bytes outside this inventory. Never certify it by link text alone.
  if (files.some((file) => file.kind === "symlink"))
    throw new Error("Symlink verification input unsupported.");
  return {
    commit,
    dirty: git(root, ["status", "--porcelain", "--untracked-files=all"]).trim() !== "",
    digest: sha256(JSON.stringify(files)),
    fileCount: files.length,
    lockfileDigest: files.find((file) => file.path === "package-lock.json")?.digest ?? null,
    artifacts: files
      .filter((file) => /^plugins\/[^/]+\/artifact-manifest\.json$/u.test(file.path))
      .map((file) => ({ path: file.path, manifestDigest: file.digest })),
  };
}
