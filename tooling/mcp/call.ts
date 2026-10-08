import { lstatSync, realpathSync } from "node:fs";
import path from "node:path";
import { verifyArtifactAgainstManifest } from "../artifacts/check-plugin-artifacts.js";
import { LabError } from "../lab/inventory.js";
import { type LabToolObservation, withLabMcp } from "../lab/mcp-session.js";
import { isRecord, readBoundedFile, sha256 } from "../verification/files.js";

/**
 * Wakeflow Tooling / MCP call：对一份制品副本启动一个新的 stdio 进程，调用一个公共工具一次。
 *
 * 它取代过去每个会话临时拼写的 `mcp-call.mjs`：制品先按自己的清单逐文件核验，工作区根必须是
 * 真实目录，结果里出现工作区绝对路径时按 `lab-public-path-disclosure` 拒绝。调用的是新进程，不能
 * 证明既有聊天里的 MCP 身份；变更类工具会真的改工作区，所以只对可丢弃工作区使用。
 */

export interface McpCallRequest {
  readonly candidate: string;
  readonly workspace: string;
  readonly tool: string;
  readonly arguments: Readonly<Record<string, unknown>>;
}

export interface McpCallResult {
  readonly kind: "WakeflowMcpCall";
  readonly schemaVersion: 1;
  readonly status: "passed" | "failed" | "unavailable";
  readonly candidate: Readonly<{ hostId: string; version: string; manifestDigest: string }>;
  readonly tool: string;
  readonly durationMs: number | null;
  readonly result: Readonly<Record<string, unknown>> | null;
  readonly mcpError: Readonly<{ code: string; reason: string }> | null;
  readonly reason: string | null;
  readonly runtime: "generated-stdio-new-process";
  readonly exitCode: 0 | 1 | 2;
}

const TOOL_NAME_PATTERN = /^wakeflow_[a-z_]{1,64}$/u;

function realDirectory(value: string, label: string): string {
  const resolved = path.resolve(value);
  const stat = lstatSync(resolved, { throwIfNoEntry: false });
  if (stat === undefined || !stat.isDirectory() || stat.isSymbolicLink())
    throw new Error(`${label} must be one real directory.`);
  const real = realpathSync(resolved);
  if (real !== resolved) throw new Error(`${label} must be given by its real path.`);
  return real;
}

/** `--input FILE` 或 `--arguments JSON`：一个 JSON 对象；`root` 由工作区参数给出，不能在这里覆盖。 */
export function parseToolArguments(
  root: string,
  input: Readonly<{ file?: string; inline?: string }>,
): Readonly<Record<string, unknown>> {
  if (input.file !== undefined && input.inline !== undefined)
    throw new Error("Give either --input FILE or --arguments JSON, not both.");
  const text =
    input.file !== undefined
      ? readBoundedFile(path.resolve(root, input.file), 1024 * 1024).toString("utf8")
      : (input.inline ?? "{}");
  const parsed: unknown = JSON.parse(text);
  if (!isRecord(parsed) || Array.isArray(parsed))
    throw new Error("Tool arguments must be one JSON object.");
  if ("root" in parsed) throw new Error("Tool arguments cannot carry root; use --root.");
  return parsed;
}

export async function callArtifactTool(
  request: McpCallRequest,
  signal?: AbortSignal,
): Promise<Readonly<McpCallResult>> {
  const candidate = realDirectory(request.candidate, "candidate artifact");
  const workspace = realDirectory(request.workspace, "workspace root");
  if (!TOOL_NAME_PATTERN.test(request.tool))
    throw new Error("Tool name must be one wakeflow_* public tool.");
  const artifact = verifyArtifactAgainstManifest(candidate);
  const { hostId, version } = artifact.manifest;
  if ((hostId !== "codex" && hostId !== "claude-code") || typeof version !== "string")
    throw new Error("Candidate artifact identity is unavailable.");
  const server = lstatSync(path.join(candidate, "mcp/server.mjs"), { throwIfNoEntry: false });
  if (server === undefined || !server.isFile())
    throw new Error("Candidate artifact has no mcp/server.mjs.");
  const identity = { hostId, version, manifestDigest: sha256(artifact.manifestBytes) };
  const observations: LabToolObservation[] = [];
  const finish = (
    status: McpCallResult["status"],
    reason: string | null,
    observation: LabToolObservation | undefined,
  ): Readonly<McpCallResult> =>
    Object.freeze({
      kind: "WakeflowMcpCall",
      schemaVersion: 1,
      status,
      candidate: identity,
      tool: request.tool,
      durationMs: observation?.durationMs ?? null,
      result: observation?.result ?? null,
      mcpError: observation?.mcpError ?? null,
      reason,
      runtime: "generated-stdio-new-process",
      exitCode: status === "passed" ? 0 : status === "failed" ? 1 : 2,
    });
  try {
    await withLabMcp(
      candidate,
      workspace,
      observations,
      (call) => call(request.tool, { root: workspace, ...request.arguments }),
      signal,
    );
    return finish("passed", null, observations[0]);
  } catch (error: unknown) {
    const observation = observations[0];
    if (error instanceof LabError && error.code === "lab-mcp-tool-failed")
      return finish("failed", error.code, observation);
    if (error instanceof LabError) return finish("unavailable", error.code, observation);
    throw error;
  }
}
