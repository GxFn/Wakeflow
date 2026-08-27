import { parseByteCount } from "../../foundation/numeric/byte-count.js";

/**
 * Wakeflow Governance / Ledger：权威记录与短期事务资源的文件系统策略。
 *
 * 长期记录目录树由版本控制跟踪并允许共享，目录和文件直接使用最终的 `0755`、
 * `0644` 权限位。事务父目录、发布意图记录和锁文件属于运行时私有资源，分别使用
 * `0700`、`0600`。即使暂存目录树已经采用最终权限位，私有事务父目录仍会阻止
 * 其他用户访问其中内容。
 */

export const LEDGER_DURABLE_DIRECTORY_MODE = 0o755;
export const LEDGER_DURABLE_FILE_MODE = 0o644;
export const LEDGER_TRANSACTION_DIRECTORY_MODE = 0o700;
export const LEDGER_TRANSACTION_FILE_MODE = 0o600;

export const LEDGER_RECORD_PUBLICATION_LOCK_TIMEOUT_MILLISECONDS = 10_000;
export const LEDGER_AUTHORITY_RECORD_MAXIMUM_BYTES = parseByteCount(
  512 * 1024,
  "$ledger.recordMaximumBytes",
);
export const LEDGER_AUTHORITY_MEMBER_MAXIMUM_BYTES = parseByteCount(
  4 * 1024 * 1024,
  "$ledger.memberMaximumBytes",
);
export const LEDGER_AUTHORITY_TREE_MAXIMUM_BYTES = parseByteCount(
  16 * 1024 * 1024,
  "$ledger.treeMaximumBytes",
);
export const LEDGER_PUBLICATION_INTENT_MAXIMUM_BYTES = parseByteCount(
  1024 * 1024,
  "$ledger.publicationIntentMaximumBytes",
);

export const LEDGER_AUTHORITY_MAXIMUM_DOCUMENTS = 32;
export const LEDGER_AUTHORITY_MAXIMUM_TREE_FILES =
  LEDGER_AUTHORITY_MAXIMUM_DOCUMENTS + 1;
export const LEDGER_AUTHORITY_MAXIMUM_TREE_ENTRIES = 256;
export const LEDGER_AUTHORITY_MAXIMUM_TREE_DEPTH = 64;
