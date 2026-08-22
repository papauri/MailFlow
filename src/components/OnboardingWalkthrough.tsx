import React, { useState, useEffect } from 'react';
import { Mail, Search, Trash2, Sparkles, X, ChevronRight, ChevronLeft, ShieldCheck } from 'lucide-react';
import { cn } from '../lib/utils';

export function OnboardingWalkthrough({ onComplete, key }: { onComplete: () => void, key?: any }) {
  const [step, setStep] = useState(0);
  const [isVisible, setIsVisible] = useState(false);
  
  useEffect(() => {
    const hasSeen = localStorage.getItem('hasSeenOnboarding');
    if (!hasSeen) {
      setIsVisible(true);
    } else {
      onComplete();
    }
  }, [onComplete]);

  if (!isVisible) return null;

  const handleFinish = () => {
    localStorage.setItem('hasSeenOnboarding', 'true');
    setIsVisible(false);
    onComplete();
  };

  const steps = [
    {
      title: "Welcome to MailFlow",
      description: "A fast, smart way to clean up your Gmail inbox and get rid of the clutter you don't need.",
      icon: <Mail className="w-12 h-12 text-indigo-600 mb-4" />,
      image: (
        <div className="bg-slate-100 rounded-xl p-4 flex items-center justify-center border border-slate-200">
          <div className="space-y-3 w-full max-w-[200px]">
            <div className="h-2 bg-slate-200 rounded w-full"></div>
            <div className="h-2 bg-slate-200 rounded w-5/6"></div>
            <div className="h-2 bg-slate-200 rounded w-4/6"></div>
            <div className="h-8 bg-indigo-100 rounded-lg w-full mt-4 flex items-center justify-center text-indigo-700 text-xs font-bold">Start Cleaning</div>
          </div>
        </div>
      )
    },
    {
      title: "Smart Search",
      description: "Use everyday language to find emails. Try asking for 'receipts from last month' or 'newsletters I haven't read'.",
      icon: <Search className="w-12 h-12 text-blue-600 mb-4" />,
      image: (
        <div className="bg-slate-100 rounded-xl p-4 flex flex-col items-center justify-center border border-slate-200 gap-3">
          <div className="bg-white rounded-full px-3 py-1.5 flex items-center gap-2 border border-slate-300 w-full shadow-sm">
            <Sparkles className="w-3 h-3 text-blue-500" />
            <div className="h-1.5 bg-slate-200 rounded w-24"></div>
          </div>
          <div className="w-full bg-white rounded-lg p-2 border border-slate-200 shadow-sm flex items-center gap-2">
             <div className="w-4 h-4 rounded-full bg-slate-200"></div>
             <div className="h-1.5 bg-slate-200 rounded w-16"></div>
          </div>
        </div>
      )
    },
    {
      title: "Analyze Your Inbox",
      description: "Discover hidden patterns, see your top senders, and find out what's taking up the most space with our AI-powered Inbox Health scan.",
      icon: <ShieldCheck className="w-12 h-12 text-emerald-600 mb-4" />,
      image: (
        <div className="bg-slate-100 rounded-xl p-4 flex flex-col items-center justify-center border border-slate-200 gap-3">
           <div className="grid grid-cols-2 gap-2 w-full">
             <div className="bg-white rounded-lg p-2 border border-slate-200 shadow-sm flex flex-col items-center gap-1">
               <div className="h-4 w-4 bg-emerald-100 rounded-full"></div>
               <div className="h-1.5 bg-slate-200 rounded w-8"></div>
             </div>
             <div className="bg-white rounded-lg p-2 border border-slate-200 shadow-sm flex flex-col items-center gap-1">
               <div className="h-4 w-4 bg-rose-100 rounded-full"></div>
               <div className="h-1.5 bg-slate-200 rounded w-8"></div>
             </div>
           </div>
        </div>
      )
    },
    {
      title: "Organize & Analyze",
      description: "Select multiple emails and use Smart Analytics to instantly group them by sender and apply labels, archive, or trash them in bulk.",
      icon: <Sparkles className="w-12 h-12 text-indigo-600 mb-4" />,
      image: (
        <div className="bg-slate-100 rounded-xl p-4 flex flex-col items-center justify-center border border-slate-200 gap-3">
           <div className="w-full bg-white rounded-lg p-2 border border-slate-200 shadow-sm flex flex-col gap-2">
             <div className="flex justify-between items-center">
               <div className="h-2 bg-slate-200 rounded w-1/3"></div>
               <div className="h-2 bg-slate-200 rounded w-1/6"></div>
             </div>
             <div className="h-6 w-full bg-blue-600 rounded mt-1"></div>
             <div className="flex gap-2">
               <div className="h-6 w-full bg-slate-100 border border-slate-200 rounded"></div>
               <div className="h-6 w-full bg-slate-100 border border-slate-200 rounded"></div>
             </div>
           </div>
        </div>
      )
    },
    {
      title: "Bulk Delete & Archive",
      description: "Select hundreds of emails at once and permanently delete them or archive them to instantly free up space.",
      icon: <Trash2 className="w-12 h-12 text-rose-600 mb-4" />,
      image: (
        <div className="bg-slate-100 rounded-xl p-4 flex flex-col items-center justify-center border border-slate-200 gap-2">
           {[1, 2, 3].map(i => (
             <div key={i} className="w-full bg-white rounded-lg p-2 border border-slate-200 shadow-sm flex items-center gap-2">
               <div className="w-3 h-3 rounded bg-indigo-500"></div>
               <div className="h-1.5 bg-slate-200 rounded w-20"></div>
             </div>
           ))}
        </div>
      )
    }
  ];

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
      <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-300">
        <div className="flex justify-end p-2">
          <button onClick={handleFinish} className="text-slate-400 hover:text-slate-600 p-2 rounded-full hover:bg-slate-100 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        
        <div className="px-6 sm:px-8 pb-6 flex-1 flex flex-col text-center items-center">
          {steps[step].icon}
          
          <div className="w-full mb-6">
            {steps[step].image}
          </div>
          
          <h2 className="text-2xl font-bold text-slate-900 mb-3">{steps[step].title}</h2>
          <p className="text-slate-600 text-sm sm:text-base leading-relaxed max-w-[280px]">
            {steps[step].description}
          </p>
        </div>

        <div className="bg-slate-50 p-4 sm:p-6 border-t border-slate-200 flex items-center justify-between">
          <div className="flex gap-1.5">
            {steps.map((_, i) => (
              <div 
                key={i} 
                className={cn(
                  "h-2 rounded-full transition-all duration-300", 
                  i === step ? "w-6 bg-indigo-600" : "w-2 bg-slate-300"
                )}
              />
            ))}
          </div>
          
          <div className="flex gap-2">
            {step > 0 && (
              <button 
                onClick={() => setStep(s => s - 1)}
                className="px-4 py-2 rounded-xl text-slate-700 hover:bg-slate-200 font-medium transition-colors text-sm"
              >
                Back
              </button>
            )}
            <button 
              onClick={() => {
                if (step === steps.length - 1) {
                  handleFinish();
                } else {
                  setStep(s => s + 1);
                }
              }}
              className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold transition-colors flex items-center gap-1 text-sm shadow-sm"
            >
              {step === steps.length - 1 ? 'Get Started' : 'Next'}
              {step < steps.length - 1 && <ChevronRight className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
