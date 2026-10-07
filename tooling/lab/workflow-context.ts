import { readFileSync } from "node:fs";
import path from "node:path";
import { isRecord } from "../verification/files.js";
import { LabError } from "./inventory.js";

export const BUSINESS_SCENARIOS = ["single-product", "dual-product", "worktree"] as const;
export type BusinessScenario = (typeof BUSINESS_SCENARIOS)[number];
export type LabCall = (
  name: string,
  args: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

export function assertLab(condition: unknown, code: string): asserts condition {
  if (!condition) throw new LabError(code);
}

export function recordAt(value: unknown, ...keys: string[]): Record<string, unknown> {
  let current = value;
  for (const key of keys) {
    assertLab(isRecord(current), "lab-scenario-result-shape");
    current = current[key];
  }
  assertLab(isRecord(current), "lab-scenario-result-shape");
  return current;
}

export function textAt(value: unknown, ...keys: string[]): string {
  const last = keys.at(-1);
  assertLab(last !== undefined, "lab-scenario-result-shape");
  const result = recordAt(value, ...keys.slice(0, -1))[last];
  assertLab(typeof result === "string" && result.length > 0, "lab-scenario-result-shape");
  return result;
}

export function rowsAt(value: unknown, key: string): Record<string, unknown>[] {
  const rows = recordAt(value)[key];
  assertLab(Array.isArray(rows), "lab-scenario-result-shape");
  return rows.map((row) => recordAt(row));
}

/** A bounded projection of the already MCP-validated fresh configuration, not another config authority. */
export function readLabConfig(root: string) {
  const document: unknown = JSON.parse(
    readFileSync(path.join(root, "wakeflow.config.json"), "utf8"),
  );
  const topology = recordAt(document, "topology");
  return {
    pods: rowsAt(document, "pods").map((pod) => ({
      podId: textAt(pod, "podId"),
      placement: textAt(pod, "placement"),
    })),
    topology: {
      repositories: rowsAt(topology, "repositories").map((item) => ({
        repositoryId: textAt(item, "repositoryId"),
        path: textAt(item, "path"),
        displayName: textAt(item, "displayName"),
      })),
      supportSurfaces: rowsAt(topology, "supportSurfaces").map((item) => ({
        surfaceId: textAt(item, "surfaceId"),
        capability: textAt(item, "capability"),
        path: textAt(item, "path"),
      })),
      windows: rowsAt(topology, "windows").map((item) => {
        const kind = textAt(item, "root", "kind");
        return {
          windowId: textAt(item, "windowId"),
          podId: textAt(item, "podId"),
          role: textAt(item, "role"),
          root: {
            kind,
            repositoryId: kind === "repository" ? textAt(item, "root", "repositoryId") : null,
          },
        };
      }),
    },
  };
}

export interface LabWindow {
  readonly id: string;
  readonly role: string;
  readonly handle: string;
  readonly cwd: string;
  readonly bindingId: string;
  readonly bindingDigest: string;
  readonly repositoryId: string | null;
  readonly repositoryName: string | null;
  readonly branch: string | null;
}

export interface WorkflowContext {
  readonly labRoot: string;
  readonly root: string;
  readonly artifact: string;
  readonly call: LabCall;
  readonly scenario: BusinessScenario;
  readonly signal: AbortSignal | undefined;
  readonly acts: string[];
  readonly windows: LabWindow[];
  podId: string;
  demandId: string;
  requirementId: string;
  recordDigest: string;
  members: string[];
}

export async function revision(context: WorkflowContext): Promise<number> {
  const status = await context.call("wakeflow_status", {
    root: context.root,
    demandId: context.demandId,
  });
  const value = recordAt(status, "route", "observedEventStream").streamRevision;
  assertLab(
    typeof value === "number" && Number.isSafeInteger(value),
    "lab-scenario-revision-missing",
  );
  return value;
}

export async function previewApply(
  context: Pick<WorkflowContext, "call" | "root">,
  tool: string,
  args: Record<string, unknown>,
) {
  const request = { root: context.root, ...args };
  const preview = await context.call(tool, { ...request, mode: "preview" });
  assertLab(preview.status === "ready", "lab-scenario-preview-blocked");
  return context.call(tool, {
    ...request,
    mode: "apply",
    planDigest: textAt(preview, "planDigest"),
  });
}

export function windowByRole(context: WorkflowContext, role: string): LabWindow {
  const window = context.windows.find((entry) => entry.role === role);
  assertLab(window !== undefined, "lab-scenario-window-missing");
  return window;
}
