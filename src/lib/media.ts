import { aiProvider, readerFor, type AiPart, type Media } from "./ai";
import { toMp3 } from "./audio";
import { isSheet, mainTable, readTables, tableText } from "./sheet";
import { step } from "./trace";

// Turns whatever the retailer sent into something the AI agent can read: the file itself when the model
// reads that format, otherwise text (a sheet as rows, a voice note or photo transcribed by a model that can).

export type Prepared = { parts: AiPart[]; label: string } | { unreadable: "unsupported" | "no_ai"; label: string };

const KIND = (m: Media) =>
  m.mime.startsWith("audio/") ? "voice note" : m.mime.startsWith("image/") ? "photo" : m.mime === "application/pdf" ? "PDF" : isSheet(m.name ?? "", m.mime) ? "spreadsheet" : "file";

const TRANSCRIBE: Record<string, string> = {
  "voice note": "Transcribe this voice note word for word, in the language and script it is spoken in. Then give an English translation on a new line starting with 'English:'.",
  photo: "This photo was sent to a medicine wholesaler. Write out every piece of text in it exactly (medicine names, strengths, quantities, batch numbers, expiry dates, licence numbers, dates, names), line by line, keeping the layout of any list or table. If it is a photo of medicine strips or boxes, list each product with its batch and expiry. If it is too blurry to read, say UNREADABLE.",
  PDF: "Write out every piece of text in this document exactly, keeping the layout of any list or table.",
};

export async function prepareMedia(media: Media): Promise<Prepared> {
  const kind = KIND(media);
  if (kind === "spreadsheet") {
    try {
      const t = mainTable(await readTables(media.data, media.name ?? "sheet.xlsx", media.mime));
      step("read", `Read spreadsheet${media.name ? ` “${media.name}”` : ""}`, `${t.rows.length} rows from sheet “${t.sheet}”`, "good");
      return { label: kind, parts: [{ text: `[The retailer sent a spreadsheet${media.name ? ` named ${media.name}` : ""}]\n${tableText(t)}` }] };
    } catch (e) {
      step("read", "Could not open the spreadsheet", e instanceof Error ? e.message : undefined, "bad");
      return { label: kind, unreadable: "unsupported" };
    }
  }
  if (media.mime.startsWith("text/")) return { label: "text file", parts: [{ text: media.data.toString("utf8").slice(0, 20_000) }] };
  if (kind === "file") {
    step("read", `Cannot read this file type (${media.mime})`, undefined, "bad");
    return { label: kind, unreadable: "unsupported" };
  }

  const file = kind === "voice note" ? await toMp3(media) : media;
  const main = aiProvider();
  if (!main) return { label: kind, unreadable: "no_ai" };
  if (main.reads(file.mime)) {
    step("read", `Sent the ${kind} to the AI agent`, `${Math.round(file.data.length / 1024)} KB`);
    return { label: kind, parts: [{ media: file }] };
  }
  // The main model cannot take this format (Nemotron and audio, say): have one that can turn it into text.
  const reader = readerFor(file.mime);
  if (!reader) {
    step("read", `${main.label} cannot read a ${kind}, and no other AI model is set up`, undefined, "bad");
    return { label: kind, unreadable: "unsupported" };
  }
  const res = await reader.generate({ system: TRANSCRIBE[kind], messages: [{ role: "user", parts: [{ media: file }] }] });
  step("read", `Transcribed the ${kind} with ${reader.label}`, res.text.slice(0, 300));
  return { label: kind, parts: [{ text: `[The retailer sent a ${kind}. Its content, transcribed:]\n${res.text}` }] };
}
