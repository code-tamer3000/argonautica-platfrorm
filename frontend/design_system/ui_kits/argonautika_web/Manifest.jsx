// Manifest.jsx — Аргонавтика · Полный Манифест (режим книги + оглавление)
// Загружает manifest.md, парсит в главы, рендерит книгой со сворачивающимся оглавлением.

// ─── INLINE MARKDOWN (** bold **, * italic *) → React nodes ───────────────────
const renderInline = (text) => {
  const nodes = [];
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*)/g;
  let last = 0, m, key = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith('**')) {
      nodes.push(<strong key={key++} style={{ color: C.kostYar, fontWeight: 600 }}>{tok.slice(2, -2)}</strong>);
    } else {
      nodes.push(<em key={key++} style={{ fontStyle: 'italic', color: C.kostDim }}>{tok.slice(1, -1)}</em>);
    }
    last = m.index + tok.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
};

// ─── PARSE markdown → blocks ─────────────────────────────────────────────────
const parseManifest = (md) => {
  const lines = md.replace(/\r/g, '').split('\n');
  const blocks = [];
  let sawChapter = false;
  for (let raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('# ') && !line.startsWith('## ')) {
      blocks.push({ type: 'title', text: line.slice(2).trim() }); continue;
    }
    if (line.startsWith('## ')) {
      sawChapter = true;
      const heading = line.slice(3).trim();
      const dot = heading.indexOf('. ');
      let num = '', title = heading;
      if (dot > 0 && dot <= 6) { num = heading.slice(0, dot); title = heading.slice(dot + 2).trim(); }
      blocks.push({ type: 'chapter', num, title }); continue;
    }
    const isBold = /^\*\*[^*].*\*\*$/.test(line) && line.indexOf('**', 2) === line.length - 2;
    if (isBold) {
      const inner = line.slice(2, -2).trim();
      if (inner.length <= 60 && inner === inner.toUpperCase()) blocks.push({ type: 'subhead', text: inner });
      else blocks.push({ type: 'strong', text: inner });
      continue;
    }
    const isItalic = /^\*[^*].*\*$/.test(line) && !line.startsWith('**');
    if (isItalic && line.length <= 40) {
      blocks.push({ type: sawChapter ? 'emph' : 'subtitle', text: line.slice(1, -1).trim() }); continue;
    }
    blocks.push({ type: sawChapter ? 'para' : 'preamble', text: line });
  }
  return blocks;
};

// ─── BLOCK RENDERERS (left-aligned book) ─────────────────────────────────────
const measure = '60ch';

const ChapterHead = ({ num, title }) => (
  <FadeSection>
    <div style={{ maxWidth: measure, marginBottom: 'clamp(28px,4vw,44px)' }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        fontFamily: "'Onest', sans-serif", fontSize: 10.5, fontWeight: 600, letterSpacing: 3.5,
        textTransform: 'uppercase', color: C.latun, marginBottom: 20,
      }}>
        <StarSpark size={9} color={C.zoloto} />
        <span>Глава {num}</span>
        <span style={{ flex: 1, maxWidth: 60, height: 1, background: C.latun, opacity: 0.4 }} />
      </div>
      <h2 style={{
        fontFamily: "'Prata', serif", fontWeight: 400,
        fontSize: 'clamp(30px,4.4vw,58px)', lineHeight: 1.08, color: C.kostYar,
        letterSpacing: '-0.015em', margin: '0 0 26px',
      }}>{title}</h2>
      <Hairline strength="soft" style={{ maxWidth: 120 }} />
    </div>
  </FadeSection>
);

const Para = ({ children }) => (
  <p style={{
    fontFamily: "'Lora', serif", fontSize: 'clamp(17px,1.55vw,19px)', lineHeight: 1.92,
    color: C.kostDim, maxWidth: measure, margin: '0 0 26px', textWrap: 'pretty',
  }}>{children}</p>
);

const StrongStatement = ({ children }) => (
  <FadeSection>
    <div style={{ display: 'flex', gap: 16, maxWidth: '52ch', margin: 'clamp(30px,4vw,44px) 0' }}>
      <StarSpark size={13} color={C.zoloto} style={{ marginTop: 14, flexShrink: 0 }} />
      <p style={{
        fontFamily: "'Prata', serif", fontWeight: 400,
        fontSize: 'clamp(21px,2.4vw,30px)', lineHeight: 1.36, color: C.kostYar, margin: 0,
        letterSpacing: '-0.005em',
      }}>{children}</p>
    </div>
  </FadeSection>
);

const SubHead = ({ children }) => (
  <div style={{
    fontFamily: "'Onest', sans-serif", fontSize: 13, fontWeight: 600, letterSpacing: 3,
    textTransform: 'uppercase', color: C.zolotoYar, maxWidth: measure,
    margin: 'clamp(28px,4vw,40px) 0 22px',
    display: 'flex', alignItems: 'center', gap: 12,
  }}>
    <StarSpark size={9} color={C.zoloto} />{children}
  </div>
);

const EmphLine = ({ children }) => (
  <p style={{
    fontFamily: "'Lora', serif", fontStyle: 'italic', fontSize: 'clamp(16px,1.6vw,19px)',
    lineHeight: 1.7, color: C.kostMuted, maxWidth: measure, margin: '0 0 26px',
  }}>{children}</p>
);

let _pk = 0;
const renderBody = (b) => {
  switch (b.type) {
    case 'para':    return <Para key={_pk++}>{renderInline(b.text)}</Para>;
    case 'strong':  return <StrongStatement key={_pk++}>{renderInline(b.text)}</StrongStatement>;
    case 'subhead': return <SubHead key={_pk++}>{b.text}</SubHead>;
    case 'emph':    return <EmphLine key={_pk++}>{renderInline(b.text)}</EmphLine>;
    default:        return null;
  }
};

// ─── TABLE OF CONTENTS (collapsible, index-style) ────────────────────────────
const TableOfContents = ({ entries, active, onJump, open, setOpen }) => (
  <nav className="toc">
    <button onClick={() => setOpen(o => !o)} className="toc-toggle" style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%',
      background: 'none', border: 'none', cursor: 'pointer', padding: '0 0 16px',
      borderBottom: '1px solid rgba(194,154,72,0.2)', marginBottom: open ? 14 : 0,
    }}>
      <span style={{
        fontFamily: "'Onest', sans-serif", fontSize: 10.5, fontWeight: 600, letterSpacing: 3,
        textTransform: 'uppercase', color: C.kostMuted, display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <StarSpark size={9} color={C.zoloto} />Оглавление
      </span>
      <span style={{
        color: C.latun, fontSize: 11, transition: 'transform .3s ease',
        transform: open ? 'rotate(0deg)' : 'rotate(-90deg)', display: 'inline-block',
      }}>▾</span>
    </button>

    <div className="toc-list" style={{
      maxHeight: open ? '70vh' : 0, overflowY: open ? 'auto' : 'hidden',
      opacity: open ? 1 : 0, transition: 'max-height .42s cubic-bezier(.4,0,.2,1), opacity .3s ease',
      paddingRight: 4,
    }}>
      {entries.map((e, i) => (
        <button key={i} onClick={() => onJump(i)} style={{
          display: 'flex', alignItems: 'baseline', gap: 11, width: '100%', textAlign: 'left',
          background: active === i ? 'rgba(194,154,72,0.06)' : 'none', border: 'none', cursor: 'pointer',
          padding: '11px 8px 11px 0',
          borderBottom: `1px solid rgba(194,154,72,${active === i ? 0.4 : 0.08})`,
          borderLeft: `2px solid ${active === i ? C.zoloto : 'transparent'}`,
          paddingLeft: 10, marginLeft: -10,
          transition: 'border-color .22s ease, background .22s ease',
        }}>
          <span style={{
            fontFamily: "'Onest', sans-serif", fontSize: 10, fontWeight: 600, letterSpacing: 0.5,
            color: active === i ? C.zolotoYar : C.stone, width: 34, flexShrink: 0,
          }}>{e.num}</span>
          <span style={{
            fontFamily: "'Prata', serif", fontSize: 13, lineHeight: 1.3,
            color: active === i ? C.kostYar : C.kostMuted, transition: 'color .22s ease',
          }}>{e.title}</span>
        </button>
      ))}
    </div>
  </nav>
);

// ─── BOOK + LAYOUT ───────────────────────────────────────────────────────────
const ManifestBook = () => {
  const [blocks, setBlocks] = useState(null);
  const [error, setError] = useState(false);
  const [active, setActive] = useState(0);
  const [tocOpen, setTocOpen] = useState(true);

  useEffect(() => {
    let alive = true;
    fetch('../../uploads/manifest.md')
      .then(r => { if (!r.ok) throw new Error('404'); return r.text(); })
      .then(t => { if (alive) setBlocks(parseManifest(t)); })
      .catch(() => { if (alive) setError(true); });
    return () => { alive = false; };
  }, []);

  // group into chapters (needed before effects below)
  const firstCh = blocks ? blocks.findIndex(b => b.type === 'chapter') : -1;
  const head = blocks ? (firstCh === -1 ? blocks : blocks.slice(0, firstCh)) : [];
  const rest = blocks ? (firstCh === -1 ? [] : blocks.slice(firstCh)) : [];
  const chapters = [];
  { let cur = null;
    for (const b of rest) {
      if (b.type === 'chapter') { cur = { head: b, body: [] }; chapters.push(cur); }
      else if (cur) cur.body.push(b);
    } }

  // Unified TOC entries: Ядро (preamble) + chapters
  const hasPreamble = head.some(b => b.type === 'preamble');
  const entries = [];
  if (hasPreamble) entries.push({ num: '·', title: 'Ядро', sec: 'sec-pre' });
  chapters.forEach((ch, i) => entries.push({ num: ch.head.num, title: ch.head.title, sec: 'ch-' + i }));

  // active-section tracking on scroll
  useEffect(() => {
    if (!entries.length) return;
    const marker = 160;
    const handler = () => {
      let idx = 0;
      for (let i = 0; i < entries.length; i++) {
        const el = document.getElementById(entries[i].sec);
        if (el && el.getBoundingClientRect().top <= marker) idx = i;
      }
      setActive(idx);
    };
    window.addEventListener('scroll', handler, { passive: true });
    handler();
    return () => window.removeEventListener('scroll', handler);
  }, [entries.length]);

  const jump = (i) => {
    const el = document.getElementById(entries[i].sec);
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY - 80;
    window.scrollTo({ top, behavior: 'smooth' });
    if (window.innerWidth <= 880) setTocOpen(false);
  };

  if (error) return (
    <div style={{ textAlign: 'center', padding: '160px 24px', color: C.kostMuted, fontFamily: "'Lora', serif" }}>
      Не удалось загрузить текст Манифеста.
    </div>
  );
  if (!blocks) return (
    <div style={{
      textAlign: 'center', padding: '180px 24px', color: C.ghost,
      fontFamily: "'Onest', sans-serif", fontSize: 11, letterSpacing: 3, textTransform: 'uppercase',
    }}>
      <StarSpark size={16} color={C.zoloto} style={{ marginBottom: 18 }} /><br />Разворачиваем свиток…
    </div>
  );

  _pk = 0;
  return (
    <article>
      {/* ─── Title page ─── */}
      <section style={{
        minHeight: '76vh', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', textAlign: 'center',
        padding: 'clamp(120px,16vh,200px) clamp(22px,6vw,80px) clamp(72px,9vw,110px)',
      }}>
        <FadeSection delay={80}>
          <StarSpark size={26} color={C.zolotoYar} style={{ marginBottom: 34 }} />
          <div style={{
            fontFamily: "'Onest', sans-serif", fontSize: 12, fontWeight: 500, letterSpacing: 5,
            textTransform: 'uppercase', color: C.latun, marginBottom: 26,
          }}>Аргонавтика</div>
          <h1 style={{
            fontFamily: "'Prata', serif", fontWeight: 400,
            fontSize: 'clamp(52px,9vw,108px)', lineHeight: 1, color: C.kostYar,
            letterSpacing: '-0.02em', margin: '0 0 30px',
          }}>Манифест</h1>
          {head.filter(b => b.type === 'subtitle').map((b, i) => (
            <div key={i} style={{
              fontFamily: "'Lora', serif", fontStyle: 'italic', fontSize: 'clamp(17px,2vw,21px)', color: C.kostMuted,
            }}>{b.text}</div>
          ))}
        </FadeSection>
        <FadeSection delay={260} style={{ marginTop: 56, width: '100%', maxWidth: 360 }}>
          <MeanderRule opacity={0.5} />
        </FadeSection>
      </section>

      {/* ─── Layout: sticky TOC + reading column (preamble + chapters) ─── */}
      <div className="manifest-layout">
        <aside className="toc-rail">
          <TableOfContents entries={entries} active={active} onJump={jump} open={tocOpen} setOpen={setTocOpen} />
        </aside>

        <div className="chapters-col">
          {/* Preamble — Ядро */}
          {hasPreamble && (
            <section id="sec-pre" style={{ padding: 'clamp(20px,3vw,40px) 0 clamp(56px,7vw,90px)' }}>
              <FadeSection>
                <div style={{ maxWidth: measure, marginBottom: 'clamp(28px,4vw,44px)' }}>
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    fontFamily: "'Onest', sans-serif", fontSize: 10.5, fontWeight: 600, letterSpacing: 3.5,
                    textTransform: 'uppercase', color: C.latun, marginBottom: 20,
                  }}>
                    <StarSpark size={9} color={C.zoloto} /><span>Ядро</span>
                    <span style={{ flex: 1, maxWidth: 60, height: 1, background: C.latun, opacity: 0.4 }} />
                  </div>
                  <Hairline strength="soft" style={{ maxWidth: 120 }} />
                </div>
              </FadeSection>
              <FadeSection delay={60}>
                <div>
                  {head.filter(b => b.type === 'preamble').map((b, i) => (
                    <p key={i} style={{
                      fontFamily: "'Lora', serif", fontSize: 'clamp(17px,1.6vw,19.5px)', lineHeight: 1.95,
                      color: i === 0 ? C.kostYar : C.kostDim, maxWidth: measure, margin: '0 0 26px', textWrap: 'pretty',
                    }}>{renderInline(b.text)}</p>
                  ))}
                </div>
              </FadeSection>
              <div style={{ marginTop: 'clamp(40px,6vw,68px)' }}>
                <StarSpark size={11} color={C.stone} />
              </div>
            </section>
          )}

          {chapters.map((ch, i) => (
            <section key={i} id={'ch-' + i} style={{
              padding: 'clamp(56px,7vw,90px) 0',
              borderTop: '1px solid rgba(194,154,72,0.1)',
            }}>
              <ChapterHead num={ch.head.num} title={ch.head.title} />
              <FadeSection delay={60}><div>{ch.body.map(renderBody)}</div></FadeSection>
              <div style={{ marginTop: 'clamp(40px,6vw,68px)' }}>
                <StarSpark size={11} color={C.stone} />
              </div>
            </section>
          ))}
        </div>
      </div>

      {/* ─── CTA ─── */}
      <section style={{
        textAlign: 'center', padding: 'clamp(90px,12vw,150px) clamp(22px,6vw,80px)',
        borderTop: '1px solid rgba(194,154,72,0.16)', background: C.tishina, position: 'relative', overflow: 'hidden',
      }}>
        <div style={{
          position: 'absolute', top: '-10%', left: '50%', transform: 'translateX(-50%)',
          width: 'min(800px,90vw)', height: 480, zIndex: 0,
          background: 'radial-gradient(ellipse at center, rgba(194,154,72,0.09), transparent 65%)',
        }} />
        <div style={{ position: 'relative', zIndex: 1 }}>
          <FadeSection>
            <MeanderRule strength="strong" opacity={0.55} style={{ maxWidth: 320, margin: '0 auto 40px' }} />
            <p style={{
              fontFamily: "'Lora', serif", fontStyle: 'italic', fontSize: 'clamp(18px,2.2vw,24px)',
              lineHeight: 1.55, color: C.kostDim, maxWidth: '30ch', margin: '0 auto 38px',
            }}>Если внутри зашевелился ледяной огонь — ты готов идти дальше.</p>
            <a href="index.html#expedition" style={{
              display: 'inline-block', fontFamily: "'Onest', sans-serif", fontSize: 13, fontWeight: 600,
              letterSpacing: 1.5, textTransform: 'uppercase', padding: '16px 36px', borderRadius: 6,
              background: C.zoloto, color: '#0B0E0C', textDecoration: 'none', transition: 'background 220ms ease',
            }}
              onMouseEnter={e => e.currentTarget.style.background = C.zolotoYar}
              onMouseLeave={e => e.currentTarget.style.background = C.zoloto}
            >Записаться на борт</a>
          </FadeSection>
        </div>
      </section>
    </article>
  );
};

// ─── PAGE HEADER (star + Назад) ──────────────────────────────────────────────
const ManifestHeader = () => {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const h = () => setScrolled(window.scrollY > 40);
    window.addEventListener('scroll', h, { passive: true });
    return () => window.removeEventListener('scroll', h);
  }, []);
  return (
    <header style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 100, height: 60,
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '0 clamp(20px,4vw,44px)',
      background: scrolled ? 'rgba(7,11,9,0.88)' : 'transparent',
      backdropFilter: scrolled ? 'blur(14px) saturate(1.1)' : 'none',
      WebkitBackdropFilter: scrolled ? 'blur(14px) saturate(1.1)' : 'none',
      borderBottom: `1px solid ${scrolled ? 'rgba(194,154,72,0.14)' : 'transparent'}`,
      transition: 'background .5s ease, border-color .5s ease, backdrop-filter .5s ease',
    }}>
      <a href="index.html" style={{
        display: 'flex', alignItems: 'center', gap: 11, textDecoration: 'none',
        fontFamily: "'Onest', sans-serif", fontSize: 11.5, fontWeight: 500, letterSpacing: 2,
        textTransform: 'uppercase', color: C.kostMuted, transition: 'color 200ms ease',
      }}
        onMouseEnter={e => e.currentTarget.style.color = C.kostYar}
        onMouseLeave={e => e.currentTarget.style.color = C.kostMuted}
      ><span style={{ fontSize: 16, lineHeight: 1 }}>←</span>Назад</a>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <StarSpark size={12} color={C.zolotoYar} />
        <span style={{
          fontFamily: "'Prata', serif", fontSize: 11.5, letterSpacing: 3, textTransform: 'uppercase', color: C.kostDim,
        }}>Манифест</span>
      </div>
    </header>
  );
};

const ManifestPage = () => (
  <div style={{ background: C.bezdna, minHeight: '100vh' }}>
    <ManifestHeader />
    <main><ManifestBook /></main>
  </div>
);

ReactDOM.createRoot(document.getElementById('root')).render(<ManifestPage />);
