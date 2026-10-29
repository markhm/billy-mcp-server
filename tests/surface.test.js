// Tool-surface tests: start the real server over stdio and check what an MCP client
// sees. Listing tools makes no Billy call, so a dummy token is enough.
//
// The golden file pins every tool's name, schema, description and annotations in
// both modes. After an intentional change, regenerate it:
//   UPDATE_SNAPSHOT=1 npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const repo = fileURLToPath(new URL("..", import.meta.url));
const golden = new URL("./fixtures/tool-surface.json", import.meta.url);
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

async function listTools(allowWrites) {
  const client = new Client({ name: "surface-test", version: "0" });
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: [`${repo}build/index.js`],
    cwd: repo,
    // Explicit values win over .env, so this never runs with the real token or writes.
    env: { ...process.env, BILLY_ACCESS_TOKEN: "dummy", BILLY_ALLOW_WRITES: allowWrites ? "true" : "" },
    stderr: "ignore",
  }));
  const server = client.getServerVersion();
  const { tools } = await client.listTools();
  await client.close();
  return { server, tools: tools.sort((a, b) => a.name.localeCompare(b.name)) };
}

const readOnly = await listTools(false);
const writes = await listTools(true);
const isWrite = (tool) => tool.annotations?.readOnlyHint !== true;

test("the tool surface matches the golden file", () => {
  const actual = { readonly: readOnly.tools, writes: writes.tools };
  if (process.env.UPDATE_SNAPSHOT) writeFileSync(golden, JSON.stringify(actual, null, 1) + "\n");
  assert.deepEqual(actual, JSON.parse(readFileSync(golden, "utf8")));
});

test("the server reports the package version", () => {
  assert.equal(writes.server.name, "billy-mcp-server");
  assert.equal(writes.server.version, pkg.version);
});

test("read-only mode exposes only read tools", () => {
  assert.equal(readOnly.tools.length, 16);
  assert.deepEqual(readOnly.tools.filter(isWrite).map((t) => t.name), []);
});

test("write mode adds exactly the nine write tools", () => {
  const added = writes.tools.filter((t) => !readOnly.tools.some((r) => r.name === t.name));
  assert.deepEqual(added.map((t) => t.name), [
    "billy_create_bill",
    "billy_create_contact",
    "billy_create_daybook_transaction",
    "billy_create_invoice",
    "billy_create_payment",
    "billy_create_product",
    "billy_delete_daybook_transaction",
    "billy_update_contact",
    "billy_update_invoice",
  ]);
  assert.ok(added.every(isWrite), "every added tool is annotated as a write");
});

test("every write tool dry-runs by default", () => {
  for (const tool of writes.tools.filter(isWrite)) {
    assert.equal(tool.inputSchema.properties?.dryRun?.default, true, `${tool.name} must default dryRun to true`);
    assert.ok(tool.outputSchema?.properties?.dryRun, `${tool.name} must declare dryRun in its output schema`);
  }
});

test("journal entries are created as drafts by default", () => {
  const tool = writes.tools.find((t) => t.name === "billy_create_daybook_transaction");
  assert.equal(tool.inputSchema.properties.state.default, "draft");
});

test("updates and deletes are flagged destructive, creates are not", () => {
  for (const tool of writes.tools.filter(isWrite)) {
    const destructive = /^billy_(update|delete)_/.test(tool.name);
    assert.equal(tool.annotations.destructiveHint, destructive, tool.name);
  }
});
