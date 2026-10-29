# Billy MCP API coverage — release 2.0.0

How much of Billy's v2 API this MCP server exposes, what is missing, and where the
implementation and Billy's documentation disagree.

- **Source:** Billy's API reference, [billy.dk/api](https://www.billy.dk/api/), read on
  29 Oct 2026. The page now carries "Billy is now part of Shine"; the v2 API itself is
  unchanged.
- **Compared against:** `src/client.ts` and `src/tools/*.ts` at release 2.0.0.
- **Verified live:** statements marked ✔ were checked against a real account. Everything
  else comes from the reference and is untested.

## Summary

| | Documented | Covered |
|---|---:|---:|
| Resources | 46 | **13 called directly** (12 with tools; `daybooks` only internally), 4 more only embedded or via `include`, 29 not at all |
| Get / list / create / update / delete operations | 207 | **27 called** (13 %), exposed as 25 tools |
| Bulk save / bulk delete operations | 92 | 0 |
| Action endpoints (send invoice email, e-invoice delivery, invoice logs) | 3 | 0 |

The server covers the **reading side of bookkeeping well**: the chart of accounts,
invoices, bills, payments, postings, journal entries, VAT returns and tax rates. It
covers **writing only for the common cases**: contacts, invoices, products, payments,
bills and journal entries. The big gaps are documents (files and attachments), bank
reconciliation, and corrections to approved entries.

Operations key: **G** get by id · **L** list · **C** create · **U** update · **D** delete.
Billy documents bulk save and bulk delete for every resource; they are left out of the
tables because none are implemented.

## Coverage by area

### Sales

| Resource | Billy documents | This server | Status |
|---|---|---|---|
| `invoices` | G L C U D | G L C U — `billy_get_invoice`, `billy_list_invoices`, `billy_create_invoice`, `billy_update_invoice` | Partial: no delete |
| `invoiceLines` | G L C U D | Only embedded in invoice create/update, read via `include=invoice.lines` | Indirect |
| `invoiceReminders`, `invoiceReminderAssociations` | G L C (U D) | — | None |
| `invoiceLateFees` | G L C U | — | None |
| `products` | G L C U D | G L C — `billy_get_product`, `billy_list_products`, `billy_create_product` | Partial: no update or delete |
| `productPrices` | G L C U D | Read via `include=product.prices`; set on product create | Indirect |
| Send invoice email, e-invoice delivery, invoice logs | action endpoints | — | None |

### Contacts

| Resource | Billy documents | This server | Status |
|---|---|---|---|
| `contacts` | G L C U D | G L C U — `billy_get_contact`, `billy_list_contacts`, `billy_create_contact`, `billy_update_contact` | Partial: no delete |
| `contactPersons` | G L C U D | — | None. This is where Billy keeps email addresses |
| `contactBalancePayments`, `contactBalancePostings` | G L C U | — | None |
| `balanceModifiers` | G L C U | — | None |

### Purchases

| Resource | Billy documents | This server | Status |
|---|---|---|---|
| `bills` | G L C U D | L C — `billy_list_bills`, `billy_create_bill` | Partial: no get, update or delete |
| `billLines` | G L C U D | Only embedded in bill create | Indirect |

### Banking and payments

| Resource | Billy documents | This server | Status |
|---|---|---|---|
| `bankPayments` | G L C U D | L C — `billy_list_bank_payments`, `billy_create_payment` | Partial |
| `bankLines` | G L C U D | — | None |
| `bankLineMatches` | G L C U D | — | None |
| `bankLineSubjectAssociations` | G L C U D | — | None |

### Ledger and journal entries

| Resource | Billy documents | This server | Status |
|---|---|---|---|
| `accounts` | G L C U D | L — `billy_list_accounts`; also used to resolve account numbers in journal entries | Partial: read only |
| `accountGroups` | G L C U D | L — `billy_list_account_groups` | Partial: read only |
| `accountNatures` | G L C U | — | None |
| `postings` | G L C U | L — `billy_list_postings` ✔ | Partial: read only, as intended |
| `transactions` | G L C U D | — | None: no voiding through the API |
| `daybookTransactions` | G L C U D | L C D — `billy_list_daybook_transactions`, `billy_create_daybook_transaction` (draft by default), `billy_delete_daybook_transaction` (drafts only) ✔; G used internally | Partial: no update |
| `daybookTransactionLines` | G L C U D | Only embedded in journal-entry create | Indirect |
| `daybooks` | G L C U D | L used internally to pick the organisation's daybook | Indirect: no tool |
| `daybookBalanceAccounts` | G L C U D | — | None |

### VAT

| Resource | Billy documents | This server | Status |
|---|---|---|---|
| `salesTaxReturns` | G L U | G L — `billy_get_sales_tax_return`, `billy_list_sales_tax_returns` ✔ | Partial: no update, so a return can't be settled or marked paid |
| `salesTaxPayments` | G L C U | — | None |
| `taxRates` | G L C U D | L — `billy_list_tax_rates` ✔ | Partial: read only |
| `salesTaxAccounts`, `salesTaxMetaFields`, `salesTaxRules`, `salesTaxRulesets`, `taxRateDeductionComponents` | G L C U D | — | None. VAT configuration |

### Documents

| Resource | Billy documents | This server | Status |
|---|---|---|---|
| `files` | G L C | — | None |
| `attachments` | G L C U D | — | None: vouchers can't be uploaded or linked |

### Organisation, users and reference data

| Resource | Billy documents | This server | Status |
|---|---|---|---|
| `organizations` | G L C U | G via `GET /organization` — `billy_get_organization` ✔ | Partial. The singular endpoint isn't in the reference, but works |
| `users` | G L U | — | None |
| `cities`, `countries`, `countryGroups`, `currencies`, `locales`, `states`, `zipcodes` | G L C U (as documented) | — | None. Reference data; the "create/update" in the reference looks generated rather than real |

## The 25 tools

| Area | Read (16) | Write (9, only with `BILLY_ALLOW_WRITES=true`, dry run by default) |
|---|---|---|
| Organisation | `billy_get_organization` | |
| Contacts | `billy_list_contacts`, `billy_get_contact` | `billy_create_contact`, `billy_update_contact` |
| Invoices | `billy_list_invoices`, `billy_get_invoice` | `billy_create_invoice`, `billy_update_invoice` |
| Products | `billy_list_products`, `billy_get_product` | `billy_create_product` |
| Payments | `billy_list_bank_payments` | `billy_create_payment` |
| Bills | `billy_list_bills` | `billy_create_bill` |
| Accounts | `billy_list_accounts`, `billy_list_account_groups` | |
| VAT | `billy_list_sales_tax_returns`, `billy_get_sales_tax_return`, `billy_list_tax_rates` | |
| Ledger | `billy_list_postings` | |
| Journal entries | `billy_list_daybook_transactions` | `billy_create_daybook_transaction`, `billy_delete_daybook_transaction` |

## What this server adds on top of the API

These are deliberate behaviours, not API features:

- **Read-only by default.** Billy's tokens are unscoped and permanent, so the server is
  the only place writes can be restricted. Write tools don't exist unless
  `BILLY_ALLOW_WRITES=true`, and the client refuses non-GET requests regardless.
- **Dry run by default** on every write tool: the exact request is returned and nothing
  is sent until the call is repeated with `dryRun: false`.
- **Journal entries are created as drafts** and only reach the ledger when approved in
  Billy. Account numbers are resolved against the live chart, and unbalanced entries
  or unknown/archived accounts are refused before anything is sent.
- **Filters that work per endpoint** ✔. Billy's `entryDatePeriod` filter works on
  `/invoices`, `/bills` and `/postings` but is silently ignored on
  `/daybookTransactions` and `/salesTaxReturns`, so those are filtered client-side. The
  same goes for `taxRateId` and `salesTaxReturnId` on `/postings`; `accountId` there is
  honoured.
- **Complete lists.** Postings, journal entries, VAT returns, tax rates and account
  groups are fetched across all pages (up to 5.000 records) and report `truncated`.

## Gaps that matter most

Ranked for a small Danish ApS that does its own bookkeeping and year-end close. Each
of these came up in the FY2025/26 close.

1. **Files and attachments.** Entries created through the server have no voucher
   attached. Bookkeeping law requires every entry to be traceable to its
   documentation, so today vouchers are attached by hand in Billy.
2. **Bank lines and matching.** Bank reconciliation is the core of a close.
   `bankLines` can filter on `isReconciled` and missing receipts, which would show
   directly what still needs work. Matching is currently done in Billy's interface.
3. **Voiding (`transactions`).** An approved entry can only be corrected in Billy.
4. **VAT payments and settling returns** (`salesTaxPayments`, `salesTaxReturns`
   update). Without them a VAT period can't be closed through the server. The H2 2025
   return still shows as unpaid in Billy even though it was paid.
5. **Updating bills and journal entries.** Fixing a draft means deleting it and
   creating it again, and bills can't be deleted at all.
6. **Line-level resources** (`invoiceLines`, `billLines`). Line detail, such as VAT
   per line, is only available via `include`.
7. **Contact persons.** Needed for invoice email addresses (see below).
8. **Balance modifiers and contact balance postings.** These hold prepayments and
   overpayments that show up when reconciling open items.

## Where the implementation and the reference disagree

The reference is not always complete, so these are leads, not bugs. Following the
project rule, test each filter or field against a live account before changing code.

| Where | Finding | Status |
|---|---|---|
| `billy_list_postings` | The reference documents no tax-rate property on postings, but the live API returns `taxRateId` on every posting, and the client-side filter uses it | ✔ **Reference incomplete; code is right** |
| `billy_create_contact`, `billy_update_contact` | We send `email`, which `contacts` doesn't document. Billy keeps email addresses on `contactPersons`, so the field is probably ignored | To verify |
| `billy_create_bill` | We send `paymentTermsDays`; bills document `dueDate`. Bill lines take `quantity`, which `billLines` doesn't document | To verify |
| `billy_list_bank_payments` | The `contactId` and `isVoided` filters aren't in the reference, which lists no filters for bank payments. They may be silently ignored | To verify |
| `billy_list_bills` | The state filter omits `voided`, which the reference allows | Small fix |
| `billy_list_daybook_transactions` | The reference lists `minEntryDate`/`maxEntryDate`. If they work, the client-side date filter could move to the server | To verify |
| `billy_list_postings` | The reference offers `isVoided` and `transactionId` filters, which we don't expose | Possible addition |
| `billy_update_invoice` | Accepts `invoiceNo`, which the reference says must not be set on an existing invoice | Small fix |
| `billy_get_organization` | Calls `GET /organization` (singular), which isn't in the reference | ✔ Works live |

## Keeping this document current

Update it whenever a tool is added or removed, alongside the README tool list and
`tests/fixtures/tool-surface.json` (`UPDATE_SNAPSHOT=1 npm test`). Mark a statement ✔
only once it has been checked against a live account.
