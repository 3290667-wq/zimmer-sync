import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import firebaseConfig from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const storage = getStorage(app);
export const googleProvider = new GoogleAuthProvider();

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string;
    email?: string | null;
    emailVerified?: boolean;
    isAnonymous?: boolean;
    tenantId?: string | null;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export const loginWithGoogle = async () => {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    return result.user;
  } catch (error) {
    console.error("Login failed:", error);
    throw error;
  }
};

// Allowed image types and max size
const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp'];

// Get file extension from MIME type
function getExtFromMime(mimeType: string): string {
  const mimeToExt: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp'
  };
  return mimeToExt[mimeType] || 'jpg';
}

export const uploadLogo = async (file: File, userId: string): Promise<string> => {
  // Validate file type
  if (!file.type.startsWith('image/')) {
    throw new Error('סוג קובץ לא חוקי. יש להעלות תמונה.');
  }

  // Validate file size (2MB max)
  if (file.size > 2 * 1024 * 1024) {
    throw new Error('הקובץ גדול מדי. גודל מקסימלי: 2MB.');
  }

  // Validate userId format (prevent path traversal)
  if (!userId || !/^[a-zA-Z0-9]+$/.test(userId)) {
    throw new Error('שגיאת זיהוי משתמש.');
  }

  // Generate safe filename based on actual MIME type
  const safeExt = getExtFromMime(file.type);
  const fileName = `logos/${userId}_${Date.now()}.${safeExt}`;
  const storageRef = ref(storage, fileName);

  console.log('[uploadLogo] Uploading:', fileName, 'type:', file.type, 'size:', file.size);

  try {
    await uploadBytes(storageRef, file);
    const downloadURL = await getDownloadURL(storageRef);
    console.log('[uploadLogo] Success:', downloadURL);
    return downloadURL;
  } catch (error) {
    console.error('[uploadLogo] Error:', error);
    throw error;
  }
};

// Upload zimmer image (supports multiple images)
export const uploadZimmerImage = async (file: File, userId: string, imageIndex: number): Promise<string> => {
  // Validate file type
  if (!file.type.startsWith('image/')) {
    throw new Error('סוג קובץ לא חוקי. יש להעלות תמונה.');
  }

  // Validate file size (5MB for zimmer images)
  if (file.size > 5 * 1024 * 1024) {
    throw new Error('הקובץ גדול מדי. גודל מקסימלי: 5MB.');
  }

  // Validate userId format (prevent path traversal)
  if (!userId || !/^[a-zA-Z0-9]+$/.test(userId)) {
    throw new Error('שגיאת זיהוי משתמש.');
  }

  // Generate safe filename based on actual MIME type
  const safeExt = getExtFromMime(file.type);
  const fileName = `zimmer-images/${userId}_${Date.now()}_${imageIndex}.${safeExt}`;
  const storageRef = ref(storage, fileName);

  console.log('[uploadZimmerImage] Uploading:', fileName, 'type:', file.type, 'size:', file.size);

  try {
    await uploadBytes(storageRef, file);
    const downloadURL = await getDownloadURL(storageRef);
    console.log('[uploadZimmerImage] Success:', downloadURL);
    return downloadURL;
  } catch (error) {
    console.error('[uploadZimmerImage] Error:', error);
    throw error;
  }
};
