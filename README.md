# Billy MCP Server

A Model Context Protocol (MCP) server for integrating with Billy's accounting system. This server provides tools to interact with Billy's REST API for managing invoices, contacts, products, payments, and other accounting data.

## Features

- **Contact Management**: Create, read, update, and list contacts
- **Invoice Management**: Create, read, and list invoices with line items
- **Product Management**: Create, read, and list products with pricing
- **Payment Processing**: Create payments to mark invoices as paid
- **Bill Management**: List and manage vendor bills
- **Account Management**: Access chart of accounts
- **Organization Info**: Get organization details

## Prerequisites

- Node.js 26 or higher (`.node-version` and `mise.toml` pin it)
- Billy account with API access
- Billy API access token

## Installation

1. Clone or download the server code
2. Install dependencies:
   ```bash
   npm install
   ```
3. Build the TypeScript code:
   ```bash
   npm run build
   ```

## Configuration

### Getting a Billy API Token

1. Log into your Billy account at app.billysbilling.com
2. Go to Settings → Access tokens
3. Create a new access token, giving it a descriptive name (e.g. `mcp-server`)
4. Copy the token — see below for where to put it

Two things worth knowing: Billy tokens are **permanent** (they never expire) and
**unscoped** (there is no read-only token — see [Read-only by default](#read-only-by-default)).
Naming the token is what lets you revoke this integration later without disturbing
your other ones.

### Where to put your access token

Pick **one** of these. If more than one is present, real environment variables win over
`.env`, so an MCP client's `env` block is never shadowed by a stale file.

**1. A `.env` file (easiest for local use)**

```bash
cp .env.example .env
# then edit .env and set BILLY_ACCESS_TOKEN=...
```

The server looks for `.env` next to the package and in the working directory, so this
works even when your MCP client launches it from somewhere else. `.env` is gitignored.

**2. Your MCP client's config (the usual choice for day-to-day use)**

Put it in the `env` block of `claude_desktop_config.json` (see below). Nothing else on
the machine needs the token, and it travels with the client config.

**3. Exported in your shell (ad hoc / CI)**

```bash
export BILLY_ACCESS_TOKEN="your_billy_access_token_here"
```

| Variable | Required | Purpose |
| --- | --- | --- |
| `BILLY_ACCESS_TOKEN` | yes | Billy API access token |
| `BILLY_ORGANIZATION_ID` | no | Sent as `organizationId` on create calls. Billy tokens are organisation-scoped, so this is normally inferred — set it only if the API rejects a create for a missing organization. |
| `BILLY_ALLOW_WRITES` | no | Set to `true` to enable the 9 mutating tools. **Off by default** — see below. Even then every write dry-runs unless called with `dryRun: false`. |
| `BILLY_API_BASE_URL` | no | Overrides the API base URL (defaults to `https://api.billysbilling.com/v2`). |

### MCP Client Configuration

Add the server to your MCP client configuration. For Claude Desktop, add this to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "billy": {
      "command": "node",
      "args": ["/path/to/billy-mcp-server/build/index.js"],
      "env": {
        "BILLY_ACCESS_TOKEN": "your_billy_access_token_here"
      }
    }
  }
}
```

## Available Tools

### Organization

- `billy_get_organization` - Get organization details

### Contacts

- `billy_list_contacts` - List contacts with optional filtering
- `billy_get_contact` - Get a specific contact by ID
- `billy_create_contact` - Create a new contact
- `billy_update_contact` - Update an existing contact

### Invoices

- `billy_list_invoices` - List invoices with optional filtering
- `billy_get_invoice` - Get a specific invoice by ID
- `billy_create_invoice` - Create a new invoice with line items
- `billy_update_invoice` - Update an existing invoice

### Products

- `billy_list_products` - List products with optional filtering
- `billy_get_product` - Get a specific product by ID
- `billy_create_product` - Create a new product with pricing

### Payments

- `billy_list_bank_payments` - List bank payments
- `billy_create_payment` - Create a payment to mark invoices as paid

### Bills

- `billy_list_bills` - List vendor bills
- `billy_create_bill` - Create a vendor bill

### Accounts

- `billy_list_accounts` - List chart of accounts
- `billy_list_account_groups` - List chart-of-accounts groups

### VAT and ledger

- `billy_list_sales_tax_returns` - Billy's own VAT returns (momsangivelser) — the authoritative figures
- `billy_get_sales_tax_return` - Get a single VAT return by ID
- `billy_list_postings` - Ledger postings, where VAT actually lands
- `billy_list_daybook_transactions` - Manual journal entries (kassekladde)
- `billy_create_daybook_transaction` - Create a journal entry (draft by default); accounts by number, must balance
- `billy_delete_daybook_transaction` - Delete a **draft** journal entry (approved entries are refused)
- `billy_list_tax_rates` - Configured VAT/tax rates

### Date filtering

`billy_list_invoices`, `billy_list_bills`, `billy_list_postings` and
`billy_list_daybook_transactions` accept `fromDate`/`toDate` (inclusive, `YYYY-MM-DD`),
filtering on `entryDate`. A malformed date is rejected rather than silently widening the
range.

> **Why this is handled server-side.** Billy's own `entryDatePeriod` filter works on
> `/invoices`, `/bills` and `/postings` but is **silently ignored** on
> `/daybookTransactions` and `/salesTaxReturns` — they return the full set instead of an
> error. Likewise `taxRateId` and `salesTaxReturnId` are ignored on `/postings`. These
> tools translate `fromDate`/`toDate` to whichever mechanism actually works per endpoint
> and apply the rest client-side, so a filter either narrows the result or fails loudly.
> Never pass raw Billy filter syntax and assume it applied.

The auto-paginating tools (`sales_tax_returns`, `postings`, `daybook_transactions`,
`tax_rates`, `account_groups`) fetch every matching page up to 5,000 records and return
`retrieved` plus a `truncated` flag. **Check `truncated` before trusting a total.**

## Read-only by default

**This server is read-only unless you explicitly enable writes.**

**Billy cannot restrict this for you.** Its access tokens are unscoped and permanent —
any token that can read can also create invoices, edit contacts and register payments.
Billy's user roles do not help either: the closest thing to a read-only role (`Upload`)
blocks writes but also blocks reading accounting data, which defeats the purpose. So the
restriction has to be enforced here, and it defaults to on.

Out of the box the client sees **16 read tools**. The 9 mutating tools
(`billy_create_*`, `billy_update_*`, `billy_delete_daybook_transaction`) are absent.
To enable them:

```bash
BILLY_ALLOW_WRITES=true
```

Read-only is enforced twice, independently:

1. **The mutating tools are never registered.** The model cannot call a write tool
   because it does not exist — calling one by name returns
   `Tool billy_create_contact not found`.
2. **`BillyClient` refuses any non-GET request**, regardless of which tool issued it.
   A backstop for future tools added without this mode in mind.

Reads behave identically in both modes. The server logs which mode it started in.

Note that `readOnlyHint` on a tool is *advice to the client*, not a security boundary —
it is what makes a well-behaved client skip a confirmation prompt, nothing more.
`BILLY_ALLOW_WRITES` is the actual enforcement.

### Dry run by default

Enabling writes does not make a write happen by accident. **Every write tool takes
`dryRun`, which defaults to `true`**: the tool resolves and validates everything it can
against live data (GET requests still run), then returns the exact request it *would*
send — method, endpoint and body — without sending it:

```json
{ "dryRun": true, "request": { "method": "POST", "endpoint": "/daybookTransactions", "body": { "...": "..." } },
  "preview": { "lines": [{ "account": "7120 Transferred Result", "side": "debit", "amount": 135000 }] } }
```

Review that, then repeat the call with `dryRun: false`. Journal entries add a third
safeguard: they are created as **drafts** by default and only reach the ledger when
someone approves them in Billy.

> **Upgrading from 1.x — three breaking changes in 2.0:**
> 1. **Writes are off by default.** They used to be on, gated by `BILLY_READ_ONLY`. That
>    variable is now ignored (the server warns if it is set). If you rely on the write
>    tools, set `BILLY_ALLOW_WRITES=true`.
> 2. **Write tools dry-run by default.** They used to send immediately. Pass
>    `dryRun: false` to send.
> 3. **Node 26 or higher is required** (was 20).

### Tool metadata

Every tool declares an `outputSchema` (results arrive as `structuredContent` as well as
text) and MCP [tool annotations](https://modelcontextprotocol.io/specification/2025-11-25/server/tools),
so clients can tell reads from writes:

| Annotation | Tools |
| --- | --- |
| `readOnlyHint: true` | all `billy_get_*` and `billy_list_*` |
| write, non-destructive | `billy_create_*` |
| write, destructive, idempotent | `billy_update_contact`, `billy_update_invoice`, `billy_delete_daybook_transaction` |

Clients that gate on `destructiveHint` will prompt before the update and delete tools run.

## Usage Examples

### Create a Contact

```javascript
// Using the billy_create_contact tool
{
  "name": "Acme Corporation",
  "type": "company",
  "countryId": "DK",
  "street": "Main Street 123",
  "city": "Copenhagen",
  "zipcode": "1000",
  "phone": "+45 12 34 56 78",
  "email": "contact@acme.com",
  "isCustomer": true,
  "paymentTermsDays": 30
}
```

### Create an Invoice

```javascript
// Using the billy_create_invoice tool
{
  "contactId": "contact-id-here",
  "entryDate": "2024-01-15",
  "currencyId": "DKK",
  "paymentTermsDays": 30,
  "lines": [
    {
      "productId": "product-id-here",
      "description": "Consulting services",
      "quantity": 10,
      "unitPrice": 1000
    }
  ],
  "state": "approved"
}
```

### Create a Payment

```javascript
// Using the billy_create_payment tool
{
  "entryDate": "2024-01-20",
  "cashAmount": 10000,
  "cashSide": "debit",
  "cashAccountId": "bank-account-id",
  "associations": [
    {
      "subjectReference": "invoice:invoice-id-here"
    }
  ]
}
```

## API Documentation

For detailed information about Billy's API, visit: https://www.billy.dk/api

## Development

### Running in Development Mode

```bash
npm run dev
```

### Building

```bash
npm run build      # compile to build/
npm run typecheck  # type-check only
```

### Verifying the connection

```bash
npm run test:connection
```

### File Structure

```
src/
  index.ts            # Entry point: creates the server, registers every tool module
  config.ts           # Loads .env; API base URL, version, the BILLY_ALLOW_WRITES switch
  client.ts           # BillyClient: all HTTP calls to the Billy v2 API
  tools/
    shared.ts         # Schema fragments, annotation presets, dry-run fragments, call()
    organization.ts   # One module per part of the Billy API
    contacts.ts
    invoices.ts
    products.ts
    payments.ts
    bills.ts
    accounts.ts       # Chart of accounts and account groups
    vat.ts            # VAT returns and tax rates
    postings.ts       # Ledger postings
    daybook.ts        # Journal entries: list, create (draft), delete (drafts only)
test-connection.js    # API connection test utility
.env.example          # Environment variable template
.node-version         # Node 26 (also pinned in mise.toml)
build/                # Compiled JavaScript output
package.json          # Dependencies and scripts
tsconfig.json         # TypeScript configuration
README.md             # This file
```

## MCP protocol version

The MCP TypeScript SDK is on the 1.x line — there is no "MCP 2.0"; protocol revisions are
dated. This server uses SDK 1.30.x, which negotiates up to protocol `2025-11-25`. The
current spec revision, `2026-07-28`, is not yet implemented by the TypeScript SDK. This
server uses none of the features that revision removes or deprecates, so adopting it
should be a dependency bump once SDK support lands.

## Error Handling

- Tool arguments are validated against each tool's schema before any request is made,
  so bad input fails fast with a field-level message.
- Billy's error envelope is unwrapped, so failures read as
  `Billy API Error 401: Invalid OAuth 2 access token. (OAUTH_INVALID_ACCESS_TOKEN)`
  rather than an opaque status code.
- Missing credentials, network failures and Billy API errors are all returned as MCP
  error results rather than crashing the server.

All errors are returned with descriptive messages to help with debugging.

## Supported Billy API Features

This MCP server supports the core Billy API functionality including:

- ✅ Organization management
- ✅ Contact management (customers/suppliers)
- ✅ Invoice creation and management
- ✅ Product catalog management
- ✅ Payment processing
- ✅ Bill management (vendor invoices)
- ✅ Chart of accounts and account groups
- ✅ VAT returns (momsangivelser) and tax rates
- ✅ Ledger postings, the ground truth for VAT and balances
- ✅ Journal entries (kassekladde): list, create as draft, delete drafts
- ✅ Read-only by default; every write dry-runs unless `dryRun: false`
- ✅ Pagination and filtering
- ✅ Related data inclusion (sideloading/embedding)
- ✅ Error handling and validation

## Limitations

- Authentication is limited to access tokens (OAuth not yet supported by Billy)
- Some advanced features like late fees, reminders, and attachments are not yet implemented
- Bank line matching is not available through the API; match bank lines in Billy.
  Journal entries (daybook transactions) are supported, as drafts by default.

## Security Considerations

- Store your Billy access token securely
- Use environment variables rather than hardcoding tokens
- Tokens in Billy don't expire but can be revoked from the Billy interface
- Each token is tied to a specific organization

## Contributing

To add a tool:

1. Add the API call to `BillyClient` in `src/client.ts`. Everything goes through
   `request()`, which enforces read-only mode and dry runs.
2. Register the tool in the module for its Billy resource, `src/tools/<resource>.ts`, or
   add a new module and call its `register…Tools` function from `src/index.ts`.
3. Use the shared fragments from `src/tools/shared.ts`: `billyEnvelope()` for the output
   schema, an annotation preset (`readOnly`, `creates`, `updates`), and `call()` to run
   the client method.
4. **Write tools** must be registered as `writeTools.push(server.registerTool(...))` so
   they disappear in read-only mode, and must spread `...dryRunParam` into the input
   schema, `...dryRunOutput` into the output schema, and pass `dryRun` to `call()`.
5. Before exposing a Billy filter, check against a live account that it actually
   narrows the result (see *Date filtering* above).
6. Update this README.

```typescript
// src/tools/<resource>.ts
writeTools.push(
  server.registerTool(
    "billy_create_thing",
    {
      title: "Create thing",
      description: "Create a thing in Billy",
      inputSchema: { ...dryRunParam, name: z.string().describe("Name") },
      outputSchema: { ...billyEnvelope("things", "list"), ...dryRunOutput },
      annotations: creates,
    },
    ({ dryRun, ...args }) => call((billy) => billy.createThing(args), dryRun)
  )
);
```

## Troubleshooting

### Common Issues

1. **"BILLY_ACCESS_TOKEN environment variable is required"**
   - Make sure you've set the environment variable correctly
   - Check that your MCP client configuration includes the env section

2. **"Billy API Error: 401"**
   - Your access token is invalid or has been revoked
   - Generate a new token from Billy's interface

3. **"Billy API Error: 403"**
   - Your token doesn't have permission for the requested operation
   - Check that you're using a company token, not a user token for certain operations

4. **"Billy API Error: 404"**
   - The requested resource (invoice, contact, etc.) doesn't exist
   - Check that you're using the correct ID

5. **"Billy API Error: 422"**
   - Invalid data in your request
   - Check required fields and data formats (especially dates: YYYY-MM-DD)

### Debug Mode

To enable more detailed logging, you can modify the server to log requests:

```typescript
// Add to the request method in BillyClient
console.error(`Making ${method} request to ${url}`, data);
```

## License

MIT License - feel free to modify and distribute as needed.

## Support

For Billy API questions, contact: dev@billy.dk
For MCP server issues, please create an issue in your repository.