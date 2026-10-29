import { spawnSync } from "node:child_process";
import { aiProvider } from "./ai";

// Every outside tool the app can use, what it is allowed to do, and whether it is set up.
// Only reports whether each key is set, never its value.

export type IntegrationStatus = "connected" | "test" | "partial" | "off" | "planned";

export type Integration = {
  id: string;
  name: string;
  category: "Messaging" | "AI" | "Payments" | "Email" | "Search" | "System";
  status: IntegrationStatus;
  note?: string;
  usedFor: string;
  access: string[]; // what the app can do with it
  keys: { name: string; set: boolean; required: boolean }[];
};

const has = (k: string) => !!process.env[k]?.trim();
const keys = (required: string[], optional: string[] = []) => [
  ...required.map((name) => ({ name, set: has(name), required: true })),
  ...optional.map((name) => ({ name, set: has(name), required: false })),
];
const statusOf = (k: Integration["keys"]): IntegrationStatus => {
  const req = k.filter((x) => x.required);
  if (req.every((x) => x.set)) return "connected"; // missing optional keys show in the key list
  return req.some((x) => x.set) ? "partial" : "off";
};

let ffmpeg: boolean | undefined;
function ffmpegFound() {
  ffmpeg ??= spawnSync(process.env.FFMPEG_PATH || "ffmpeg", ["-version"], { timeout: 3000 }).status === 0;
  return ffmpeg;
}

export function integrations(): Integration[] {
  const wa = keys(["WHATSAPP_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_VERIFY_TOKEN"], ["WHATSAPP_APP_SECRET", "PUBLIC_BASE_URL"]);
  const waPay = keys(["WHATSAPP_PAYMENT_CONFIG"], ["WHATSAPP_CATALOG_ID"]);
  // Either model runs the assistant, so no key is required on its own
  const model = keys([], ["AI_API_KEY", "AI_MODEL", "AI_THINKING", "NEMOTRON_API_KEY", "NEMOTRON_MODEL", "NEMOTRON_AUDIO_MODEL", "NEMOTRON_VISION_MODEL", "NEMOTRON_BASE_URL", "NEMOTRON_TEXT_ONLY", "AI_PROVIDER"]);
  const tavily = keys(["TAVILY_API_KEY"]);
  const active = aiProvider()?.id;
  const rzp = keys(["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET"], ["RAZORPAY_WEBHOOK_SECRET"]);
  const rzpStatus = statusOf(rzp);
  const testMode = process.env.RAZORPAY_KEY_ID?.startsWith("rzp_test_");

  return [
    {
      id: "whatsapp",
      name: "WhatsApp Business (Meta Cloud API)",
      category: "Messaging",
      status: statusOf(wa),
      note: !has("WHATSAPP_APP_SECRET") && has("WHATSAPP_TOKEN") ? "Webhook signatures are not checked until WHATSAPP_APP_SECRET is set" : undefined,
      usedFor: "Where retailers place orders and get replies",
      access: [
        "Reads messages, voice notes, photos, PDFs and Excel sheets sent to your business number",
        "Sends replies, confirmation buttons and the language picker",
        "Sends invoice PDFs (needs PUBLIC_BASE_URL so Meta can fetch them)",
      ],
      keys: wa,
    },
    {
      id: "whatsapp-pay",
      name: "WhatsApp in-chat payments",
      category: "Payments",
      status: statusOf(waPay),
      usedFor: "A Pay button inside the chat, processed by Razorpay",
      access: ["Sends an order card the retailer can pay by UPI or card without leaving WhatsApp", "Receives the payment result"],
      keys: waPay,
    },
    {
      // One assistant, whichever model is set up: the default model, or NVIDIA Nemotron when only its key is set.
      id: "ai",
      name: "AI assistant",
      category: "AI",
      status: active ? "connected" : has("AI_API_KEY") || has("NEMOTRON_API_KEY") ? "partial" : "off",
      note: active === "nemotron"
        ? `NVIDIA Nemotron (OpenAI-compatible API) · ${process.env.NEMOTRON_MODEL || "nvidia/Llama-3_3-Nemotron-Super-49B-v1_5"}${has("NEMOTRON_AUDIO_MODEL") ? "" : " · voice notes need NEMOTRON_AUDIO_MODEL"}`
        : active === "default"
          ? `Model ${process.env.AI_MODEL}${has("NEMOTRON_API_KEY") ? " · set AI_PROVIDER=nemotron to run on NVIDIA Nemotron instead" : ""}`
          : "Set AI_API_KEY and AI_MODEL, or NEMOTRON_API_KEY for NVIDIA Nemotron. Without either, only typed orders work, matched by keywords.",
      usedFor: "Understands orders, questions, returns and licences in any language",
      access: [
        "Receives the retailer's message, voice note, photo, PDF or sheet, recent chat, their dues summary and your product list",
        "Calls the assistant's tools (stock, order, dues, returns); every price, stock and credit rule is checked by this app",
        "Reads stock lists from photos and PDFs, and writes the daily summary",
      ],
      keys: model,
    },
    {
      id: "razorpay",
      name: "Razorpay",
      category: "Payments",
      status: rzpStatus === "off" ? "off" : testMode ? "test" : rzpStatus,
      note: testMode ? "Test keys: no real money moves" : rzpStatus === "off" ? "Without it the Pay button sends a plain UPI link" : undefined,
      usedFor: "Payment links for bills",
      access: ["Creates a payment link for each bill (UPI, cards, netbanking)", "Is told when a link is paid, and marks the order paid"],
      keys: rzp,
    },
    {
      id: "upi",
      name: "UPI (direct)",
      category: "Payments",
      status: has("UPI_ID") ? "connected" : "off",
      usedFor: "Fallback payment link when Razorpay is not set up",
      access: ["Puts your UPI ID, store name and the bill amount in a upi:// link"],
      keys: keys(["UPI_ID"]),
    },
    {
      id: "email",
      name: "Email",
      category: "Email",
      status: "planned",
      usedFor: "Invoices and payment reminders by email",
      access: ["Will send invoices and overdue reminders to the retailer's email address"],
      keys: [],
    },
    {
      id: "tavily",
      name: "Tavily web search",
      category: "Search",
      status: statusOf(tavily),
      note: has("TAVILY_API_KEY") ? undefined : "Without it, the agent only offers substitutes from compositions already in your catalogue",
      usedFor: "Identifying a medicine you do not stock, so a same-composition product can be offered",
      access: [
        "Receives only a medicine name (e.g. “Ascoril LS”), never the retailer, the order or any other data",
        "Searches pharmacy references only (1mg, PharmEasy, Netmeds, Apollo, MedlinePlus, Drugs.com, CDSCO, Jan Aushadhi)",
      ],
      keys: tavily,
    },
    {
      id: "ffmpeg",
      name: "ffmpeg",
      category: "System",
      status: ffmpegFound() ? "connected" : "off",
      note: ffmpegFound() ? undefined : "Not found on this server. Voice notes are sent to the AI unconverted",
      usedFor: "Converting voice notes before the AI reads them",
      access: ["Runs on this server only; audio never leaves it for this step"],
      keys: keys([], ["FFMPEG_PATH"]),
    },
  ];
}

export type Plain = { id: string; name: string; on: boolean | "test" | "soon"; text: string };

/** The same list for the shop owner: what is switched on, in everyday words. */
export function plainSettings(list = integrations()): Plain[] {
  const by = (id: string) => list.find((i) => i.id === id)!;
  const ok = (id: string) => ["connected", "test"].includes(by(id).status);
  const rzp = by("razorpay").status;
  return [
    {
      id: "whatsapp", name: "WhatsApp", on: ok("whatsapp"),
      text: ok("whatsapp") ? "Retailers can send orders to your WhatsApp number." : "Not connected yet. Use Practice chat to try things out.",
    },
    {
      id: "ai", name: "AI assistant", on: ok("ai"),
      text: ok("ai") ? "Understands orders in any language: typed, voice notes, photos of lists, PDFs and Excel sheets." : "Off. Only simple typed orders are understood.",
    },
    {
      id: "pay", name: "Online payments", on: rzp === "test" ? "test" : rzp === "connected" || ok("upi"),
      text: rzp === "test" ? "Set up in test mode: no real money moves yet." : rzp === "connected" ? "Retailers can pay bills by UPI, card or netbanking." : ok("upi") ? "Retailers get a UPI link to pay each bill." : "Retailers cannot pay online yet.",
    },
    {
      id: "lookup", name: "Medicine lookup", on: ok("tavily"),
      text: ok("tavily") ? "If you do not stock a medicine, the assistant finds one with the same ingredients." : "Off. Substitutes come only from medicines you already stock.",
    },
    { id: "email", name: "Email", on: "soon", text: "Bills and reminders by email. Coming soon." },
  ];
}
