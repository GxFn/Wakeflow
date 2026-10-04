import { spawn } from "node:child_process";

/** 用真实子进程持有 Foundation 锁；SIGKILL 留下真实残留，end 则正常释放。 */
export async function holdLockInChildProcess(root: string, resourcePath: string) {
  const directoryModule = new URL(
    "../../src/foundation/filesystem/rooted-directory.js",
    import.meta.url,
  );
  const lockModule = new URL(
    "../../src/foundation/filesystem/rooted-exclusive-file-lock.js",
    import.meta.url,
  );
  const program = `
    import { RootedDirectory } from ${JSON.stringify(directoryModule.href)};
    import { withRootedExclusiveFileLock } from ${JSON.stringify(lockModule.href)};
    const root = await RootedDirectory.open(process.argv[1]);
    try {
      await withRootedExclusiveFileLock(root, process.argv[2], async () => {
        process.stdout.write("held\\n");
        await new Promise(resolve => process.stdin.once("data", resolve));
      });
    } finally { await root.close(); process.stdin.destroy(); }
  `;
  const child = spawn(
    process.execPath,
    ["--input-type=module", "-e", program, root, resourcePath],
    {
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  const exited = new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code !== 0 && signal !== "SIGKILL") reject(new Error(`Lock holder failed: ${stderr}`));
      else resolve();
    });
  });
  await Promise.race([
    new Promise<void>((resolve) => child.stdout.once("data", () => resolve())),
    exited.then(() => {
      throw new Error("Lock holder exited before acquisition.");
    }),
  ]);
  return Object.freeze({
    async crash() {
      child.kill("SIGKILL");
      await exited;
    },
    async close() {
      if (child.exitCode === null && child.signalCode === null) child.stdin.end("release\n");
      await exited;
    },
  });
}
