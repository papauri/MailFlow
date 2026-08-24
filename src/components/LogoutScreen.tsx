import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';

export default function LogoutScreen() {
  const [typedText, setTypedText] = useState("");
  const fullText = "Goodbye.";

  useEffect(() => {
    let currentText = "";
    let currentIndex = 0;
    
    const timeout = setTimeout(() => {
      const interval = setInterval(() => {
        currentText += fullText[currentIndex];
        setTypedText(currentText);
        currentIndex++;
        
        if (currentIndex >= fullText.length) {
          clearInterval(interval);
        }
      }, 100);
      return () => clearInterval(interval);
    }, 100);

    return () => clearTimeout(timeout);
  }, []);

  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center font-sans text-slate-900 selection:bg-slate-200">
      <div className="h-12 flex items-center justify-center w-full">
        <h1 className="text-3xl font-light tracking-wide text-slate-900 flex items-center">
          {typedText}
          <motion.span 
            animate={{ opacity: [1, 0] }} 
            transition={{ repeat: Infinity, duration: 0.8, ease: "linear" }}
            className="inline-block w-[2px] h-[28px] bg-slate-300 ml-1"
          />
        </h1>
      </div>
    </div>
  );
}
