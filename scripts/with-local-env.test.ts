import assert from "node:assert/strict";
import { test } from "node:test";

import { localCommandEnv, parseEnvFile } from "./with-local-env.ts";

test("parses local dev var files", () => {
  const env = parseEnvFile(`
    # comment
    O11YFLEET_API_BEARER_SECRET = "secret-value"
    O11YFLEET_CLAIM_HMAC_SECRET='claim-value'
    QUOTED="secret \\"with quotes\\""
    MULTILINE="line one
line two"
    INDENTED_MULTILINE="line one
  line two"
    EMPTY=
    MALFORMED
  `);

  assert.deepEqual(env, {
    O11YFLEET_API_BEARER_SECRET: "secret-value",
    O11YFLEET_CLAIM_HMAC_SECRET: "claim-value",
    QUOTED: 'secret "with quotes"',
    MULTILINE: "line one\nline two",
    INDENTED_MULTILINE: "line one\n  line two",
    EMPTY: "",
  });
});

test("keeps shell environment values ahead of local dev vars", () => {
  const originalApiSecret = process.env.O11YFLEET_API_BEARER_SECRET;
  const originalO11yFleetApiKey = process.env.O11YFLEET_API_KEY;
  const originalFpApiKey = process.env.FP_API_KEY;
  const originalPath = process.env.PATH;
  try {
    process.env.O11YFLEET_API_BEARER_SECRET = "shell-secret";
    delete process.env.O11YFLEET_API_KEY;
    delete process.env.FP_API_KEY;
    process.env.PATH = "shell-path";

    const env = localCommandEnv({
      O11YFLEET_API_BEARER_SECRET: "local-secret",
      PATH: "local-path",
    });

    assert.equal(env.O11YFLEET_API_BEARER_SECRET, "shell-secret");
    assert.equal(env.PATH, "shell-path");
    assert.equal(env.O11YFLEET_API_KEY, "shell-secret");
    assert.equal(env.FP_API_KEY, "shell-secret");
  } finally {
    if (originalApiSecret === undefined) {
      delete process.env.O11YFLEET_API_BEARER_SECRET;
    } else {
      process.env.O11YFLEET_API_BEARER_SECRET = originalApiSecret;
    }
    if (originalO11yFleetApiKey === undefined) {
      delete process.env.O11YFLEET_API_KEY;
    } else {
      process.env.O11YFLEET_API_KEY = originalO11yFleetApiKey;
    }
    if (originalFpApiKey === undefined) {
      delete process.env.FP_API_KEY;
    } else {
      process.env.FP_API_KEY = originalFpApiKey;
    }
    if (originalPath === undefined) {
      delete process.env.PATH;
    } else {
      process.env.PATH = originalPath;
    }
  }
});
