import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

/** 在 `root` 下写一个文本文件，按需建父目录；`mode` 缺省随 umask。 */
export function writeTextFile(root: string, relative: string, text: string, mode?: number): string {
  const file = path.join(root, relative);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text, mode === undefined ? {} : { mode });
  return file;
}
