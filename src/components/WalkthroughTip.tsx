import React, { useState } from 'react';
import { HelpCircle, X } from 'lucide-react';
import { cn } from '../lib/utils';

export function WalkthroughTip({ title, description, storageKey }: { title: string, description: string, storageKey: string }) {
  const [isVisible, setIsVisible] = useState(() => {
    return localStorage.getItem(storageKey) !== 'true';
  });

  React.useEffect(() => {
    const handleReset = () => {
      localStorage.removeItem(storageKey);
      setIsVisible(true);
    };
    window.addEventListener('reset-walkthroughs', handleReset);
    return () => window.removeEventListener('reset-walkthroughs', handleReset);
  }, [storageKey]);

  if (!isVisible) return null;

  const handleDismiss = () => {
    localStorage.setItem(storageKey, 'true');
    setIsVisible(false);
  };

  return (
    <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-3 sm:p-4 mb-4 sm:mb-6 flex items-start sm:items-center justify-between gap-4 shadow-sm animate-in fade-in slide-in-from-top-2 duration-500 relative">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="bg-indigo-100 p-2 rounded-lg text-indigo-600 shrink-0">
          <HelpCircle className="w-5 h-5" />
        </div>
        <div>
          <h4 className="text-sm font-bold text-indigo-900 mb-0.5">{title}</h4>
          <p className="text-xs sm:text-sm text-indigo-700 leading-relaxed">
            {description}
          </p>
        </div>
      </div>
      <button 
        onClick={handleDismiss}
        className="text-indigo-400 hover:text-indigo-600 p-1.5 rounded-lg hover:bg-indigo-100 transition-colors shrink-0 absolute top-2 right-2 sm:relative sm:top-0 sm:right-0"
        title="Dismiss tip"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
