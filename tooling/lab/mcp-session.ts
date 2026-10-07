import path from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { isRecord, safeErrorCode } from "../verification/files.js";
import { LabError } from "./inventory.js";

/** SDK connect failure can start close without awaiting it. All callers share the same
 * teardown, including the final child close event after a forced kill. */
class AwaitedStdioTransport extends StdioClientTransport {
  #closing: Promise<void> | undefined;
  #shutdownVerified = false;

  assertShutdownVerified(): void {
    if (!this.#shutdownVerified) throw new LabError("lab-mcp-shutdown-unverified");
  }

  override close(): Promise<void> {
    if (this.#closing !== undefined) return this.#closing;
    const hadProcess = this.pid !== null;
    const closed = Promise.withResolvers<void>();
    const previous = this.onclose;
    this.onclose = () => {
      closed.resolve();
      previous?.();
    };
    this.#closing = (async () => {
      try {
        await super.close();
        if (hadProcess) {
          let timer: ReturnType<typeof setTimeout> | undefined;
          try {
            await Promise.race([
              closed.promise,
              new Promise<never>((_resolve, reject) => {
                timer = setTimeout(() => reject(new LabError("lab-mcp-shutdown-unverified")), 5000);
              }),
            ]);
          } finally {
            if (timer !== undefined) clearTimeout(timer);
          }
        }
        this.#shutdownVerified = true;
      } catch {
        // SDK handshake error discards Client.close()'s Promise. Defer the error to
        // the owning finally block, avoiding an unhandled rejection in that SDK path.
        this.#shutdownVerified = false;
      }
    })();
    return this.#closing;
  }
}

export interface LabToolObservation {
  readonly tool: string;
  readonly durationMs: number;
  readonly status: "passed" | "failed";
  readonly result?: Record<string, unknown>;
  readonly reason?: string;
  readonly mcpError?: { readonly code: string; readonly reason: string };
}

function publicError(value: unknown): { code: string; reason: string } | undefined {
  if (!isRecord(value) || !isRecord(value.error) || value.kind !== "WakeflowMcpError")
    return undefined;
  const { code, reason } = value.error;
  const token = /^[a-z][a-z0-9-]{0,79}$/u;
  return typeof code === "string" &&
    token.test(code) &&
    typeof reason === "string" &&
    token.test(reason)
    ? { code, reason }
    : undefined;
}

/** A newly launched generated stdio process; never evidence about a native chat's MCP process. */
export async function withLabMcp<T>(
  artifact: string,
  privateRoot: string,
  observations: LabToolObservation[],
  action: (
    call: (name: string, args: Record<string, unknown>) => Promise<Record<string, unknown>>,
  ) => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  signal?.throwIfAborted();
  const transport = new AwaitedStdioTransport({
    command: process.execPath,
    args: [path.join(artifact, "mcp/server.mjs")],
    cwd: artifact,
    env: { PATH: process.env.PATH ?? "" },
    stderr: "pipe",
    maxBufferSize: 4 * 1024 * 1024,
  });
  // Retain no arbitrary stderr in the shareable observation. Drain it with constant memory.
  let stderrBytes = 0;
  transport.stderr?.on("data", (chunk: Buffer) => {
    stderrBytes = Math.min(1024 * 1024, stderrBytes + chunk.length);
  });
  const client = new Client({ name: "wakeflow-disposable-lab", version: "1.0.0" });
  const options = { timeout: 60_000, ...(signal === undefined ? {} : { signal }) };
  // SDK requests observe the signal; finally awaits even an SDK-initiated teardown.
  try {
    await client.connect(transport, options);
    const result = await action(async (name, args) => {
      signal?.throwIfAborted();
      const start = performance.now();
      let mcpError: { code: string; reason: string } | undefined;
      try {
        const result = await client.callTool({ name, arguments: args }, options);
        if (result.isError === true) {
          const first = result.content[0];
          if (first?.type === "text" && first.text.length < 65_536) {
            try {
              mcpError = publicError(JSON.parse(first.text));
            } catch {
              /* Unknown error text is never copied to the report. */
            }
          }
          throw new LabError("lab-mcp-tool-failed");
        }
        if (!isRecord(result.structuredContent)) throw new LabError("lab-mcp-tool-failed");
        if (JSON.stringify(result).includes(privateRoot))
          throw new LabError("lab-public-path-disclosure");
        observations.push({
          tool: name,
          status: "passed",
          durationMs: Math.round(performance.now() - start),
          result: result.structuredContent,
        });
        return result.structuredContent;
      } catch (error: unknown) {
        observations.push({
          tool: name,
          status: "failed",
          durationMs: Math.round(performance.now() - start),
          reason: safeErrorCode(error),
          ...(mcpError === undefined ? {} : { mcpError }),
        });
        throw error;
      }
    });
    if (stderrBytes !== 0) throw new LabError("lab-mcp-stderr-observed");
    return result;
  } finally {
    try {
      await client.close();
    } finally {
      await transport.close();
      transport.assertShutdownVerified();
    }
  }
}
