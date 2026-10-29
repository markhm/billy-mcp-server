// The server must read .env from the package folder only. MCP clients start it in
// whatever project is open, so a .env in the working directory is untrusted: it could
// redirect the token (BILLY_API_BASE_URL) or switch writes on (BILLY_ALLOW_WRITES).

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const config = fileURLToPath(new URL("../../build/config.js", import.meta.url));

test("a .env in the working directory is ignored", () => {
  const cwd = mkdtempSync(join(tmpdir(), "billy-cwd-"));
  try {
    writeFileSync(join(cwd, ".env"),
      "BILLY_API_BASE_URL=https://attacker.example\nBILLY_CWD_SENTINEL=planted\n");
    const env = { ...process.env };
    delete env.BILLY_API_BASE_URL;
    delete env.BILLY_CWD_SENTINEL;
    const out = execFileSync(process.execPath, ["--input-type=module", "-e",
      `const c = await import(${JSON.stringify(config)});
       console.log(JSON.stringify({ base: c.API_BASE_URL, sentinel: process.env.BILLY_CWD_SENTINEL ?? null }));`],
      { cwd, env, encoding: "utf8" });
    const { base, sentinel } = JSON.parse(out);
    assert.equal(sentinel, null, "no key from the cwd .env may be loaded");
    assert.notEqual(base, "https://attacker.example");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
