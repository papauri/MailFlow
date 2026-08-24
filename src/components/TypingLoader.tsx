import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';

interface TypingLoaderProps {
  title?: string;
  messages: string[];
}

export function TypingLoader({ title = "Loading", messages }: TypingLoaderProps) {
  const [typedText, setTypedText] = useState("");

  useEffect(() => {
    let currentMsgIndex = 0;
    let currentCharIndex = 0;
    let currentText = "";
    let isDeleting = false;
    let timeoutId: any;

    function typeWriter() {
      if (messages.length === 0) return;
      const fullMsg = messages[currentMsgIndex];
      
      if (!isDeleting) {
        currentText = fullMsg.substring(0, currentCharIndex + 1);
        setTypedText(currentText);
        currentCharIndex++;
        
        if (currentCharIndex === fullMsg.length) {
          isDeleting = true;
          timeoutId = setTimeout(typeWriter, 2000); // Wait before deleting
        } else {
          timeoutId = setTimeout(typeWriter, 50); // Typing speed
        }
      } else {
        currentText = fullMsg.substring(0, currentCharIndex - 1);
        setTypedText(currentText);
        currentCharIndex--;
        
        if (currentCharIndex === 0) {
          isDeleting = false;
          currentMsgIndex = (currentMsgIndex + 1) % messages.length;
          timeoutId = setTimeout(typeWriter, 500); // Wait before typing next
        } else {
          timeoutId = setTimeout(typeWriter, 30); // Deleting speed
        }
      }
    }

    if (messages.length > 0) {
      timeoutId = setTimeout(typeWriter, 100);
    }

    return () => clearTimeout(timeoutId);
  }, [messages]);

  return (
    <div className="p-8 sm:p-16 flex flex-col items-center justify-center text-slate-500 gap-6 mt-4 sm:mt-8 w-full h-full flex-1">
      {/* Progress visualizer */}
      <div className="w-48 sm:w-64 h-1.5 sm:h-2 bg-slate-100 rounded-full overflow-hidden relative">
        <motion.div 
          className="absolute top-0 bottom-0 left-0 bg-slate-800 rounded-full"
          animate={{ width: ["0%", "100%", "0%"], left: ["0%", "0%", "100%"] }}
          transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
        />
      </div>
      
      <div className="flex flex-col items-center gap-1 sm:gap-2 h-16 text-center">
        <h2 className="text-lg sm:text-xl font-medium text-slate-800 flex items-center">
          {title}
        </h2>
        <div className="text-xs sm:text-sm font-medium text-slate-500 flex items-center justify-center min-h-[20px]">
          <span>{typedText}</span>
          <motion.span 
            animate={{ opacity: [1, 0] }} 
            transition={{ repeat: Infinity, duration: 0.8, ease: "linear" }}
            className="inline-block w-[2px] h-[12px] sm:h-[14px] bg-slate-400 ml-0.5"
          />
        </div>
      </div>
    </div>
  );
}
