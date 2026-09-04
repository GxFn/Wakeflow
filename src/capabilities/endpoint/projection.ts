import type { Sha256Digest } from "../../foundation/crypto/sha256.js";
import { readDeterministicJsonFile } from "../../foundation/filesystem/deterministic-json-file.js";
import {
  createFileAtomically,
  DurableAtomicFileWriteError,
  replaceFileAtomically,
} from "../../foundation/filesystem/durable-atomic-file-write.js";
import type { PortableResourcePath } from "../../foundation/filesystem/portable-resource-path.js";
import type { RootedDirectory } from "../../foundation/filesystem/rooted-directory.js";
import { StableFileReadError } from "../../foundation/filesystem/stable-file-read.js";
import { parseByteCount } from "../../foundation/numeric/byte-count.js";
import { encodeUtf8 } from "../../foundation/text/utf8.js";
import { fail } from "../../kernel/error.js";
import type { NextProjection } from "../../kernel/next-projection.js";
import { WAKEFLOW_WINDOW_HOST_BINDING_PUBLIC_TOOL_NAME } from "./contract.js";

/**
 * Wakeflow Capabilities / Endpoint：窗口运行投影的写入与 `next` 派生。
 *
 * 投影是派生数据：登记、替换、退役都用当前权威重算一份文档并整体替换；
 * 文档由旧投影模块编译，本模块只负责落盘与下一步。
 */

const PROJECTION_MAXIMUM_BYTES = parseByteCount(256 * 1024, "$projection.maximumBytes");
const FILE_MODE = 0o600;

export interface ProjectionDocument {
  readonly resourceRef: PortableResourcePath;
  readonly document: string;
  readonly documentDigest: Sha256Digest;
  readonly projectionDigest: Sha256Digest;
}

export interface ProjectionReceipt {
  readonly resourceRef: PortableResourcePath;
  readonly projectionDigest: Sha256Digest;
  readonly documentDigest: Sha256Digest;
}

/** 让磁盘上的投影文档等于目标文档；已相等则不写。 */
export async function publishProjectionDocument(
  root: RootedDirectory,
  target: Readonly<ProjectionDocument>,
  signal: AbortSignal | undefined,
): Promise<Readonly<ProjectionReceipt>> {
  const options = signal === undefined ? {} : { signal };
  let current: Awaited<ReturnType<typeof readDeterministicJsonFile>> | null = null;
  try {
    current = await readDeterministicJsonFile(root, target.resourceRef, {
      maximumBytes: PROJECTION_MAXIMUM_BYTES,
      ...options,
    });
  } catch (error: unknown) {
    if (!(error instanceof StableFileReadError && error.reason === "not-found")) {
      if (error instanceof StableFileReadError) {
        fail("io-failure", `projection-read-${error.reason}`, "$projection", { cause: error });
      }
      throw error;
    }
  }
  const bytes = encodeUtf8(target.document, "$projection");
  try {
    if (current === null) {
      await createFileAtomically(root, target.resourceRef, bytes, { mode: FILE_MODE, ...options });
    } else if (current.text !== target.document) {
      await replaceFileAtomically(root, target.resourceRef, bytes, {
        mode: FILE_MODE,
        expected: {
          resourcePath: current.resourcePath,
          node: current.node,
          byteCount: current.byteCount,
          digest: current.digest,
        },
        ...options,
      });
    }
  } catch (error: unknown) {
    if (error instanceof DurableAtomicFileWriteError) {
      fail("io-failure", `projection-write-${error.reason}`, "$projection", { cause: error });
    }
    throw error;
  }
  return Object.freeze({
    resourceRef: target.resourceRef,
    projectionDigest: target.projectionDigest,
    documentDigest: target.documentDigest,
  });
}

export interface EndpointNextInput {
  readonly registered: boolean;
  readonly claimHeld: boolean;
  readonly claimExpired: boolean;
  /** 本宿主下仍未登记的其他窗口。 */
  readonly unregisteredWindowIds: readonly string[];
}

/** 端点切片对 `next` 的贡献：先登记完所有窗口，再处理过期的工作声明。 */
export function deriveEndpointNext(input: Readonly<EndpointNextInput>): Readonly<NextProjection> {
  if (!input.registered) {
    return Object.freeze({
      frontier: "window-registration",
      owner: "user",
      suggestedTool: WAKEFLOW_WINDOW_HOST_BINDING_PUBLIC_TOOL_NAME,
      blockers: Object.freeze([]),
    });
  }
  if (input.claimHeld && input.claimExpired) {
    return Object.freeze({
      frontier: "work-claim-recovery",
      owner: "controller",
      suggestedTool: WAKEFLOW_WINDOW_HOST_BINDING_PUBLIC_TOOL_NAME,
      blockers: Object.freeze([]),
    });
  }
  if (input.unregisteredWindowIds.length > 0) {
    return Object.freeze({
      frontier: "window-registration",
      owner: "user",
      suggestedTool: WAKEFLOW_WINDOW_HOST_BINDING_PUBLIC_TOOL_NAME,
      blockers: Object.freeze([...input.unregisteredWindowIds].slice(0, 32)),
    });
  }
  return Object.freeze({
    frontier: null,
    owner: "none",
    suggestedTool: null,
    blockers: Object.freeze([]),
  });
}
