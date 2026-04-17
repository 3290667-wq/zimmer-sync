---
paths:
  - "src/firebase.ts"
  - "firestore.rules"
  - "firebase-*.json"
---

# Firebase Rules

## Authentication
- Use Google Auth via `signInWithPopup`
- Export `auth`, `db`, `googleProvider` from firebase.ts
- Handle auth state with `onAuthStateChanged`

## Firestore Operations
- Always use `serverTimestamp()` for `updatedAt` fields
- Use `handleFirestoreError()` for error handling with context
- Query with `orderBy('updatedAt', 'desc')` for lists

## Security
- Check `ownerUid` (zimmers) or `createdBy` (requests) for ownership
- Admin check: email === '3290667@gmail.com'
- Never expose Firebase config secrets in code

## Error Handling Pattern
```typescript
try {
  await someFirestoreOperation();
} catch (e) {
  handleFirestoreError(e, OperationType.UPDATE, 'collection/docId');
}
```
