import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export async function parseWhatsAppText(text: string) {
  const model = "gemini-3-flash-preview";
  
  // Get current date info for relative date conversion
  const today = new Date();
  const todayStr = `${today.getDate()}/${today.getMonth() + 1}/${today.getFullYear()}`;

  // Calculate next Friday and Saturday
  const daysUntilFriday = (5 - today.getDay() + 7) % 7 || 7;
  const friday = new Date(today);
  friday.setDate(today.getDate() + daysUntilFriday);
  const saturday = new Date(friday);
  saturday.setDate(friday.getDate() + 1);

  const hebrewMonths = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];

  const prompt = `
    אתה עוזר חכם שמתמחה בניתוח הודעות טקסט מקבוצות וואטסאפ של סוכני צימרים.
    נתחו את הטקסט הבא שכולל הודעות וואטסאפ - כל הודעה היא ביקוש/דרישה לצימר.

    התאריך היום: ${todayStr}
    שבת הקרובה: ${friday.getDate()}-${saturday.getDate()} ב${hebrewMonths[friday.getMonth()]}

    ⚠️ חשוב: כל הודעה בקבוצה היא ביקוש - לקוח או סוכן מחפש צימר.

    הוציאו כמה שיותר פרטים מכל הודעה:
    - שם הלקוח או שם השולח (customerName)
    - מיקום מבוקש (locationPref) - צפון, דרום, מרכז, גליל, גולן וכו'
    - תאריכים (dates)
    - מספר חדרים (roomsNeeded)
    - מספר מיטות (bedsNeeded)
    - תקציב (budget)
    - פרטי קשר - טלפון (contactInfo)
    - הערות נוספות (notes)

    תרגום תאריכים יחסיים:
    - "שבת הקרובה" / "סופש" / "סוף השבוע" → "${friday.getDate()}-${saturday.getDate()} ב${hebrewMonths[friday.getMonth()]}"
    - "מחר" → תאריך של מחר
    - "השבוע" → טווח התאריכים של השבוע הנוכחי
    - "שבוע הבא" → טווח התאריכים של השבוע הבא

    תמיד תרגם תאריכים יחסיים לתאריכים מדויקים בפורמט: "X-Y בחודש" או "X בחודש"

    טקסט לניתוח:
    ${text}
  `;

  try {
    const response = await ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            requests: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  customerName: { type: Type.STRING },
                  locationPref: { type: Type.STRING },
                  dates: { type: Type.STRING },
                  roomsNeeded: { type: Type.NUMBER },
                  bedsNeeded: { type: Type.NUMBER },
                  budget: { type: Type.STRING },
                  contactInfo: { type: Type.STRING },
                  notes: { type: Type.STRING }
                },
                required: ["customerName", "dates"]
              }
            }
          }
        }
      }
    });

    const result = JSON.parse(response.text) as { requests: any[] };
    // Always return empty zimmers array for backwards compatibility
    return { zimmers: [], requests: result.requests || [] };
  } catch (error) {
    console.error("Error parsing WhatsApp text:", error);
    throw error;
  }
}
