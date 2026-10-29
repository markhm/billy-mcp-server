// Unit tests for journal-entry preparation: account resolution, balancing and the
// request body, against a stub client. No network.

import { test } from "node:test";
import assert from "node:assert/strict";
import { prepareDaybookTransaction } from "../../build/tools/daybook.js";

const ACCOUNTS = [
  { id: "ACC7120", accountNo: 7120, name: "Transferred Result" },
  { id: "ACC7161", accountNo: 7161, name: "Betalt udbytte" },
  { id: "ACC7375", accountNo: 7375, name: "Owed Tax Account" },
  { id: "ACC9000", accountNo: 9000, name: "Old account", isArchived: true },
];

function stub({ daybooks = [{ id: "DB1", name: "Standardkassekladde" }], organization = { id: "ORG", baseCurrencyId: "DKK" } } = {}) {
  return {
    getAllAccounts: async () => ({ accounts: ACCOUNTS }),
    getDaybooks: async () => ({ daybooks }),
    getOrganization: async () => ({ organization }),
  };
}

const entry = (lines, extra = {}) => ({ entryDate: "2025-12-21", state: "draft", lines, ...extra });

test("a balanced entry resolves account numbers and IDs into the request body", async () => {
  const { transaction, preview } = await prepareDaybookTransaction(stub(), entry([
    { account: "7120", side: "debit", amount: 135000, text: "Udbytte" },
    { account: "ACC7161", side: "credit", amount: 135000 },
  ], { description: "Udbytte 2024/25" }));

  assert.deepEqual(transaction, {
    organizationId: "ORG",
    daybookId: "DB1",
    entryDate: "2025-12-21",
    voucherNo: undefined,
    description: "Udbytte 2024/25",
    state: "draft",
    lines: [
      { accountId: "ACC7120", contraAccountId: undefined, side: "debit", amount: 135000, text: "Udbytte", taxRateId: undefined, currencyId: "DKK", priority: 1 },
      { accountId: "ACC7161", contraAccountId: undefined, side: "credit", amount: 135000, text: undefined, taxRateId: undefined, currencyId: "DKK", priority: 2 },
    ],
  });
  assert.equal(preview.daybook, "Standardkassekladde");
  assert.deepEqual(preview.lines.map((l) => l.account), ["7120 Transferred Result", "7161 Betalt udbytte"]);
});

test("a line with a contra account balances on its own", async () => {
  const { transaction, preview } = await prepareDaybookTransaction(stub(), entry([
    { account: "7161", contraAccount: "7375", side: "debit", amount: 36450 },
  ]));
  assert.equal(transaction.lines[0].contraAccountId, "ACC7375");
  assert.equal(preview.lines[0].contraAccount, "7375 Owed Tax Account");
});

test("an unbalanced entry is refused", async () => {
  await assert.rejects(prepareDaybookTransaction(stub(), entry([
    { account: "7120", side: "debit", amount: 8000 },
    { account: "7161", side: "credit", amount: 7999 },
  ])), /does not balance: debit 8000 vs credit 7999/);
});

test("contra lines do not hide an imbalance in the other lines", async () => {
  await assert.rejects(prepareDaybookTransaction(stub(), entry([
    { account: "7161", contraAccount: "7375", side: "debit", amount: 100 },
    { account: "7120", side: "debit", amount: 50 },
  ])), /does not balance/);
});

test("amounts are compared in whole øre, so float noise does not unbalance an entry", async () => {
  const { transaction } = await prepareDaybookTransaction(stub(), entry([
    { account: "7120", side: "debit", amount: 0.1 },
    { account: "7120", side: "debit", amount: 0.2 },
    { account: "7161", side: "credit", amount: 0.3 },
  ]));
  assert.deepEqual(transaction.lines.map((l) => l.amount), [0.1, 0.2, 0.3]);
  const rounded = await prepareDaybookTransaction(stub(), entry([{ account: "7120", contraAccount: "7161", side: "debit", amount: 10.256 }]));
  assert.equal(rounded.transaction.lines[0].amount, 10.26);
});

test("unknown and archived accounts are refused", async () => {
  await assert.rejects(prepareDaybookTransaction(stub(), entry([{ account: "9999", contraAccount: "7120", side: "debit", amount: 1 }])), /Unknown account "9999"/);
  await assert.rejects(prepareDaybookTransaction(stub(), entry([{ account: "7120", contraAccount: "9999", side: "debit", amount: 1 }])), /Unknown account "9999"/);
  await assert.rejects(prepareDaybookTransaction(stub(), entry([{ account: "9000", contraAccount: "7120", side: "debit", amount: 1 }])), /9000 Old account is archived/);
});

test("with several daybooks the daybook must be named, and must exist", async () => {
  const two = stub({ daybooks: [{ id: "DB1", name: "A" }, { id: "DB2", name: "B" }] });
  const line = [{ account: "7120", contraAccount: "7161", side: "debit", amount: 1 }];
  await assert.rejects(prepareDaybookTransaction(two, entry(line)), /Specify daybookId; this organisation has 2 daybooks: DB1 \(A\), DB2 \(B\)/);
  const { transaction } = await prepareDaybookTransaction(two, entry(line, { daybookId: "DB2" }));
  assert.equal(transaction.daybookId, "DB2");
  await assert.rejects(prepareDaybookTransaction(two, entry(line, { daybookId: "NOPE" })), /Unknown daybook "NOPE"/);
});

test("currency follows the organisation, with an explicit override and a DKK fallback", async () => {
  const line = [{ account: "7120", contraAccount: "7161", side: "debit", amount: 1 }];
  const eur = await prepareDaybookTransaction(stub({ organization: { id: "ORG", baseCurrencyId: "EUR" } }), entry(line));
  assert.equal(eur.transaction.lines[0].currencyId, "EUR");
  const usd = await prepareDaybookTransaction(stub(), entry(line, { currencyId: "USD" }));
  assert.equal(usd.transaction.lines[0].currencyId, "USD");
  const none = await prepareDaybookTransaction(stub({ organization: { id: "ORG" } }), entry(line));
  assert.equal(none.transaction.lines[0].currencyId, "DKK");
});
