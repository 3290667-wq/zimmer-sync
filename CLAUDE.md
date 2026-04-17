# ZimmerSync - Project Instructions

## Project Overview
**ZimmerSync** is a zimmer (vacation rental) management system for Israeli rental agents. It allows importing availability and customer requests from WhatsApp messages using Gemini AI.

## Tech Stack
- **Frontend**: React 19 + TypeScript + Vite
- **Styling**: Tailwind CSS 4 (RTL Hebrew interface)
- **Backend**: Firebase (Auth + Firestore)
- **AI**: Google Gemini API (`@google/genai`)
- **UI Components**: Lucide icons, react-day-picker, framer-motion

## Commands
```bash
npm install          # Install dependencies
npm run dev          # Start dev server (port 3000)
npm run build        # Production build
npm run lint         # TypeScript type check
npm run preview      # Preview production build
```

## Project Structure
```
src/
  App.tsx           # Main component (zimmers list, requests, import modal)
  types.ts          # TypeScript interfaces (ZimmerAvailability, CustomerRequest)
  firebase.ts       # Firebase config, auth, error handling
  lib/gemini.ts     # Gemini AI parsing for WhatsApp messages
  index.css         # Tailwind config with custom theme
  main.tsx          # React entry point
```

## Key Concepts

### Data Models
- **ZimmerAvailability**: Available zimmer with dates, rooms, beds, price
- **CustomerRequest**: Customer looking for zimmer with requirements
- Both stored in Firestore with user ownership (`ownerUid`/`createdBy`)

### Authentication
- Google Auth only via Firebase
- Admin email: `3290667@gmail.com` has full access
- Regular users can only edit/delete their own items

### WhatsApp Import
- Uses Gemini AI to parse Hebrew WhatsApp messages
- Automatically categorizes as "available zimmer" or "customer request"
- Extracts: name, location, dates, rooms, beds, price, contact

## Code Style
- Hebrew UI text, English code
- RTL layout (`direction: rtl` in CSS)
- Custom Tailwind colors: `whatsapp-primary`, `whatsapp-dark`, `face-*`
- Component classes: `.whatsapp-card`, `.whatsapp-tag`, `.whatsapp-panel`

## Environment Variables
```
GEMINI_API_KEY=xxx   # Required for AI parsing
```

## Firebase Collections
- `zimmers` - Available zimmers (ownerUid for ownership)
- `requests` - Customer requests (createdBy for ownership)
- `users` - User profiles (role field for admin)

## Security Rules
- All operations require authentication
- Users can only modify their own documents
- Admin can modify any document
- Validation for required fields and string lengths
