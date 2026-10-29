#!/usr/bin/env node

/**
 * Billy MCP Server
 *
 * Exposes Billy's accounting API (v2) as MCP tools over stdio.
 * Docs: https://www.billy.dk/api/
 *
 * config.ts loads .env and the write switch; client.ts talks to Billy; each
 * tools/<resource>.ts registers the tools for one part of the API.
 */

import { McpServer, type RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { READ_ONLY, SERVER_VERSION } from "./config.js";
import { registerOrganizationTools } from "./tools/organization.js";
import { registerContactsTools } from "./tools/contacts.js";
import { registerInvoicesTools } from "./tools/invoices.js";
import { registerProductsTools } from "./tools/products.js";
import { registerPaymentsTools } from "./tools/payments.js";
import { registerBillsTools } from "./tools/bills.js";
import { registerAccountsTools } from "./tools/accounts.js";
import { registerVatTools } from "./tools/vat.js";
import { registerPostingsTools } from "./tools/postings.js";
import { registerDaybookTools } from "./tools/daybook.js";

const server = new McpServer({ name: "billy-mcp-server", version: SERVER_VERSION });

/** Mutating tools, tracked so they can be unregistered unless writes are enabled. */
const writeTools: RegisteredTool[] = [];

for (const register of [
  registerOrganizationTools,
  registerContactsTools,
  registerInvoicesTools,
  registerProductsTools,
  registerPaymentsTools,
  registerBillsTools,
  registerAccountsTools,
  registerVatTools,
  registerPostingsTools,
  registerDaybookTools,
]) {
  register({ server, writeTools });
}

if (READ_ONLY) {
  for (const tool of writeTools) tool.remove();
}

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    `Billy MCP Server ${SERVER_VERSION} running on stdio ` +
      (READ_ONLY
        ? `(read-only: ${writeTools.length} write tools disabled)`
        : `(BILLY_ALLOW_WRITES is set: ${writeTools.length} write tools enabled)`)
  );
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
