// `npm run dev:tunnel`: starts ngrok, then `next dev` with PUBLIC_BASE_URL set to the tunnel URL,
// and prints the webhook URLs to register with Razorpay and Meta.
import { spawn } from "node:child_process";

const PORT = process.env.PORT ?? "3000";

async function tunnelUrl() {
  try {
    const res = await fetch("http://127.0.0.1:4040/api/tunnels");
    const { tunnels } = await res.json();
    return tunnels.find((t) => t.public_url.startsWith("https://") && t.config?.addr?.endsWith(`:${PORT}`))?.public_url ?? null;
  } catch {
    return null;
  }
}

let url = await tunnelUrl(); // reuse an ngrok that is already running for this port
let ngrok;
if (!url) {
  ngrok = spawn("ngrok", ["http", PORT], { stdio: "ignore", shell: true });
  for (let i = 0; i < 30 && !url; i++) {
    await new Promise((r) => setTimeout(r, 500));
    url = await tunnelUrl();
  }
}
if (!url) {
  console.error("Could not get an ngrok URL. Is ngrok signed in (ngrok config add-authtoken ...)?");
  ngrok?.kill();
  process.exit(1);
}

console.log(`\n  ngrok tunnel:      ${url}`);
console.log(`  Razorpay webhook:  ${url}/api/razorpay   (event: payment_link.paid)`);
console.log(`  WhatsApp webhook:  ${url}/api/whatsapp\n`);

// Next gets the environment as it was before .env is loaded, so it reads .env itself. Passing the loaded
// values down would freeze them: Next never overrides variables that are already set, so later .env edits were ignored.
const nextEnv = { ...process.env, PUBLIC_BASE_URL: url };
try { process.loadEnvFile(".env"); } catch {} // so this script sees the same keys as Next

/** Points Meta's WhatsApp webhook at the tunnel. Meta calls the URL back to verify it, so the server must already be up. */
async function registerMetaWebhook() {
  const { META_APP_ID: appId, WHATSAPP_APP_SECRET: secret, WHATSAPP_VERIFY_TOKEN: verify, WHATSAPP_BUSINESS_ACCOUNT_ID: waba, WHATSAPP_TOKEN: token } = process.env;
  if (!appId || !secret || !verify) {
    console.log("  Meta webhook: not auto-registered (set META_APP_ID, WHATSAPP_APP_SECRET, WHATSAPP_VERIFY_TOKEN to enable)");
    return;
  }
  for (let i = 0; i < 120; i++) { // wait for the first compile
    try { await fetch(`http://localhost:${PORT}/api/whatsapp`); break; } catch { await new Promise((r) => setTimeout(r, 1000)); }
  }
  const body = new URLSearchParams({
    object: "whatsapp_business_account",
    callback_url: `${url}/api/whatsapp`,
    verify_token: verify,
    fields: "messages",
    access_token: `${appId}|${secret}`,
  });
  const res = await fetch(`https://graph.facebook.com/${process.env.WHATSAPP_API_VERSION ?? "v21.0"}/${appId}/subscriptions`, { method: "POST", body });
  console.log(res.ok ? `  Meta webhook: set to ${url}/api/whatsapp` : `  Meta webhook: FAILED ${res.status} ${await res.text()}`);
  if (res.ok && waba && token) { // make sure the business account delivers messages to this app
    const sub = await fetch(`https://graph.facebook.com/${process.env.WHATSAPP_API_VERSION ?? "v21.0"}/${waba}/subscribed_apps`, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
    if (!sub.ok) console.log(`  Meta app subscription: FAILED ${sub.status} ${await sub.text()}`);
  }
}

const next = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "-p", PORT], {
  stdio: "inherit",
  env: nextEnv,
});
registerMetaWebhook().catch((e) => console.error("  Meta webhook: FAILED", e));
const stop =() => { ngrok?.kill(); next.kill(); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
next.on("exit", (code) => { ngrok?.kill(); process.exit(code ?? 0); });
