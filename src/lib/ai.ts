import { GoogleGenAI, type Content, type Part, type ThinkingLevel } from "@google/genai";

// One interface over the AI models, so the assistant runs the same way on the default model (Google AI Studio,
// set with AI_API_KEY and AI_MODEL) or on NVIDIA Nemotron through any OpenAI-compatible endpoint (Nebius Token
// Factory, NVIDIA's own API, a self-hosted NIM). Pick with AI_PROVIDER=default|nemotron; without it, whichever
// has a key is used, the default model first.

/** A file the retailer sent. `name` is the file name, when WhatsApp gives one (documents). */
export type Media = { mime: string; data: Buffer; name?: string };

export type AiPart = { text: string } | { media: Media };
export type AiCall = { id: string; name: string; args: Record<string, unknown> };
export type AiMessage =
  | { role: "user"; parts: AiPart[] }
  | { role: "model"; text: string; calls: AiCall[]; raw?: unknown }
  | { role: "tool"; results: { id: string; name: string; result: unknown }[] };
/** A tool the model may call. `parameters` is a JSON Schema object. */
export type AiTool = { name: string; description: string; parameters: Record<string, unknown> };
export type AiReply = Extract<AiMessage, { role: "model" }>;

export interface AiProvider {
  id: "default" | "nemotron";
  /** Shown in logs and the agent trace: "AI agent · <model>". */
  label: string;
  /** Whether a file of this type can be sent to the model as it is. */
  reads(mime: string): boolean;
  generate(o: { system: string; messages: AiMessage[]; tools?: AiTool[]; json?: boolean }): Promise<AiReply>;
}

const has = (k: string) => !!process.env[k]?.trim();

// ---------------------------------------------------------------------------
// Default model, through the Google Gen AI SDK. Reads text, voice notes, photos and PDFs as they are.
// ---------------------------------------------------------------------------

const defaultReady = () => has("AI_API_KEY") && has("AI_MODEL");

function defaultModel(): AiProvider {
  const model = process.env.AI_MODEL!.trim();
  const client = new GoogleGenAI({ apiKey: process.env.AI_API_KEY! });
  const toContents = (messages: AiMessage[]): Content[] =>
    messages.map((m) => {
      if (m.role === "user") {
        return {
          role: "user",
          parts: m.parts.map((p): Part => ("text" in p ? { text: p.text } : { inlineData: { mimeType: p.media.mime, data: p.media.data.toString("base64") } })),
        };
      }
      // Send the model's own turn back exactly as it came, so it keeps its thought signatures between tool calls.
      if (m.role === "model") return (m.raw as Content) ?? { role: "model", parts: [{ text: m.text }] };
      return { role: "user", parts: m.results.map((r): Part => ({ functionResponse: { id: r.id, name: r.name, response: { result: r.result } } })) };
    });

  return {
    id: "default",
    label: `AI agent · ${model}`,
    reads: (mime) => /^(audio|image|text)\//.test(mime) || mime === "application/pdf",
    async generate({ system, messages, tools, json }) {
      const config = {
        systemInstruction: system,
        ...(tools?.length ? { tools: [{ functionDeclarations: tools.map((t) => ({ name: t.name, description: t.description, parametersJsonSchema: t.parameters })) }] } : {}),
        ...(json ? { responseMimeType: "application/json" } : {}),
      };
      // Low thinking keeps WhatsApp replies quick; the app does the arithmetic and checks itself.
      const level = (process.env.AI_THINKING || "low").toUpperCase() as ThinkingLevel;
      const res = await client.models
        .generateContent({ model, contents: toContents(messages), config: { ...config, thinkingConfig: { thinkingLevel: level } } })
        .catch((e) => {
          if (!/thinking/i.test(String(e))) throw e;
          return client.models.generateContent({ model, contents: toContents(messages), config }); // model without thinking levels
        });
      console.log("ai usage", "default", res.usageMetadata); // tokens in/out, for tracking cost
      const content = res.candidates?.[0]?.content;
      return {
        role: "model",
        text: (content?.parts ?? []).filter((p) => p.text && !p.thought).map((p) => p.text).join("").trim(),
        calls: (res.functionCalls ?? []).map((c, i) => ({ id: c.id ?? `call_${i}`, name: c.name ?? "", args: c.args ?? {} })),
        raw: content,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// NVIDIA Nemotron, over the OpenAI chat completions API
// ---------------------------------------------------------------------------

type OaPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } } | { type: "input_audio"; input_audio: { data: string; format: string } };
type OaMessage =
  | { role: "system" | "user"; content: string | OaPart[] }
  | { role: "assistant"; content: string | null; tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[] }
  | { role: "tool"; tool_call_id: string; content: string };

function nemotron(): AiProvider {
  const base = (process.env.NEMOTRON_BASE_URL || "https://api.tokenfactory.nebius.com/v1").replace(/\/$/, "");
  const model = process.env.NEMOTRON_MODEL || "nvidia/nemotron-3-nano-omni";
  // The default model is multimodal (Nemotron 3 Nano Omni: text, images and voice). If NEMOTRON_MODEL is a
  // text-only model, set these to route photos and voice notes to a vision / audio-capable model instead.
  const textOnly = process.env.NEMOTRON_TEXT_ONLY === "1";
  const vision = process.env.NEMOTRON_VISION_MODEL?.trim() || (textOnly ? undefined : model);
  // Voice notes go to the audio-capable model as OpenAI "input_audio" parts.
  const audio = process.env.NEMOTRON_AUDIO_MODEL?.trim() || (textOnly ? undefined : model);
  const toMessages = (system: string, messages: AiMessage[]): OaMessage[] => [
    // Nemotron reasons step by step unless told not to; that is slow for chat replies, so it is off unless asked for.
    { role: "system", content: `${process.env.NEMOTRON_THINKING === "1" ? "" : "/no_think\n"}${system}` },
    ...messages.flatMap((m): OaMessage[] => {
      if (m.role === "user") {
        const parts = m.parts.map((p): OaPart => {
          if ("text" in p) return { type: "text", text: p.text };
          const data = p.media.data.toString("base64");
          if (p.media.mime.startsWith("audio/")) return { type: "input_audio", input_audio: { data, format: /wav/.test(p.media.mime) ? "wav" : "mp3" } };
          return { type: "image_url", image_url: { url: `data:${p.media.mime};base64,${data}` } };
        });
        return [{ role: "user", content: parts.every((p) => p.type === "text") ? parts.map((p) => (p as { text: string }).text).join("\n") : parts }];
      }
      if (m.role === "model") {
        return [{
          role: "assistant",
          content: m.text || null,
          ...(m.calls.length ? { tool_calls: m.calls.map((c) => ({ id: c.id, type: "function" as const, function: { name: c.name, arguments: JSON.stringify(c.args) } })) } : {}),
        }];
      }
      return m.results.map((r) => ({ role: "tool" as const, tool_call_id: r.id, content: JSON.stringify(r.result) }));
    }),
  ];

  return {
    id: "nemotron",
    label: `Nemotron · ${model}`,
    reads: (mime) => mime.startsWith("text/") || (!!vision && mime.startsWith("image/")) || (!!audio && /^audio\/(mpeg|mp3|wav|x-wav)/.test(mime)),
    async generate({ system, messages, tools, json }) {
      const media = messages.flatMap((m) => (m.role === "user" ? m.parts.filter((p) => "media" in p) : [])) as { media: Media }[];
      const hasAudio = media.some((p) => p.media.mime.startsWith("audio/"));
      const hasImage = media.some((p) => p.media.mime.startsWith("image/"));
      const res = await fetch(`${base}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.NEMOTRON_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: hasAudio && audio ? audio : hasImage && vision ? vision : model,
          messages: toMessages(system, messages),
          temperature: 0.2,
          ...(tools?.length ? { tools: tools.map((t) => ({ type: "function", function: t })), tool_choice: "auto" } : {}),
          ...(json ? { response_format: { type: "json_object" } } : {}),
        }),
      });
      if (!res.ok) throw new Error(`Nemotron ${res.status}: ${(await res.text()).slice(0, 500)}`);
      const out = (await res.json()) as {
        choices?: { message?: { content?: string | null; tool_calls?: { id: string; function: { name: string; arguments: string } }[] } }[];
        usage?: unknown;
      };
      console.log("ai usage", "nemotron", out.usage);
      const msg = out.choices?.[0]?.message;
      const calls = (msg?.tool_calls ?? []).map((c) => {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(c.function.arguments || "{}");
        } catch {
          console.error("nemotron sent tool arguments that are not JSON", c.function.arguments);
        }
        return { id: c.id, name: c.function.name, args };
      });
      // Reasoning models may wrap their thinking in <think> tags; the retailer must never see it.
      const text = (msg?.content ?? "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
      return { role: "model", text, calls, raw: msg };
    },
  };
}

// ---------------------------------------------------------------------------

export function aiProvider(): AiProvider | null {
  const want = process.env.AI_PROVIDER?.trim().toLowerCase();
  if (want === "nemotron") return has("NEMOTRON_API_KEY") ? nemotron() : null;
  if (want === "default") return defaultReady() ? defaultModel() : null;
  if (defaultReady()) return defaultModel();
  if (has("NEMOTRON_API_KEY")) return nemotron();
  return null;
}

export const aiEnabled = () => aiProvider() !== null;

/**
 * A model that can read this file, for providers that cannot (e.g. Nemotron and PDFs):
 * the main provider if it can, otherwise the default model when its key is also set.
 */
export function readerFor(mime: string): AiProvider | null {
  const main = aiProvider();
  if (main?.reads(mime)) return main;
  if (main?.id !== "default" && defaultReady()) {
    const g = defaultModel();
    if (g.reads(mime)) return g;
  }
  return null;
}

/** Model output that should be JSON, with any ``` fences or stray text around it removed. */
export function parseJson<T>(raw: string | undefined): T {
  const s = (raw ?? "").trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const start = s.search(/[[{]/);
  const end = Math.max(s.lastIndexOf("}"), s.lastIndexOf("]"));
  return JSON.parse(start >= 0 && end > start ? s.slice(start, end + 1) : s) as T;
}
