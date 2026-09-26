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
- `npm run test:connection` - Test Billy API connection and verify credentials
- Set `BILLY_ACCESS_TOKEN` (env var or `.env`) before running

### Environment Setup
- Requires Node.js 20.12+ (for `process.loadEnvFile`)
- Copy `.env.example` to `.env` and set `BILLY_ACCESS_TOKEN`, or pass it via the MCP
  client's `env` block. `loadDotEnv()` reads `.env` from the package root and the cwd;
  real environment variables take precedence over the file.
- Run `npm install` to install dependencies

## Architecture

An MCP server that exposes Billy's accounting API to MCP clients. Single source file,
`src/index.ts`, in two halves:

**BillyClient class (src/index.ts:34-137)**
- All Billy API communication, authenticated via the `X-Access-Token` header
- Methods for organization, contacts, invoices, products, payments, bills and accounts
- Base URL `https://api.billysbilling.com/v2`, overridable via `BILLY_API_BASE_URL`

**Tool registrations (src/index.ts:235-590)**
- Built on `McpServer` + `registerTool` from `@modelcontextprotocol/sdk`
- 17 tools, grouped by resource with `// ---` section banners
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
- **New mutating tools must be registered through `writeTools.push(...)`**, or they
  will stay exposed in read-only mode (the non-GET guard still blocks them)
- `BILLY_READ_ONLY` from 1.x is ignored; the server warns if it is still set

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
src/index.ts           # MCP server implementation
test-connection.js     # API connection test utility
.env.example           # Environment variable template
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
