import type { Media } from "./ai";
import { runAgent } from "./agent";
import { db, type Customer } from "./db";
import { normLang, t } from "./i18n";
import { prepareMedia } from "./media";
import { handleButton } from "./orders";
import { handleGstinText, markUnregistered } from "./gst-collect";
import { step, withTrace } from "./trace";
import { logIncoming, sendLanguageCard, sendText } from "./whatsapp";

// Every message from a retailer, from WhatsApp or the simulator, comes in here.

export type Incoming = {
  phone: string;
  name?: string;
  kind: "text" | "audio" | "image" | "document" | "button";
  text?: string;
  buttonId?: string;
  media?: Media | (() => Promise<Media>);
};

const GREETING = /^\s*(hi+|hello+|hey+|hai|hlo|namaste|namaskara|namaskar|vanakkam|start|नमस्ते|ನಮಸ್ಕಾರ|வணக்கம்|నమస్కారం)\W*$/i;
const THANKS = /^\s*(ok(ay)?|k|thanks?|thank you|thx|dhanyavad|dhanyavaada|nandri|dhanyavaadalu|👍|🙏|ಧನ್ಯವಾದ|धन्यवाद|நன்றி|ధన్యవాదాలు)[\s!.🙏👍]*$/i;
const CHANGE_LANG = /^\s*(change\s+)?(language|bhasha|भाषा|ಭಾಷೆ|மொழி|భాష)\s*$/i;

const LABEL = { text: "", audio: "🎤 Voice note", image: "📷 Photo", document: "📎 File", button: "" };

export async function handleIncoming(msg: Incoming) {
  const d = db();
  let c = d.prepare("SELECT * FROM customers WHERE phone = ?").get(msg.phone) as Customer | undefined;
  if (!c) {
    d.prepare("INSERT INTO customers (phone, name, language, created_at) VALUES (?,?,?,?)").run(msg.phone, msg.name || "+" + msg.phone, "en", Date.now());
  } else if (msg.name && msg.name !== c.name && c.name.startsWith("+")) {
    d.prepare("UPDATE customers SET name = ? WHERE phone = ?").run(msg.name, msg.phone); // keep a name the team typed in
  }
  c = d.prepare("SELECT * FROM customers WHERE phone = ?").get(msg.phone) as Customer;
  const lang = normLang(c.language);

  if (msg.kind === "button" && msg.buttonId?.startsWith("lang:")) {
    logIncoming(msg.phone, "button", msg.text ?? msg.buttonId);
    const L = normLang(msg.buttonId.slice(5));
    d.prepare("UPDATE customers SET language = ?, lang_set = 1 WHERE phone = ?").run(L, msg.phone);
    return sendText(msg.phone, `${t(L, "langSet")}\n\n${t(L, "hello")}`);
  }
  if (msg.kind === "button" && msg.buttonId === "nogst") {
    logIncoming(msg.phone, "button", msg.text ?? msg.buttonId);
    return withTrace(msg.phone, `Tapped “${msg.text ?? "No GSTIN"}”`, async () => {
      markUnregistered(msg.phone);
      await sendText(msg.phone, t(lang, "gstNone"));
    });
  }
  if (msg.kind === "button" && msg.buttonId) {
    logIncoming(msg.phone, "button", msg.text ?? msg.buttonId);
    const id = msg.buttonId;
    return withTrace(msg.phone, `Tapped “${msg.text ?? id}”`, () => handleButton(msg.phone, id, lang));
  }

  logIncoming(msg.phone, msg.kind, [LABEL[msg.kind], msg.text].filter(Boolean).join(" ") || LABEL[msg.kind]);
  // First message of any kind (hi, an order, a voice note): ask for the language before anything else.
  if (!c.lang_set || CHANGE_LANG.test(msg.text ?? "")) return sendLanguageCard(msg.phone);
  if (!msg.media && (!msg.text?.trim() || GREETING.test(msg.text))) return sendText(msg.phone, t(lang, "hello"));
  if (!msg.media && THANKS.test(msg.text ?? "")) return sendText(msg.phone, "🙏");
  if (!msg.media && msg.text && /\d{2}\s*[a-z]{5}/i.test(msg.text)) {
    const text = msg.text;
    let done = false;
    await withTrace(msg.phone, text, async () => void (done = await handleGstinText(msg.phone, text, lang)));
    if (done) return;
  }

  const input = [LABEL[msg.kind], msg.text].filter(Boolean).join(" · ");
  return withTrace(msg.phone, input, async () => {
    let media: Media | undefined;
    try {
      media = typeof msg.media === "function" ? await msg.media() : msg.media;
    } catch (e) {
      console.error("media download failed", e);
      step("read", "Could not download the file from WhatsApp", e instanceof Error ? e.message : undefined, "bad");
      return sendText(msg.phone, t(lang, "nothingFound"));
    }
    const parts = [];
    if (media) {
      const prepared = await prepareMedia(media);
      if ("unreadable" in prepared) {
        // A caption alone can still be an order; otherwise say what we can read.
        if (!msg.text?.trim()) return sendText(msg.phone, t(lang, prepared.unreadable === "no_ai" ? "noAi" : "unsupported"));
      } else parts.push(...prepared.parts);
    }
    if (msg.text?.trim()) parts.push({ text: media ? `Caption: ${msg.text}` : msg.text });
    const source = msg.kind === "audio" ? "voice" : msg.kind === "image" ? "image" : msg.kind === "document" ? (media?.mime === "application/pdf" ? "document" : "sheet") : "text";
    await runAgent({ phone: msg.phone, lang, customer: c, media, source, said: msg.text ?? "" }, parts);
  });
}
