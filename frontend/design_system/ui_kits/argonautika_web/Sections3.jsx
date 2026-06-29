// Sections3.jsx — Аргонавтика · Экспедиция (заявка, регистр A) · Footer

// ─── ЭКСПЕДИЦИЯ — ЗАЯВКА (Register A · gold on black) ─────────────────────────
const ExpeditionSection = () => {
  const [val, setVal] = useState('');
  const [sent, setSent] = useState(false);
  const [glowRef, glowOffset] = useParallax(0.08);

  const submit = () => { if (val.trim()) setSent(true); };

  return (
    <section id="expedition" data-screen-label="Экспедиция" style={{
      background: C.tishina, position: 'relative', overflow: 'hidden',
      padding: 'clamp(88px,12vw,160px) clamp(22px,6vw,80px)',
      borderTop: '1px solid rgba(194,154,72,0.16)',
    }}>
      {/* ambient gold light */}
      <div style={{
        position: 'absolute', top: '-10%', left: '50%', transform: 'translateX(-50%)',
        width: 'min(900px, 90vw)', height: 600, zIndex: 0,
        background: 'radial-gradient(ellipse at center, rgba(194,154,72,0.10), transparent 65%)',
      }} />

      <div style={{ position: 'relative', zIndex: 1, maxWidth: 720, margin: '0 auto', textAlign: 'center' }}>
        <FadeSection><MeanderRule strength="strong" opacity={0.55} style={{ marginBottom: 44 }} /></FadeSection>

        <FadeSection delay={80}>
          <SecLabel num="04" text="Экспедиция" color={C.latun} accent={C.zoloto} style={{ justifyContent: 'center' }} />
        </FadeSection>

        {/* Ceremonial Argo ship */}
        <FadeSection delay={140} y={22}>
          <figure ref={glowRef} style={{
            margin: '0 auto 40px', width: 'clamp(260px,40vw,420px)',
            transform: `translateY(${glowOffset}px)`,
            filter: 'drop-shadow(0 0 70px rgba(194,154,72,0.22))',
          }}>
            <img src={MEDIA.argoBoat} alt="Арго — корабль"
              style={{ width: '100%', display: 'block', aspectRatio: '3 / 2', objectFit: 'contain' }} />
          </figure>
        </FadeSection>

        <FadeSection delay={220}>
          <h2 style={{
            fontFamily: "'Prata', serif", fontWeight: 400,
            fontSize: 'clamp(30px,4.6vw,56px)', lineHeight: 1.1, color: C.kostYar,
            letterSpacing: '-0.01em', margin: '0 auto 30px', maxWidth: '14ch',
          }}>
            Экспедиция посылания <span style={{ color: C.zolotoYar }}>на&nbsp;хер</span>.
          </h2>
        </FadeSection>

        <FadeSection delay={300}>
          <p style={{
            fontFamily: "'Lora', serif", fontSize: 'clamp(16px,1.9vw,19px)', lineHeight: 1.78,
            color: C.kostDim, margin: '0 auto 18px', maxWidth: '50ch',
          }}>
            Герой встречает чудище и посылает его нахер.
          </p>
          <p style={{
            fontFamily: "'Lora', serif", fontStyle: 'italic', fontSize: 17, lineHeight: 1.7,
            color: C.kostMuted, margin: '0 auto 48px', maxWidth: '40ch',
          }}>
            Оставь заявку — кто ты и в какой точке находишься; мы свяжемся с тобой и сообщим как попасть на борт.
          </p>
        </FadeSection>

        <FadeSection delay={380}>
          {sent ? (
            <div style={{
              maxWidth: 480, margin: '0 auto', padding: '40px 32px', borderRadius: 8,
              border: '1px solid rgba(194,154,72,0.4)',
              background: 'linear-gradient(160deg, rgba(194,154,72,0.08), rgba(194,154,72,0.01))',
              boxShadow: 'inset 0 0 50px rgba(194,154,72,0.08)',
            }}>
              <StarSpark size={20} color={C.zolotoYar} style={{ marginBottom: 18 }} />
              <div style={{ fontFamily: "'Prata', serif", fontSize: 22, color: C.kostYar, marginBottom: 10 }}>Заявка принята.</div>
              <div style={{ fontFamily: "'Lora', serif", fontStyle: 'italic', fontSize: 15.5, color: C.kostMuted, lineHeight: 1.6 }}>
                Свяжемся, когда Экспедиция откроется. Ты — среди Первых.
              </div>
            </div>
          ) : (
            <div style={{ maxWidth: 480, margin: '0 auto' }}>
              <div className="exp-form" style={{ display: 'flex', gap: 0 }}>
                <input type="text" value={val} onChange={e => setVal(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') submit(); }}
                  placeholder="e-mail / telegram"
                  style={{
                    flex: 1, fontFamily: "'Onest', sans-serif", fontSize: 14, color: C.kostYar,
                    background: 'rgba(255,255,255,0.02)', border: `1px solid ${C.frameDeep}`, borderRight: 'none',
                    borderRadius: '6px 0 0 6px', padding: '15px 18px', outline: 'none', caretColor: C.zoloto,
                  }}
                  onFocus={e => e.currentTarget.style.borderColor = 'rgba(194,154,72,0.55)'}
                  onBlur={e => e.currentTarget.style.borderColor = C.frameDeep}
                />
                <button onClick={submit} style={{
                  fontFamily: "'Onest', sans-serif", fontSize: 12.5, fontWeight: 600, letterSpacing: 1,
                  textTransform: 'uppercase', padding: '15px 26px', background: C.zoloto, color: '#0B0E0C',
                  border: 'none', borderRadius: '0 6px 6px 0', cursor: 'pointer', whiteSpace: 'nowrap',
                  transition: 'background 220ms ease',
                }}
                  onMouseEnter={e => e.currentTarget.style.background = C.zolotoYar}
                  onMouseLeave={e => e.currentTarget.style.background = C.zoloto}
                >Встать в строй первых</button>
              </div>
              <div style={{
                fontFamily: "'Onest', sans-serif", fontSize: 10.5, letterSpacing: 1, color: C.stone,
                marginTop: 14,
              }}>Заявка = предварительный отбор. Не гарантирует участия.</div>
            </div>
          )}
        </FadeSection>
      </div>
    </section>
  );
};

// ─── FOOTER (Register A crest) ───────────────────────────────────────────────
const Footer = () => (
  <footer style={{
    background: C.tishina, borderTop: '1px solid rgba(194,154,72,0.16)',
    padding: 'clamp(44px,6vw,64px) clamp(22px,6vw,80px) 40px',
  }}>
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      <MeanderRule opacity={0.3} style={{ marginBottom: 40 }} />
      <div className="footer-row" style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 28, flexWrap: 'wrap',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 13 }}>
          <img src={MEDIA.monogram} alt="Аргонавтика"
            style={{ height: 30, width: 'auto', filter: 'invert(1)', opacity: 0.7 }} />
          <WordMark size={12} color={C.kostMuted} gap={7} withStar={false} />
        </div>
        <div style={{ display: 'flex', gap: 'clamp(20px,4vw,40px)', flexWrap: 'wrap', alignItems: 'center' }}>
          <a href="https://t.me/argonautica_systems" target="_blank" rel="noopener" style={{
            fontFamily: "'Onest', sans-serif", fontSize: 11.5, letterSpacing: 1, color: C.kostMuted,
            textDecoration: 'none', transition: 'color 200ms ease',
          }}
            onMouseEnter={e => e.currentTarget.style.color = C.zolotoYar}
            onMouseLeave={e => e.currentTarget.style.color = C.kostMuted}
          >t.me/argonautica_systems</a>
          <span style={{ fontFamily: "'Onest', sans-serif", fontSize: 11.5, letterSpacing: 1, color: C.ghost }}>Аргат</span>
        </div>
      </div>
      <div style={{
        marginTop: 30, fontFamily: "'Onest', sans-serif", fontSize: 10, letterSpacing: 1.5,
        textTransform: 'uppercase', color: C.stone,
      }}>MMXXVI · СИСТЕМА ПРОЯВЛЕНИЯ ДЛЯ ЛЮДЕЙ С МИССИЕЙ</div>
    </div>
  </footer>
);

Object.assign(window, { ExpeditionSection, Footer });
