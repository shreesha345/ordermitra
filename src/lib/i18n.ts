export type Lang = "en" | "hi" | "kn" | "ta" | "te";

export const LANG_NAMES: Record<Lang, string> = {
  en: "English",
  hi: "Hindi",
  kn: "Kannada",
  ta: "Tamil",
  te: "Telugu",
};

export function normLang(code: string | undefined | null): Lang {
  const c = (code ?? "").toLowerCase().slice(0, 2);
  return (["en", "hi", "kn", "ta", "te"] as const).find((l) => l === c) ?? "en";
}

// Every customer-facing string. {x} placeholders are filled by t().
const S = {
  confirmTitle: {
    en: "Please confirm your order",
    hi: "कृपया अपना ऑर्डर पक्का करें",
    kn: "ದಯವಿಟ್ಟು ನಿಮ್ಮ ಆರ್ಡರ್ ದೃಢೀಕರಿಸಿ",
    ta: "உங்கள் ஆர்டரை உறுதிப்படுத்தவும்",
    te: "దయచేసి మీ ఆర్డర్‌ను నిర్ధారించండి",
  },
  youSaid: { en: "You said:", hi: "आपने कहा:", kn: "ನೀವು ಹೇಳಿದ್ದು:", ta: "நீங்கள் சொன்னது:", te: "మీరు చెప్పింది:" },
  weUnderstood: {
    en: "We understood:",
    hi: "हमने समझा:",
    kn: "ನಮಗೆ ಅರ್ಥವಾದದ್ದು:",
    ta: "நாங்கள் புரிந்துகொண்டது:",
    te: "మేము అర్థం చేసుకున్నది:",
  },
  notNeeded: { en: "Not needed", hi: "नहीं चाहिए", kn: "ಬೇಡ", ta: "வேண்டாம்", te: "వద్దు" },
  notFound: { en: "Not found", hi: "नहीं मिला", kn: "ಸಿಗಲಿಲ್ಲ", ta: "கிடைக்கவில்லை", te: "దొరకలేదు" },
  estTotal: { en: "Estimated total", hi: "अनुमानित कुल", kn: "ಅಂದಾಜು ಒಟ್ಟು", ta: "மதிப்பிட்ட மொத்தம்", te: "అంచనా మొత్తం" },
  approve: { en: "Yes, confirm ✅", hi: "मंजूर करें ✅", kn: "ಸರಿ, ಖಚಿತಪಡಿಸಿ ✅", ta: "சரி, உறுதிப்படுத்து ✅", te: "సరే, నిర్ధారించు ✅" },
  edit: { en: "Change", hi: "बदलें", kn: "ಬದಲಾಯಿಸಿ", ta: "மாற்று", te: "మార్చు" },
  editHelp: {
    en: "No problem. Please send a new voice note with the correct order.",
    hi: "कोई बात नहीं। कृपया सही ऑर्डर के साथ नया वॉइस नोट भेजें।",
    kn: "ಪರವಾಗಿಲ್ಲ. ದಯವಿಟ್ಟು ಸರಿಯಾದ ಆರ್ಡರ್‌ನೊಂದಿಗೆ ಹೊಸ ವಾಯ್ಸ್ ನೋಟ್ ಕಳುಹಿಸಿ.",
    ta: "பரவாயில்லை. சரியான ஆர்டருடன் புதிய வாய்ஸ் நோட் அனுப்புங்கள்.",
    te: "పర్వాలేదు. సరైన ఆర్డర్‌తో కొత్త వాయిస్ నోట్ పంపండి.",
  },
  nothingFound: {
    en: "Sorry, we could not find any medicines in your message. Please send it again.",
    hi: "क्षमा करें, आपके संदेश में कोई दवा नहीं मिली। कृपया दोबारा भेजें।",
    kn: "ಕ್ಷಮಿಸಿ, ನಿಮ್ಮ ಸಂದೇಶದಲ್ಲಿ ಯಾವ ಔಷಧವೂ ಸಿಗಲಿಲ್ಲ. ದಯವಿಟ್ಟು ಮತ್ತೆ ಕಳುಹಿಸಿ.",
    ta: "மன்னிக்கவும், உங்கள் செய்தியில் மருந்து எதுவும் கிடைக்கவில்லை. மீண்டும் அனுப்புங்கள்.",
    te: "క్షమించండి, మీ సందేశంలో ఏ మందూ దొరకలేదు. దయచేసి మళ్లీ పంపండి.",
  },
  stockChecked: { en: "Stock check done", hi: "स्टॉक जांच पूरी हुई", kn: "ಸ್ಟಾಕ್ ಪರಿಶೀಲನೆ ಮುಗಿದಿದೆ", ta: "இருப்பு சரிபார்ப்பு முடிந்தது", te: "స్టాక్ తనిఖీ పూర్తయింది" },
  available: { en: "Available ✅", hi: "उपलब्ध ✅", kn: "ಲಭ್ಯವಿದೆ ✅", ta: "உள்ளது ✅", te: "అందుబాటులో ఉంది ✅" },
  onlyHave: {
    en: "Sorry, we have only {have} of {name}. You asked for {want}.",
    hi: "क्षमा करें, {name} केवल {have} हैं। आपने {want} मांगे थे।",
    kn: "ಕ್ಷಮಿಸಿ, {name} ನಮ್ಮ ಬಳಿ ಕೇವಲ {have} ಮಾತ್ರ ಇದೆ. ನೀವು {want} ಕೇಳಿದ್ದೀರಿ.",
    ta: "மன்னிக்கவும், {name} எங்களிடம் {have} மட்டுமே உள்ளது. நீங்கள் {want} கேட்டீர்கள்.",
    te: "క్షమించండి, {name} మా వద్ద కేవలం {have} మాత్రమే ఉంది. మీరు {want} అడిగారు.",
  },
  outOfStock: {
    en: "Sorry, {name} is out of stock right now.",
    hi: "क्षमा करें, {name} अभी स्टॉक में नहीं है।",
    kn: "ಕ್ಷಮಿಸಿ, {name} ಈಗ ಸ್ಟಾಕ್‌ನಲ್ಲಿ ಇಲ್ಲ.",
    ta: "மன்னிக்கவும், {name} தற்போது இருப்பில் இல்லை.",
    te: "క్షమించండి, {name} ప్రస్తుతం స్టాక్‌లో లేదు.",
  },
  addToCart: { en: "Add {n} to cart", hi: "{n} कार्ट में जोड़ें", kn: "{n} ಕಾರ್ಟ್‌ಗೆ ಸೇರಿಸಿ", ta: "{n} கார்ட்டில் சேர்", te: "{n} కార్ట్‌కు జోడించు" },
  dropItem: { en: "Drop this item", hi: "यह आइटम छोड़ें", kn: "ಈ ಐಟಂ ಬಿಡಿ", ta: "இந்த பொருளை விடு", te: "ఈ ఐటమ్ వద్దు" },
  updatedOrder: { en: "Your updated order", hi: "आपका अपडेटेड ऑर्डर", kn: "ನಿಮ್ಮ ಅಪ್‌ಡೇಟ್ ಆದ ಆರ್ಡರ್", ta: "உங்கள் புதுப்பிக்கப்பட்ட ஆர்டர்", te: "మీ అప్‌డేట్ చేసిన ఆర్డర్" },
  dropped: { en: "dropped", hi: "छोड़ा गया", kn: "ಬಿಟ್ಟಿದೆ", ta: "விடப்பட்டது", te: "తొలగించబడింది" },
  total: { en: "Total", hi: "कुल", kn: "ಒಟ್ಟು", ta: "மொத்தம்", te: "మొత్తం" },
  confirmUpdated: { en: "Confirm ✅", hi: "पक्का करें ✅", kn: "ಖಚಿತಪಡಿಸಿ ✅", ta: "உறுதிப்படுத்து ✅", te: "నిర్ధారించు ✅" },
  orderApproved: { en: "Order approved ✅", hi: "ऑर्डर मंजूर हो गया ✅", kn: "ಆರ್ಡರ್ ಒಪ್ಪಿಗೆಯಾಗಿದೆ ✅", ta: "ஆர்டர் ஏற்கப்பட்டது ✅", te: "ఆర్డర్ ఆమోదించబడింది ✅" },
  hereIsBill: {
    en: "Here is your digital bill {inv}. Total {total}.",
    hi: "यह रहा आपका डिजिटल बिल {inv}। कुल {total}।",
    kn: "ಇದೋ ನಿಮ್ಮ ಡಿಜಿಟಲ್ ಬಿಲ್ {inv}. ಒಟ್ಟು {total}.",
    ta: "இதோ உங்கள் டிஜிட்டல் பில் {inv}. மொத்தம் {total}.",
    te: "ఇదిగో మీ డిజిటల్ బిల్లు {inv}. మొత్తం {total}.",
  },
  payUpi: { en: "Pay {total} via UPI", hi: "UPI से {total} भरें", kn: "UPI ಮೂಲಕ {total} ಪಾವತಿಸಿ", ta: "UPI மூலம் {total} செலுத்துங்கள்", te: "UPI ద్వారా {total} చెల్లించండి" },
  codConfirm: { en: "Confirm · pay on delivery", hi: "पक्का करें · डिलीवरी पर भुगतान", kn: "ಖಚಿತಪಡಿಸಿ · ಡೆಲಿವರಿಯಲ್ಲಿ ಪಾವತಿ", ta: "உறுதி · டெலிவரியில் பணம்", te: "నిర్ధారణ · డెలివరీలో చెల్లింపు" },
  paid: {
    en: "Payment received ✅ Order #{id} is confirmed. Receipt: {ref}.",
    hi: "भुगतान मिला ✅ ऑर्डर #{id} पक्का है। रसीद: {ref}।",
    kn: "ಪಾವತಿ ಸ್ವೀಕರಿಸಲಾಗಿದೆ ✅ ಆರ್ಡರ್ #{id} ಖಚಿತವಾಗಿದೆ. ರಸೀದಿ: {ref}.",
    ta: "பணம் பெறப்பட்டது ✅ ஆர்டர் #{id} உறுதி. ரசீது: {ref}.",
    te: "చెల్లింపు అందింది ✅ ఆర్డర్ #{id} నిర్ధారించబడింది. రసీదు: {ref}.",
  },
  cod: {
    en: "Order #{id} is confirmed ✅ Please pay on delivery.",
    hi: "ऑर्डर #{id} पक्का हो गया ✅ कृपया डिलीवरी पर भुगतान करें।",
    kn: "ಆರ್ಡರ್ #{id} ಖಚಿತವಾಗಿದೆ ✅ ದಯವಿಟ್ಟು ಡೆಲಿವರಿಯಲ್ಲಿ ಪಾವತಿಸಿ.",
    ta: "ஆர்டர் #{id} உறுதி ✅ டெலிவரியில் பணம் செலுத்துங்கள்.",
    te: "ఆర్డర్ #{id} నిర్ధారించబడింది ✅ డెలివరీలో చెల్లించండి.",
  },
  allDropped: {
    en: "Nothing left in your order, so it has been cancelled. Send a new voice note any time.",
    hi: "आपके ऑर्डर में कुछ नहीं बचा, इसलिए रद्द कर दिया गया। कभी भी नया वॉइस नोट भेजें।",
    kn: "ನಿಮ್ಮ ಆರ್ಡರ್‌ನಲ್ಲಿ ಏನೂ ಉಳಿದಿಲ್ಲ, ಆದ್ದರಿಂದ ರದ್ದುಗೊಳಿಸಲಾಗಿದೆ. ಯಾವಾಗ ಬೇಕಾದರೂ ಹೊಸ ವಾಯ್ಸ್ ನೋಟ್ ಕಳುಹಿಸಿ.",
    ta: "உங்கள் ஆர்டரில் எதுவும் இல்லை, எனவே ரத்து செய்யப்பட்டது. எப்போது வேண்டுமானாலும் புதிய வாய்ஸ் நோட் அனுப்புங்கள்.",
    te: "మీ ఆర్డర్‌లో ఏమీ మిగలలేదు, అందువల్ల రద్దు చేయబడింది. ఎప్పుడైనా కొత్త వాయిస్ నోట్ పంపండి.",
  },
  rxNeeded: {
    en: "{name} needs a prescription. Please send a photo of the prescription.",
    hi: "{name} के लिए पर्चा चाहिए। कृपया पर्चे की फोटो भेजें।",
    kn: "{name} ಗೆ ಪ್ರಿಸ್ಕ್ರಿಪ್ಷನ್ ಬೇಕು. ದಯವಿಟ್ಟು ಪ್ರಿಸ್ಕ್ರಿಪ್ಷನ್ ಫೋಟೋ ಕಳುಹಿಸಿ.",
    ta: "{name} மருந்துச் சீட்டு தேவை. மருந்துச் சீட்டின் புகைப்படத்தை அனுப்புங்கள்.",
    te: "{name} కు ప్రిస్క్రిప్షన్ కావాలి. దయచేసి ప్రిస్క్రిప్షన్ ఫోటో పంపండి.",
  },
  stale: {
    en: "This order is no longer active. Please send a new voice note.",
    hi: "यह ऑर्डर अब सक्रिय नहीं है। कृपया नया वॉइस नोट भेजें।",
    kn: "ಈ ಆರ್ಡರ್ ಇನ್ನು ಸಕ್ರಿಯವಾಗಿಲ್ಲ. ದಯವಿಟ್ಟು ಹೊಸ ವಾಯ್ಸ್ ನೋಟ್ ಕಳುಹಿಸಿ.",
    ta: "இந்த ஆர்டர் இனி செயலில் இல்லை. புதிய வாய்ஸ் நோட் அனுப்புங்கள்.",
    te: "ఈ ఆర్డర్ ఇకపై చెల్లదు. దయచేసి కొత్త వాయిస్ నోట్ పంపండి.",
  },
  payCardBody: {
    en: "Pay securely here with UPI or card.",
    hi: "यहीं UPI या कार्ड से सुरक्षित भुगतान करें।",
    kn: "ಇಲ್ಲಿಯೇ UPI ಅಥವಾ ಕಾರ್ಡ್ ಮೂಲಕ ಸುರಕ್ಷಿತವಾಗಿ ಪಾವತಿಸಿ.",
    ta: "இங்கேயே UPI அல்லது கார்டு மூலம் பாதுகாப்பாக செலுத்துங்கள்.",
    te: "ఇక్కడే UPI లేదా కార్డ్‌తో సురక్షితంగా చెల్లించండి.",
  },
  orCod: {
    en: "Or pay when it is delivered.",
    hi: "या डिलीवरी पर भुगतान करें।",
    kn: "ಅಥವಾ ಡೆಲಿವರಿಯಲ್ಲಿ ಪಾವತಿಸಿ.",
    ta: "அல்லது டெலிவரியில் பணம் செலுத்துங்கள்.",
    te: "లేదా డెలివరీలో చెల్లించండి.",
  },
  langSet: {
    en: "Language set to English ✅",
    hi: "भाषा हिन्दी चुनी गई ✅",
    kn: "ಭಾಷೆ ಕನ್ನಡಕ್ಕೆ ಹೊಂದಿಸಲಾಗಿದೆ ✅",
    ta: "மொழி தமிழாக அமைக்கப்பட்டது ✅",
    te: "భాష తెలుగుకు సెట్ చేయబడింది ✅",
  },
  hello: {
    en: "Hello! Send a voice note with the medicines you need, in any language.",
    hi: "नमस्ते! जो दवाएं चाहिए उनका वॉइस नोट किसी भी भाषा में भेजें।",
    kn: "ನಮಸ್ಕಾರ! ನಿಮಗೆ ಬೇಕಾದ ಔಷಧಗಳ ವಾಯ್ಸ್ ನೋಟ್ ಯಾವುದೇ ಭಾಷೆಯಲ್ಲಿ ಕಳುಹಿಸಿ.",
    ta: "வணக்கம்! தேவையான மருந்துகளை எந்த மொழியிலும் வாய்ஸ் நோட்டாக அனுப்புங்கள்.",
    te: "నమస్కారం! మీకు కావలసిన మందుల వాయిస్ నోట్‌ను ఏ భాషలోనైనా పంపండి.",
  },
} as const;

export type Key = keyof typeof S;

export function t(lang: Lang, key: Key, vars: Record<string, string | number> = {}): string {
  let s: string = S[key][lang] ?? S[key].en;
  for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

export const inr = (n: number) =>
  "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
