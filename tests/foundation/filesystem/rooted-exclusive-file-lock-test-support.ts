import { renderDeterministicJsonDocument } from "../../../src/foundation/data/deterministic-json-document.js";

interface RootedExclusiveFileLockRecordFixture {
  readonly pid?: number;
  readonly threadId?: number;
  readonly tokenUuid: string;
}

/** 仅供测试构造显式崩溃恢复残留，不参与生产锁签发或 owner-state 判断。 */
export function rootedExclusiveFileLockRecordTextForTest(
  fixture: Readonly<RootedExclusiveFileLockRecordFixture>,
): string {
  const pid = fixture.pid ?? 2_147_483_647;
  const workerThreadId = fixture.threadId ?? 0;
  return renderDeterministicJsonDocument({
    kind: "WakeflowExclusiveFileLock",
    ownerBirth: null,
    pid,
    registryId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    threadId: workerThreadId,
    token: `${pid}-${workerThreadId}-${fixture.tokenUuid}`,
    version: 2,
  });
}
