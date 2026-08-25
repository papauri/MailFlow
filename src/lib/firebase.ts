import { initializeApp } from 'firebase/app';
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, User } from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
/**
 * Firestore on demand.
 *
 * This module is imported by App, gmail.ts and AdminPanel, so a static Firestore
 * import put the entire SDK in the initial bundle for every user — to read one
 * config document on two screens. Callers await getDb() instead, which loads it the
 * first time it is genuinely needed and reuses it after.
 */
let dbPromise: Promise<any> | null = null;

export function getDb() {
  if (!dbPromise) {
    dbPromise = import('firebase/firestore').then(m => m.getFirestore(app));
  }
  return dbPromise;
}

const provider = new GoogleAuthProvider();
provider.addScope('https://mail.google.com/');
provider.addScope('https://www.googleapis.com/auth/gmail.settings.basic');
provider.setCustomParameters({ prompt: 'consent' });

let isSigningIn = false;
let cachedAccessToken: string | null = sessionStorage.getItem('gmail_access_token');

export const initAuth = (
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: () => void
) => {
  return onAuthStateChanged(auth, async (user: User | null) => {
    if (user) {
      if (cachedAccessToken) {
        if (onAuthSuccess) onAuthSuccess(user, cachedAccessToken);
      } else if (!isSigningIn) {
        cachedAccessToken = null;
        sessionStorage.removeItem('gmail_access_token');
        if (onAuthFailure) onAuthFailure();
      }
    } else {
      cachedAccessToken = null;
      sessionStorage.removeItem('gmail_access_token');
      if (onAuthFailure) onAuthFailure();
    }
  });
};

export const googleSignIn = async (): Promise<{ user: User; accessToken: string } | null> => {
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Failed to get access token from Firebase Auth');
    }

    cachedAccessToken = credential.accessToken;
    sessionStorage.setItem('gmail_access_token', cachedAccessToken);
    return { user: result.user, accessToken: cachedAccessToken };
  } catch (error: any) {
    console.error('Sign in error:', error);
    throw error;
  } finally {
    isSigningIn = false;
  }
};

export const getAccessToken = async (): Promise<string | null> => {
  return cachedAccessToken;
};

export const logout = async () => {
  await auth.signOut();
  cachedAccessToken = null;
  sessionStorage.removeItem('gmail_access_token');
};
