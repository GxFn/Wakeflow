import { lstatSync, realpathSync } from "node:fs";
import path from "node:path";

export class WakeflowFsSafetyError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "WakeflowFsSafetyError";
    this.details = details;
  }
}

export function pathIsInside(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === ""
    || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`));
}

export function assertExistingPathInside({
  root,
  candidate,
  label = "path",
  allowRoot = false,
  allowSymlink = false,
} = {}) {
  const lexicalRoot = path.resolve(root);
  const lexicalCandidate = path.resolve(candidate);
  if (!pathIsInside(lexicalRoot, lexicalCandidate) || (!allowRoot && lexicalRoot === lexicalCandidate)) {
    throw new WakeflowFsSafetyError(`${label} must stay below ${lexicalRoot}: ${lexicalCandidate}`, {
      root: lexicalRoot,
      candidate: lexicalCandidate,
      reason: "lexical-containment",
    });
  }

  const rootStat = lstatSync(lexicalRoot);
  if (rootStat.isSymbolicLink()) {
    throw new WakeflowFsSafetyError(`${label} root cannot be a symbolic link: ${lexicalRoot}`, {
      root: lexicalRoot,
      reason: "root-symlink",
    });
  }
  const candidateStat = lstatSync(lexicalCandidate);
  if (!allowSymlink && candidateStat.isSymbolicLink()) {
    throw new WakeflowFsSafetyError(`${label} cannot be a symbolic link: ${lexicalCandidate}`, {
      candidate: lexicalCandidate,
      reason: "candidate-symlink",
    });
  }

  const realRoot = realpathSync(lexicalRoot);
  const realCandidate = realpathSync(lexicalCandidate);
  if (!pathIsInside(realRoot, realCandidate) || (!allowRoot && realRoot === realCandidate)) {
    throw new WakeflowFsSafetyError(`${label} resolves outside ${realRoot}: ${lexicalCandidate}`, {
      root: realRoot,
      candidate: realCandidate,
      reason: "realpath-containment",
    });
  }
  return {
    lexicalRoot,
    lexicalCandidate,
    realRoot,
    realCandidate,
    stat: candidateStat,
  };
}
