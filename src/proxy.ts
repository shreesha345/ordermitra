import { NextResponse, type NextRequest } from "next/server";
import { allowed, dashboardPassword } from "@/lib/auth";

// Locks the dashboard. Only what retailers, WhatsApp and Razorpay must reach stays open:
// the webhooks (each checks its own signature), retailers' order pages (/o/<random token>)
// and invoice PDFs fetched with their order's random key (?k=...).
export function proxy(req: NextRequest) {
  const { pathname, searchParams } = req.nextUrl;
  const open =
    pathname === "/api/whatsapp" ||
    pathname === "/api/razorpay" ||
    pathname.startsWith("/o/") ||
    (/^\/api\/orders\/\d+\/invoice$/.test(pathname) && searchParams.has("k"));
  if (open) return NextResponse.next();
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method) && !sameSite(req)) {
    return new NextResponse("Blocked: this request did not come from the dashboard", { status: 403 });
  }
  if (allowed(req.headers)) return NextResponse.next();

  if (dashboardPassword()) {
    return new NextResponse("Password needed", { status: 401, headers: { "WWW-Authenticate": 'Basic realm="Dashboard", charset="UTF-8"' } });
  }
  return new NextResponse(
    "This dashboard only opens on the computer it runs on. To open it from another device or through a tunnel, set DASHBOARD_PASSWORD in .env and restart.",
    { status: 403, headers: { "Content-Type": "text/plain; charset=utf-8" } },
  );
}

/** A form or button on this dashboard, not another website the browser has open (cross-site request forgery). */
function sameSite(req: NextRequest) {
  const origin = req.headers.get("origin");
  const fetchSite = req.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") return false;
  if (!origin) return true; // scripts and tools on this computer; browsers always send Origin on POST
  try {
    return new URL(origin).host === (req.headers.get("x-forwarded-host") ?? req.headers.get("host"));
  } catch {
    return false;
  }
}

export const config = {
  // Everything except Next's own files and the icons
  matcher: ["/((?!_next/static|_next/image|icon.svg|logo.svg|favicon.ico).*)"],
};
