// Unit tests for the HTTP client layer. No network: every case either never reaches
// axios (read-only guard, dry run) or tests a pure helper.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BillyClient,
  describeErrorBody,
  entryDatePeriodParam,
  toQuery,
  withinRange,
} from "../../build/client.js";

test("toQuery skips absent values and coerces the rest", () => {
  assert.equal(toQuery(), "");
  assert.equal(toQuery({ a: undefined, b: null }), "");
  assert.equal(toQuery({ page: 2, isPaid: false, q: "a b" }), "?page=2&isPaid=false&q=a+b");
});

test("withinRange is inclusive and rejects non-strings", () => {
  assert.equal(withinRange("2026-09-30", "2025-10-01", "2026-09-30"), true);
  assert.equal(withinRange("2025-10-01", "2025-10-01", "2026-09-30"), true);
  assert.equal(withinRange("2025-09-30", "2025-10-01"), false);
  assert.equal(withinRange("2026-10-01", undefined, "2026-09-30"), false);
  assert.equal(withinRange("2026-01-01"), true);
  assert.equal(withinRange(undefined, "2025-10-01"), false);
});

test("entryDatePeriodParam builds Billy's dates: syntax, open-ended on either side", () => {
  assert.deepEqual(entryDatePeriodParam(), {});
  assert.deepEqual(entryDatePeriodParam("2025-10-01", "2026-09-30"), { entryDatePeriod: "dates:2025-10-01...2026-09-30" });
  assert.deepEqual(entryDatePeriodParam("2025-10-01"), { entryDatePeriod: "dates:2025-10-01...2999-12-31" });
  assert.deepEqual(entryDatePeriodParam(undefined, "2026-09-30"), { entryDatePeriod: "dates:1900-01-01...2026-09-30" });
});

test("describeErrorBody unwraps Billy's error envelope", () => {
  assert.equal(describeErrorBody({ errorMessage: "Invalid token.", errorCode: "OAUTH_INVALID_ACCESS_TOKEN" }),
    "Invalid token. (OAUTH_INVALID_ACCESS_TOKEN)");
  assert.equal(describeErrorBody({ errorMessage: "Not found." }), "Not found.");
  assert.equal(describeErrorBody({ other: 1 }), '{"other":1}');
  assert.equal(describeErrorBody(undefined), undefined);
  assert.equal(describeErrorBody(null), undefined);
});

test("describeErrorBody recovers JSON behind a plain-text LOGGER ERROR prefix", () => {
  const body = 'LOGGER ERROR: something went wrong\n{"errorMessage":"Validation failed.","errorCode":"VALIDATION"}';
  assert.equal(describeErrorBody(body), "Validation failed. (VALIDATION)");
  assert.equal(describeErrorBody("  plain failure text  "), "plain failure text");
  // Without a "{", nothing is sliced: a body ending in a digit must not collapse to it.
  assert.equal(describeErrorBody("Service Unavailable 503"), "Service Unavailable 503");
  assert.equal(describeErrorBody("error 1"), "error 1");
});

test("a read-only client refuses every non-GET request before it reaches the network", async () => {
  const client = new BillyClient({ accessToken: "dummy", readOnly: true });
  await assert.rejects(client.createContact({ name: "X" }), /read-only/);
  await assert.rejects(client.updateInvoice("id", { state: "approved" }), /Refusing PUT/);
  await assert.rejects(client.deleteDaybookTransaction("id"), /Refusing DELETE/);
});

test("read-only wins over dry run", async () => {
  const client = new BillyClient({ accessToken: "dummy", readOnly: true }).withDryRun();
  await assert.rejects(client.createContact({ name: "X" }), /read-only/);
});

test("a dry-run client returns the request instead of sending it", async () => {
  const client = new BillyClient({ accessToken: "dummy" }).withDryRun();
  assert.deepEqual(await client.createContact({ name: "X", countryId: "DK" }), {
    dryRun: true,
    request: { method: "POST", endpoint: "/contacts", body: { contact: { name: "X", countryId: "DK" } } },
  });
  assert.deepEqual(await client.deleteDaybookTransaction("a b"), {
    dryRun: true,
    request: { method: "DELETE", endpoint: "/daybookTransactions/a%20b", body: null },
  });
});

test("BILLY_ORGANIZATION_ID-style config is sent on creates only", async () => {
  const client = new BillyClient({ accessToken: "dummy", organizationId: "ORG" }).withDryRun();
  const created = await client.createInvoice({ contactId: "C" });
  assert.deepEqual(created.request.body, { invoice: { organizationId: "ORG", contactId: "C" } });
  const updated = await client.updateContact("C", { name: "Y" });
  assert.deepEqual(updated.request.body, { contact: { name: "Y" } });
});

test("withDryRun leaves the original client sending for real", () => {
  const client = new BillyClient({ accessToken: "dummy" });
  const dry = client.withDryRun();
  assert.notEqual(dry, client);
  assert.equal(client.dryRun, false);
  assert.equal(dry.dryRun, true);
});
