// Splash screen with a "Changing Words" cycle recreated from the Framer
// module (framer.com/m/Changing-Words-rMO9qk): each word springs in
// character-by-character (stiffness 200, damping 50, 0.05s stagger) from
// x:+20 / blur(5px), holds, blanks, then cycles to the next word.
import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';

const WORDS = ['Live trains', 'Real-time GPS', 'Photoreal 3D'];
const SPRING = { type: 'spring', stiffness: 200, damping: 50 };
const SHOW_MS = 2600; // word visible
const GAP_MS = 500; // blank between words (Framer used 1s; tightened for a splash)
const MIN_MS = 4200; // minimum splash time so at least one full word plays

function ChangingWords({ words = WORDS }) {
  const [idx, setIdx] = useState(0);
  const [on, setOn] = useState(true);

  useEffect(() => {
    const t = on
      ? setTimeout(() => setOn(false), SHOW_MS)
      : setTimeout(() => { setIdx((i) => (i + 1) % words.length); setOn(true); }, GAP_MS);
    return () => clearTimeout(t);
  }, [on, words.length]);

  return (
    <span className="tt-splash-words">
      <AnimatePresence>
        {on && (
          <motion.span
            key={idx}
            className="word"
            exit={{ opacity: 0, filter: 'blur(6px)', transition: { duration: 0.3 } }}
          >
            {words[idx].split('').map((ch, i) => (
              <motion.span
                key={i}
                className="ch"
                initial={{ opacity: 0, x: 20, filter: 'blur(5px)' }}
                animate={{ opacity: 1, x: 0, filter: 'blur(0px)' }}
                transition={{ ...SPRING, delay: i * 0.05 }}
              >
                {ch === ' ' ? ' ' : ch}
              </motion.span>
            ))}
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}

export default function Splash({ ready, onDone }) {
  const mountedAt = useRef(Date.now());
  const [leaving, setLeaving] = useState(false);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    if (!ready || leaving) return;
    const wait = Math.max(0, MIN_MS - (Date.now() - mountedAt.current));
    const t = setTimeout(() => { setLeaving(true); onDone?.(); }, wait);
    return () => clearTimeout(t);
  }, [ready, leaving, onDone]);

  if (gone) return null;

  return (
    <motion.div
      className="tt-splash"
      initial={{ opacity: 1 }}
      animate={leaving ? { opacity: 0 } : { opacity: 1 }}
      transition={{ duration: 0.7, ease: 'easeInOut' }}
      onAnimationComplete={() => leaving && setGone(true)}
    >
      <div className="tt-splash-inner">
        <svg className="tt-splash-logo" width="56" height="56" viewBox="0 0 24 24" aria-hidden="true">
          <defs>
            <linearGradient id="ttsg" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#252c38" />
              <stop offset="1" stopColor="#0b0e14" />
            </linearGradient>
          </defs>
          <rect x="0.5" y="0.5" width="23" height="23" rx="7" fill="url(#ttsg)" stroke="rgba(255,255,255,0.16)" />
          <path d="M6.2 17.8 L13 7" stroke="#4b5563" strokeWidth="1.7" strokeLinecap="round" />
          <path d="M10.4 17.8 L17.2 7" stroke="#8a94a6" strokeWidth="1.7" strokeLinecap="round" />
          <circle cx="16.9" cy="16.4" r="2.2" fill="#e6eaf0" />
        </svg>
        <h1 className="tt-splash-brand">TERM<span>TRADE</span></h1>
        <div className="tt-splash-line">
          <ChangingWords />
        </div>
        <p className="tt-splash-sub">
          <i className={ready ? 'ok' : ''} />
          {ready ? 'network ready' : 'loading Malaysia transit network…'}
        </p>
      </div>
    </motion.div>
  );
}
