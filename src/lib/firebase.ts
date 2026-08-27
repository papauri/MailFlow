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

/**
 * Session storage, or a no-op when there is no browser.
 *
 * `sessionStorage` was read at module scope, so merely importing this file outside a
 * browser threw. Every test suite that touches a component imports it transitively,
 * which is why eight of the thirteen suites died on `ReferenceError: sessionStorage
 * is not defined` before running a single assertion — the token cache is incidental
 * to what they test, but it took the whole process down at import time.
 *
 * Reads also throw, not just return null, when a browser blocks site data, so both
 * directions are guarded.
 */
const sessionTokens = {
  get(key: string): string | null {
    try {
      return typeof sessionStorage === 'undefined' ? null : sessionStorage.getItem(key);
    } catch { return null; }
  },
  set(key: string, value: string) {
    try {
      if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(key, value);
    } catch { }
  },
  remove(key: string) {
    try {
      if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem(key);
    } catch { }
  },
};

let isSigningIn = false;
let cachedAccessToken: string | null = sessionTokens.get('gmail_access_token');

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
        sessionTokens.remove('gmail_access_token');
        if (onAuthFailure) onAuthFailure();
      }
    } else {
      cachedAccessToken = null;
      sessionTokens.remove('gmail_access_token');
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
    sessionTokens.set('gmail_access_token', cachedAccessToken);
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
  sessionTokens.remove('gmail_access_token');
};
