// Environment and server-wide settings. Loads .env before anything reads process.env.

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Load a .env file if one exists, so the token can live in .env rather than being
 * exported by hand. Real environment variables always take precedence, so an MCP
 * client's `env` block is never shadowed by a stale .env.
 *
 * Reads only the .env next to the package (where .env.example lives), never one in
 * the working directory. MCP clients spawn the server in whatever project is open,
 * and a .env planted in an untrusted repo could otherwise set BILLY_API_BASE_URL
 * (sending the token elsewhere) or BILLY_ALLOW_WRITES (turning writes on unseen).
 */
function loadDotEnv(): void {
  const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  try {
    process.loadEnvFile(resolve(packageRoot, ".env"));
  } catch {
    // Absent or unreadable; environment variables remain the primary source.
  }
}

loadDotEnv();

export const API_BASE_URL = process.env.BILLY_API_BASE_URL ?? "https://api.billysbilling.com/v2";
export const SERVER_VERSION = "2.0.0";

const TRUTHY = /^(1|true|yes|on)$/i;

/**
 * Writes are opt-in. Billy has no scoped or read-only access tokens and no read-only
 * user role, so every token can write and this server is the only place the
 * restriction can be enforced. It defaults to refusing, and enforces that twice:
 * mutating tools are not registered at all, and BillyClient refuses any non-GET
 * request. Set BILLY_ALLOW_WRITES=true to enable the mutating tools.
 */
export const ALLOW_WRITES = TRUTHY.test(process.env.BILLY_ALLOW_WRITES?.trim() ?? "");
export const READ_ONLY = !ALLOW_WRITES;

// BILLY_READ_ONLY was the opt-in flag before writes became opt-out. Setting it no
// longer does anything, and `BILLY_READ_ONLY=false` no longer enables writes.
if (process.env.BILLY_READ_ONLY !== undefined) {
  console.error(
    "Warning: BILLY_READ_ONLY is no longer used. Read-only is now the default; " +
      "set BILLY_ALLOW_WRITES=true to enable the mutating tools."
  );
}
