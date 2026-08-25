import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Loader2 } from 'lucide-react';

interface Particle {
  x: number;
  y: number;
  originX: number;
  originY: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  alpha: number;
  baseAlpha: number;
  floatAngle: number;
  floatSpeed: number;
}

export default function LoginScreen({ 
  onLogin, 
  isLoggingIn, 
  error 
}: { 
  onLogin: () => void; 
  isLoggingIn?: boolean; 
  error?: string | null; 
}) {
  const [typedText, setTypedText] = useState("");
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const phrases = [
    "Clean your inbox.",
    "Zero email storage.",
    "Runs 100% in your browser.",
    "Reclaim your storage.",
    "Private by design."
  ];

  // Typing effect
  useEffect(() => {
    let phraseIndex = 0;
    let charIndex = 0;
    let isDeleting = false;
    let timer: NodeJS.Timeout;

    function handleTyping() {
      const currentPhrase = phrases[phraseIndex];

      if (!isDeleting) {
        setTypedText(currentPhrase.substring(0, charIndex + 1));
        charIndex++;

        if (charIndex === currentPhrase.length) {
          isDeleting = true;
          timer = setTimeout(handleTyping, 2400);
        } else {
          timer = setTimeout(handleTyping, 60);
        }
      } else {
        setTypedText(currentPhrase.substring(0, charIndex - 1));
        charIndex--;

        if (charIndex === 0) {
          isDeleting = false;
          phraseIndex = (phraseIndex + 1) % phrases.length;
          timer = setTimeout(handleTyping, 400);
        } else {
          timer = setTimeout(handleTyping, 35);
        }
      }
    }

    timer = setTimeout(handleTyping, 300);
    return () => clearTimeout(timer);
  }, []);

  // Antigravity interactive canvas particle system
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;
    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);

    const mouse = {
      x: width / 2,
      y: height / 2,
      targetX: width / 2,
      targetY: height / 2,
      isHovered: false,
      speed: 0,
      lastX: width / 2,
      lastY: height / 2,
    };

    const particleColors = [
      '#0B3D91', // Navy — Google blue taken most of the way to black
      '#7F1D1D', // Deep maroon
      '#78350F', // Dark amber; yellow itself is invisible on white at this size
      '#14532D', // Forest green
      '#1E293B', // Slate 800
      '#0F172A'  // Slate 900
    ];

    const particleCount = Math.min(Math.floor((width * height) / 12000), 75);
    const particles: Particle[] = [];

    for (let i = 0; i < particleCount; i++) {
      const x = Math.random() * width;
      const y = Math.random() * height;
      const baseAlpha = 0.6 + Math.random() * 0.35;
      particles.push({
        x,
        y,
        originX: x,
        originY: y,
        vx: (Math.random() - 0.5) * 0.4,
        vy: (Math.random() - 0.5) * 0.4,
        size: Math.random() * 2.4 + 1.5,
        color: particleColors[Math.floor(Math.random() * particleColors.length)],
        alpha: baseAlpha,
        baseAlpha,
        floatAngle: Math.random() * Math.PI * 2,
        floatSpeed: 0.008 + Math.random() * 0.015
      });
    }

    const handleResize = () => {
      if (!canvas) return;
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    };

    const handleMouseMove = (e: MouseEvent) => {
      mouse.targetX = e.clientX;
      mouse.targetY = e.clientY;
      mouse.isHovered = true;
    };

    const handleMouseLeave = () => {
      mouse.isHovered = false;
    };

    window.addEventListener('resize', handleResize);
    window.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseleave', handleMouseLeave);

    const render = () => {
      ctx.clearRect(0, 0, width, height);

      // Smooth mouse interpolation
      mouse.x += (mouse.targetX - mouse.x) * 0.12;
      mouse.y += (mouse.targetY - mouse.y) * 0.12;

      const dxMouse = mouse.x - mouse.lastX;
      const dyMouse = mouse.y - mouse.lastY;
      mouse.speed = Math.sqrt(dxMouse * dxMouse + dyMouse * dyMouse);
      mouse.lastX = mouse.x;
      mouse.lastY = mouse.y;

      // Update and draw particles
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];

        // Ambient antigravity float
        p.floatAngle += p.floatSpeed;
        p.x += p.vx + Math.cos(p.floatAngle) * 0.35;
        p.y += p.vy + Math.sin(p.floatAngle) * 0.35;

        // Interaction with mouse cursor
        if (mouse.isHovered) {
          const dx = mouse.x - p.x;
          const dy = mouse.y - p.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const maxDist = 160;

          if (dist < maxDist && dist > 0) {
            const force = (1 - dist / maxDist);
            // Gentle repulsive spring + slight gravitational swirling
            const angle = Math.atan2(dy, dx);
            p.x -= Math.cos(angle) * force * 3.5;
            p.y -= Math.sin(angle) * force * 3.5;
            p.alpha = Math.min(1, p.baseAlpha + force * 0.5);
          } else {
            p.alpha += (p.baseAlpha - p.alpha) * 0.05;
          }
        } else {
          p.alpha += (p.baseAlpha - p.alpha) * 0.05;
        }

        // Boundary wrap
        if (p.x < -10) p.x = width + 10;
        if (p.x > width + 10) p.x = -10;
        if (p.y < -10) p.y = height + 10;
        if (p.y > height + 10) p.y = -10;

        // Draw particle sprinkle
        ctx.save();
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.globalAlpha = p.alpha;
        ctx.fill();
        ctx.restore();
      }

      animationFrameId = requestAnimationFrame(render);
    };

    render();

    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseleave', handleMouseLeave);
      cancelAnimationFrame(animationFrameId);
    };
  }, []);

  return (
    <div id="login-container" className="relative min-h-screen bg-white text-slate-900 flex flex-col justify-between font-sans selection:bg-slate-200 overflow-hidden">
      {/* Interactive HTML5 Canvas Antigravity Sprinkle Background */}
      <canvas
        ref={canvasRef}
        className="pointer-events-none absolute inset-0 z-0 w-full h-full"
      />

      {/* Spacer where the small wordmark used to sit. The name is already set at
          7xl in the middle of the page, so repeating it here just said it twice. */}
      <div className="relative z-10 w-full py-6" />

      {/* Main Plain Centered Content */}
      <main className="relative z-10 flex-1 w-full max-w-xl mx-auto px-6 flex flex-col items-center justify-center -mt-8 text-center">
        {/* MailFlow Big Title */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="flex flex-col items-center mb-3"
        >
          <h1 className="text-7xl font-normal tracking-[-0.04em] text-slate-900 leading-none select-none">
            MailFlow
          </h1>
        </motion.div>

        {/* Typing Headline */}
        <div className="h-12 flex items-center justify-center mb-10">
          <p className="text-xl font-normal text-slate-400 tracking-tight flex items-center justify-center">
            <span>{typedText}</span>
            <motion.span 
              animate={{ opacity: [1, 0] }} 
              transition={{ repeat: Infinity, duration: 0.8, ease: "linear" }}
              className="inline-block w-[2px] h-[22px] bg-slate-400 ml-1.5 align-middle"
            />
          </p>
        </div>

        {/* Action Button - Fully Transparent */}
        <div className="w-full max-w-xs flex flex-col items-center gap-3">
          <button
            id="google-login-btn"
            onClick={onLogin}
            disabled={isLoggingIn}
            className="group relative flex items-center justify-center gap-2.5 bg-transparent hover:bg-slate-100/70 active:bg-slate-200/50 text-slate-800 py-2.5 px-5 rounded-full transition-all duration-200 active:scale-[0.985] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            {isLoggingIn ? (
              <Loader2 className="w-4 h-4 animate-spin text-slate-500" />
            ) : (
              <svg className="w-4 h-4 shrink-0 transition-transform duration-200 group-hover:scale-105" viewBox="0 0 48 48">
                <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
                <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
                <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
                <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
                <path fill="none" d="M0 0h48v48H0z" />
              </svg>
            )}
            <span className="text-sm font-medium tracking-tight text-slate-800">
              {isLoggingIn ? "Connecting..." : "Continue with Google"}
            </span>
          </button>

          <AnimatePresence>
            {error && (
              <motion.div 
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -5 }}
                className="text-xs text-rose-600 bg-rose-50 border border-rose-200 px-3 py-2 rounded-lg w-full text-center mt-2"
              >
                {error}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>

      {/* Subtle Minimal Footer */}
      <footer className="relative z-10 w-full py-6 px-6 text-center text-xs text-slate-400">
        <span>Private • Secure</span>
      </footer>
    </div>
  );
}
