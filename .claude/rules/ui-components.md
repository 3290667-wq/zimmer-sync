---
paths:
  - "src/App.tsx"
  - "src/index.css"
---

# UI Component Rules

## Design System
- WhatsApp-inspired green theme (`#25D366`, `#128C7E`)
- Facebook-style grays for backgrounds and borders
- Use custom classes: `.whatsapp-card`, `.whatsapp-tag`, `.whatsapp-panel`

## RTL Layout
- All text is RTL Hebrew
- Use `direction: rtl` (set globally)
- Icons on right side of text

## Component Patterns
- Cards for zimmer/request display
- Modal for import functionality
- Sidebar for filters and stats
- Tabs for switching between zimmers/requests

## State Management
- Local state with useState
- Firestore realtime sync with onSnapshot
- Editing mode per card with `editingId`

## Icons
- Use Lucide React icons only
- Common: Calendar, MapPin, Phone, Bed, DoorOpen, Edit2, Trash2

## Animations
- Use framer-motion for transitions
- AnimatePresence for mount/unmount animations
- Subtle opacity and scale effects
