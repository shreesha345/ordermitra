// GSTIN: 2-digit state code, 10-character PAN, entity number, "Z", and a check character.

export const STATES: Record<string, string> = {
  "01": "Jammu and Kashmir", "02": "Himachal Pradesh", "03": "Punjab", "04": "Chandigarh", "05": "Uttarakhand", "06": "Haryana", "07": "Delhi",
  "08": "Rajasthan", "09": "Uttar Pradesh", "10": "Bihar", "11": "Sikkim", "12": "Arunachal Pradesh", "13": "Nagaland", "14": "Manipur",
  "15": "Mizoram", "16": "Tripura", "17": "Meghalaya", "18": "Assam", "19": "West Bengal", "20": "Jharkhand", "21": "Odisha", "22": "Chhattisgarh",
  "23": "Madhya Pradesh", "24": "Gujarat", "26": "Dadra and Nagar Haveli and Daman and Diu", "27": "Maharashtra", "29": "Karnataka", "30": "Goa",
  "31": "Lakshadweep", "32": "Kerala", "33": "Tamil Nadu", "34": "Puducherry", "35": "Andaman and Nicobar Islands", "36": "Telangana",
  "37": "Andhra Pradesh", "38": "Ladakh", "97": "Other Territory",
};

const CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const SHAPE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/** The check character of the first 14 characters (the GSTN's mod-36 scheme). */
function checkChar(first14: string) {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const p = CHARS.indexOf(first14[i]) * (i % 2 ? 2 : 1);
    sum += Math.floor(p / 36) + (p % 36);
  }
  return CHARS[(36 - (sum % 36)) % 36];
}

/** A GSTIN as typed or read from a photo: spaces and dashes removed, upper case. */
export const cleanGstin = (s: string) => s.toUpperCase().replace(/[\s\-.]/g, "");

/** null when valid, otherwise what is wrong, in plain words. */
export function gstinProblem(raw: string): string | null {
  const g = cleanGstin(raw);
  if (g.length !== 15) return "A GSTIN has 15 characters";
  if (!SHAPE.test(g)) return "This does not look like a GSTIN";
  if (!STATES[g.slice(0, 2)]) return "The first two digits are not a state code";
  if (checkChar(g.slice(0, 14)) !== g[14]) return "The last character does not match; please check for a typo";
  return null;
}

export const validGstin = (raw: string) => !!raw && gstinProblem(raw) === null;

/** A GSTIN anywhere in a message, e.g. "my gst no is 29aakfs4412m1z3". */
export function findGstin(text: string) {
  const m = cleanGstin(text).match(/\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]/);
  return m && validGstin(m[0]) ? m[0] : null;
}

/** "Karnataka (29)" */
export const stateName = (gstin: string) => {
  const code = gstin.trim().slice(0, 2);
  return STATES[code] ? `${STATES[code]} (${code})` : "-";
};

/** Place of supply as the GST returns write it: "29-Karnataka". */
export const placeOfSupply = (code: string) => `${code}-${STATES[code] ?? ""}`;
