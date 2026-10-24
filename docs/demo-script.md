# OrderMitra: 3-minute demo script

Total: about 175 seconds, about 400 spoken words. Read it at a calm, normal pace. Do not rush.
Left column is what you SAY. Right column is what the VIEWER SEES.

---

## 0:00 to 0:30. The problem, then the fix (30 sec)

Short lines on purpose. You can dictate each line with Wispr Flow, one at a time, and it will come out clean.

| SAY | SEE |
| --- | --- |
| "Before this, every order started with a phone call." | Raw shot: a phone ringing, the wholesaler picking up. |
| "And the calls were long. Someone had to check the stock by hand. See if it is available. Check the price. Compare it. Review it." | Quick cuts: a person flipping a stock register, a calculator, a scribbled price list. |
| "Then write the bill. Then send the GST filing details. All of this, for one order." | A handwritten bill, a pile of papers, a clock. |
| "It took too much time. So we asked: what if an AI agent does all of it?" | Cut to black for one beat. |
| "That is OrderMitra. It lives inside WhatsApp, and it does the whole job in seconds." | Logo (`public/logo-mark.svg`) on a blue (#1F5FD6) card, then the WhatsApp chat. |

**Captions (in order):** `One order = one long phone call` `Check stock. Check price. Compare. Review.` `Write the bill. Send the GST details.` `Too slow.` `OrderMitra. An AI agent on WhatsApp.`

---

## 0:30 to 1:20. Demo 1: WhatsApp on your phone (50 sec)

Screen-record your phone. Same chat, four inputs, one after another. Keep each one short and cut between them.

| SAY | SEE |
| --- | --- |
| "Here I am a pharmacy. I can send a photo of my handwritten list." | Send the photo. AI replies with a confirm card in your language. |
| "Or a PDF." | Send `docs/sample-order.pdf`. Items matched, confirm card. |
| "Or just talk. A voice note, in Hindi, Kannada, Tamil, Telugu, or English." | Hold the mic, say the order. AI replies. |
| "Or type. I'm using Wispr Flow, so I just speak and it types for me." | Wispr Flow types the text into the chat. Send. |
| "The AI matches every item, checks stock, and if something is short, it offers the same medicine from another brand. I tap confirm." | Tap **Confirm** (or **Take substitutes**). |
| "And in seconds I get a GST invoice, with a discount if I pay today. One tap to pay." | The invoice PDF arrives, then the **Pay** button and the discount line. |

**Captions:** `Photo` `PDF` `Voice note` `Text (via Wispr Flow)` then `Invoice + pay-now discount in seconds`

(You said you will send the full WhatsApp demo separately. Use this section as a short teaser, or swap in your full recording here. Keep it to about 50 seconds.)

---

## 1:20 to 2:35. Demo 2: The dashboard (75 sec)

Screen-record the dashboard with the **demo data loaded**. One feature, one screen, about 8 seconds each. Zoom into the part you are talking about.

| SAY | SEE (page) |
| --- | --- |
| "On the other side, the wholesaler opens the dashboard. **Today** shows what needs attention: the order queue, today's sales, and one-click reminders." | **Today**: to-do list, 14-day chart. Click one reminder button. |
| "Open any order and you see exactly what the AI did, step by step. Nothing is hidden." | **Orders**, open one: transcript, matched items, **What the AI agent did**. |
| "The app checks credit and the drug licence for every order. If a retailer owes too much, or has no valid licence for a restricted medicine, the order waits for the owner to decide." | **Needs your credit decision**: show approve / pay-first / deny. |
| "Retailers get a payment grade, A to D, based on how fast they pay." | **Retailers**: grade, dues, licence status. |
| "Stock is tracked by batch and expiry. It shows what is expiring soon, and what customers asked for that you did not have." | **Stock**: expiry report, missed demand. |
| "It forecasts demand and tells you what to buy, and why." | **What to buy**: forecast, suggested order. |
| "GST returns? One click. GSTR-1, ready to upload." | **GST filing**: click **GSTR-1 Excel**. |
| "And you can just ask. 'Who owes me the most?' 'Add 100 strips of Dolo.' It does it." | Click **Ask**, type a question, show the answer. Then one stock change with the **Undo** button. |

**Captions (one per screen):** `Today` `What the AI did` `Credit + licence check` `Payment grade` `Batch + expiry` `What to buy` `GST in one click` `Ask anything`

---

## 2:35 to 2:50. Product review: why it is safe (15 sec)

| SAY | SEE |
| --- | --- |
| "It is built to be safe. The AI reads and suggests. The app, not the AI, calculates price, GST and credit. Big changes need the owner to confirm. Every change can be undone." | Show a **Confirm / Cancel** card, then the **Undo** button. |

**Caption:** `AI reads. The app decides. You approve.`

---

## 2:50 to 3:00. Close

| SAY | SEE |
| --- | --- |
| "OrderMitra. Orders in on WhatsApp. Bills out in seconds. Your team only reviews and dispatches." | Logo, tagline, your name / contact. |

**Caption:** `OrderMitra. Less typing. Faster payments.`

---

## Look and feel (raw + branded)

- **Raw:** real screen recordings, no stock footage, no fancy transitions. Hard cuts only. Leave in the real phone status bar and real typing.
- **Brand:** primary blue `#1F5FD6`, soft blue `#EAF1FD`, font Geist (the app's own font). Logo bottom-right corner on every shot.
- **Captions:** burned in, word-by-word, white text on a dark rounded box or a blue box, bottom third, 2 to 4 words at a time. Add a second caption for Hindi or Kannada voice-note shots so non-speakers can follow.
- **Music:** very low, no vocals.

## Before you record (checklist)

1. `npm run dev:tunnel` so WhatsApp can reach your laptop (needs ngrok signed in).
2. Click **Load demo data** (or `DEMO_MODE=1`) so the dashboard is full.
3. Have these ready on your phone: a photo of a handwritten list, `docs/sample-order.pdf`, `docs/sample-order-new-stock.pdf` (shows a missing or short item), a Hindi or Kannada voice order.
4. Pick a pharmacy with a licence and good credit for the main run. Keep an unlicensed or overdue one for the "credit decision" screen.
5. Turn on Do Not Disturb, set phone to 100% battery, screen brightness up.
6. Run it once as a dry run in **Practice chat** (`/simulator`) if WhatsApp misbehaves. It shows the same agent steps.
7. Time it. If you run over 3:00, shorten the dashboard section first.

## Note

"Product review" in your message: I read it as a quick overview of what the product is and why it is safe (the 2:35 section). If you meant customer reviews or testimonials, tell me and I will add a slot for them.
