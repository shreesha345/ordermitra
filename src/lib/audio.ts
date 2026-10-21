import { spawn } from "node:child_process";
import type { Media } from "./gemini";

/** WhatsApp voice notes are OGG/Opus. Convert to a small mono MP3 for Gemini; set FFMPEG_PATH if ffmpeg is not on PATH. */
export function toMp3(media: Media): Promise<Media> {
  if (media.mime === "audio/mpeg") return Promise.resolve(media);
  return new Promise((resolve) => {
    const fallback = (why: unknown) => {
      console.error("mp3 conversion failed, sending the original audio", why);
      resolve(media);
    };
    const ff = spawn(process.env.FFMPEG_PATH || "ffmpeg", [
      "-hide_banner", "-loglevel", "error",
      "-i", "pipe:0",
      "-vn", "-ac", "1", "-ar", "16000", "-b:a", "64k",
      "-write_xing", "0", "-f", "mp3", "pipe:1",
    ]);
    const out: Buffer[] = [];
    let err = "";
    ff.stdout.on("data", (c: Buffer) => out.push(c));
    ff.stderr.on("data", (c: Buffer) => (err += c));
    ff.on("error", fallback); // ffmpeg missing
    ff.stdin.on("error", () => {}); // ffmpeg may exit before reading everything
    ff.on("close", (code) => {
      const data = Buffer.concat(out);
      if (code !== 0 || !data.length) return fallback(err.trim() || `ffmpeg exited with ${code}`);
      console.log("converted to mp3", { from: media.mime, fromBytes: media.data.length, toBytes: data.length });
      resolve({ mime: "audio/mpeg", data });
    });
    ff.stdin.end(media.data);
  });
}
