// Live tests against the real Billy account from .env. Opt-in, because they need a
// token and network access:
//   npm run test:live
//
// Every write call here is a dry run (the default), and the last test checks that the
// daybook count did not change, so nothing is ever written. Account numbers and IDs
// are MHM Consult ApS's chart of accounts.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const repo = fileURLToPath(new URL("../..", import.meta.url));
const skip = process.env.BILLY_LIVE_TESTS !== "1" && "set BILLY_LIVE_TESTS=1 (npm run test:live) to run against the live account";

let client, before_count;

async function connect() {
  const c = new Client({ name: "live-test", version: "0" });
  // The token comes from .env; writes are enabled so the write tools exist, but each call dry-runs.
  await c.connect(new StdioClientTransport({
    command: process.execPath,
    args: [`${repo}build/index.js`],
    cwd: repo,
    env: { ...process.env, BILLY_ALLOW_WRITES: "true" },
    stderr: "ignore",
  }));
  return c;
}

const call = (name, args = {}) => client.callTool({ name, arguments: args });
const daybookCount = async () => (await call("billy_list_daybook_transactions")).structuredContent.retrieved;

before(async () => {
  if (skip) return;
  client = await connect();
  before_count = await daybookCount();
});

after(async () => client?.close());

test("reads the organisation", { skip }, async () => {
  const res = await call("billy_get_organization");
  assert.ok(!res.isError, res.content[0].text);
  assert.ok(res.structuredContent.organization?.id);
});

test("date-filtered invoice list narrows the result", { skip }, async () => {
  const res = await call("billy_list_invoices", { fromDate: "2026-08-01", toDate: "2026-08-31" });
  assert.ok(!res.isError, res.content[0].text);
  assert.ok(res.structuredContent.invoices.every((i) => i.entryDate >= "2026-08-01" && i.entryDate <= "2026-08-31"));
});

test("a journal entry dry-runs with resolved accounts and a draft state", { skip }, async () => {
  const res = await call("billy_create_daybook_transaction", {
    entryDate: "2025-12-21",
    lines: [{ account: "7120", side: "debit", amount: 135000 }, { account: "7161", side: "credit", amount: 135000 }],
  });
  assert.ok(!res.isError, res.content[0].text);
  const { dryRun, request, preview } = res.structuredContent;
  assert.equal(dryRun, true);
  assert.equal(request.method, "POST");
  assert.equal(request.endpoint, "/daybookTransactions");
  assert.equal(request.body.daybookTransaction.state, "draft");
  assert.deepEqual(preview.lines.map((l) => l.account), ["7120 Transferred Result", "7161 Betalt udbytte"]);
});

test("unbalanced entries and unknown accounts are refused against the live chart", { skip }, async () => {
  const unbalanced = await call("billy_create_daybook_transaction", {
    entryDate: "2026-09-26",
    lines: [{ account: "7325", side: "debit", amount: 8000 }, { account: "1860", side: "credit", amount: 7999 }],
  });
  assert.ok(unbalanced.isError && /does not balance/.test(unbalanced.content[0].text));
  const unknown = await call("billy_create_daybook_transaction", {
    entryDate: "2026-09-26",
    lines: [{ account: "9999", contraAccount: "5710", side: "debit", amount: 1 }],
  });
  assert.ok(unknown.isError && /Unknown account "9999"/.test(unknown.content[0].text));
});

test("deleting an approved entry is refused", { skip }, async () => {
  const approved = (await call("billy_list_daybook_transactions", { state: "approved" })).structuredContent.daybookTransactions[0];
  const res = await call("billy_delete_daybook_transaction", { id: approved.id });
  assert.ok(res.isError && /only drafts can be deleted/.test(res.content[0].text));
});

test("an existing write tool dry-runs too", { skip }, async () => {
  const res = await call("billy_create_contact", { name: "DRY RUN TEST", countryId: "DK" });
  assert.ok(!res.isError, res.content[0].text);
  assert.equal(res.structuredContent.dryRun, true);
  assert.equal(res.structuredContent.request.endpoint, "/contacts");
});

test("nothing was written", { skip }, async () => {
  assert.equal(await daybookCount(), before_count);
});
