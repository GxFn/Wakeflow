import { equal } from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  isLocalFilesystemType,
  parseDfMountPoint,
  parseMountType,
  readFilesystemTypeName,
} from "../../../src/foundation/node/filesystem-type.js";
import { loadSensitive } from "../../support/load-sensitive.js";

/**
 * 级别 0（纯逻辑）加一次真实探测：一个路径所在卷的文件系统类型（open-items B11，ADR-0021）。
 *
 * 维护预览据此拒绝非本地文件系统。解析两份宿主命令的输出是这里要钉住的部分：挂载点可以带空格，类型是
 * `mount` 括号里的第一项；认不出的输出回答 null，而不是猜。
 */

const MOUNTS = [
  "/dev/disk3s1s1 on / (apfs, sealed, local, read-only, journaled)",
  "devfs on /dev (devfs, local, nobrowse)",
  "/dev/disk3s5 on /System/Volumes/Data (apfs, local, journaled, nobrowse, protect)",
  "//user@server/share on /Volumes/Team Share (smbfs, nodev, nosuid, mounted by user)",
  "server:/export on /Volumes/nfs (nfs, nodev, nosuid, automounted)",
  "/dev/disk5s1 on /Volumes/USB (exfat, local, nodev, nosuid, noowners)",
  "map auto_home on /System/Volumes/Data/home (autofs, automounted, nobrowse)",
].join("\n");

test("df 与 mount 的输出：挂载点取最后一列（可带空格），类型取括号里的第一项；认不出的回答 null", () => {
  equal(
    parseDfMountPoint(
      "Filesystem   512-blocks      Used Available Capacity  Mounted on\n/dev/disk3s5  965595304 806557344 101445560    89%    /System/Volumes/Data\n",
    ),
    "/System/Volumes/Data",
  );
  equal(
    parseDfMountPoint(
      "Filesystem 512-blocks Used Available Capacity Mounted on\n//user@server/share 1000 10 990 1% /Volumes/Team Share\n",
    ),
    "/Volumes/Team Share",
  );
  equal(parseDfMountPoint("df: no such file\n"), null);
  equal(parseDfMountPoint(""), null);

  equal(parseMountType(MOUNTS, "/"), "apfs");
  equal(parseMountType(MOUNTS, "/System/Volumes/Data"), "apfs");
  equal(parseMountType(MOUNTS, "/Volumes/Team Share"), "smbfs");
  equal(parseMountType(MOUNTS, "/Volumes/nfs"), "nfs");
  equal(parseMountType(MOUNTS, "/Volumes/USB"), "exfat");
  // 只认完整的挂载点：前缀相同的另一个挂载点不算。
  equal(parseMountType(MOUNTS, "/System/Volumes"), null);
  equal(parseMountType("", "/"), null);

  for (const local of ["apfs", "hfs"]) equal(isLocalFilesystemType(local), true, local);
  for (const other of ["smbfs", "nfs", "afpfs", "webdav", "exfat", "msdos", "autofs", ""]) {
    equal(isLocalFilesystemType(other), false, other);
  }
});

test("真实探测：macOS 上临时目录在本地卷上，还不存在的路径看它最近的已存在祖先；别的平台读不出", async (t) => {
  if (loadSensitive(t, "two real host commands per probe")) return;
  const existing = await readFilesystemTypeName(os.tmpdir());
  const missing = await readFilesystemTypeName(
    path.join(os.tmpdir(), "wakeflow-filesystem-type-missing", "a", "b"),
  );
  if (process.platform === "darwin") {
    equal(typeof existing, "string");
    equal(isLocalFilesystemType(existing ?? ""), true, String(existing));
    equal(missing, existing);
  } else {
    equal(existing, null);
    equal(missing, null);
  }
});
