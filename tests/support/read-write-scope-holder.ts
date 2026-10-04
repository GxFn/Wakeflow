import { RootedDirectory } from "../../src/foundation/filesystem/rooted-directory.js";
import { parsePortableResourcePath } from "../../src/foundation/filesystem/portable-resource-path.js";
import { withRootedReadWriteScope } from "../../src/foundation/filesystem/rooted-read-write-scope.js";

const base = process.argv[2];
if (base === undefined) throw new Error("Missing disposable fixture root.");
const root = await RootedDirectory.open(base);
try {
  await withRootedReadWriteScope(
    root,
    parsePortableResourcePath("admission"),
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
