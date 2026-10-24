import { appName } from "@/lib/brand";
import { LOGO } from "@/lib/logo";

/** The logo with the product name from APP_NAME as the wordmark. */
export function GET() {
  const name = appName().replace(/[<>&"]/g, "");
  const width = 50 + Math.ceil(name.length * 15.5);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} 40" role="img" aria-label="${name}"><g transform="translate(0 4)"><path d="${LOGO.tile}" fill="${LOGO.blue}"/><path d="${LOGO.bubble}" fill="#fff"/><path d="${LOGO.cross}" fill="${LOGO.blue}"/></g><text x="42" y="29" font-family="Geist, Inter, Segoe UI, Helvetica, Arial, sans-serif" font-size="26" font-weight="600" letter-spacing="-0.6" fill="#101828">${name}</text></svg>`;
  return new Response(svg, { headers: { "Content-Type": "image/svg+xml", "Cache-Control": "no-cache" } });
}
