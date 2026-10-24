// Tavily web search, used for one thing only: identifying a medicine by name (its composition, strength and
// schedule) when it is not in the catalogue, so a same-composition product we stock can be offered.
// The query is built here from the drug name alone; nothing about the retailer or the order is sent.

export const tavilyEnabled = () => !!process.env.TAVILY_API_KEY?.trim();

// Pharmacy and drug references. Results from anywhere else are ignored.
const DOMAINS = ["1mg.com", "pharmeasy.in", "netmeds.com", "apollopharmacy.in", "medlineplus.gov", "drugs.com", "cdsco.gov.in", "janaushadhi.gov.in"];

export type DrugInfo = { query: string; answer: string; sources: { title: string; url: string }[] };

const cache = new Map<string, DrugInfo>();

export async function lookupDrug(name: string): Promise<DrugInfo | null> {
  // A medicine name is short; anything longer or with odd characters is not one, so it is not sent.
  const drug = name.replace(/[^\p{L}\p{N}\s.+\-/%]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 60);
  if (!tavilyEnabled() || drug.length < 3) return null;
  const key = drug.toLowerCase();
  if (cache.has(key)) return cache.get(key)!;
  const query = `${drug} medicine composition salt strength India schedule`;
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.TAVILY_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, search_depth: "basic", max_results: 4, include_answer: true, include_domains: DOMAINS }),
  });
  if (!res.ok) {
    console.error("tavily search failed", res.status, (await res.text()).slice(0, 300));
    return null;
  }
  const out = (await res.json()) as { answer?: string; results?: { title: string; url: string; content: string }[] };
  const info: DrugInfo = {
    query,
    answer: out.answer || (out.results ?? []).map((r) => r.content).join(" ").slice(0, 800),
    sources: (out.results ?? []).slice(0, 3).map((r) => ({ title: r.title, url: r.url })),
  };
  cache.set(key, info);
  return info;
}
