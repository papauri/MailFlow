import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Loader2 } from 'lucide-react';
import { cn } from '../lib/utils';

export default function LoginScreen({ onLogin, isLoggingIn, error }: { onLogin: () => void, isLoggingIn?: boolean, error?: string | null }) {
  const [typedTitle, setTypedTitle] = useState("");
  const [typedDesc, setTypedDesc] = useState("");
  const [showCursorOnTitle, setShowCursorOnTitle] = useState(true);
  
  const fullTitle = "MailFlow.";
  const fullDesc = "Intelligent inbox routing, bulk cleanup, and AI-powered organization.";

  useEffect(() => {
    let titleIndex = 0;
    let descIndex = 0;
    
    const typeDesc = () => {
      setShowCursorOnTitle(false);
      const descInterval = setInterval(() => {
        setTypedDesc(fullDesc.substring(0, descIndex + 1));
        descIndex++;
        if (descIndex >= fullDesc.length) {
          clearInterval(descInterval);
        }
      }, 30);
    };

    const timeout = setTimeout(() => {
      const titleInterval = setInterval(() => {
        setTypedTitle(fullTitle.substring(0, titleIndex + 1));
        titleIndex++;
        
        if (titleIndex >= fullTitle.length) {
          clearInterval(titleInterval);
          setTimeout(typeDesc, 400); // Pause before typing description
        }
      }, 100);
      return () => clearInterval(titleInterval);
    }, 300);

    return () => clearTimeout(timeout);
  }, []);

  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center font-sans text-slate-900 selection:bg-slate-200">
      <div className="w-full max-w-sm px-6 flex flex-col items-center relative z-10">
        
        {/* Minimalist Logo */}
        <motion.div 
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className="w-12 h-12 flex items-center justify-center mb-8"
        >
          <svg className="w-8 h-8 text-slate-800" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
        </motion.div>

        {/* Typed Text */}
        <div className="h-12 flex items-center mb-2 justify-center w-full">
          <h1 className="text-3xl font-light tracking-wide text-slate-900 flex items-center">
            {typedTitle}
            {showCursorOnTitle && (
              <motion.span 
                animate={{ opacity: [1, 0] }} 
                transition={{ repeat: Infinity, duration: 0.8, ease: "linear" }}
                className="inline-block w-[2px] h-[28px] bg-slate-300 ml-1"
              />
            )}
          </h1>
        </div>

        <div className="h-16 flex items-start justify-center w-full mb-6">
          <p className="text-sm text-slate-500 font-normal text-center tracking-wide max-w-[260px]">
            {typedDesc}
            {!showCursorOnTitle && (
              <motion.span 
                animate={{ opacity: [1, 0] }} 
                transition={{ repeat: Infinity, duration: 0.8, ease: "linear" }}
                className="inline-block w-[1.5px] h-[14px] bg-slate-300 ml-0.5 align-middle"
              />
            )}
          </p>
        </div>

        {/* Sleek Light Button */}
        <motion.div 
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1.4, duration: 0.8 }}
          className="w-full"
        >
          <button
            onClick={onLogin}
            disabled={isLoggingIn}
            className="group w-full flex items-center justify-center gap-3 bg-white border border-slate-200 text-slate-700 font-medium py-3 px-4 rounded-xl transition-colors hover:border-slate-300 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoggingIn ? (
              <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
            ) : (
              <svg className="w-5 h-5" viewBox="0 0 48 48">
                <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
                <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
                <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
                <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
                <path fill="none" d="M0 0h48v48H0z" />
              </svg>
            )}
            <span className="text-[15px] relative overflow-hidden">
              {isLoggingIn ? "Authenticating..." : "Continue with Google"}
              <span className="absolute bottom-0 left-0 w-full h-[1px] bg-slate-400 -translate-x-full group-hover:translate-x-0 transition-transform duration-300 ease-out" />
            </span>
          </button>
        </motion.div>

        <AnimatePresence>
          {error && (
            <motion.div 
              initial={{ opacity: 0, height: 0, y: -10 }}
              animate={{ opacity: 1, height: 'auto', y: 0 }}
              exit={{ opacity: 0, height: 0, y: -10 }}
              className="mt-6 text-sm text-rose-600 bg-rose-50 border border-rose-200 p-3.5 rounded-xl w-full text-center"
            >
              {error}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
