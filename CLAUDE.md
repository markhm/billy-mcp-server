# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Build and Development
- `npm run build` - Compile TypeScript to JavaScript in build/ directory
- `npm run typecheck` - Type-check without emitting
- `npm run dev` - Run server in development mode with tsx
- `npm run watch` - Run server in watch mode (auto-restart on changes)
- `npm start` - Run the compiled server from build/index.js

### Testing
- `npm test` - Build, then run `tests/**/*.test.js` with `node:test` (no network, no token)
- `npm run test:live` - The same plus `tests/live/`, against the real account in `.env`.
  Every write there is a dry run, and the last test asserts nothing was written
- `UPDATE_SNAPSHOT=1 npm test` - Regenerate `tests/fixtures/tool-surface.json` after an
  intentional change to a tool's name, schema, description or annotations
- `npm run test:connection` - Quick credentials check against the live API
- Tests import from `build/`, not `src/`: Node's type stripping rejects the
  `BillyClient` constructor parameter property, and the `.js` import specifiers only
  resolve after compiling. Anything a unit test needs must be exported

### Environment Setup
- Requires Node.js 26+ (`engines`, `.node-version`, `mise.toml`). `process.loadEnvFile`
  is used unguarded, which is safe at that floor
- Copy `.env.example` to `.env` and set `BILLY_ACCESS_TOKEN`, or pass it via the MCP
  client's `env` block. `loadDotEnv()` reads `.env` from the package root and the cwd;
  real environment variables take precedence over the file.
- Run `npm install` to install dependencies

## Architecture

An MCP server that exposes Billy's accounting API to MCP clients. Infrastructure modules
plus one tool module per Billy resource:

- `src/index.ts` creates the server, calls every `register…Tools` function, then removes
  the write tools in read-only mode
- `src/config.ts` loads `.env` and computes the env-derived constants. `loadDotEnv()`
  must run in this module, above the constants, and the file must compile directly into
  `build/`, because it resolves the package root from its own location
- `src/client.ts` holds `BillyClient` and `getBillyClient()`
- `src/tools/shared.ts` holds the schema fragments, annotation presets, dry-run
  fragments, `call()` and the `ToolRegistry` type
- `src/tools/<resource>.ts` registers one resource's tools: organization, contacts,
  invoices, products, payments, bills, accounts, vat, postings, daybook
- Relative imports need the `.js` extension (`"./config.js"`). tsc accepts them without
  it but Node ESM then fails at runtime

**BillyClient class**
- All Billy API communication, authenticated via the `X-Access-Token` header
- Methods for organization, contacts, invoices, products, payments, bills, accounts,
  VAT returns, postings and daybook (journal) transactions
- Base URL `https://api.billysbilling.com/v2`, overridable via `BILLY_API_BASE_URL`

**Tool registrations**
- Built on `McpServer` + `registerTool` from `@modelcontextprotocol/sdk`
- 25 tools (16 read, 9 write), one module per Billy resource under `src/tools/`
- stdio transport; Billy client is lazily constructed on the first tool call

### Key Design Patterns

**API request pattern**
- Everything funnels through `BillyClient.request()`
- `toQuery()` builds query strings, skipping absent values (never emits `?x=undefined`)
- `describeErrorBody()` unwraps Billy's `{errorMessage, errorCode}` envelope, including
  the case where Billy prefixes the body with a plain-text `LOGGER ERROR:` line that
  leaves axios holding an unparsed string

**Tool definition pattern**
- Zod schemas for `inputSchema`; the SDK converts them to JSON Schema and validates
  arguments before the handler runs
- Shared fragments (`listParams`, `includeParam`, `contactFields`, `invoiceFields`)
  keep list/create/update variants consistent
- Every tool declares `title`, `outputSchema` and `annotations`
- Annotation presets: `readOnly`, `creates`, `updates`. Updates are marked
  `destructiveHint: true` because they overwrite existing field values
- The `call()` helper runs a client method and returns the payload as both a text
  block and `structuredContent`, converting thrown errors into `isError` results

**Read-only by default; writes are opt-in**
- The server is read-only unless `BILLY_ALLOW_WRITES=true`. Enforced in two
  independent places: mutating tools are removed from the registry after
  registration (`writeTools`), and `BillyClient.request()` rejects any non-GET method
- Billy has no scoped/read-only access token and no read-only user role, so this
  server is the only enforcement point. `readOnlyHint` is a client hint, not a guard
- **New mutating tools must be registered through `writeTools.push(...)`** in their
  `src/tools/<resource>.ts` module, or they
  will stay exposed in read-only mode (the non-GET guard still blocks them)
- `BILLY_READ_ONLY` from 1.x is ignored; the server warns if it is still set

**Every write dry-runs by default**
- Each write tool takes `dryRun` (default `true`). `call(fn, dryRun)` hands the tool a
  `client.withDryRun()` client whose `request()` returns non-GET requests as
  `{dryRun, request: {method, endpoint, body}}` instead of sending them. GETs still
  run, so a dry run resolves and validates against live data
- A real write needs two deliberate steps: review the dry run, then repeat with
  `dryRun: false`. **New write tools must spread `...dryRunParam` / `...dryRunOutput`
  and pass `dryRun` to `call()`**
- Tools that can summarise their change return a `preview` next to the result

**Journal entries (`billy_create_daybook_transaction`)**
- For postings with no invoice or bill behind them: reclassifications, accruals,
  dividend and equity entries. Bank lines are matched in Billy, not through the API
- `prepareDaybookTransaction()` resolves account numbers against the live chart,
  refuses archived/unknown accounts and unbalanced entries (lines with a contra
  account balance themselves), and defaults to the organisation's only daybook
- Created as **draft** by default: nothing reaches the ledger until approved in Billy
- `billy_delete_daybook_transaction` only deletes drafts; approved entries must be
  voided in Billy to keep the audit trail
- Daybook line amounts are VAT-inclusive when `taxRateId` is set (Billy splits VAT)

**Billy filters are not uniformly honoured — verified empirically**
- `entryDatePeriod=dates:FROM...TO` works on `/invoices`, `/bills`, `/postings`
- It is **silently ignored** on `/daybookTransactions` and `/salesTaxReturns`
  (full set returned, no error). Same for `taxRateId`/`salesTaxReturnId` on `/postings`
- `accountId` on `/postings` is honoured
- The client therefore translates `fromDate`/`toDate` per endpoint and applies the rest
  client-side via `withinRange()`. Before exposing any new Billy filter, test that it
  actually narrows the result — assume nothing
- `getAllPages()` auto-paginates to MAX_RECORDS (5000) and reports `retrieved` +
  `truncated`, because partial data silently produces wrong totals

**Output schemas are deliberately permissive**
- Billy entity shapes vary by organisation configuration, so entity bodies are
  `z.looseObject({})` and every envelope key is optional
- The schema documents the envelope (`{meta, <resource>}`) without risking a runtime
  validation failure on a response shape that has not been verified against a live
  account. Tighten these once verified with a real token.

## File Structure

```
src/index.ts           # Entry point: server, tool registration, read-only removal
src/config.ts          # .env loading, API base URL, version, BILLY_ALLOW_WRITES
src/client.ts          # BillyClient (all HTTP calls)
src/tools/shared.ts    # Schema fragments, annotations, dry-run fragments, call()
src/tools/*.ts         # One module per Billy resource
tests/                 # node:test: unit/, surface.test.js (+ fixtures/), live/ (opt-in)
docs/coverage.md       # Billy MCP API coverage: what of Billy's v2 API is exposed
test-connection.js     # API connection test utility
.env.example           # Environment variable template
.node-version          # Node 26 pin (mise.toml pins it for mise too)
FP_CLAUDE.md, .fp/     # fp issue tracking (labels: development / operations)
build/                 # Compiled JavaScript output
package.json           # Dependencies and npm scripts
tsconfig.json          # TypeScript configuration
```

## Development Notes

- ES modules (`type: "module"` in package.json)
- TypeScript targets ES2022 with strict mode
- Errors log to stderr, never stdout, to avoid corrupting the MCP protocol stream

## MCP Protocol Status

- The SDK is 1.x; there is no "MCP 2.0". Protocol revisions are dated.
- SDK 1.30.0 supports up to protocol `2025-11-25`. The current spec revision is
  `2026-07-28` (stateless, no `initialize` handshake, mandatory `server/discover`),
  which the TypeScript SDK does not implement yet.
- This server uses no feature removed or deprecated in `2026-07-28` (no sessions,
  no ping, no logging/setLevel, no roots/sampling), so that migration should be a
  dependency bump when the SDK ships support.

## Billy API Specifics

- Currency codes: ISO format (DKK, USD, EUR)
- Date format: YYYY-MM-DD for all date fields
- Payment associations: `"invoice:invoiceId"` or `"bill:billId"`
- Invoice/bill states: `"draft"` or `"approved"`
- Payment cash sides: `"debit"` for invoice payments, `"credit"` for bill payments
- Maximum page size: 1000 items per request
- Access tokens are organisation-scoped, so `organizationId` is normally inferred.
  Set `BILLY_ORGANIZATION_ID` to send it explicitly on create calls.
- Tokens are permanent, unscoped and full-access; there is no read-only token.
- Billy has been acquired and is being rebranded to Shine Regnskab. The v2 API is
  unchanged and live, but watch for deprecation notices.

@FP_CLAUDE.md
