import type { Sha256Digest } from "../../foundation/crypto/sha256.js";
import type { PortableResourcePath } from "../../foundation/filesystem/portable-resource-path.js";

/**
 * 两类Agent Report共享的最小Result词汇。
 *
 * `completed`只表示目标窗口完成了自身合同，不表示Controller acceptance。Evidence
 * locator只定位并绑定外部Artifact字节，不解释其内容或可信度。
 */

export type TargetResultOutcome = "completed" | "blocked" | "needs-review";

export interface TargetResultEvidenceLocator {
  readonly kind: string;
  readonly ref: PortableResourcePath;
  readonly digest: Sha256Digest;
}
