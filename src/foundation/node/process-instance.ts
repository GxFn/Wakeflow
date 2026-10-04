import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { computeCanonicalJsonSha256Digest } from "../crypto/canonical-json-sha256.js";
import type { Sha256Digest } from "../crypto/sha256.js";
import { readNodeSystemErrorCode } from "./node-system-error.js";

/** OS process birth evidence. A matching coarse timestamp never authorizes retirement. */
export interface ProcessInstanceObservation {
  readonly state: "active" | "inactive" | "unknown";
  readonly birthDigest: Sha256Digest | null;
}

const execute = promisify(execFile);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
let boot: Promise<string | null> | undefined;
let ownBirth: Promise<Sha256Digest | null> | undefined;

async function command(file: string, args: readonly string[]): Promise<string> {
  const result = await execute(file, [...args], {
    encoding: "utf8", timeout: 2_000, maxBuffer: 4096,
    env: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", LC_ALL: "C", TZ: "UTC" },
  });
  return result.stdout.trim();
}

async function bootIdentity(): Promise<string | null> {
  try {
    const value = process.platform === "linux"
      ? (await readFile("/proc/sys/kernel/random/boot_id", "utf8")).trim()
      : process.platform === "darwin"
        ? await command("/usr/sbin/sysctl", ["-n", "kern.bootsessionuuid"])
        : "";
    return UUID.test(value) ? value.toLowerCase() : null;
  } catch { return null; }
}

async function readBirth(pid: number): Promise<Sha256Digest | null> {
  try {
    boot ??= bootIdentity();
    const bootId = await boot;
    if (bootId === null) return null;
    let started: string;
    if (process.platform === "linux") {
      const stat = await readFile(`/proc/${pid}/stat`, "utf8");
      if (stat.length > 8192 || !stat.startsWith(`${pid} (`)) return null;
      started = stat.slice(stat.lastIndexOf(")") + 2).trim().split(/\s+/u)[19] ?? "";
      if (!/^[0-9]+$/u.test(started)) return null;
    } else if (process.platform === "darwin") {
      started = await command("/bin/ps", ["-p", String(pid), "-o", "lstart="]);
      if (!/^[A-Z][a-z]{2}\s+[A-Z][a-z]{2}\s+[0-9]{1,2}\s+[0-9]{2}:[0-9]{2}:[0-9]{2}\s+[0-9]{4}$/u.test(started)) return null;
    } else { return null; }
    return computeCanonicalJsonSha256Digest({ platform: process.platform, bootId, pid, started });
  } catch { return null; }
}

/** Unknown platforms/permissions remain unknown; elapsed time is never death evidence. */
export async function observeProcessInstance(pid: number): Promise<Readonly<ProcessInstanceObservation>> {
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new TypeError("Invalid process identifier.");
  let state: ProcessInstanceObservation["state"] = "active";
  try { process.kill(pid, 0); }
  catch (error: unknown) {
    if (readNodeSystemErrorCode(error) === "ESRCH") return Object.freeze({ state: "inactive", birthDigest: null });
    state = "unknown";
  }
  if (pid === process.pid && ownBirth === undefined) ownBirth = readBirth(pid);
  const birth = pid === process.pid ? ownBirth : readBirth(pid);
  const birthDigest = (await birth) ?? null;
  return Object.freeze({ state, birthDigest });
}

/** A different positively observed birth proves the recorded process no longer exists. */
export function recordedProcessIsInactive(
  recordedBirth: Sha256Digest | null,
  current: Readonly<ProcessInstanceObservation>,
): boolean {
  return current.state === "inactive" ||
    (recordedBirth !== null && current.birthDigest !== null && recordedBirth !== current.birthDigest);
}
