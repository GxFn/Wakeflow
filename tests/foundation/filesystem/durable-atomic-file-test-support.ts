import {
  parseDurableAtomicFileStageFileName,
  type DurableAtomicFileStageAddress,
} from "../../../src/foundation/filesystem/durable-atomic-file-stage-address.js";
import {
  parsePortableResourcePath,
  splitPortableResourcePath,
  type PortableResourcePath,
} from "../../../src/foundation/filesystem/portable-resource-path.js";

/** 仅供测试构造崩溃残留；生产代码不需要把 stage 暴露为逻辑资源引用。 */
export function durableAtomicFileStageRefForTest(
  targetResourcePathValue: unknown,
  addressValue: Readonly<DurableAtomicFileStageAddress>,
): PortableResourcePath {
  const targetResourcePath = parsePortableResourcePath(targetResourcePathValue);
  const address = parseDurableAtomicFileStageFileName(addressValue.fileName);
  const segments = splitPortableResourcePath(targetResourcePath);
  return parsePortableResourcePath(
    [...segments.slice(0, -1), address.fileName].join("/"),
  );
}
