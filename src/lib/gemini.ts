import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export async function parseWhatsAppText(text: string) {
  const model = "gemini-3-flash-preview";
  
  const prompt = `
    אתה עוזר חכם שמתמחה בניתוח הודעות טקסט מקבוצות וואטסאפ של בעלי צימרים וסוכנים.
    נתחו את הטקסט הבא שכולל הודעות וואטסאפ על צימרים פנויים וביקושי לקוחות.
    
    כללים:
    1. צימרים פנויים: זהו מקרים בהם בעל צימר מפרסם שיש לו מקום פנוי בתאריכים מסוימים.
    2. ביקושי לקוחות: זהו מקרים בהם סוכן או לקוח מחפשים צימר (למשל: "מחפש ל-3 חדרים במירון").
    3. הוציאו כמה שיותר פרטים: שם הצימר/לקוח, מיקום, תאריכים, מספר חדרים, מספר מיטות, מחיר, פרטי קשר.
    4. אם חסר מידע, השאירו ריק או נחשו לפי ההקשר אם זה ברור.
    
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
            zimmers: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  name: { type: Type.STRING },
                  location: { type: Type.STRING },
                  dates: { type: Type.STRING },
                  rooms: { type: Type.NUMBER },
                  beds: { type: Type.NUMBER },
                  price: { type: Type.STRING },
                  contactInfo: { type: Type.STRING },
                  notes: { type: Type.STRING }
                },
                required: ["name", "dates"]
              }
            },
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

    return JSON.parse(response.text) as { zimmers: any[], requests: any[] };
  } catch (error) {
    console.error("Error parsing WhatsApp text:", error);
    throw error;
  }
}
