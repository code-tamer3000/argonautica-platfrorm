// Sections.jsx — Аргонавтика · Header · Hero (Порог) · О чём
// Register C (dark ocean) threshold + definition.

// ─── HEADER ──────────────────────────────────────────────────────────────────
const Header = ({ activeSection }) => {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 60);
    window.addEventListener('scroll', handler, { passive: true });
    return () => window.removeEventListener('scroll', handler);
  }, []);

  const navItems = [
    { id: 'about',     label: 'О ЧЁМ' },
    { id: 'manifesto', label: 'МАНИФЕСТ' },
    { id: 'karta',     label: 'КАРТА' },
  ];

  return (
    <header style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 100,
      padding: '0 clamp(20px,4vw,44px)', height: 64,
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      background: scrolled ? 'rgba(7,11,9,0.86)' : 'transparent',
      backdropFilter: scrolled ? 'blur(14px) saturate(1.1)' : 'none',
      WebkitBackdropFilter: scrolled ? 'blur(14px) saturate(1.1)' : 'none',
      borderBottom: scrolled ? '1px solid rgba(194,154,72,0.14)' : '1px solid transparent',
      transition: 'background 0.5s ease, border-color 0.5s ease, backdrop-filter 0.5s ease',
    }}>
      <button onClick={() => scrollTo('hero', 0)} style={{
        background: 'none', border: 'none', cursor: 'pointer', padding: 0,
        display: 'flex', alignItems: 'center', gap: 11,
      }}>
        <img src={MEDIA.monogram} alt="Аргонавтика"
          style={{ height: 26, width: 'auto', filter: 'invert(1)', display: 'block', opacity: 0.92 }} />
        <span style={{
          fontFamily: "'Prata', serif", fontSize: 12, letterSpacing: 3.5,
          textTransform: 'uppercase', color: C.kostDim,
        }}>Аргонавтика</span>
      </button>

      <nav style={{ display: 'flex', gap: 'clamp(16px,2.5vw,30px)', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: 'clamp(14px,2vw,26px)' }} className="hdr-links">
          {navItems.map(item => (
            <button key={item.id} onClick={() => scrollTo(item.id)}
              style={{
                background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0',
                fontFamily: "'Onest', sans-serif", fontSize: 11, fontWeight: 500, letterSpacing: 2.5,
                textTransform: 'uppercase',
                color: activeSection === item.id ? C.kostDim : C.ghost,
                borderBottom: `1px solid ${activeSection === item.id ? 'rgba(194,154,72,0.5)' : 'transparent'}`,
                transition: 'color 220ms ease, border-color 220ms ease',
              }}
              onMouseEnter={e => e.currentTarget.style.color = C.kostDim}
              onMouseLeave={e => e.currentTarget.style.color = activeSection === item.id ? C.kostDim : C.ghost}
            >{item.label}</button>
          ))}
        </div>
        <button onClick={() => scrollTo('expedition')} style={{
          background: C.zoloto, color: '#0B0E0C', border: 'none', borderRadius: 6,
          fontFamily: "'Onest', sans-serif", fontSize: 11.5, fontWeight: 600, letterSpacing: 1.5,
          textTransform: 'uppercase', padding: '9px 17px', cursor: 'pointer',
          transition: 'background 220ms ease',
        }}
          onMouseEnter={e => e.currentTarget.style.background = C.zolotoYar}
          onMouseLeave={e => e.currentTarget.style.background = C.zoloto}
        >Записаться на борт</button>
      </nav>
    </header>
  );
};

// ─── HERO / ПОРОГ (Register C) ────────────────────────────────────────────────
const HeroSection = () => {
  const [bgRef, bgOffset] = useParallax(0.18);
  return (
    <section id="hero" data-screen-label="Hero · Порог" style={{
      position: 'relative', minHeight: '100svh',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      overflow: 'hidden', background: C.tishina, paddingTop: 'clamp(56px,9vh,112px)',
    }}>
      {/* Sea background w/ parallax */}
      <div ref={bgRef} style={{
        position: 'absolute', inset: '-12% 0', zIndex: 0,
        backgroundImage: `url('${MEDIA.sea}')`,
        backgroundSize: 'cover', backgroundPosition: 'center',
        transform: `translateY(${bgOffset}px) scale(1.08)`,
        opacity: 0.62,
      }} />
      {/* tone + grain over sea */}
      <div style={{ position: 'absolute', inset: 0, zIndex: 1,
        background: 'radial-gradient(ellipse 80% 70% at 50% 42%, rgba(11,16,14,0) 0%, rgba(8,12,10,0.55) 62%, rgba(5,7,6,0.92) 100%)' }} />
      <div style={{ position: 'absolute', inset: 0, zIndex: 1,
        background: 'linear-gradient(to bottom, rgba(5,7,6,0.7) 0%, transparent 22%, transparent 60%, #0B100E 100%)' }} />

      {/* Content */}
      <div style={{ position: 'relative', zIndex: 2, textAlign: 'center', padding: '0 24px', maxWidth: 880 }}>
        <FadeSection delay={120} y={16}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 56, fontFamily: "'Onest', sans-serif", fontSize: 12, fontWeight: 600, letterSpacing: 3, textTransform: 'uppercase', color: C.kostDim, maxWidth: '34ch', margin: '0 auto 56px' }}>
            СИСТЕМА ПРОЯВЛЕНИЯ ДЛЯ ЛЮДЕЙ С МИССИЕЙ
          </div>
        </FadeSection>

        <FadeSection delay={360} y={22}>
          <h1 style={{
            fontFamily: "'Prata', serif", fontWeight: 400,
            fontSize: 'clamp(40px, 7.5vw, 86px)', lineHeight: 1.04,
            color: C.kostYar, letterSpacing: '-0.01em',
            margin: '0 auto 42px', maxWidth: '13em',
            textShadow: '0 2px 40px rgba(0,0,0,0.55)',
          }}>
            Пиратская<br />экспедиция.
          </h1>
        </FadeSection>

        <FadeSection delay={620} y={18}>
          <p style={{
            fontFamily: "'Lora', serif", fontStyle: 'italic', fontWeight: 400,
            fontSize: 'clamp(16px,2vw,20px)', lineHeight: 1.7,
            color: C.kostDim, margin: '0 auto 62px', maxWidth: 520,
          }}>
            Аргонавты способны срезать углы и проходить сквозь стены системы.
          </p>
        </FadeSection>

        <FadeSection delay={860} y={14}>
          <div style={{ display: 'flex', gap: 16, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button onClick={() => scrollTo('manifesto')} style={btnPrimary}
              onMouseEnter={e => e.currentTarget.style.background = C.kostYar}
              onMouseLeave={e => e.currentTarget.style.background = C.kost}
            >Читать Манифест</button>
            <button onClick={() => scrollTo('about')} style={btnGhost}
              onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(194,154,72,0.5)'; e.currentTarget.style.color = C.kostDim; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = C.frameDeep; e.currentTarget.style.color = C.kostMuted; }}
            >О чём это</button>
          </div>
        </FadeSection>
      </div>

      {/* Scroll hint */}
      <FadeSection delay={1200} y={0} style={{ position: 'absolute', bottom: 30, left: 0, right: 0, zIndex: 2 }}>
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
          fontFamily: "'Onest', sans-serif", fontSize: 9.5, letterSpacing: 3.5,
          textTransform: 'uppercase', color: C.ghost,
        }}>
          <span>Спуститься</span>
          <span className="hero-arrow" style={{ fontSize: 14, lineHeight: 1 }}>↓</span>
        </div>
      </FadeSection>
    </section>
  );
};

// shared button styles
const btnPrimary = {
  fontFamily: "'Onest', sans-serif", fontSize: 13, fontWeight: 600, letterSpacing: 1,
  textTransform: 'uppercase', padding: '14px 30px', borderRadius: 6,
  background: C.kost, color: '#0B0E0C', border: 'none', cursor: 'pointer',
  transition: 'background 220ms ease',
};
const btnGhost = {
  fontFamily: "'Onest', sans-serif", fontSize: 13, fontWeight: 500, letterSpacing: 1,
  textTransform: 'uppercase', padding: '14px 30px', borderRadius: 6,
  background: 'transparent', color: C.kostMuted, border: `1px solid ${C.frameDeep}`, cursor: 'pointer',
  transition: 'border-color 220ms ease, color 220ms ease',
};

// ─── О ЧЁМ ─────────────────────────────────────────────────────────────────────
const ARC = [
  { k: 'Чужие сценарии', s: 'где ты сейчас' },
  { k: 'Своя опора',     s: 'плотное Ядро' },
  { k: 'Призвание',      s: 'твоё Дело' },
  { k: 'Легендарность',  s: 'наследие' },
];
const MOVES = [
  { glyph: 'yav',  big: 'Внутрь', label: 'ЯВЬ',  color: C.kost,    desc: 'Освобождение внимания. Опора.' },
  { glyph: 'nav',  big: 'Вглубь', label: 'НАВЬ', color: C.krovYar, desc: 'Погружение за самой большой силой.' },
  { glyph: 'prav', big: 'Наверх', label: 'ПРАВЬ', color: C.zoloto, desc: 'Проявленность. Дело — в мир.' },
];

const AboutSection = () => (
  <section id="about" data-screen-label="О чём" style={{
    background: C.bezdna, position: 'relative',
    padding: 'clamp(98px,12vw,172px) clamp(22px,7vw,96px)',
    borderTop: '1px solid rgba(194,154,72,0.08)',
  }}>
    <div style={{ maxWidth: 1080, margin: '0 auto' }}>
      <FadeSection><SecLabel num="01" text="О чём" /></FadeSection>

      {/* Definition + sword */}
      <div className="about-grid" style={{
        display: 'grid', gridTemplateColumns: '1fr clamp(220px,26vw,300px)', gap: 'clamp(32px,5vw,64px)',
        alignItems: 'center', marginBottom: 'clamp(56px,8vw,96px)',
      }}>
        <div>
          <FadeSection delay={80}>
            <h2 style={{
              fontFamily: "'Prata', serif", fontWeight: 400,
              fontSize: 'clamp(28px,4vw,50px)', lineHeight: 1.16, color: C.kostYar,
              letterSpacing: '-0.01em', marginBottom: 28, maxWidth: '13em',
            }}>
              Аргонавтика — это искусство <span style={{ color: C.zolotoYar }}>отсечения лишнего</span>.
            </h2>
          </FadeSection>
          <FadeSection delay={180}>
            <p style={{
              fontFamily: "'Lora', serif", fontSize: 18, lineHeight: 1.78, color: C.kostDim,
              maxWidth: '52ch', marginBottom: 18,
            }}>
              Племя тех, кто различает живое от неживого. Для аргонавтов тьма — не враг,
              а строительный материал. Через негатив происходит настоящее проявление, а не попытки проявиться.
              <br /><br />Аргонавты создают канву Эпохи Перемен. Это проводники и лидеры своих стай.
              <br /><br />Каждый аргонавт в душе знает, что пришёл сюда делать своё дело. Аргонавтика создана, чтобы отсечь всё наносное и проявить Дело согласно твоему Призванию.
            </p>
          </FadeSection>
        </div>

        <FadeSection delay={260} y={20}>
          <figure style={{
            margin: 0, position: 'relative', borderRadius: 8, overflow: 'hidden',
            border: '1px solid rgba(194,154,72,0.28)',
            boxShadow: 'inset 0 0 60px rgba(194,154,72,0.07)',
          }}>
            <img src={MEDIA.sword} alt="Меч — отсечение"
              style={{ width: '100%', display: 'block', aspectRatio: '4 / 5', objectFit: 'cover' }} />
            <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to bottom, transparent 60%, rgba(8,12,10,0.55))' }} />
          </figure>
        </FadeSection>
      </div>

      {/* Arc of transformation */}
      <FadeSection delay={120}>
        <div style={{
          fontFamily: "'Onest', sans-serif", fontSize: 10.5, fontWeight: 500, letterSpacing: 3,
          textTransform: 'uppercase', color: C.ghost, marginBottom: 26,
        }}>Дуга превращения</div>
      </FadeSection>
      <FadeSection delay={180}>
        <div className="arc-row" style={{
          display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 0,
          position: 'relative', marginBottom: 'clamp(56px,8vw,96px)',
        }}>
          {/* connecting line */}
          <div style={{
            position: 'absolute', top: 5, left: '12.5%', right: '12.5%', height: 1,
            background: `linear-gradient(to right, ${C.stone}, ${C.zoloto})`, opacity: 0.55,
          }} />
          {ARC.map((a, i) => (
            <div key={i} style={{ position: 'relative', paddingTop: 24, paddingRight: 16 }}>
              <div style={{ position: 'absolute', top: 0, left: 0 }}>
                <StarSpark size={i === ARC.length - 1 ? 12 : 9}
                  color={i === ARC.length - 1 ? C.zolotoYar : (i === 0 ? C.stone : C.latun)} />
              </div>
              <div style={{
                fontFamily: "'Prata', serif", fontSize: 'clamp(15px,1.7vw,20px)',
                color: i === ARC.length - 1 ? C.zolotoYar : C.kost, marginBottom: 6, lineHeight: 1.2,
              }}>{a.k}</div>
              <div style={{
                fontFamily: "'Onest', sans-serif", fontSize: 10, letterSpacing: 1.5,
                textTransform: 'uppercase', color: C.ghost,
              }}>{a.s}</div>
            </div>
          ))}
        </div>
      </FadeSection>

      {/* Three movements */}
      <FadeSection delay={120}><MeanderRule style={{ marginBottom: 48 }} opacity={0.35} /></FadeSection>
      <div className="moves-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 1, background: C.frame }}>
        {MOVES.map((m, i) => (
          <FadeSection key={i} delay={140 + i * 120} style={{ background: C.bezdna }}>
            <div style={{ padding: 'clamp(28px,4vw,40px) clamp(20px,3vw,34px)' }}>
              <MovementGlyph kind={m.glyph} size={44} color={m.color} />
              <div style={{ marginTop: 24, display: 'flex', alignItems: 'baseline', gap: 12 }}>
                <span style={{ fontFamily: "'Prata', serif", fontSize: 'clamp(22px,2.6vw,30px)', color: C.kostYar }}>{m.big}</span>
                <span style={{ fontFamily: "'Onest', sans-serif", fontSize: 11, fontWeight: 600, letterSpacing: 3, textTransform: 'uppercase', color: m.color }}>{m.label}</span>
              </div>
              <p style={{ fontFamily: "'Lora', serif", fontSize: 15.5, lineHeight: 1.65, color: C.kostMuted, marginTop: 12 }}>{m.desc}</p>
            </div>
          </FadeSection>
        ))}
      </div>

      <FadeSection delay={200}>
        <p style={{
          fontFamily: "'Lora', serif", fontStyle: 'italic', fontSize: 'clamp(16px,1.7vw,19px)',
          lineHeight: 1.65, color: C.kostDim, maxWidth: '44ch', margin: 'clamp(56px,8vw,90px) auto 0',
          textAlign: 'center',
        }}>
          Идти сразу наверх — духовная ловушка, так люди отлетают и становятся репликаторами эгрегоров.
          <br />Настоящая реализация происходит через углубление и проявление глубины в&nbsp;мир.
        </p>
      </FadeSection>
    </div>
  </section>
);

Object.assign(window, { Header, HeroSection, AboutSection, btnPrimary, btnGhost });
