---
paths:
  - "**/*.ts"
  - "**/*.tsx"
---

# TypeScript Rules

## Types
- Define all interfaces in `src/types.ts`
- Use `Omit<T, 'id'>` for creating new documents
- Use `Partial<T>` for update operations

## Key Interfaces
```typescript
ZimmerAvailability {
  id, ownerUid?, name, location, dates, rooms, beds,
  price?, contactInfo?, notes?, disabledDates?, updatedAt?
}

CustomerRequest {
  id, createdBy?, customerName, locationPref?, dates,
  roomsNeeded, bedsNeeded, budget?, contactInfo?, notes?, updatedAt?
}
```

## Async/Await
- Always use async/await over .then()
- Handle errors with try/catch
- Use Promise.all for parallel operations

## React Patterns
- Functional components only
- useState for local state
- useEffect for side effects and subscriptions
- Return cleanup functions from useEffect
