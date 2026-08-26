import React, { useEffect, useState } from 'react';

/**
 * Hand-drawn stick figures for loading states.
 *
 * Drawn as inline SVG with CSS keyframes rather than an animation library or a GIF:
 * it stays crisp at any size, adds nothing to the bundle, inherits the current text
 * colour, and costs nothing to render.
 *
 * The scene matches the job, so the wait tells you what is happening — filing for
 * folder work, binning for cleanup, a magnifying glass for analysis.
 */

export type SketchScene = 'filing' | 'sorting' | 'binning' | 'searching' | 'measuring' | 'walking' | 'resting';

interface Props {
  scene?: SketchScene;
  className?: string;
}

/** Shared stick body. The head is separate so scenes can tilt it. */
function Body() {
  return (
    <>
      <line x1="50" y1="42" x2="50" y2="70" />
      <line x1="50" y1="70" x2="42" y2="88" />
      <line x1="50" y1="70" x2="58" y2="88" />
    </>
  );
}

function Scene({ scene }: { scene: SketchScene }) {
  switch (scene) {
    case 'filing':
      return (
        <g>
          {/* Cabinet */}
          <rect x="66" y="52" width="28" height="38" rx="2" />
          <line x1="66" y1="65" x2="94" y2="65" />
          <line x1="66" y1="78" x2="94" y2="78" />
          <circle cx="80" cy="58.5" r="1.6" />
          <circle cx="80" cy="71.5" r="1.6" />
          <g className="sk-arm-file">
            <line x1="50" y1="52" x2="66" y2="46" />
            <rect className="sk-paper" x="62" y="38" width="12" height="9" rx="1" />
          </g>
          <line x1="50" y1="52" x2="38" y2="62" />
          <circle cx="50" cy="34" r="8" />
          <Body />
        </g>
      );

    case 'sorting':
      return (
        <g>
          <rect x="8" y="70" width="22" height="18" rx="2" />
          <rect x="70" y="70" width="22" height="18" rx="2" />
          <rect className="sk-paper sk-fly-left" x="20" y="30" width="12" height="9" rx="1" />
          <rect className="sk-paper sk-fly-right" x="68" y="30" width="12" height="9" rx="1" />
          <line x1="50" y1="52" x2="34" y2="44" />
          <line x1="50" y1="52" x2="66" y2="44" />
          <circle cx="50" cy="34" r="8" />
          <Body />
        </g>
      );

    case 'binning':
      return (
        <g>
          {/* Bin */}
          <path d="M68 58 L92 58 L89 92 L71 92 Z" />
          <line x1="65" y1="58" x2="95" y2="58" />
          <line x1="76" y1="66" x2="77" y2="85" />
          <line x1="84" y1="66" x2="83" y2="85" />
          <rect className="sk-paper sk-drop" x="72" y="30" width="12" height="9" rx="1" />
          <g className="sk-arm-toss">
            <line x1="50" y1="52" x2="68" y2="44" />
          </g>
          <line x1="50" y1="52" x2="38" y2="62" />
          <circle cx="50" cy="34" r="8" />
          <Body />
        </g>
      );

    case 'measuring':
      return (
        <g>
          <rect x="64" y="62" width="30" height="28" rx="2" />
          <line x1="64" y1="72" x2="94" y2="72" />
          <rect className="sk-paper sk-stack" x="68" y="48" width="22" height="12" rx="1" />
          <line x1="50" y1="52" x2="66" y2="56" />
          <line x1="50" y1="52" x2="38" y2="62" />
          <circle cx="50" cy="34" r="8" />
          <Body />
        </g>
      );

    case 'walking':
      // Legs swap and the arms counter-swing; the figure itself is translated
      // across the frame by .sk-walk on the wrapper.
      return (
        <g>
          <g className="sk-carry">
            <line x1="50" y1="52" x2="62" y2="46" />
            <rect className="sk-paper" x="58" y="38" width="13" height="10" rx="1" />
          </g>
          <line className="sk-arm-swing" x1="50" y1="52" x2="38" y2="60" />
          <circle cx="50" cy="34" r="8" />
          <line x1="50" y1="42" x2="50" y2="70" />
          <line className="sk-leg-a" x1="50" y1="70" x2="41" y2="88" />
          <line className="sk-leg-b" x1="50" y1="70" x2="59" y2="88" />
        </g>
      );

    case 'resting':
      // Sitting on a box, one leg swinging. For quiet states rather than work.
      return (
        <g>
          <rect x="40" y="70" width="26" height="20" rx="2" />
          <circle cx="36" cy="40" r="8" />
          <line x1="36" y1="48" x2="40" y2="70" />
          <line x1="38" y1="56" x2="28" y2="64" />
          <line x1="40" y1="70" x2="56" y2="70" />
          <line className="sk-leg-swing" x1="56" y1="70" x2="58" y2="88" />
          <line x1="56" y1="70" x2="50" y2="88" />
        </g>
      );

    case 'searching':
    default:
      return (
        <g>
          <g className="sk-glass">
            <circle cx="76" cy="46" r="11" />
            <line x1="84" y1="54" x2="92" y2="63" />
          </g>
          <line x1="50" y1="52" x2="68" y2="50" />
          <line x1="50" y1="52" x2="38" y2="62" />
          <circle cx="50" cy="34" r="8" />
          <Body />
        </g>
      );
  }
}

export function SketchLoader({ scene = 'searching', className }: Props) {
  const isWalking = scene === 'walking';
  return (
    <div className={className} aria-hidden="true">
      <style>{`
        @keyframes sk-bob { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-3px); } }
        @keyframes sk-arm-file { 0%,100% { transform: rotate(0deg); } 45% { transform: rotate(-16deg); } }
        @keyframes sk-arm-toss { 0%,100% { transform: rotate(0deg); } 40% { transform: rotate(-26deg); } }
        @keyframes sk-drop { 0% { opacity:0; transform: translate(0,0); } 25% { opacity:1; }
                             70% { opacity:1; transform: translate(4px,26px); }
                             85%,100% { opacity:0; transform: translate(4px,30px); } }
        @keyframes sk-fly-left { 0%,100% { transform: translate(0,0); opacity:0; }
                                 30% { opacity:1; } 75% { transform: translate(-6px,38px); opacity:1; }
                                 90% { opacity:0; } }
        @keyframes sk-fly-right { 0%,100% { transform: translate(0,0); opacity:0; }
                                  40% { opacity:1; } 80% { transform: translate(6px,38px); opacity:1; }
                                  95% { opacity:0; } }
        @keyframes sk-glass { 0%,100% { transform: translate(0,0); } 33% { transform: translate(-7px,4px); }
                              66% { transform: translate(5px,-3px); } }
        @keyframes sk-stack { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-4px); } }
        @keyframes sk-dash { to { stroke-dashoffset: 0; } }
        @keyframes sk-walk { 0% { transform: translateX(-42%); } 100% { transform: translateX(42%); } }
        @keyframes sk-leg-a { 0%,100% { transform: rotate(14deg); } 50% { transform: rotate(-14deg); } }
        @keyframes sk-leg-b { 0%,100% { transform: rotate(-14deg); } 50% { transform: rotate(14deg); } }
        @keyframes sk-arm-swing { 0%,100% { transform: rotate(-12deg); } 50% { transform: rotate(12deg); } }
        @keyframes sk-carry { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-2px); } }
        @keyframes sk-leg-swing { 0%,100% { transform: rotate(-10deg); } 50% { transform: rotate(16deg); } }
        /* Hand-drawn "boil": the whole scene jitters a hair on a slow step timer, the
           way ink-on-paper animation wobbles frame to frame. Keeps it alive to watch. */
        @keyframes sk-boil { 0%,100% { transform: translate(0,0) rotate(0deg); }
                             33% { transform: translate(.5px,-.4px) rotate(.4deg); }
                             66% { transform: translate(-.4px,.45px) rotate(-.35deg); } }
        /* Indeterminate bar: a shuttle crossing the track when there is nothing to count. */
        @keyframes sk-bar-shuttle { 0% { transform: translateX(-110%); } 100% { transform: translateX(360%); } }

        .sk-figure { animation: sk-bob 2.4s ease-in-out infinite; transform-origin: 50% 100%; }
        /* Strokes draw themselves in once, so it reads as a sketch being made. */
        .sk-figure path, .sk-figure line, .sk-figure circle, .sk-figure rect {
          stroke-dasharray: 120; stroke-dashoffset: 120;
          animation: sk-dash 1.1s ease-out forwards;
        }
        .sk-scene { animation: sk-boil .42s steps(1,end) infinite; transform-origin: 50% 60%; transform-box: fill-box; }
        .sk-arm-file { animation: sk-arm-file 2.4s ease-in-out infinite; transform-origin: 50px 52px; }
        .sk-arm-toss { animation: sk-arm-toss 2.2s ease-in-out infinite; transform-origin: 50px 52px; }
        .sk-glass { animation: sk-glass 3s ease-in-out infinite; }
        /* The moving props are <rect>s, so they also match the draw-in rule above and
           would lose their motion to it. Re-declare both animations at a specificity
           that wins, or the papers hang in mid-air. */
        .sk-figure .sk-drop { animation: sk-dash 1.1s ease-out forwards, sk-drop 2.2s ease-in-out infinite; }
        .sk-figure .sk-fly-left { animation: sk-dash 1.1s ease-out forwards, sk-fly-left 2.6s ease-in-out infinite; }
        .sk-figure .sk-fly-right { animation: sk-dash 1.1s ease-out forwards, sk-fly-right 2.6s ease-in-out infinite .3s; }
        .sk-figure .sk-stack { animation: sk-dash 1.1s ease-out forwards, sk-stack 2s ease-in-out infinite; }
        /* The whole figure crosses the frame, so it reads as carrying something
           somewhere rather than marching on the spot. */
        .sk-walking { animation: sk-walk 5s linear infinite alternate; }
        /* Limbs are <line>s and hit the same clash as the props above. */
        .sk-figure .sk-leg-a { animation: sk-dash 1.1s ease-out forwards, sk-leg-a .6s ease-in-out infinite; transform-origin: 50px 70px; }
        .sk-figure .sk-leg-b { animation: sk-dash 1.1s ease-out forwards, sk-leg-b .6s ease-in-out infinite; transform-origin: 50px 70px; }
        .sk-figure .sk-arm-swing { animation: sk-dash 1.1s ease-out forwards, sk-arm-swing .6s ease-in-out infinite; transform-origin: 50px 52px; }
        .sk-figure .sk-leg-swing { animation: sk-dash 1.1s ease-out forwards, sk-leg-swing 2.6s ease-in-out infinite; transform-origin: 56px 70px; }
        .sk-carry { animation: sk-carry .6s ease-in-out infinite; transform-origin: 50px 52px; }
        .sk-bar-shuttle { animation: sk-bar-shuttle 1.6s cubic-bezier(.65,.05,.36,1) infinite; }

        /* Respect a stated preference for less motion: the drawing still appears,
           it simply stops moving. */
        @media (prefers-reduced-motion: reduce) {
          .sk-figure, .sk-figure *, .sk-scene, .sk-arm-file, .sk-arm-toss, .sk-drop,
          .sk-fly-left, .sk-fly-right, .sk-glass, .sk-stack,
          .sk-walking, .sk-leg-a, .sk-leg-b, .sk-arm-swing, .sk-carry, .sk-leg-swing {
            animation: none !important;
            stroke-dashoffset: 0 !important;
          }
          /* A still bar would read as stalled, so fill the track instead. */
          .sk-bar-shuttle { animation: none !important; width: 100% !important; opacity: .45; }
        }
      `}</style>

      <svg
        viewBox="0 0 100 100"
        className={`sk-figure text-slate-400 ${isWalking ? 'sk-walking w-28 h-28 sm:w-32 sm:h-32' : 'w-24 h-24 sm:w-28 sm:h-28'}`}
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <g className="sk-scene">
          <Scene scene={scene} />
        </g>
        {/* Ground line, so the figure is standing rather than floating */}
        <line x1="14" y1="92" x2="86" y2="92" className="text-slate-200" strokeWidth="1.6" />
      </svg>
    </div>
  );
}

/**
 * Cycles through messages beneath the sketch. A wait that names what it is doing is
 * far easier to sit through than a bare spinner.
 */
export function SketchLoadingState({
  scene = 'searching',
  title,
  messages = [],
  progress,
  progressLabel = 'Reading your mail',
}: {
  scene?: SketchScene;
  title: string;
  messages?: string[];
  /** Real counts when the work is measurable, so a long scan reads as progress. */
  progress?: { done: number; total: number } | null;
  /** Caption on the bar. Says what is being counted when counts are available. */
  progressLabel?: string;
}) {
  const [index, setIndex] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (messages.length < 2) return;
    const timer = setInterval(() => setIndex(i => (i + 1) % messages.length), 2200);
    return () => clearInterval(timer);
  }, [messages.length]);

  // Without counts there is nothing honest to put opposite the bar, and a wait with
  // no numbers on it at all feels stuck. A running clock at least confirms it is alive.
  const measurable = !!progress && progress.total > 0;
  useEffect(() => {
    if (measurable) return;
    const timer = setInterval(() => setElapsed(s => s + 1), 1000);
    return () => clearInterval(timer);
  }, [measurable]);

  const pct = measurable
    ? Math.min(100, Math.round((progress!.done / progress!.total) * 100))
    : 0;

  return (
    <div className="w-full flex flex-col items-center justify-center py-12 sm:py-16 gap-1 text-center">
      <SketchLoader scene={scene} />
      <p className="text-sm font-semibold text-slate-800 mt-2">{title}</p>
      {messages.length > 0 && (
        <p key={index} className="text-xs text-slate-500 animate-in fade-in duration-500 min-h-[1rem]">
          {messages[index]}
        </p>
      )}

      {/* The bar is always here: determinate when the work can be counted, a moving
          shuttle when it cannot. Either way the wait shows something happening. */}
      <div className="w-full max-w-[220px] mt-3">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[11px] font-medium text-slate-500">
            {measurable ? progressLabel : 'Working…'}
          </span>
          <span className="text-[11px] font-medium text-slate-600 tabular-nums">
            {measurable
              ? `${progress!.done.toLocaleString()} / ${progress!.total.toLocaleString()}`
              : formatElapsed(elapsed)}
          </span>
        </div>
        <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
          {measurable ? (
            <div
              className="h-full bg-slate-800 rounded-full transition-all duration-300"
              style={{ width: `${pct}%` }}
            />
          ) : (
            <div className="sk-bar-shuttle h-full w-[28%] bg-slate-800/80 rounded-full" />
          )}
        </div>
      </div>
    </div>
  );
}

function formatElapsed(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
