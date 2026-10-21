# Intova

WhatsApp order desk for a pharmacy. Customers send an order as text, a voice note, a photo or a PDF. Gemini reads it, the app matches it against inventory, and the shop gets an order to confirm, with a GST invoice and a Razorpay/UPI payment link sent back over WhatsApp.

## Setup

```bash
npm install
cp .env.example .env   # then fill in the keys
npm run dev
```

Open http://localhost:3000 (redirects to `/orders`). Data is stored in `data/intova.db` (SQLite, gitignored).

Without `GEMINI_API_KEY` only typed text orders work. Without Razorpay keys the Pay button sends a plain `upi://` link.

## Receiving WhatsApp messages locally

Meta needs a public https URL. `npm run dev:tunnel` starts ngrok, runs `next dev` with `PUBLIC_BASE_URL` set to the tunnel, and prints the webhook URLs:

- WhatsApp: `<PUBLIC_BASE_URL>/api/whatsapp` (verify token = `WHATSAPP_VERIFY_TOKEN`)
- Razorpay: `<PUBLIC_BASE_URL>/api/razorpay`, event `payment_link.paid`

ngrok must be installed and signed in (`ngrok config add-authtoken ...`). Set `META_APP_ID` and `WHATSAPP_BUSINESS_ACCOUNT_ID` to have the webhook registered with Meta automatically.

## Layout

| Path | What it does |
| --- | --- |
| `src/app/orders`, `customers`, `inventory` | Dashboard pages |
| `src/app/api/whatsapp` | Meta webhook (verification, signature check, dedupe) |
| `src/app/api/razorpay` | Payment-paid webhook |
| `src/app/api/orders/[id]` | Order actions and invoice PDF |
| `src/app/api/inventory/import` | Spreadsheet inventory import |
| `src/lib/orders.ts` | Incoming-message handling and order flow |
| `src/lib/gemini.ts` | Order extraction from text, audio, images, PDFs |
| `src/lib/invoice.ts` | Invoice PDF |
| `src/lib/db.ts` | SQLite schema and access |

## Production notes

- Set `WHATSAPP_APP_SECRET`; without it webhook signatures are not checked.
- Use `rzp_test_` Razorpay keys until you have verified the flow end to end.
- Store details on the invoice come from the `STORE_*` variables.
