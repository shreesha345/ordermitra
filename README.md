# OrderMitra

WhatsApp order desk for a pharmaceutical wholesaler. Retail pharmacies message it the way they already do: text, a voice note, a photo of a list, a PDF or an Excel sheet, in English, Hindi, Kannada, Tamil or Telugu. An AI agent reads it, checks stock, credit and the retailer's drug licence, and sends back a GST invoice with a pay-now discount. The wholesaler's team only reviews and dispatches.

## Setup

```bash
npm install
cp .env.example .env   # then fill in the keys
npm run dev
```

Open http://localhost:3000. Data is stored in `data/intova.db` (SQLite, gitignored).

Without an AI key only typed messages work, matched by keywords. Without Razorpay keys the Pay button sends a plain `upi://` link.

## What the AI agent does on WhatsApp

| Retailer says or sends | What happens |
| --- | --- |
| An order: text, voice note, photo, PDF or Excel/CSV | Items matched to the catalogue, a confirm card in their language, then a stock check |
| A handwritten list, in any language and script, with units ("10 patta", "2 dabba", "५० गोली", "45 tabs") | Each line read with its unit; tablets become strips and boxes become strips or bottles when the pack size is known, and the card says what they wrote |
| A long order (more than 15 lines) | A short card with counts, what is not in your list and what is short ("you asked 50, we have 30"), and a link to a mobile page with every item, quantity and unit |
| Many items short at once | One message with "Keep what's there" or "Take substitutes" for all of them, instead of one message per item |
| Their GSTIN, typed or as a GST certificate photo | Checked (format and check digit) and saved; asked for once a week with an order until they answer or tap "No GSTIN" |
| An item that is out of stock or short | Offers a product with the same composition, or keeps what is available |
| "Same as last time, plus 20 Dolo" | Repeats the last order with the changes |
| "Is X available? Rate?" | Stock and rate with GST; for a medicine you do not stock, a same-composition alternative (Tavily, optional) |
| "How much do I owe?", "What discount if I pay today?" | Unpaid bills with today's discounted amount and a Pay button for each |
| "Where is my order?" | Status and dispatch of recent orders |
| A return (or a photo of strips) | Logs a return request with batch and expiry, checking that batch was sold to them |
| A photo of their drug licence | Reads the licence number, forms and expiry for your team to verify |
| "Please call me" | Logs a callback request |

Several requests in one message are handled together. Each step the agent takes is saved and shown on the order page and in the simulator under **What the AI agent did**.

## Credit, discounts and licences

- **Credit period**: `CREDIT_DAYS` (default 30) from the bill date.
- **Pay sooner, pay less**: `PROMPT_PAY_DISCOUNT` tiers (default 2% within 1 day, 1% within 7, 0.5% within 15). The bill shows each tier; the discount is issued as a credit note when the payment arrives, so the tax invoice never changes.
- **Credit decision on every bill**, made by the app, not the AI:
  - *On credit*: the retailer may pay now (discounted) or take it on credit.
  - *Pay first*: an earlier bill is overdue. The Pay button is shown, but no credit option.
  - *Held for you*: over the credit limit, or a Schedule H/H1/X medicine without a verified, in-date drug licence. The order waits under **Needs your credit decision**, and you approve on credit, approve as pay-first, or deny.
- **Payment grade** (A to D) per retailer, from how many days they usually take to pay.
- **Licences**: Schedule H/H1 need a Form 20, 20A or 20B licence; Schedule X also needs 20F or 20G. A licence counts once someone ticks *checked* on the retailer page, or approves the licence photo under **Requests**. Confirm these rules with your compliance person.

## GST invoices

The PDF follows the tax-invoice contents of Rule 46 (CGST Rules) and what pharma bills carry:

- Serial number unique and consecutive within the financial year, given only when a bill is issued: `INV/26-27/0001` (`INVOICE_PREFIX` changes `INV`)
- Seller and buyer GSTIN, state and state code, drug licence numbers; place of supply; reverse charge
- Per line: product with manufacturer and pack, HSN, batch, expiry, quantity, MRP, rate, taxable value, GST rate and amount
- Tax summary by HSN (CGST and SGST, or IGST for another state), totals, amount and tax in words
- Payment terms with the early-payment table, or a PAID receipt with the credit note; declaration, jurisdiction and signatory

Each product carries its own HSN and GST rate (5% / 3004 by default). Check them with your accountant.

## GST returns

The **GST returns** page builds GSTR-1 for any month from the bills issued: B2B invoices (4A), B2C small (7), credit notes to registered buyers for prompt-payment discounts (9B), the HSN summary split into B2B and B2C (12), and documents issued (13), plus the GSTR-3B 3.1(a) totals. **GSTR-1 Excel** downloads a workbook laid out like the GST offline tool's template (import it with *Import Excel*, generate the JSON, upload on the portal); each section is also a CSV. Before filing it lists what to fix: retailers without a GSTIN, GSTINs that fail the check digit, HSN codes shorter than 6 digits.

Bills to retailers without a GSTIN are taken as supplies within your state. UQC follows the selling unit (bottles BTL, tubes TUB, boxes BOX, others NOS). Have your accountant check the first month.

## Demand and forecast

The **Demand** page shows best sellers, what is rising or falling, and what to stock up on. Demand is what retailers asked for, including what you could not supply. Each product's weekly demand over 12 weeks goes through Holt's smoothing with a damped trend to forecast the next 30 days; the suggested order is that forecast plus a safety buffer (from past forecast error over `SUPPLIER_LEAD_DAYS`) minus free stock, rounded up to whole boxes. Each suggestion says why (rising demand, days of stock left, unmet demand). With little history it orders for two weeks only.

## Stock, batches and expiry

Stock is held per batch. Import a stock sheet (Excel or CSV) with a batch and expiry column and each row becomes a batch of that product; re-importing sets the quantities again rather than adding to them. Expired batches stop counting as sellable stock, and orders take the batch that expires first. The **Expiry report** on the Inventory page groups batches into already expired, within 30 days, 31 to 90 days and 3 to 6 months, with quantity, rack and value, and the morning briefing flags expired and soon-to-expire stock.

## Dashboard

| Page | What it shows |
| --- | --- |
| Today | A to-do list for the day with one-click actions (reminders for overdue dues, restock nudges), today's numbers, the 14-day chart, the queue |
| Orders | Status tabs, the transcript, item matching, the conversation, the credit decision, the bill and what the AI agent did |
| Retailers | Licence status, payment grade, dues against the limit; per retailer the dues, regular items and reminder buttons |
| Stock | Quantity you can sell, next batch and expiry, rate and MRP, the expiry report, and demand you missed (products asked for but not stocked, sales lost to short stock). Imports Excel, CSV, photos and PDFs |
| What to buy | Best sellers, rising and falling products, a 30-day forecast and what to order now, with the reason |
| GST filing | GSTR-1 by month as an offline-tool Excel workbook or CSVs, GSTR-3B 3.1(a) totals and checks before filing |
| Returns and calls | Returns, licences to verify and callbacks the AI agent handed over. The retailer is told on WhatsApp when you decide |
| Settings | What is switched on (WhatsApp, AI assistant, payments, medicine lookup) in plain words; keys and model details under Technical details |
| Practice chat | Play a retailer through the real flow, with the agent's steps shown live |

**Ask** (the button at the bottom right of every page) opens a chat with the assistant about your own data: "How much did I sell this week?", "Who owes me the most?", "Which medicines expire this month?". It can also change stock when told ("Add 100 strips of Dolo 650 at ₹30", "we have 40 Azee 500 left", "remove 10 damaged Cofsils"), read a photo or PDF of a supplier bill and add every line, and change a retailer's credit limit. Questions run on a read-only connection to the database, so asking can never change data; changes go through the same code as a stock upload and show under Stock history.

Safety, enforced in code rather than by asking the AI nicely:

- **Dashboard lock.** Without `DASHBOARD_PASSWORD` the dashboard only opens on the computer it runs on; through ngrok or from another device it answers 403. With it set, the browser asks for the password. Only the WhatsApp and Razorpay webhooks (signature-checked), retailers' order pages (random link) and invoice PDFs with their random key stay public. Requests that change things must come from the dashboard itself (no cross-site forms). If staff open it from other devices on the shop network, set a password.
- **Prompt injection.** Text from retailers, suppliers and files is data, never instructions. Database text that looks like instructions ("ignore previous instructions…") is hidden from the AI and reported. Once such text, or an attached file, has been read, every change in that answer waits for Confirm. The WhatsApp agent has the same rule, and its tools only touch the chatting retailer's own account.
- **Confirm before big changes.** Changing more than 20 medicines, a price moving by more than half, stock going down a lot, GST changes, removing a licence rule, and any credit limit increase are shown as a card with **Confirm / Cancel**. Only the owner's button applies it; the AI cannot.
- **Value checks** on every stock change (upload, Add medicine or AI): quantity up to 1,00,000, price up to ₹1,00,000, GST one of 0/0.25/3/5/12/18/28, real expiry dates, HSN 4–8 digits, names cleaned of markup. Bad values are not saved and the reason is shown.
- **Undo.** Each change the assistant makes has an Undo button for a day, as long as nothing (an order, another edit) has touched that medicine since. Everything is logged in `assistant_actions`.
- **No deletes.** The assistant cannot delete, cancel orders, touch bills or payments, or send messages. On the Stock page, **Add medicine** does the same by hand.

The dashboard is in English, Hindi, Kannada, Tamil or Telugu (picker in the sidebar; `DASHBOARD_LANGUAGE` sets the default). The translations live in `src/locales`; after adding UI text, `npm run i18n translate` fills in the other languages with the AI model (placeholders are checked), and `npm run i18n list` shows what is missing.

## AI models

`AI_PROVIDER=default` or `nemotron`. Without it, whichever has a key is used, the default model first.

- **Default model** (`AI_API_KEY` from Google AI Studio, `AI_MODEL` from its model list) reads text, voice notes, photos and PDFs natively.
- **Nemotron** (`NEMOTRON_API_KEY`, `NEMOTRON_BASE_URL`, `NEMOTRON_MODEL`) runs through any OpenAI-compatible endpoint: Nebius Token Factory (default), NVIDIA's API or a self-hosted NIM. The default model, `nvidia/nemotron-3-nano-omni`, is multimodal, so voice notes (sent as OpenAI `input_audio`) and photos work out of the box; override with `NEMOTRON_AUDIO_MODEL` / `NEMOTRON_VISION_MODEL`, or set `NEMOTRON_TEXT_ONLY=1` for a text-only model; PDFs are read by the default model when its key is also set. Check the exact model id in your provider's model list.

The model only reads and decides what to do; prices, stock, GST, discounts and the credit decision are always computed by the app.

## Demo

The simulator works without any WhatsApp setup. To fill the dashboard with six sample pharmacies (a fast payer, a slow payer with an overdue bill, one in Kerala for IGST, one without a licence) and two weeks of orders, click **Load demo data** on an empty store, or set `DEMO_MODE=1` to allow **Reset demo data** at any time (it wipes all data). Simulator and demo numbers start with `910000`, which no real Indian mobile does, so nothing is ever sent to WhatsApp for them.

## White-labelling

- `APP_NAME`: product name in the sidebar, browser tab and invoice footer (default `OrderMitra`)
- `STORE_NAME`, `STORE_ADDRESS`, `STORE_DRUG_LICENCE`, `STORE_GSTIN`: the seller, on invoices and payment requests. The GSTIN's first two digits decide intra- or inter-state tax.

Restart the server (or rebuild, for a production deploy) after changing them.

## Receiving WhatsApp messages locally

Meta needs a public https URL. `npm run dev:tunnel` starts ngrok, runs `next dev` with `PUBLIC_BASE_URL` set to the tunnel, and prints the webhook URLs:

- WhatsApp: `<PUBLIC_BASE_URL>/api/whatsapp` (verify token = `WHATSAPP_VERIFY_TOKEN`)
- Razorpay: `<PUBLIC_BASE_URL>/api/razorpay`, event `payment_link.paid`

ngrok must be installed and signed in (`ngrok config add-authtoken ...`). Set `META_APP_ID` and `WHATSAPP_BUSINESS_ACCOUNT_ID` to have the webhook registered with Meta automatically.

## Layout

| Path | What it does |
| --- | --- |
| `src/lib/assistant.ts` | Entry point for every incoming message: language, buttons, files |
| `src/lib/agent.ts`, `tools.ts` | The AI agent's instructions and tools, and the keyword fallback |
| `src/lib/ai.ts` | The default model and Nemotron behind one interface |
| `src/lib/orders.ts` | Order flow: confirm, stock, substitutes, billing, payment |
| `src/lib/owner-assistant.ts`, `stock-edit.ts` | The dashboard assistant (Ask), and adding or changing medicines |
| `src/lib/billing.ts` | GST, prompt-payment discounts, credit decision, payment grade |
| `src/lib/gstr1.ts`, `gstin.ts`, `gst-collect.ts` | GSTR-1 report, GSTIN check digit, asking retailers for their GSTIN |
| `src/lib/demand.ts` | Demand history and forecast |
| `src/lib/units.ts`, `order-view.ts`, `order-page.ts` | Units and Indian numerals, the retailer's full-order page |
| `src/lib/invoice.ts` | Invoice PDF |
| `src/lib/sheet.ts` | Excel/CSV reader (handles tables, images, title rows) |
| `src/lib/briefing.ts`, `outreach.ts` | Morning briefing, dues and restock reminders |
| `src/lib/requests.ts` | Returns, licences and callbacks |
| `src/lib/tavily.ts` | Medicine-name lookup |
| `src/lib/db.ts` | SQLite schema and migrations |

## Production notes

- Set `WHATSAPP_APP_SECRET`; without it webhook signatures are not checked.
- Use `rzp_test_` Razorpay keys until you have verified the flow end to end.
- WhatsApp only allows free-form messages within 24 hours of the retailer's last message. Dues and restock reminders to retailers who have not written recently need an approved message template.
- Check the GST rate and HSN of each product; the default is 5% / 3004.

## License

Licensed under the [Apache License 2.0](LICENSE).
