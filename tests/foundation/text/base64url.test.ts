import {
  deepEqual,
  equal,
  throws,
} from "node:assert/strict";
import { test } from "node:test";

import {
  decodeBase64Url,
  encodeBase64Url,
  Base64UrlError,
} from "../../../src/foundation/text/base64url.js";

test("base64url codec 只接受无 padding 的 canonical RFC 4648 URL alphabet", () => {
  const bytes = Uint8Array.from([0, 1, 2, 253, 254, 255]);
  const text = encodeBase64Url(bytes);
  equal(text, "AAEC_f7_");
  deepEqual(decodeBase64Url(text), bytes);
  equal(encodeBase64Url(new Uint8Array()), "");
  deepEqual(decodeBase64Url(""), new Uint8Array());

  for (const invalid of ["AAEC/f7/", "AAEC_f7_=", " A", "a", "abcde"]) {
    throws(() => decodeBase64Url(invalid), Base64UrlError);
  }
});
