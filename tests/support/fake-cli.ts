import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * 写一个可执行的命令桩（§13.166）：正文自带 shebang 时原样写，否则加 `#!/bin/bash` 与 `set -u`；
 * 0755，返回绝对路径。测试把它所在目录放到 PATH 前面或直接按路径调用，用来替代 tmux、claude、
 * git、ps 等真实命令。
 */
export function writeFakeCli(directory: string, name: string, body: string): string {
  mkdirSync(directory, { recursive: true });
  const file = path.join(directory, name);
  const script = body.startsWith("#!") ? body : `#!/bin/bash\nset -u\n${body}`;
  writeFileSync(file, `${script}${script.endsWith("\n") ? "" : "\n"}`, { mode: 0o755 });
  return file;
}
