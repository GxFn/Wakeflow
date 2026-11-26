import { parsePortableResourcePath } from "../../src/foundation/filesystem/portable-resource-path.js";
import { RootedDirectory } from "../../src/foundation/filesystem/rooted-directory.js";
import { withRootedReadWriteScope } from "../../src/foundation/filesystem/rooted-read-write-scope.js";

/** 子进程：以共享方式进入 `<root>/admission` 下的读写作用域并一直停在里面，直到被杀。 */
const base = process.argv[2];
if (base === undefined) throw new Error("Missing disposable fixture root.");
const root = await RootedDirectory.open(base);
try {
  await withRootedReadWriteScope(
    root,
    {
      gate: parsePortableResourcePath("admission/gate.lock"),
      scope: parsePortableResourcePath("admission/scope.lock"),
    },
    "shared",
    async () => {
      process.stdout.write("held\n");
      await new Promise<void>(() => {
        setInterval(() => {}, 1000);
      });
    },
  );
} finally {
  await root.close();
}
