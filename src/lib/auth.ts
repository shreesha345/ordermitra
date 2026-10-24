import { createHash, timingSafeEqual } from "node:crypto";

// Who may open the dashboard. With DASHBOARD_PASSWORD set, every dashboard page and API asks for it (the browser's
// own sign-in box; any user name). Without it, the dashboard only opens on this computer, never through a tunnel
// or a public address, because it can change stock and shows every retailer's data.

const hash = (s: string) => createHash("sha256").update(s).digest();

export const dashboardPassword = () => process.env.DASHBOARD_PASSWORD?.trim() || "";

/** True when the Authorization header carries the dashboard password. */
export function passwordOk(authorization: string | null) {
  const want = dashboardPassword();
  if (!want || !authorization?.startsWith("Basic ")) return false;
  const decoded = Buffer.from(authorization.slice(6), "base64").toString("utf8");
  const given = decoded.slice(decoded.indexOf(":") + 1);
  return timingSafeEqual(hash(given), hash(want)); // same length, so no early exit on the first wrong character
}

const LOOPBACK = ["localhost", "127.0.0.1", "::1", "::ffff:127.0.0.1"];
const hostName = (h: string | null) => (h ?? "").trim().replace(/:\d+$/, "").replace(/^\[|\]$/g, "").toLowerCase();

/**
 * A request made on this computer, not through a tunnel such as ngrok. Next.js fills X-Forwarded-For with the
 * caller's address when it is missing; a tunnel adds the visitor's real address and its own host name instead.
 */
export function isLocal(headers: Headers) {
  const hosts = [headers.get("host"), headers.get("x-forwarded-host")].filter((h) => h !== null).map(hostName);
  const via = (headers.get("x-forwarded-for") ?? "").split(",").map((a) => a.trim()).filter(Boolean);
  return hosts.length > 0 && hosts.every((h) => LOOPBACK.includes(h)) && via.every((a) => LOOPBACK.includes(a));
}

/** Whether this request may use the dashboard. */
export function allowed(headers: Headers) {
  return dashboardPassword() ? passwordOk(headers.get("authorization")) : isLocal(headers);
}
