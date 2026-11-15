# Linkify Payment Manager

## Supabase-connected frontend

Files: `index.html`, `style.css`, `script.js`.

### Setup
1. Keep all three files in the same folder.
2. Open `index.html` through a local web server or deploy the folder to an HTTPS host.
3. Sign in using the email and password of the confirmed Supabase Auth user.
4. Data is stored in the existing Supabase tables: `parties`, `party_roles`, `invoices`, `payments`, `payment_allocations`, and `payment_attachments`.
5. Payment evidence is uploaded to the private `payment-attachments` bucket. Files are stored under `<auth-user-id>/<payment-id>/...`.

The browser uses the Supabase publishable key. Never put a service-role or secret key in frontend code. Keep Row Level Security enabled.

### Notes
- The current database schema does not include a country column for parties, so the contact form omits country persistence.
- Invoice numbers are generated automatically if left blank.
- Linked payment allocations must match the invoice contact, direction and currency, and cannot exceed the remaining invoice balance.
- Signed receipt links expire after one hour and are refreshed when cloud data loads.
- The app requires an internet connection to load and save cloud data.

## Overall client and vendor account balances

Before using this version, run `supabase-account-ledger-migration.sql` once in the Supabase SQL Editor.

- Add or edit a client/vendor and enter its overall account total in USD and/or PKR.
- Client received payments reduce the client receivable balance.
- Vendor sent payments reduce the vendor payable balance.
- Every transaction for that party and currency is counted, including invoice-linked and direct payments.
- If no overall account total is set for a party/currency, the dashboard falls back to the remaining balance of its invoices.
- USD and PKR are calculated separately. A negative remaining amount is treated as an advance/credit and is not included in outstanding receivables/payables.
- Transactions can be filtered by month, contact, and received/sent type.

Important: When you set an overall account total, enter the full amount owed for that currency, including any work that also has invoices. The linked invoice records remain available as supporting details, but their balances are not added a second time to the overall account total.
