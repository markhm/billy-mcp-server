// Every write tool must dry-run when called without dryRun. The schema default alone
// does not prove it: a handler that forgets to pass dryRun to call() would send for
// real while every schema test stays green.
//
// The server runs against a local stub of the Billy API. The stub answers the reads
// the write tools need (accounts, daybooks, organisation, one draft entry) and records
// every write. A dry run must produce no write at all.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const repo = fileURLToPath(new URL("..", import.meta.url));
const writes = [];

const READS = {
  "/organization": { organization: { id: "ORG", baseCurrencyId: "DKK" } },
  "/accounts": { meta: { paging: { pageCount: 1 } }, accounts: [
    { id: "ACC7120", accountNo: 7120, name: "Transferred Result" },
    { id: "ACC7161", accountNo: 7161, name: "Betalt udbytte" },
  ] },
  "/daybooks": { meta: { paging: { pageCount: 1 } }, daybooks: [{ id: "DB1", name: "Standardkassekladde" }] },
  "/daybookTransactions/T1": { daybookTransaction: { id: "T1", state: "draft", entryDate: "2026-01-01" } },
};

const billy = createServer((req, res) => {
  const path = new URL(req.url, "http://stub").pathname.replace(/^\/v2/, "");
  res.setHeader("Content-Type", "application/json");
  if (req.method !== "GET") {
    writes.push(`${req.method} ${path}`);
    res.statusCode = 500;
    return res.end(JSON.stringify({ errorMessage: "stub refuses writes" }));
  }
  res.end(JSON.stringify(READS[path] ?? {}));
});

let client;

before(async () => {
  await new Promise((ok) => billy.listen(0, "127.0.0.1", ok));
  client = new Client({ name: "handler-test", version: "0" });
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: [`${repo}build/index.js`],
    cwd: repo,
    env: {
      ...process.env,
      BILLY_ACCESS_TOKEN: "dummy",
      BILLY_ALLOW_WRITES: "true",
      BILLY_API_BASE_URL: `http://127.0.0.1:${billy.address().port}/v2`,
      BILLY_ORGANIZATION_ID: "",
    },
    stderr: "ignore",
  }));
});

after(async () => {
  await client?.close();
  billy.close();
});

// Minimal valid arguments for each write tool, without dryRun.
const CALLS = {
  billy_create_contact: { name: "X", countryId: "DK" },
  billy_update_contact: { id: "C1", name: "Y" },
  billy_create_invoice: { contactId: "C1", entryDate: "2026-01-01", currencyId: "DKK", lines: [{ productId: "P1", unitPrice: 1 }] },
  billy_update_invoice: { id: "I1", contactMessage: "x" },
  billy_create_product: { name: "X" },
  billy_create_payment: { entryDate: "2026-01-01", cashAmount: 1, cashSide: "debit", cashAccountId: "ACC", associations: [{ subjectReference: "invoice:I1" }] },
  billy_create_bill: { contactId: "C1", entryDate: "2026-01-01", currencyId: "DKK", lines: [{ accountId: "ACC7120", amount: 1 }] },
  billy_create_daybook_transaction: { entryDate: "2026-01-01", lines: [{ account: "7120", contraAccount: "7161", side: "debit", amount: 1 }] },
  billy_delete_daybook_transaction: { id: "T1" },
};

test("this test covers every write tool the server exposes", async () => {
  const { tools } = await client.listTools();
  const writeTools = tools.filter((t) => t.annotations?.readOnlyHint !== true).map((t) => t.name).sort();
  assert.deepEqual(Object.keys(CALLS).sort(), writeTools, "add new write tools to CALLS");
});

for (const [name, args] of Object.entries(CALLS)) {
  test(`${name} dry-runs when dryRun is omitted, and sends nothing`, async () => {
    const before_writes = writes.length;
    const res = await client.callTool({ name, arguments: args });
    assert.ok(!res.isError, res.content[0].text);
    assert.equal(res.structuredContent.dryRun, true);
    assert.equal(res.structuredContent.request.method === "GET", false);
    assert.equal(writes.length, before_writes, `${name} sent ${writes.slice(before_writes).join(", ")}`);
  });
}

test("control: dryRun: false really sends, so the stub would catch a leak", async () => {
  const before_writes = writes.length;
  const res = await client.callTool({ name: "billy_create_contact", arguments: { name: "X", countryId: "DK", dryRun: false } });
  assert.ok(res.isError && /stub refuses writes/.test(res.content[0].text));
  assert.deepEqual(writes.slice(before_writes), ["POST /contacts"]);
});
