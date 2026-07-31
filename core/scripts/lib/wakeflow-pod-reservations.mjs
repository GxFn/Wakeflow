import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { stableArtifactPart } from "./wakeflow-artifact-identity.mjs";
import { assertExistingPathInside } from "./wakeflow-fs-safety.mjs";

export const POD_RESERVATION_KIND = "WakeflowPodReservation";

export function podReservationDir(workspaceRoot) {
  return path.join(path.resolve(workspaceRoot), ".wakeflow-local", "pod-reservations");
}

export function podReservationFile(workspaceRoot, demandKey) {
  return path.join(podReservationDir(workspaceRoot), `${stableArtifactPart(demandKey, "demand")}.json`);
}

function ensureReservationDir(workspaceRoot) {
  const root = path.resolve(workspaceRoot);
  const localRoot = path.join(root, ".wakeflow-local");
  if (!existsSync(localRoot)) mkdirSync(localRoot);
  assertExistingPathInside({
    root,
    candidate: localRoot,
    label: "Wakeflow local runtime root",
  });
  const directory = podReservationDir(root);
  if (!existsSync(directory)) mkdirSync(directory);
  assertExistingPathInside({
    root: localRoot,
    candidate: directory,
    label: "pod reservation directory",
  });
  return directory;
}

function reservationIssue(file, error) {
  return {
    file,
    error: String(error?.message ?? error).replace(/\s+/g, " "),
  };
}

function validateReservation(value, file) {
  if (value?.kind !== POD_RESERVATION_KIND) {
    throw new Error(`unexpected pod reservation kind in ${file}`);
  }
  if (typeof value.demandKey !== "string" || !value.demandKey.trim()) {
    throw new Error(`pod reservation has no demandKey in ${file}`);
  }
  if (!Array.isArray(value.repositories) || value.repositories.length === 0
    || value.repositories.some((item) => typeof item !== "string" || !item.trim())) {
    throw new Error(`pod reservation has no valid repositories in ${file}`);
  }
  if (!["reserved", "prepared", "consumed"].includes(value.status)) {
    throw new Error(`pod reservation has invalid status in ${file}`);
  }
  return value;
}

export function listPodReservations(workspaceRoot) {
  const directory = podReservationDir(workspaceRoot);
  if (!existsSync(directory)) return { reservations: [], issues: [] };
  try {
    if (lstatSync(directory).isSymbolicLink()) {
      return {
        reservations: [],
        issues: [reservationIssue(directory, "pod reservation directory is a symbolic link")],
      };
    }
  } catch (error) {
    return { reservations: [], issues: [reservationIssue(directory, error)] };
  }
  const reservations = [];
  const issues = [];
  for (const name of readdirSync(directory).filter((item) => item.endsWith(".json")).sort()) {
    const file = path.join(directory, name);
    try {
      if (lstatSync(file).isSymbolicLink()) throw new Error("pod reservation file is a symbolic link");
      reservations.push({ file, value: validateReservation(JSON.parse(readFileSync(file, "utf8")), file) });
    } catch (error) {
      issues.push(reservationIssue(file, error));
    }
  }
  return { reservations, issues };
}

export function writePodReservation(workspaceRoot, value) {
  const directory = ensureReservationDir(workspaceRoot);
  const file = podReservationFile(workspaceRoot, value.demandKey);
  const next = validateReservation({
    kind: POD_RESERVATION_KIND,
    version: 1,
    ...value,
    repositories: [...new Set(value.repositories)].sort(),
  }, file);
  const temp = path.join(directory, `.${path.basename(file)}.tmp-${process.pid}-${Date.now()}`);
  writeFileSync(temp, `${JSON.stringify(next, null, 2)}\n`);
  renameSync(temp, file);
  return { file, value: next };
}

export function removePodReservation(workspaceRoot, demandKey) {
  const file = podReservationFile(workspaceRoot, demandKey);
  if (!existsSync(file)) return false;
  if (lstatSync(file).isSymbolicLink()) {
    throw new Error(`pod reservation file is a symbolic link: ${file}`);
  }
  rmSync(file);
  return true;
}
