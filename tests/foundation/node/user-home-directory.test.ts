import { equal, ok } from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { currentUserHomeDirectory } from "../../../src/foundation/node/user-home-directory.js";

test("当前用户家目录端口返回 Node 解析的绝对路径，内核不再直接取得 node:os（§13.166）", () => {
  const home = currentUserHomeDirectory();
  equal(home, os.homedir());
  ok(path.isAbsolute(home));
});
