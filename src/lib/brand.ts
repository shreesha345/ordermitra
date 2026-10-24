// White-label settings. Server-only: pass values to client components as props.
export const appName = () => process.env.APP_NAME || "OrderMitra";
export const storeName = () => process.env.STORE_NAME || "Sri Ram Medicals";
export const storeGstin = () => process.env.STORE_GSTIN ?? "29ABCDE1234F1ZW";

/** The seller, as printed on invoices. */
export const store = () => ({
  name: storeName(),
  address: process.env.STORE_ADDRESS ?? "12, Market Road, Mangaluru 575001",
  licence: process.env.STORE_DRUG_LICENCE ?? "KA-MNG-20B/21B-1234",
  gstin: storeGstin(),
  phone: process.env.STORE_PHONE ?? "",
  email: process.env.STORE_EMAIL ?? "",
  bank: process.env.STORE_BANK ?? "", // e.g. "HDFC Bank, A/c 50200012345678, IFSC HDFC0001234"
  upi: process.env.UPI_ID ?? "",
});

/** "Sri Ram Medicals" -> "SR" */
export const initials = (s: string) =>
  s
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");
