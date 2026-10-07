import { isRecord, readBoundedFile, sha256 } from "../verification/files.js";

export class LiveError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

export const DIGEST = /^sha256:[a-f0-9]{64}$/u;
export const WINDOW_ID = /^window_[a-f0-9-]{36}$/u;

export interface LiveWindow {
  readonly windowId: string;
  readonly role: string;
  readonly intentDigest: string;
  readonly executionRoot: string;
  readonly bindingStatus: "registered" | "unregistered";
  readonly bindingId: string | null;
  readonly instruction: Record<string, unknown>;
}

export interface LivePlan {
  readonly kind: "WakeflowLivePlan";
  readonly schemaVersion: 1;
  readonly scenario: "project-bootstrap";
  readonly root: string;
  readonly candidate: string;
  readonly artifactDigest: string;
  readonly configFileDigest: string;
  readonly configDigest: string;
  readonly host: string;
  readonly project: { readonly id: string; readonly hostId: string; readonly root: string };
  readonly windows: readonly LiveWindow[];
  readonly planDigest: string;
}

export function record(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new LiveError("live-invalid-document");
  return value;
}

export function textField(value: unknown, maximum = 4096): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximum ||
    [...value].some((character) => character.charCodeAt(0) < 32)
  )
    throw new LiveError("live-invalid-field");
  return value;
}

/** Raw local files are imported observations, even when a field claims verified provenance. */
export function readDocument(file: string): Record<string, unknown> {
  return record(JSON.parse(readBoundedFile(file, 4 * 1024 * 1024).toString("utf8")));
}

export function unwrapResult(value: unknown): Record<string, unknown> {
  const result = record(value);
  if (result.isError === true) throw new LiveError("live-imported-tool-error");
  if (isRecord(result.structuredContent)) return result.structuredContent;
  if (Array.isArray(result.content)) {
    if (result.content.length !== 1) throw new LiveError("live-ambiguous-tool-result");
    const first = record(result.content[0]);
    if (first.type !== "text" || typeof first.text !== "string")
      throw new LiveError("live-invalid-tool-result");
    return record(JSON.parse(first.text));
  }
  return result;
}

export function parsePlan(value: unknown): LivePlan {
  const p = record(value);
  if (p.kind !== "WakeflowLivePlan" || p.schemaVersion !== 1 || p.scenario !== "project-bootstrap")
    throw new LiveError("live-invalid-plan");
  const { planDigest, ...body } = p;
  if (
    typeof planDigest !== "string" ||
    !DIGEST.test(planDigest) ||
    sha256(JSON.stringify(body)) !== planDigest
  )
    throw new LiveError("live-plan-digest-mismatch");
  for (const key of ["root", "candidate", "host"]) textField(p[key]);
  for (const key of ["artifactDigest", "configFileDigest", "configDigest"])
    if (!DIGEST.test(textField(p[key]))) throw new LiveError("live-invalid-plan");
  const project = record(p.project);
  for (const key of ["id", "hostId", "root"]) textField(project[key]);
  if (!Array.isArray(p.windows) || p.windows.length === 0 || p.windows.length > 64)
    throw new LiveError("live-invalid-plan");
  const ids = new Set<string>();
  for (const value of p.windows) {
    const window = record(value);
    const id = textField(window.windowId);
    if (
      !WINDOW_ID.test(id) ||
      ids.has(id) ||
      !DIGEST.test(textField(window.intentDigest)) ||
      !["registered", "unregistered"].includes(textField(window.bindingStatus))
    )
      throw new LiveError("live-invalid-plan");
    ids.add(id);
    textField(window.role);
    textField(window.executionRoot);
    record(window.instruction);
    if (window.bindingId !== null) textField(window.bindingId);
  }
  return p as unknown as LivePlan;
}
