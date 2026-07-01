// Shared.jsx — Аргонавтика Design System
// Tokens, base components, utilities, glyphs, parallax.
// Exports to window: C, StarSpark, FadeSection, SecLabel, Hairline, scrollTo,
//                    WordMark, MovementGlyph, MeanderRule, useParallax, MEDIA

const { useState, useEffect, useRef, useCallback, useLayoutEffect } = React;

// ─── COLOR TOKENS ───────────────────────────────────────────────────────────
const argonautikaColors = {
  bezdna:      '#0B100E',   // абзацный фон
  tishina:     '#000000',   // чистая чернота / тишина
  more:        '#134E45',   // море
  moreGlub:    '#0E342E',   // море·глубь
  kost:        '#E9E2D4',   // текст / пена / кость
  kostYar:     '#F4F1E9',   // кость·ярь
  kostDim:     '#C7C0B1',
  kostMuted:   '#9A9486',
  ghost:       '#6A665B',
  stone:       '#4F4B42',
  zoloto:      '#C29A48',   // золото
  zolotoYar:   '#D9B45A',   // золото·ярь
  latun:       '#9C7A33',   // латунь
  krov:        '#8E2018',   // кровь
  krovYar:     '#B23A2E',   // кровь·ярь
  kamen:       '#6E6A5E',
  kamenTepl:   '#8A8478',
  frame:       '#1C211E',
  frameDeep:   '#2C322E',
  surface:     '#0C100F',
};
const C = argonautikaColors;

const MEDIA = {
  sea:        'media/sea.jpg',
  seaShip:    'media/sea_ship.jpg',
  argoLine:   'media/argo_lineart.jpg',
  monogram:   'media/monogram.png',
  argoShip:   'media/argo_ship.png',
  argoBoat:   'media/argo_boat.png',
  thread:     'media/thread.jpg',
  sword:      'media/sword.jpg',
  rings:      'media/rings.jpg',
  ascension:  'media/ascension.jpg',
  helmet:     'media/helmet_meander.jpg',
  vase:       'media/argonaut_vase.jpg',
  worldsMap:  'media/worlds_map.jpg',
};

// ─── STAR SPARK ─────────────────────────────────────────────────────────────
const StarSpark = ({ size = 12, color = C.zoloto, style }) => (
  <svg
    width={size} height={size}
    viewBox="-11 -11 22 22"
    style={{ display: 'inline-block', flexShrink: 0, verticalAlign: 'middle', ...style }}
  >
    <path
      d="M0,-10 C1.5,-3 3,-1.5 10,0 C3,1.5 1.5,3 0,10 C-1.5,3 -3,1.5 -10,0 C-3,-1.5 -1.5,-3 0,-10 Z"
      fill={color}
    />
  </svg>
);

// ─── WORDMARK — «АРГОНАВТИКА» (T1 placeholder, Prata) ────────────────────────
const WordMark = ({ text = 'АРГОНАВТИКА', size = 13, color = C.kostDim, gap = 6, withStar = true, starColor = C.zoloto, style }) => (
  <span style={{
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap,
    fontFamily: "'Prata', serif",
    fontSize: size, letterSpacing: Math.max(2, size * 0.32),
    textTransform: 'uppercase',
    color, lineHeight: 1.4, textAlign: 'center', flexWrap: 'wrap',
    ...style,
  }}>
    {withStar && <StarSpark size={size * 0.72} color={starColor} />}
    {text}
  </span>
);

// ─── THREE MOVEMENT GLYPHS — Явь / Навь / Правь ──────────────────────────────
// kind: 'yav' (crosshair, в точку), 'nav' (sphere+descent, внутри точки),
//       'prav' (radiant burst, из точки)
const MovementGlyph = ({ kind = 'yav', size = 40, color = C.kost }) => {
  const s = { display: 'block' };
  if (kind === 'yav') {
    return (
      <svg width={size} height={size} viewBox="-24 -24 48 48" style={s} fill="none" stroke={color} strokeWidth="1.1">
        <circle cx="0" cy="0" r="17" opacity="0.75" />
        <line x1="-22" y1="0" x2="22" y2="0" opacity="0.55" />
        <line x1="0" y1="-22" x2="0" y2="22" opacity="0.55" />
        <circle cx="0" cy="0" r="2.4" fill={color} stroke="none" />
      </svg>
    );
  }
  if (kind === 'nav') {
    return (
      <svg width={size} height={size} viewBox="-24 -24 48 48" style={s} fill="none" stroke={color} strokeWidth="1.1">
        <circle cx="0" cy="-3" r="14" stroke={color} opacity="0.85" />
        <path d="M0,-3 C5,-3 5,3 0,3 C-5,3 -5,-3 0,-3 Z" fill={color} stroke="none" opacity="0.9" />
        <line x1="0" y1="11" x2="0" y2="20" opacity="0.6" />
        <circle cx="0" cy="20" r="1.6" fill={color} stroke="none" />
      </svg>
    );
  }
  // prav — radiant burst from a star
  return (
    <svg width={size} height={size} viewBox="-24 -24 48 48" style={s} fill="none" stroke={color} strokeWidth="1.1">
      {[0,45,90,135,180,225,270,315].map(a => {
        const r = (a % 90 === 0) ? 21 : 14;
        const rad = a * Math.PI / 180;
        return <line key={a} x1={Math.cos(rad)*5} y1={Math.sin(rad)*5} x2={Math.cos(rad)*r} y2={Math.sin(rad)*r} opacity={a%90===0?0.85:0.4} />;
      })}
      <path d="M0,-7 C1,-2 2,-1 7,0 C2,1 1,2 0,7 C-1,2 -2,1 -7,0 C-2,-1 -1,-2 0,-7 Z" fill={color} stroke="none" />
    </svg>
  );
};

// ─── FADE ON SCROLL ──────────────────────────────────────────────────────────
const FadeSection = ({ children, delay = 0, y = 28, style, className }) => {
  const ref = useRef(null);
  const reduceMotion = typeof window !== 'undefined' && window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const [visible, setVisible] = useState(reduceMotion);

  useEffect(() => {
    if (reduceMotion) { setVisible(true); return; }
    const el = ref.current;
    if (!el) return;
    let revealed = false;
    let timer = null;
    const reveal = () => {
      if (revealed) return;
      revealed = true;
      cleanup();
      timer = setTimeout(() => setVisible(true), delay);
    };
    const vh = () => window.innerHeight || document.documentElement.clientHeight || 800;
    const inView = () => {
      const r = el.getBoundingClientRect();
      return r.top < vh() * 0.94 && r.bottom > 0;
    };
    const onScroll = () => { if (inView()) reveal(); };
    function cleanup() {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    }

    // Reveal immediately if in view; otherwise watch scroll/resize.
    if (inView()) {
      reveal();
    } else {
      window.addEventListener('scroll', onScroll, { passive: true });
      window.addEventListener('resize', onScroll);
      // Re-check across the next few frames in case layout/fonts settle late.
      requestAnimationFrame(() => { if (!revealed && inView()) reveal(); });
      setTimeout(() => { if (!revealed && inView()) reveal(); }, 250);
    }
    // Safety net: never let content stay hidden if scroll never fires.
    const fallback = setTimeout(reveal, 1500 + delay);

    return () => { cleanup(); if (timer) clearTimeout(timer); clearTimeout(fallback); };
  }, [delay]);

  return (
    <div
      ref={ref}
      className={className}
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : `translateY(${y}px)`,
        transition: 'opacity 1.1s cubic-bezier(.22,.61,.36,1), transform 1.1s cubic-bezier(.22,.61,.36,1)',
        willChange: 'opacity, transform',
        ...style,
      }}
    >
      {children}
    </div>
  );
};

// ─── PARALLAX HOOK ───────────────────────────────────────────────────────────
// Returns a ref + style for slow vertical parallax. `speed` ~ -0.15..0.15.
const useParallax = (speed = 0.12) => {
  const ref = useRef(null);
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf = null;
    const update = () => {
      raf = null;
      const rect = el.getBoundingClientRect();
      const vh = window.innerHeight;
      // progress: -1 (below) .. 1 (above), 0 when centered
      const progress = (rect.top + rect.height / 2 - vh / 2) / (vh);
      setOffset(progress * speed * vh);
    };
    const onScroll = () => { if (raf == null) raf = requestAnimationFrame(update); };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [speed]);
  return [ref, offset];
};

// ─── SECTION LABEL ───────────────────────────────────────────────────────────
const SecLabel = ({ num, text, color = C.ghost, accent = C.latun, style }) => (
  <div style={{
    fontFamily: "'Onest', sans-serif",
    fontSize: 11, fontWeight: 500, letterSpacing: 3.5,
    textTransform: 'uppercase',
    color, marginBottom: 30,
    display: 'flex', alignItems: 'center', gap: 12,
    ...style,
  }}>
    <span style={{ color: accent }}>{num}</span>
    <span style={{ width: 22, height: 1, background: `${accent}`, opacity: 0.5 }} />
    <span>{text}</span>
  </div>
);

// ─── GOLD HAIRLINE ───────────────────────────────────────────────────────────
const Hairline = ({ strength = 'soft', style }) => (
  <div style={{
    borderTop: `1px solid rgba(194,154,72,${strength === 'strong' ? 0.42 : strength === 'faint' ? 0.1 : 0.2})`,
    ...style,
  }} />
);

// ─── MEANDER RULE — greek-key gold divider (Register A) ──────────────────────
const MeanderRule = ({ color = C.zoloto, opacity = 0.5, height = 12, style }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 14, ...style }}>
    <div style={{ flex: 1, borderTop: `1px solid ${color}`, opacity: opacity * 0.5 }} />
    <svg width="78" height={height} viewBox="0 0 78 12" style={{ opacity, flexShrink: 0 }} fill="none" stroke={color} strokeWidth="1">
      <path d="M1,11 V4 H8 V8 H5 V6 M14,11 V4 H21 V8 H18 V6 M27,11 V4 H34 V8 H31 V6 M40,11 V4 H47 V8 H44 V6 M53,11 V4 H60 V8 H57 V6 M66,11 V4 H73 V8 H70 V6" />
    </svg>
    <div style={{ flex: 1, borderTop: `1px solid ${color}`, opacity: opacity * 0.5 }} />
  </div>
);

// ─── SMOOTH SCROLL HELPER ────────────────────────────────────────────────────
const scrollTo = (id, offset = 64) => {
  const el = document.getElementById(id);
  if (!el) return;
  const top = el.getBoundingClientRect().top + window.scrollY - offset;
  window.scrollTo({ top, behavior: 'smooth' });
};

// Export all shared items
Object.assign(window, {
  argonautikaColors, C, MEDIA,
  StarSpark, WordMark, MovementGlyph, FadeSection, SecLabel, Hairline, MeanderRule,
  scrollTo, useParallax,
  useState, useEffect, useRef, useCallback, useLayoutEffect,
});
