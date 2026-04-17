---
paths:
  - "src/lib/gemini.ts"
---

# Gemini AI Rules

## Model
- Use `gemini-3-flash-preview` for fast parsing
- API key from `process.env.GEMINI_API_KEY`

## Response Schema
- Always use `responseMimeType: "application/json"`
- Define strict `responseSchema` with Type enums
- Required fields: `name`+`dates` for zimmers, `customerName`+`dates` for requests

## Hebrew Processing
- Prompts should be in Hebrew for better context understanding
- Handle Hebrew text extraction from WhatsApp format
- Parse Israeli date formats (DD/MM, Hebrew month names)

## Error Handling
- Wrap in try/catch, log errors with context
- Return empty arrays on parse failure, not throw
