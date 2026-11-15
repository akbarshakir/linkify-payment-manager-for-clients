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
