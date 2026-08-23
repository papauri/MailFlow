/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import { User } from 'firebase/auth';
import { initAuth, googleSignIn } from './lib/firebase';
import LoginScreen from './components/LoginScreen';
import Dashboard from './components/Dashboard';
import { Loader2 } from 'lucide-react';

export default function App() {
  const [isInitializing, setIsInitializing] = useState(true);
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    const unsubscribe = initAuth(
      (authUser) => {
        setUser(authUser);
        setIsInitializing(false);
      },
      () => {
        setUser(null);
        setIsInitializing(false);
      }
    );
    return () => unsubscribe();
  }, []);

  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  const handleLogin = async () => {
    if (isLoggingIn) return; // Prevent double clicks
    setIsLoggingIn(true);
    setLoginError(null);
    try {
      const result = await googleSignIn();
      if (result) {
        setUser(result.user);
      }
    } catch (error: any) {
      console.error("Login failed", error);
      if (error.code !== 'auth/popup-closed-by-user' && error.code !== 'auth/cancelled-popup-request') {
        setLoginError(error.message || "Failed to log in.");
      }
    } finally {
      setIsLoggingIn(false);
    }
  };

  if (isInitializing) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
      </div>
    );
  }

  if (!user) {
    return <LoginScreen onLogin={handleLogin} isLoggingIn={isLoggingIn} error={loginError} />;
  }

  return <Dashboard user={user} />;
}
