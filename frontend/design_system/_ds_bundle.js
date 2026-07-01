/* @ds-bundle: {"format":3,"namespace":"DesignSystem_d3a524","components":[],"sourceHashes":{"ui_kits/argonautika_web/App.jsx":"ebb477270946","ui_kits/argonautika_web/Manifest.jsx":"07e71458e88c","ui_kits/argonautika_web/Sections.jsx":"bca5cc94a2a2","ui_kits/argonautika_web/Sections2.jsx":"5f9da94c308b","ui_kits/argonautika_web/Sections3.jsx":"553b8ba8d6c6","ui_kits/argonautika_web/Shared.jsx":"5d70a90a2190"},"inlinedExternals":[],"unexposedExports":[]} */

(() => {

const __ds_ns = (window.DesignSystem_d3a524 = window.DesignSystem_d3a524 || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// ui_kits/argonautika_web/App.jsx
try { (() => {
// App.jsx — Аргонавтика · сайт-манифест (единый кинематографичный скролл)

const App = () => {
  const [activeSection, setActiveSection] = useState('hero');
  useEffect(() => {
    const sections = ['hero', 'about', 'manifesto', 'karta', 'expedition'];
    const observers = sections.map(id => {
      const el = document.getElementById(id);
      if (!el) return null;
      const obs = new IntersectionObserver(([entry]) => {
        if (entry.isIntersecting) setActiveSection(id);
      }, {
        threshold: 0.001,
        rootMargin: '-45% 0px -45% 0px'
      });
      obs.observe(el);
      return obs;
    }).filter(Boolean);
    return () => observers.forEach(o => o.disconnect());
  }, []);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      background: C.bezdna,
      minHeight: '100vh'
    }
  }, /*#__PURE__*/React.createElement(Header, {
    activeSection: activeSection
  }), /*#__PURE__*/React.createElement("main", null, /*#__PURE__*/React.createElement(HeroSection, null), /*#__PURE__*/React.createElement(AboutSection, null), /*#__PURE__*/React.createElement(ManifestoSection, null), /*#__PURE__*/React.createElement(KartaSection, null), /*#__PURE__*/React.createElement(ExpeditionSection, null)), /*#__PURE__*/React.createElement(Footer, null));
};
ReactDOM.createRoot(document.getElementById('root')).render(/*#__PURE__*/React.createElement(App, null));
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/argonautika_web/App.jsx", error: String((e && e.message) || e) }); }

// ui_kits/argonautika_web/Manifest.jsx
try { (() => {
// Manifest.jsx — Аргонавтика · Полный Манифест (режим книги + оглавление)
// Загружает manifest.md, парсит в главы, рендерит книгой со сворачивающимся оглавлением.

// ─── INLINE MARKDOWN (** bold **, * italic *) → React nodes ───────────────────
const renderInline = text => {
  const nodes = [];
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*)/g;
  let last = 0,
    m,
    key = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith('**')) {
      nodes.push(/*#__PURE__*/React.createElement("strong", {
        key: key++,
        style: {
          color: C.kostYar,
          fontWeight: 600
        }
      }, tok.slice(2, -2)));
    } else {
      nodes.push(/*#__PURE__*/React.createElement("em", {
        key: key++,
        style: {
          fontStyle: 'italic',
          color: C.kostDim
        }
      }, tok.slice(1, -1)));
    }
    last = m.index + tok.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
};

// ─── PARSE markdown → blocks ─────────────────────────────────────────────────
const parseManifest = md => {
  const lines = md.replace(/\r/g, '').split('\n');
  const blocks = [];
  let sawChapter = false;
  for (let raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('# ') && !line.startsWith('## ')) {
      blocks.push({
        type: 'title',
        text: line.slice(2).trim()
      });
      continue;
    }
    if (line.startsWith('## ')) {
      sawChapter = true;
      const heading = line.slice(3).trim();
      const dot = heading.indexOf('. ');
      let num = '',
        title = heading;
      if (dot > 0 && dot <= 6) {
        num = heading.slice(0, dot);
        title = heading.slice(dot + 2).trim();
      }
      blocks.push({
        type: 'chapter',
        num,
        title
      });
      continue;
    }
    const isBold = /^\*\*[^*].*\*\*$/.test(line) && line.indexOf('**', 2) === line.length - 2;
    if (isBold) {
      const inner = line.slice(2, -2).trim();
      if (inner.length <= 60 && inner === inner.toUpperCase()) blocks.push({
        type: 'subhead',
        text: inner
      });else blocks.push({
        type: 'strong',
        text: inner
      });
      continue;
    }
    const isItalic = /^\*[^*].*\*$/.test(line) && !line.startsWith('**');
    if (isItalic && line.length <= 40) {
      blocks.push({
        type: sawChapter ? 'emph' : 'subtitle',
        text: line.slice(1, -1).trim()
      });
      continue;
    }
    blocks.push({
      type: sawChapter ? 'para' : 'preamble',
      text: line
    });
  }
  return blocks;
};

// ─── BLOCK RENDERERS (left-aligned book) ─────────────────────────────────────
const measure = '60ch';
const ChapterHead = ({
  num,
  title
}) => /*#__PURE__*/React.createElement(FadeSection, null, /*#__PURE__*/React.createElement("div", {
  style: {
    maxWidth: measure,
    marginBottom: 'clamp(28px,4vw,44px)'
  }
}, /*#__PURE__*/React.createElement("div", {
  style: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    fontFamily: "'Onest', sans-serif",
    fontSize: 10.5,
    fontWeight: 600,
    letterSpacing: 3.5,
    textTransform: 'uppercase',
    color: C.latun,
    marginBottom: 20
  }
}, /*#__PURE__*/React.createElement(StarSpark, {
  size: 9,
  color: C.zoloto
}), /*#__PURE__*/React.createElement("span", null, "\u0413\u043B\u0430\u0432\u0430 ", num), /*#__PURE__*/React.createElement("span", {
  style: {
    flex: 1,
    maxWidth: 60,
    height: 1,
    background: C.latun,
    opacity: 0.4
  }
})), /*#__PURE__*/React.createElement("h2", {
  style: {
    fontFamily: "'Prata', serif",
    fontWeight: 400,
    fontSize: 'clamp(30px,4.4vw,58px)',
    lineHeight: 1.08,
    color: C.kostYar,
    letterSpacing: '-0.015em',
    margin: '0 0 26px'
  }
}, title), /*#__PURE__*/React.createElement(Hairline, {
  strength: "soft",
  style: {
    maxWidth: 120
  }
})));
const Para = ({
  children
}) => /*#__PURE__*/React.createElement("p", {
  style: {
    fontFamily: "'Lora', serif",
    fontSize: 'clamp(17px,1.55vw,19px)',
    lineHeight: 1.92,
    color: C.kostDim,
    maxWidth: measure,
    margin: '0 0 26px',
    textWrap: 'pretty'
  }
}, children);
const StrongStatement = ({
  children
}) => /*#__PURE__*/React.createElement(FadeSection, null, /*#__PURE__*/React.createElement("div", {
  style: {
    display: 'flex',
    gap: 16,
    maxWidth: '52ch',
    margin: 'clamp(30px,4vw,44px) 0'
  }
}, /*#__PURE__*/React.createElement(StarSpark, {
  size: 13,
  color: C.zoloto,
  style: {
    marginTop: 14,
    flexShrink: 0
  }
}), /*#__PURE__*/React.createElement("p", {
  style: {
    fontFamily: "'Prata', serif",
    fontWeight: 400,
    fontSize: 'clamp(21px,2.4vw,30px)',
    lineHeight: 1.36,
    color: C.kostYar,
    margin: 0,
    letterSpacing: '-0.005em'
  }
}, children)));
const SubHead = ({
  children
}) => /*#__PURE__*/React.createElement("div", {
  style: {
    fontFamily: "'Onest', sans-serif",
    fontSize: 13,
    fontWeight: 600,
    letterSpacing: 3,
    textTransform: 'uppercase',
    color: C.zolotoYar,
    maxWidth: measure,
    margin: 'clamp(28px,4vw,40px) 0 22px',
    display: 'flex',
    alignItems: 'center',
    gap: 12
  }
}, /*#__PURE__*/React.createElement(StarSpark, {
  size: 9,
  color: C.zoloto
}), children);
const EmphLine = ({
  children
}) => /*#__PURE__*/React.createElement("p", {
  style: {
    fontFamily: "'Lora', serif",
    fontStyle: 'italic',
    fontSize: 'clamp(16px,1.6vw,19px)',
    lineHeight: 1.7,
    color: C.kostMuted,
    maxWidth: measure,
    margin: '0 0 26px'
  }
}, children);
let _pk = 0;
const renderBody = b => {
  switch (b.type) {
    case 'para':
      return /*#__PURE__*/React.createElement(Para, {
        key: _pk++
      }, renderInline(b.text));
    case 'strong':
      return /*#__PURE__*/React.createElement(StrongStatement, {
        key: _pk++
      }, renderInline(b.text));
    case 'subhead':
      return /*#__PURE__*/React.createElement(SubHead, {
        key: _pk++
      }, b.text);
    case 'emph':
      return /*#__PURE__*/React.createElement(EmphLine, {
        key: _pk++
      }, renderInline(b.text));
    default:
      return null;
  }
};

// ─── TABLE OF CONTENTS (collapsible, index-style) ────────────────────────────
const TableOfContents = ({
  entries,
  active,
  onJump,
  open,
  setOpen
}) => /*#__PURE__*/React.createElement("nav", {
  className: "toc"
}, /*#__PURE__*/React.createElement("button", {
  onClick: () => setOpen(o => !o),
  className: "toc-toggle",
  style: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: '0 0 16px',
    borderBottom: '1px solid rgba(194,154,72,0.2)',
    marginBottom: open ? 14 : 0
  }
}, /*#__PURE__*/React.createElement("span", {
  style: {
    fontFamily: "'Onest', sans-serif",
    fontSize: 10.5,
    fontWeight: 600,
    letterSpacing: 3,
    textTransform: 'uppercase',
    color: C.kostMuted,
    display: 'flex',
    alignItems: 'center',
    gap: 10
  }
}, /*#__PURE__*/React.createElement(StarSpark, {
  size: 9,
  color: C.zoloto
}), "\u041E\u0433\u043B\u0430\u0432\u043B\u0435\u043D\u0438\u0435"), /*#__PURE__*/React.createElement("span", {
  style: {
    color: C.latun,
    fontSize: 11,
    transition: 'transform .3s ease',
    transform: open ? 'rotate(0deg)' : 'rotate(-90deg)',
    display: 'inline-block'
  }
}, "\u25BE")), /*#__PURE__*/React.createElement("div", {
  className: "toc-list",
  style: {
    maxHeight: open ? '70vh' : 0,
    overflowY: open ? 'auto' : 'hidden',
    opacity: open ? 1 : 0,
    transition: 'max-height .42s cubic-bezier(.4,0,.2,1), opacity .3s ease',
    paddingRight: 4
  }
}, entries.map((e, i) => /*#__PURE__*/React.createElement("button", {
  key: i,
  onClick: () => onJump(i),
  style: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 11,
    width: '100%',
    textAlign: 'left',
    background: active === i ? 'rgba(194,154,72,0.06)' : 'none',
    border: 'none',
    cursor: 'pointer',
    padding: '11px 8px 11px 0',
    borderBottom: `1px solid rgba(194,154,72,${active === i ? 0.4 : 0.08})`,
    borderLeft: `2px solid ${active === i ? C.zoloto : 'transparent'}`,
    paddingLeft: 10,
    marginLeft: -10,
    transition: 'border-color .22s ease, background .22s ease'
  }
}, /*#__PURE__*/React.createElement("span", {
  style: {
    fontFamily: "'Onest', sans-serif",
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: 0.5,
    color: active === i ? C.zolotoYar : C.stone,
    width: 34,
    flexShrink: 0
  }
}, e.num), /*#__PURE__*/React.createElement("span", {
  style: {
    fontFamily: "'Prata', serif",
    fontSize: 13,
    lineHeight: 1.3,
    color: active === i ? C.kostYar : C.kostMuted,
    transition: 'color .22s ease'
  }
}, e.title)))));

// ─── BOOK + LAYOUT ───────────────────────────────────────────────────────────
const ManifestBook = () => {
  const [blocks, setBlocks] = useState(null);
  const [error, setError] = useState(false);
  const [active, setActive] = useState(0);
  const [tocOpen, setTocOpen] = useState(true);
  useEffect(() => {
    let alive = true;
    fetch('../../uploads/manifest.md').then(r => {
      if (!r.ok) throw new Error('404');
      return r.text();
    }).then(t => {
      if (alive) setBlocks(parseManifest(t));
    }).catch(() => {
      if (alive) setError(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  // group into chapters (needed before effects below)
  const firstCh = blocks ? blocks.findIndex(b => b.type === 'chapter') : -1;
  const head = blocks ? firstCh === -1 ? blocks : blocks.slice(0, firstCh) : [];
  const rest = blocks ? firstCh === -1 ? [] : blocks.slice(firstCh) : [];
  const chapters = [];
  {
    let cur = null;
    for (const b of rest) {
      if (b.type === 'chapter') {
        cur = {
          head: b,
          body: []
        };
        chapters.push(cur);
      } else if (cur) cur.body.push(b);
    }
  }

  // Unified TOC entries: Ядро (preamble) + chapters
  const hasPreamble = head.some(b => b.type === 'preamble');
  const entries = [];
  if (hasPreamble) entries.push({
    num: '·',
    title: 'Ядро',
    sec: 'sec-pre'
  });
  chapters.forEach((ch, i) => entries.push({
    num: ch.head.num,
    title: ch.head.title,
    sec: 'ch-' + i
  }));

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
    window.addEventListener('scroll', handler, {
      passive: true
    });
    handler();
    return () => window.removeEventListener('scroll', handler);
  }, [entries.length]);
  const jump = i => {
    const el = document.getElementById(entries[i].sec);
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY - 80;
    window.scrollTo({
      top,
      behavior: 'smooth'
    });
    if (window.innerWidth <= 880) setTocOpen(false);
  };
  if (error) return /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: 'center',
      padding: '160px 24px',
      color: C.kostMuted,
      fontFamily: "'Lora', serif"
    }
  }, "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044C \u0442\u0435\u043A\u0441\u0442 \u041C\u0430\u043D\u0438\u0444\u0435\u0441\u0442\u0430.");
  if (!blocks) return /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: 'center',
      padding: '180px 24px',
      color: C.ghost,
      fontFamily: "'Onest', sans-serif",
      fontSize: 11,
      letterSpacing: 3,
      textTransform: 'uppercase'
    }
  }, /*#__PURE__*/React.createElement(StarSpark, {
    size: 16,
    color: C.zoloto,
    style: {
      marginBottom: 18
    }
  }), /*#__PURE__*/React.createElement("br", null), "\u0420\u0430\u0437\u0432\u043E\u0440\u0430\u0447\u0438\u0432\u0430\u0435\u043C \u0441\u0432\u0438\u0442\u043E\u043A\u2026");
  _pk = 0;
  return /*#__PURE__*/React.createElement("article", null, /*#__PURE__*/React.createElement("section", {
    style: {
      minHeight: '76vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      textAlign: 'center',
      padding: 'clamp(120px,16vh,200px) clamp(22px,6vw,80px) clamp(72px,9vw,110px)'
    }
  }, /*#__PURE__*/React.createElement(FadeSection, {
    delay: 80
  }, /*#__PURE__*/React.createElement(StarSpark, {
    size: 26,
    color: C.zolotoYar,
    style: {
      marginBottom: 34
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "'Onest', sans-serif",
      fontSize: 12,
      fontWeight: 500,
      letterSpacing: 5,
      textTransform: 'uppercase',
      color: C.latun,
      marginBottom: 26
    }
  }, "\u0410\u0440\u0433\u043E\u043D\u0430\u0432\u0442\u0438\u043A\u0430"), /*#__PURE__*/React.createElement("h1", {
    style: {
      fontFamily: "'Prata', serif",
      fontWeight: 400,
      fontSize: 'clamp(52px,9vw,108px)',
      lineHeight: 1,
      color: C.kostYar,
      letterSpacing: '-0.02em',
      margin: '0 0 30px'
    }
  }, "\u041C\u0430\u043D\u0438\u0444\u0435\u0441\u0442"), head.filter(b => b.type === 'subtitle').map((b, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      fontFamily: "'Lora', serif",
      fontStyle: 'italic',
      fontSize: 'clamp(17px,2vw,21px)',
      color: C.kostMuted
    }
  }, b.text))), /*#__PURE__*/React.createElement(FadeSection, {
    delay: 260,
    style: {
      marginTop: 56,
      width: '100%',
      maxWidth: 360
    }
  }, /*#__PURE__*/React.createElement(MeanderRule, {
    opacity: 0.5
  }))), /*#__PURE__*/React.createElement("div", {
    className: "manifest-layout"
  }, /*#__PURE__*/React.createElement("aside", {
    className: "toc-rail"
  }, /*#__PURE__*/React.createElement(TableOfContents, {
    entries: entries,
    active: active,
    onJump: jump,
    open: tocOpen,
    setOpen: setTocOpen
  })), /*#__PURE__*/React.createElement("div", {
    className: "chapters-col"
  }, hasPreamble && /*#__PURE__*/React.createElement("section", {
    id: "sec-pre",
    style: {
      padding: 'clamp(20px,3vw,40px) 0 clamp(56px,7vw,90px)'
    }
  }, /*#__PURE__*/React.createElement(FadeSection, null, /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: measure,
      marginBottom: 'clamp(28px,4vw,44px)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      fontFamily: "'Onest', sans-serif",
      fontSize: 10.5,
      fontWeight: 600,
      letterSpacing: 3.5,
      textTransform: 'uppercase',
      color: C.latun,
      marginBottom: 20
    }
  }, /*#__PURE__*/React.createElement(StarSpark, {
    size: 9,
    color: C.zoloto
  }), /*#__PURE__*/React.createElement("span", null, "\u042F\u0434\u0440\u043E"), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      maxWidth: 60,
      height: 1,
      background: C.latun,
      opacity: 0.4
    }
  })), /*#__PURE__*/React.createElement(Hairline, {
    strength: "soft",
    style: {
      maxWidth: 120
    }
  }))), /*#__PURE__*/React.createElement(FadeSection, {
    delay: 60
  }, /*#__PURE__*/React.createElement("div", null, head.filter(b => b.type === 'preamble').map((b, i) => /*#__PURE__*/React.createElement("p", {
    key: i,
    style: {
      fontFamily: "'Lora', serif",
      fontSize: 'clamp(17px,1.6vw,19.5px)',
      lineHeight: 1.95,
      color: i === 0 ? C.kostYar : C.kostDim,
      maxWidth: measure,
      margin: '0 0 26px',
      textWrap: 'pretty'
    }
  }, renderInline(b.text))))), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 'clamp(40px,6vw,68px)'
    }
  }, /*#__PURE__*/React.createElement(StarSpark, {
    size: 11,
    color: C.stone
  }))), chapters.map((ch, i) => /*#__PURE__*/React.createElement("section", {
    key: i,
    id: 'ch-' + i,
    style: {
      padding: 'clamp(56px,7vw,90px) 0',
      borderTop: '1px solid rgba(194,154,72,0.1)'
    }
  }, /*#__PURE__*/React.createElement(ChapterHead, {
    num: ch.head.num,
    title: ch.head.title
  }), /*#__PURE__*/React.createElement(FadeSection, {
    delay: 60
  }, /*#__PURE__*/React.createElement("div", null, ch.body.map(renderBody))), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 'clamp(40px,6vw,68px)'
    }
  }, /*#__PURE__*/React.createElement(StarSpark, {
    size: 11,
    color: C.stone
  })))))), /*#__PURE__*/React.createElement("section", {
    style: {
      textAlign: 'center',
      padding: 'clamp(90px,12vw,150px) clamp(22px,6vw,80px)',
      borderTop: '1px solid rgba(194,154,72,0.16)',
      background: C.tishina,
      position: 'relative',
      overflow: 'hidden'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      top: '-10%',
      left: '50%',
      transform: 'translateX(-50%)',
      width: 'min(800px,90vw)',
      height: 480,
      zIndex: 0,
      background: 'radial-gradient(ellipse at center, rgba(194,154,72,0.09), transparent 65%)'
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative',
      zIndex: 1
    }
  }, /*#__PURE__*/React.createElement(FadeSection, null, /*#__PURE__*/React.createElement(MeanderRule, {
    strength: "strong",
    opacity: 0.55,
    style: {
      maxWidth: 320,
      margin: '0 auto 40px'
    }
  }), /*#__PURE__*/React.createElement("p", {
    style: {
      fontFamily: "'Lora', serif",
      fontStyle: 'italic',
      fontSize: 'clamp(18px,2.2vw,24px)',
      lineHeight: 1.55,
      color: C.kostDim,
      maxWidth: '30ch',
      margin: '0 auto 38px'
    }
  }, "\u0415\u0441\u043B\u0438 \u0432\u043D\u0443\u0442\u0440\u0438 \u0437\u0430\u0448\u0435\u0432\u0435\u043B\u0438\u043B\u0441\u044F \u043B\u0435\u0434\u044F\u043D\u043E\u0439 \u043E\u0433\u043E\u043D\u044C \u2014 \u0442\u044B \u0433\u043E\u0442\u043E\u0432 \u0438\u0434\u0442\u0438 \u0434\u0430\u043B\u044C\u0448\u0435."), /*#__PURE__*/React.createElement("a", {
    href: "index.html#expedition",
    style: {
      display: 'inline-block',
      fontFamily: "'Onest', sans-serif",
      fontSize: 13,
      fontWeight: 600,
      letterSpacing: 1.5,
      textTransform: 'uppercase',
      padding: '16px 36px',
      borderRadius: 6,
      background: C.zoloto,
      color: '#0B0E0C',
      textDecoration: 'none',
      transition: 'background 220ms ease'
    },
    onMouseEnter: e => e.currentTarget.style.background = C.zolotoYar,
    onMouseLeave: e => e.currentTarget.style.background = C.zoloto
  }, "\u0417\u0430\u043F\u0438\u0441\u0430\u0442\u044C\u0441\u044F \u043D\u0430 \u0431\u043E\u0440\u0442")))));
};

// ─── PAGE HEADER (star + Назад) ──────────────────────────────────────────────
const ManifestHeader = () => {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const h = () => setScrolled(window.scrollY > 40);
    window.addEventListener('scroll', h, {
      passive: true
    });
    return () => window.removeEventListener('scroll', h);
  }, []);
  return /*#__PURE__*/React.createElement("header", {
    style: {
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      zIndex: 100,
      height: 60,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 clamp(20px,4vw,44px)',
      background: scrolled ? 'rgba(7,11,9,0.88)' : 'transparent',
      backdropFilter: scrolled ? 'blur(14px) saturate(1.1)' : 'none',
      WebkitBackdropFilter: scrolled ? 'blur(14px) saturate(1.1)' : 'none',
      borderBottom: `1px solid ${scrolled ? 'rgba(194,154,72,0.14)' : 'transparent'}`,
      transition: 'background .5s ease, border-color .5s ease, backdrop-filter .5s ease'
    }
  }, /*#__PURE__*/React.createElement("a", {
    href: "index.html",
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 11,
      textDecoration: 'none',
      fontFamily: "'Onest', sans-serif",
      fontSize: 11.5,
      fontWeight: 500,
      letterSpacing: 2,
      textTransform: 'uppercase',
      color: C.kostMuted,
      transition: 'color 200ms ease'
    },
    onMouseEnter: e => e.currentTarget.style.color = C.kostYar,
    onMouseLeave: e => e.currentTarget.style.color = C.kostMuted
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 16,
      lineHeight: 1
    }
  }, "\u2190"), "\u041D\u0430\u0437\u0430\u0434"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10
    }
  }, /*#__PURE__*/React.createElement(StarSpark, {
    size: 12,
    color: C.zolotoYar
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "'Prata', serif",
      fontSize: 11.5,
      letterSpacing: 3,
      textTransform: 'uppercase',
      color: C.kostDim
    }
  }, "\u041C\u0430\u043D\u0438\u0444\u0435\u0441\u0442")));
};
const ManifestPage = () => /*#__PURE__*/React.createElement("div", {
  style: {
    background: C.bezdna,
    minHeight: '100vh'
  }
}, /*#__PURE__*/React.createElement(ManifestHeader, null), /*#__PURE__*/React.createElement("main", null, /*#__PURE__*/React.createElement(ManifestBook, null)));
ReactDOM.createRoot(document.getElementById('root')).render(/*#__PURE__*/React.createElement(ManifestPage, null));
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/argonautika_web/Manifest.jsx", error: String((e && e.message) || e) }); }

// ui_kits/argonautika_web/Sections.jsx
try { (() => {
// Sections.jsx — Аргонавтика · Header · Hero (Порог) · О чём
// Register C (dark ocean) threshold + definition.

// ─── HEADER ──────────────────────────────────────────────────────────────────
const Header = ({
  activeSection
}) => {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 60);
    window.addEventListener('scroll', handler, {
      passive: true
    });
    return () => window.removeEventListener('scroll', handler);
  }, []);
  const navItems = [{
    id: 'about',
    label: 'О ЧЁМ'
  }, {
    id: 'manifesto',
    label: 'МАНИФЕСТ'
  }, {
    id: 'karta',
    label: 'КАРТА'
  }];
  return /*#__PURE__*/React.createElement("header", {
    style: {
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      zIndex: 100,
      padding: '0 clamp(20px,4vw,44px)',
      height: 64,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      background: scrolled ? 'rgba(7,11,9,0.86)' : 'transparent',
      backdropFilter: scrolled ? 'blur(14px) saturate(1.1)' : 'none',
      WebkitBackdropFilter: scrolled ? 'blur(14px) saturate(1.1)' : 'none',
      borderBottom: scrolled ? '1px solid rgba(194,154,72,0.14)' : '1px solid transparent',
      transition: 'background 0.5s ease, border-color 0.5s ease, backdrop-filter 0.5s ease'
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => scrollTo('hero', 0),
    style: {
      background: 'none',
      border: 'none',
      cursor: 'pointer',
      padding: 0,
      display: 'flex',
      alignItems: 'center',
      gap: 11
    }
  }, /*#__PURE__*/React.createElement("img", {
    src: MEDIA.monogram,
    alt: "\u0410\u0440\u0433\u043E\u043D\u0430\u0432\u0442\u0438\u043A\u0430",
    style: {
      height: 26,
      width: 'auto',
      filter: 'invert(1)',
      display: 'block',
      opacity: 0.92
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "'Prata', serif",
      fontSize: 12,
      letterSpacing: 3.5,
      textTransform: 'uppercase',
      color: C.kostDim
    }
  }, "\u0410\u0440\u0433\u043E\u043D\u0430\u0432\u0442\u0438\u043A\u0430")), /*#__PURE__*/React.createElement("nav", {
    style: {
      display: 'flex',
      gap: 'clamp(16px,2.5vw,30px)',
      alignItems: 'center'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 'clamp(14px,2vw,26px)'
    },
    className: "hdr-links"
  }, navItems.map(item => /*#__PURE__*/React.createElement("button", {
    key: item.id,
    onClick: () => scrollTo(item.id),
    style: {
      background: 'none',
      border: 'none',
      cursor: 'pointer',
      padding: '4px 0',
      fontFamily: "'Onest', sans-serif",
      fontSize: 11,
      fontWeight: 500,
      letterSpacing: 2.5,
      textTransform: 'uppercase',
      color: activeSection === item.id ? C.kostDim : C.ghost,
      borderBottom: `1px solid ${activeSection === item.id ? 'rgba(194,154,72,0.5)' : 'transparent'}`,
      transition: 'color 220ms ease, border-color 220ms ease'
    },
    onMouseEnter: e => e.currentTarget.style.color = C.kostDim,
    onMouseLeave: e => e.currentTarget.style.color = activeSection === item.id ? C.kostDim : C.ghost
  }, item.label))), /*#__PURE__*/React.createElement("button", {
    onClick: () => scrollTo('expedition'),
    style: {
      background: C.zoloto,
      color: '#0B0E0C',
      border: 'none',
      borderRadius: 6,
      fontFamily: "'Onest', sans-serif",
      fontSize: 11.5,
      fontWeight: 600,
      letterSpacing: 1.5,
      textTransform: 'uppercase',
      padding: '9px 17px',
      cursor: 'pointer',
      transition: 'background 220ms ease'
    },
    onMouseEnter: e => e.currentTarget.style.background = C.zolotoYar,
    onMouseLeave: e => e.currentTarget.style.background = C.zoloto
  }, "\u0417\u0430\u043F\u0438\u0441\u0430\u0442\u044C\u0441\u044F \u043D\u0430 \u0431\u043E\u0440\u0442")));
};

// ─── HERO / ПОРОГ (Register C) ────────────────────────────────────────────────
const HeroSection = () => {
  const [bgRef, bgOffset] = useParallax(0.18);
  return /*#__PURE__*/React.createElement("section", {
    id: "hero",
    "data-screen-label": "Hero \xB7 \u041F\u043E\u0440\u043E\u0433",
    style: {
      position: 'relative',
      minHeight: '100svh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
      background: C.tishina,
      paddingTop: 'clamp(56px,9vh,112px)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    ref: bgRef,
    style: {
      position: 'absolute',
      inset: '-12% 0',
      zIndex: 0,
      backgroundImage: `url('${MEDIA.sea}')`,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
      transform: `translateY(${bgOffset}px) scale(1.08)`,
      opacity: 0.62
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      inset: 0,
      zIndex: 1,
      background: 'radial-gradient(ellipse 80% 70% at 50% 42%, rgba(11,16,14,0) 0%, rgba(8,12,10,0.55) 62%, rgba(5,7,6,0.92) 100%)'
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      inset: 0,
      zIndex: 1,
      background: 'linear-gradient(to bottom, rgba(5,7,6,0.7) 0%, transparent 22%, transparent 60%, #0B100E 100%)'
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative',
      zIndex: 2,
      textAlign: 'center',
      padding: '0 24px',
      maxWidth: 880
    }
  }, /*#__PURE__*/React.createElement(FadeSection, {
    delay: 120,
    y: 16
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'center',
      marginBottom: 56,
      fontFamily: "'Onest', sans-serif",
      fontSize: 12,
      fontWeight: 600,
      letterSpacing: 3,
      textTransform: 'uppercase',
      color: C.kostDim,
      maxWidth: '34ch',
      margin: '0 auto 56px'
    }
  }, "\u0421\u0418\u0421\u0422\u0415\u041C\u0410 \u041F\u0420\u041E\u042F\u0412\u041B\u0415\u041D\u0418\u042F \u0414\u041B\u042F \u041B\u042E\u0414\u0415\u0419 \u0421 \u041C\u0418\u0421\u0421\u0418\u0415\u0419")), /*#__PURE__*/React.createElement(FadeSection, {
    delay: 360,
    y: 22
  }, /*#__PURE__*/React.createElement("h1", {
    style: {
      fontFamily: "'Prata', serif",
      fontWeight: 400,
      fontSize: 'clamp(40px, 7.5vw, 86px)',
      lineHeight: 1.04,
      color: C.kostYar,
      letterSpacing: '-0.01em',
      margin: '0 auto 42px',
      maxWidth: '13em',
      textShadow: '0 2px 40px rgba(0,0,0,0.55)'
    }
  }, "\u041F\u0438\u0440\u0430\u0442\u0441\u043A\u0430\u044F", /*#__PURE__*/React.createElement("br", null), "\u044D\u043A\u0441\u043F\u0435\u0434\u0438\u0446\u0438\u044F.")), /*#__PURE__*/React.createElement(FadeSection, {
    delay: 620,
    y: 18
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      fontFamily: "'Lora', serif",
      fontStyle: 'italic',
      fontWeight: 400,
      fontSize: 'clamp(16px,2vw,20px)',
      lineHeight: 1.7,
      color: C.kostDim,
      margin: '0 auto 62px',
      maxWidth: 520
    }
  }, "\u0410\u0440\u0433\u043E\u043D\u0430\u0432\u0442\u044B \u0441\u043F\u043E\u0441\u043E\u0431\u043D\u044B \u0441\u0440\u0435\u0437\u0430\u0442\u044C \u0443\u0433\u043B\u044B \u0438 \u043F\u0440\u043E\u0445\u043E\u0434\u0438\u0442\u044C \u0441\u043A\u0432\u043E\u0437\u044C \u0441\u0442\u0435\u043D\u044B \u0441\u0438\u0441\u0442\u0435\u043C\u044B.")), /*#__PURE__*/React.createElement(FadeSection, {
    delay: 860,
    y: 14
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 16,
      justifyContent: 'center',
      flexWrap: 'wrap'
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => scrollTo('manifesto'),
    style: btnPrimary,
    onMouseEnter: e => e.currentTarget.style.background = C.kostYar,
    onMouseLeave: e => e.currentTarget.style.background = C.kost
  }, "\u0427\u0438\u0442\u0430\u0442\u044C \u041C\u0430\u043D\u0438\u0444\u0435\u0441\u0442"), /*#__PURE__*/React.createElement("button", {
    onClick: () => scrollTo('about'),
    style: btnGhost,
    onMouseEnter: e => {
      e.currentTarget.style.borderColor = 'rgba(194,154,72,0.5)';
      e.currentTarget.style.color = C.kostDim;
    },
    onMouseLeave: e => {
      e.currentTarget.style.borderColor = C.frameDeep;
      e.currentTarget.style.color = C.kostMuted;
    }
  }, "\u041E \u0447\u0451\u043C \u044D\u0442\u043E")))), /*#__PURE__*/React.createElement(FadeSection, {
    delay: 1200,
    y: 0,
    style: {
      position: 'absolute',
      bottom: 30,
      left: 0,
      right: 0,
      zIndex: 2
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: 8,
      fontFamily: "'Onest', sans-serif",
      fontSize: 9.5,
      letterSpacing: 3.5,
      textTransform: 'uppercase',
      color: C.ghost
    }
  }, /*#__PURE__*/React.createElement("span", null, "\u0421\u043F\u0443\u0441\u0442\u0438\u0442\u044C\u0441\u044F"), /*#__PURE__*/React.createElement("span", {
    className: "hero-arrow",
    style: {
      fontSize: 14,
      lineHeight: 1
    }
  }, "\u2193"))));
};

// shared button styles
const btnPrimary = {
  fontFamily: "'Onest', sans-serif",
  fontSize: 13,
  fontWeight: 600,
  letterSpacing: 1,
  textTransform: 'uppercase',
  padding: '14px 30px',
  borderRadius: 6,
  background: C.kost,
  color: '#0B0E0C',
  border: 'none',
  cursor: 'pointer',
  transition: 'background 220ms ease'
};
const btnGhost = {
  fontFamily: "'Onest', sans-serif",
  fontSize: 13,
  fontWeight: 500,
  letterSpacing: 1,
  textTransform: 'uppercase',
  padding: '14px 30px',
  borderRadius: 6,
  background: 'transparent',
  color: C.kostMuted,
  border: `1px solid ${C.frameDeep}`,
  cursor: 'pointer',
  transition: 'border-color 220ms ease, color 220ms ease'
};

// ─── О ЧЁМ ─────────────────────────────────────────────────────────────────────
const ARC = [{
  k: 'Чужие сценарии',
  s: 'где ты сейчас'
}, {
  k: 'Своя опора',
  s: 'плотное Ядро'
}, {
  k: 'Призвание',
  s: 'твоё Дело'
}, {
  k: 'Легендарность',
  s: 'наследие'
}];
const MOVES = [{
  glyph: 'yav',
  big: 'Внутрь',
  label: 'ЯВЬ',
  color: C.kost,
  desc: 'Освобождение внимания. Опора.'
}, {
  glyph: 'nav',
  big: 'Вглубь',
  label: 'НАВЬ',
  color: C.krovYar,
  desc: 'Погружение за самой большой силой.'
}, {
  glyph: 'prav',
  big: 'Наверх',
  label: 'ПРАВЬ',
  color: C.zoloto,
  desc: 'Проявленность. Дело — в мир.'
}];
const AboutSection = () => /*#__PURE__*/React.createElement("section", {
  id: "about",
  "data-screen-label": "\u041E \u0447\u0451\u043C",
  style: {
    background: C.bezdna,
    position: 'relative',
    padding: 'clamp(98px,12vw,172px) clamp(22px,7vw,96px)',
    borderTop: '1px solid rgba(194,154,72,0.08)'
  }
}, /*#__PURE__*/React.createElement("div", {
  style: {
    maxWidth: 1080,
    margin: '0 auto'
  }
}, /*#__PURE__*/React.createElement(FadeSection, null, /*#__PURE__*/React.createElement(SecLabel, {
  num: "01",
  text: "\u041E \u0447\u0451\u043C"
})), /*#__PURE__*/React.createElement("div", {
  className: "about-grid",
  style: {
    display: 'grid',
    gridTemplateColumns: '1fr clamp(220px,26vw,300px)',
    gap: 'clamp(32px,5vw,64px)',
    alignItems: 'center',
    marginBottom: 'clamp(56px,8vw,96px)'
  }
}, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(FadeSection, {
  delay: 80
}, /*#__PURE__*/React.createElement("h2", {
  style: {
    fontFamily: "'Prata', serif",
    fontWeight: 400,
    fontSize: 'clamp(28px,4vw,50px)',
    lineHeight: 1.16,
    color: C.kostYar,
    letterSpacing: '-0.01em',
    marginBottom: 28,
    maxWidth: '13em'
  }
}, "\u0410\u0440\u0433\u043E\u043D\u0430\u0432\u0442\u0438\u043A\u0430 \u2014 \u044D\u0442\u043E \u0438\u0441\u043A\u0443\u0441\u0441\u0442\u0432\u043E ", /*#__PURE__*/React.createElement("span", {
  style: {
    color: C.zolotoYar
  }
}, "\u043E\u0442\u0441\u0435\u0447\u0435\u043D\u0438\u044F \u043B\u0438\u0448\u043D\u0435\u0433\u043E"), ".")), /*#__PURE__*/React.createElement(FadeSection, {
  delay: 180
}, /*#__PURE__*/React.createElement("p", {
  style: {
    fontFamily: "'Lora', serif",
    fontSize: 18,
    lineHeight: 1.78,
    color: C.kostDim,
    maxWidth: '52ch',
    marginBottom: 18
  }
}, "\u041F\u043B\u0435\u043C\u044F \u0442\u0435\u0445, \u043A\u0442\u043E \u0440\u0430\u0437\u043B\u0438\u0447\u0430\u0435\u0442 \u0436\u0438\u0432\u043E\u0435 \u043E\u0442 \u043D\u0435\u0436\u0438\u0432\u043E\u0433\u043E. \u0414\u043B\u044F \u0430\u0440\u0433\u043E\u043D\u0430\u0432\u0442\u043E\u0432 \u0442\u044C\u043C\u0430 \u2014 \u043D\u0435 \u0432\u0440\u0430\u0433, \u0430 \u0441\u0442\u0440\u043E\u0438\u0442\u0435\u043B\u044C\u043D\u044B\u0439 \u043C\u0430\u0442\u0435\u0440\u0438\u0430\u043B. \u0427\u0435\u0440\u0435\u0437 \u043D\u0435\u0433\u0430\u0442\u0438\u0432 \u043F\u0440\u043E\u0438\u0441\u0445\u043E\u0434\u0438\u0442 \u043D\u0430\u0441\u0442\u043E\u044F\u0449\u0435\u0435 \u043F\u0440\u043E\u044F\u0432\u043B\u0435\u043D\u0438\u0435, \u0430 \u043D\u0435 \u043F\u043E\u043F\u044B\u0442\u043A\u0438 \u043F\u0440\u043E\u044F\u0432\u0438\u0442\u044C\u0441\u044F.", /*#__PURE__*/React.createElement("br", null), /*#__PURE__*/React.createElement("br", null), "\u0410\u0440\u0433\u043E\u043D\u0430\u0432\u0442\u044B \u0441\u043E\u0437\u0434\u0430\u044E\u0442 \u043A\u0430\u043D\u0432\u0443 \u042D\u043F\u043E\u0445\u0438 \u041F\u0435\u0440\u0435\u043C\u0435\u043D. \u042D\u0442\u043E \u043F\u0440\u043E\u0432\u043E\u0434\u043D\u0438\u043A\u0438 \u0438 \u043B\u0438\u0434\u0435\u0440\u044B \u0441\u0432\u043E\u0438\u0445 \u0441\u0442\u0430\u0439.", /*#__PURE__*/React.createElement("br", null), /*#__PURE__*/React.createElement("br", null), "\u041A\u0430\u0436\u0434\u044B\u0439 \u0430\u0440\u0433\u043E\u043D\u0430\u0432\u0442 \u0432 \u0434\u0443\u0448\u0435 \u0437\u043D\u0430\u0435\u0442, \u0447\u0442\u043E \u043F\u0440\u0438\u0448\u0451\u043B \u0441\u044E\u0434\u0430 \u0434\u0435\u043B\u0430\u0442\u044C \u0441\u0432\u043E\u0451 \u0434\u0435\u043B\u043E. \u0410\u0440\u0433\u043E\u043D\u0430\u0432\u0442\u0438\u043A\u0430 \u0441\u043E\u0437\u0434\u0430\u043D\u0430, \u0447\u0442\u043E\u0431\u044B \u043E\u0442\u0441\u0435\u0447\u044C \u0432\u0441\u0451 \u043D\u0430\u043D\u043E\u0441\u043D\u043E\u0435 \u0438 \u043F\u0440\u043E\u044F\u0432\u0438\u0442\u044C \u0414\u0435\u043B\u043E \u0441\u043E\u0433\u043B\u0430\u0441\u043D\u043E \u0442\u0432\u043E\u0435\u043C\u0443 \u041F\u0440\u0438\u0437\u0432\u0430\u043D\u0438\u044E."))), /*#__PURE__*/React.createElement(FadeSection, {
  delay: 260,
  y: 20
}, /*#__PURE__*/React.createElement("figure", {
  style: {
    margin: 0,
    position: 'relative',
    borderRadius: 8,
    overflow: 'hidden',
    border: '1px solid rgba(194,154,72,0.28)',
    boxShadow: 'inset 0 0 60px rgba(194,154,72,0.07)'
  }
}, /*#__PURE__*/React.createElement("img", {
  src: MEDIA.sword,
  alt: "\u041C\u0435\u0447 \u2014 \u043E\u0442\u0441\u0435\u0447\u0435\u043D\u0438\u0435",
  style: {
    width: '100%',
    display: 'block',
    aspectRatio: '4 / 5',
    objectFit: 'cover'
  }
}), /*#__PURE__*/React.createElement("div", {
  style: {
    position: 'absolute',
    inset: 0,
    background: 'linear-gradient(to bottom, transparent 60%, rgba(8,12,10,0.55))'
  }
})))), /*#__PURE__*/React.createElement(FadeSection, {
  delay: 120
}, /*#__PURE__*/React.createElement("div", {
  style: {
    fontFamily: "'Onest', sans-serif",
    fontSize: 10.5,
    fontWeight: 500,
    letterSpacing: 3,
    textTransform: 'uppercase',
    color: C.ghost,
    marginBottom: 26
  }
}, "\u0414\u0443\u0433\u0430 \u043F\u0440\u0435\u0432\u0440\u0430\u0449\u0435\u043D\u0438\u044F")), /*#__PURE__*/React.createElement(FadeSection, {
  delay: 180
}, /*#__PURE__*/React.createElement("div", {
  className: "arc-row",
  style: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: 0,
    position: 'relative',
    marginBottom: 'clamp(56px,8vw,96px)'
  }
}, /*#__PURE__*/React.createElement("div", {
  style: {
    position: 'absolute',
    top: 5,
    left: '12.5%',
    right: '12.5%',
    height: 1,
    background: `linear-gradient(to right, ${C.stone}, ${C.zoloto})`,
    opacity: 0.55
  }
}), ARC.map((a, i) => /*#__PURE__*/React.createElement("div", {
  key: i,
  style: {
    position: 'relative',
    paddingTop: 24,
    paddingRight: 16
  }
}, /*#__PURE__*/React.createElement("div", {
  style: {
    position: 'absolute',
    top: 0,
    left: 0
  }
}, /*#__PURE__*/React.createElement(StarSpark, {
  size: i === ARC.length - 1 ? 12 : 9,
  color: i === ARC.length - 1 ? C.zolotoYar : i === 0 ? C.stone : C.latun
})), /*#__PURE__*/React.createElement("div", {
  style: {
    fontFamily: "'Prata', serif",
    fontSize: 'clamp(15px,1.7vw,20px)',
    color: i === ARC.length - 1 ? C.zolotoYar : C.kost,
    marginBottom: 6,
    lineHeight: 1.2
  }
}, a.k), /*#__PURE__*/React.createElement("div", {
  style: {
    fontFamily: "'Onest', sans-serif",
    fontSize: 10,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: C.ghost
  }
}, a.s))))), /*#__PURE__*/React.createElement(FadeSection, {
  delay: 120
}, /*#__PURE__*/React.createElement(MeanderRule, {
  style: {
    marginBottom: 48
  },
  opacity: 0.35
})), /*#__PURE__*/React.createElement("div", {
  className: "moves-grid",
  style: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3,1fr)',
    gap: 1,
    background: C.frame
  }
}, MOVES.map((m, i) => /*#__PURE__*/React.createElement(FadeSection, {
  key: i,
  delay: 140 + i * 120,
  style: {
    background: C.bezdna
  }
}, /*#__PURE__*/React.createElement("div", {
  style: {
    padding: 'clamp(28px,4vw,40px) clamp(20px,3vw,34px)'
  }
}, /*#__PURE__*/React.createElement(MovementGlyph, {
  kind: m.glyph,
  size: 44,
  color: m.color
}), /*#__PURE__*/React.createElement("div", {
  style: {
    marginTop: 24,
    display: 'flex',
    alignItems: 'baseline',
    gap: 12
  }
}, /*#__PURE__*/React.createElement("span", {
  style: {
    fontFamily: "'Prata', serif",
    fontSize: 'clamp(22px,2.6vw,30px)',
    color: C.kostYar
  }
}, m.big), /*#__PURE__*/React.createElement("span", {
  style: {
    fontFamily: "'Onest', sans-serif",
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: 3,
    textTransform: 'uppercase',
    color: m.color
  }
}, m.label)), /*#__PURE__*/React.createElement("p", {
  style: {
    fontFamily: "'Lora', serif",
    fontSize: 15.5,
    lineHeight: 1.65,
    color: C.kostMuted,
    marginTop: 12
  }
}, m.desc))))), /*#__PURE__*/React.createElement(FadeSection, {
  delay: 200
}, /*#__PURE__*/React.createElement("p", {
  style: {
    fontFamily: "'Lora', serif",
    fontStyle: 'italic',
    fontSize: 'clamp(16px,1.7vw,19px)',
    lineHeight: 1.65,
    color: C.kostDim,
    maxWidth: '44ch',
    margin: 'clamp(56px,8vw,90px) auto 0',
    textAlign: 'center'
  }
}, "\u0418\u0434\u0442\u0438 \u0441\u0440\u0430\u0437\u0443 \u043D\u0430\u0432\u0435\u0440\u0445 \u2014 \u0434\u0443\u0445\u043E\u0432\u043D\u0430\u044F \u043B\u043E\u0432\u0443\u0448\u043A\u0430, \u0442\u0430\u043A \u043B\u044E\u0434\u0438 \u043E\u0442\u043B\u0435\u0442\u0430\u044E\u0442 \u0438 \u0441\u0442\u0430\u043D\u043E\u0432\u044F\u0442\u0441\u044F \u0440\u0435\u043F\u043B\u0438\u043A\u0430\u0442\u043E\u0440\u0430\u043C\u0438 \u044D\u0433\u0440\u0435\u0433\u043E\u0440\u043E\u0432.", /*#__PURE__*/React.createElement("br", null), "\u041D\u0430\u0441\u0442\u043E\u044F\u0449\u0430\u044F \u0440\u0435\u0430\u043B\u0438\u0437\u0430\u0446\u0438\u044F \u043F\u0440\u043E\u0438\u0441\u0445\u043E\u0434\u0438\u0442 \u0447\u0435\u0440\u0435\u0437 \u0443\u0433\u043B\u0443\u0431\u043B\u0435\u043D\u0438\u0435 \u0438 \u043F\u0440\u043E\u044F\u0432\u043B\u0435\u043D\u0438\u0435 \u0433\u043B\u0443\u0431\u0438\u043D\u044B \u0432\xA0\u043C\u0438\u0440."))));
Object.assign(window, {
  Header,
  HeroSection,
  AboutSection,
  btnPrimary,
  btnGhost
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/argonautika_web/Sections.jsx", error: String((e && e.message) || e) }); }

// ui_kits/argonautika_web/Sections2.jsx
try { (() => {
// Sections2.jsx — Аргонавтика · Манифест (книга) · Карта (тизер напряжения)

// ─── MANIFESTO CHAPTERS (excerpts from the real Manifesto) ───────────────────
const CHAPTERS = [{
  num: 'I',
  title: 'Архитектура симуляции',
  body: 'Мы живём в цифровой симуляции. Это фундаментальная рабочая предпосылка — не метафора. Задача аргонавта — научиться различать живое от неживого. Различать за тысячу шагов: чувствовать, знать и быть готовым ещё до того, как неживое на тебя бросится.',
  pull: 'Различать живое от неживого. За тысячу шагов.'
}, {
  num: 'IV',
  title: 'Вертикаль и горизонтали',
  body: 'Пока Ядро не собрано — невозможно участвовать в собственных событийных рядах. Человек включается в чужие игры, созданные другими сценаристами. Первичная задача аргонавта — освободить внимание из внешних горизонтальных игр и сфокусироваться на уплотнении своего Ядра.',
  hard: 'Одиночество — титановая оболочка Ядра.'
}, {
  num: 'V',
  title: 'Вещество Матрицы',
  body: 'Матрица ни в коем случае не враг. Воевать с матрицей — сон безумца. Аргонавт понимает принципы её работы и лепит из неё свою великую действительность. Намерение → Сопротивление → Рождение — абсолютная закономерность, работающая как часы.',
  pull: 'Матрица — это пластилин в руках аргонавта.',
  hard: 'Бояться пиздеца — значит отказываться от великих дел.'
}, {
  num: 'VI',
  title: 'Мир — зеркало',
  body: 'Ты принял твёрдое решение, Матрица приняла его к исполнению. Но проходит время, ты смотришь в зеркало — а там всё как прежде, и бросаешь начатое на полпути. Физика инертна. Матрица материализует с задержкой; её инерцию нужно воспринимать как благо.',
  pull: 'Аргонавтика начинается, когда ты разбиваешь зеркало.'
}, {
  num: 'VIII',
  title: 'Ловушка окружения',
  body: 'Матрица не выключает тебя сразу — она действует через постепенное усыпление. Аргонавт видит вовлекающие ловушки и даже среди людей не теряет состояния трезвого одиночества. Самые сильные проверки часто приходят через близких.',
  hard: 'Отсутствие врагов — признак посредственности человека.'
}, {
  num: 'IX',
  title: 'Правило бинера',
  body: 'Энергия вырабатывается на разнице потенциалов. Свет и тьма, день и ночь, напряжение и расслабление. Чем глубже вхождение в тишину и недеяние — тем больше энергии действия черпается из бездонного источника. Аргонавт ловит и держит Баланс.',
  pull: 'Энергия вырабатывается на разнице потенциалов.'
}, {
  num: 'XIV',
  title: 'Необходимость действовать',
  body: 'Аргонавт идёт своим путём — он активирует Бездеятеля: того, кто создаёт импульс, из которого рождается действие. Мы встаём в точку, из которой возникает Намерение, и держимся там, пока оно не станет плотным. Намерение → Импульс → Действие.'
}, {
  num: 'XV',
  title: 'Оживление',
  body: 'Пробуждение и Просветление — не финал. За ними есть третий этап. Оживление — интеграция всех знаний в жизнь, разворачивание реальности из точки баланса. Аргонавт — человек, активирующий живые структуры.',
  pull: 'Пробуждение — не финал. Есть третий этап: Оживление.'
}, {
  num: 'XVIII',
  title: 'Перезагрузка системы 64-х',
  body: 'Здесь всё начинается с чистого импульса. После — всегда Проверка от системы, плодородная Тень. Именно здесь ты опускаешь руки. Ты не слабый — ты просто не знаешь механизма. Проходя плотность Тени, Ядро Намерения укрепляется, и ты обретаешь Дар.',
  pull: 'Сиддхи → Тень → Дар.'
}, {
  num: 'XXIII',
  title: 'Карта Аргонавтики',
  body: 'Карта собирает твоё внимание, чтобы ты дошёл. На ней — состояния, что держат тебя; этапы, открывающиеся по одному; и Золотое Руно как пламя, которое, загораясь, меняет всё.'
}];
const ManifestoSection = () => {
  const [active, setActive] = useState(0);
  const ch = CHAPTERS[active];
  return /*#__PURE__*/React.createElement("section", {
    id: "manifesto",
    "data-screen-label": "\u041C\u0430\u043D\u0438\u0444\u0435\u0441\u0442",
    style: {
      background: C.tishina,
      padding: 'clamp(98px,12vw,172px) clamp(22px,6vw,80px)',
      borderTop: '1px solid rgba(194,154,72,0.1)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 1120,
      margin: '0 auto'
    }
  }, /*#__PURE__*/React.createElement(FadeSection, null, /*#__PURE__*/React.createElement(SecLabel, {
    num: "02",
    text: "\u041C\u0430\u043D\u0438\u0444\u0435\u0441\u0442"
  }), /*#__PURE__*/React.createElement("h2", {
    style: {
      fontFamily: "'Prata', serif",
      fontWeight: 400,
      fontSize: 'clamp(26px,3.4vw,40px)',
      lineHeight: 1.2,
      color: C.kostYar,
      maxWidth: '16ch',
      marginBottom: 18
    }
  }, "\u0422\u043E\u0447\u043A\u0430 \u043F\u0440\u0438\u0442\u044F\u0436\u0435\u043D\u0438\u044F. \u0412\u044B\u0436\u0438\u043C\u043A\u0430 \u0441\u0443\u0442\u0438."), /*#__PURE__*/React.createElement("p", {
    style: {
      fontFamily: "'Lora', serif",
      fontStyle: 'italic',
      fontSize: 17,
      lineHeight: 1.7,
      color: C.kostMuted,
      maxWidth: '54ch',
      marginBottom: 'clamp(40px,6vw,64px)'
    }
  }, "\u041C\u0430\u043D\u0438\u0444\u0435\u0441\u0442 \u2014 \u043B\u0435\u0434\u044F\u043D\u043E\u0439 \u043E\u0442\u0440\u0435\u0437\u0432\u043B\u044F\u044E\u0449\u0438\u0439 \u0434\u0443\u0448. \u0414\u0432\u0430\u0434\u0446\u0430\u0442\u044C \u0447\u0435\u0442\u044B\u0440\u0435 \u0433\u043B\u0430\u0432\u044B, \u043D\u0430\u0431\u0440\u0430\u043D\u043D\u044B\u0435 \u043A\u0430\u043A \u0441\u0435\u0440\u044C\u0451\u0437\u043D\u0430\u044F \u043A\u043D\u0438\u0433\u0430. \u0417\u0434\u0435\u0441\u044C \u2014 \u0442\u043E\u043B\u044C\u043A\u043E \u0432\u0435\u0440\u0445\u0443\u0448\u043A\u0430 \u0430\u0439\u0441\u0431\u0435\u0440\u0433\u0430.")), /*#__PURE__*/React.createElement("div", {
    className: "manifesto-grid",
    style: {
      display: 'grid',
      gridTemplateColumns: '54px 210px 1fr',
      gap: 'clamp(28px,4vw,56px)',
      alignItems: 'start'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "thread-rail",
    style: {
      alignSelf: 'stretch',
      borderRadius: 6,
      overflow: 'hidden',
      minHeight: 460,
      border: '1px solid rgba(194,154,72,0.18)',
      position: 'relative'
    }
  }, /*#__PURE__*/React.createElement("img", {
    src: MEDIA.thread,
    alt: "\u0417\u043E\u043B\u043E\u0442\u0430\u044F \u043D\u0438\u0442\u044C \u0410\u0440\u0438\u0430\u0434\u043D\u044B",
    style: {
      width: '100%',
      height: '100%',
      objectFit: 'cover',
      display: 'block',
      opacity: 0.85
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      inset: 0,
      background: 'linear-gradient(to bottom, rgba(0,0,0,0.35), transparent 30%, transparent 70%, rgba(0,0,0,0.45))'
    }
  })), /*#__PURE__*/React.createElement("nav", {
    className: "ch-nav"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "'Onest', sans-serif",
      fontSize: 10,
      fontWeight: 500,
      letterSpacing: 3,
      textTransform: 'uppercase',
      color: C.ghost,
      marginBottom: 18
    }
  }, "I \u2014 XXIV \xB7 \u0413\u043B\u0430\u0432\u044B"), CHAPTERS.map((c, i) => /*#__PURE__*/React.createElement("button", {
    key: i,
    onClick: () => setActive(i),
    style: {
      display: 'flex',
      alignItems: 'baseline',
      gap: 12,
      width: '100%',
      background: 'none',
      border: 'none',
      textAlign: 'left',
      cursor: 'pointer',
      padding: '12px 0',
      borderBottom: `1px solid rgba(194,154,72,${active === i ? 0.4 : 0.1})`,
      transition: 'border-color 220ms ease'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "'Onest', sans-serif",
      fontSize: 10.5,
      fontWeight: 600,
      letterSpacing: 1,
      color: active === i ? C.zolotoYar : C.stone,
      width: 38,
      flexShrink: 0
    }
  }, c.num), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "'Prata', serif",
      fontSize: 13.5,
      lineHeight: 1.3,
      color: active === i ? C.kostYar : C.kostMuted,
      transition: 'color 220ms ease'
    }
  }, c.title))), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 16,
      fontFamily: "'Onest', sans-serif",
      fontSize: 10,
      letterSpacing: 2,
      color: C.stone
    }
  }, "\xB7 \xB7 \xB7 \u0438 \u0434\u0430\u043B\u0435\u0435 \u0434\u043E XXIV")), /*#__PURE__*/React.createElement("article", {
    key: active,
    className: "reader-fade",
    style: {
      maxWidth: '62ch',
      paddingTop: 4
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "'Onest', sans-serif",
      fontSize: 11,
      fontWeight: 600,
      letterSpacing: 3,
      textTransform: 'uppercase',
      color: C.latun,
      marginBottom: 14,
      display: 'flex',
      alignItems: 'center',
      gap: 10
    }
  }, /*#__PURE__*/React.createElement(StarSpark, {
    size: 9,
    color: C.zoloto
  }), "\u0413\u043B\u0430\u0432\u0430 ", ch.num), /*#__PURE__*/React.createElement("h3", {
    style: {
      fontFamily: "'Prata', serif",
      fontWeight: 400,
      fontSize: 'clamp(24px,3vw,36px)',
      lineHeight: 1.22,
      color: C.kostYar,
      marginBottom: 26
    }
  }, ch.title), /*#__PURE__*/React.createElement(Hairline, {
    strength: "soft",
    style: {
      marginBottom: 30
    }
  }), /*#__PURE__*/React.createElement("p", {
    style: {
      fontFamily: "'Lora', serif",
      fontSize: 18,
      lineHeight: 1.85,
      color: C.kostDim,
      marginBottom: ch.pull || ch.hard ? 30 : 0
    }
  }, ch.body), ch.pull && /*#__PURE__*/React.createElement("blockquote", {
    style: {
      margin: '0 0 30px',
      display: 'flex',
      gap: 16
    }
  }, /*#__PURE__*/React.createElement(StarSpark, {
    size: 12,
    color: C.zoloto,
    style: {
      marginTop: 14,
      flexShrink: 0
    }
  }), /*#__PURE__*/React.createElement("p", {
    style: {
      fontFamily: "'Prata', serif",
      fontWeight: 400,
      fontSize: 'clamp(20px,2.4vw,28px)',
      lineHeight: 1.34,
      color: C.kostYar,
      margin: 0
    }
  }, ch.pull)), ch.hard && /*#__PURE__*/React.createElement("p", {
    style: {
      fontFamily: "'Onest', sans-serif",
      fontWeight: 600,
      fontSize: 'clamp(14px,1.6vw,17px)',
      letterSpacing: 0.5,
      color: C.krovYar,
      lineHeight: 1.5,
      margin: '0 0 30px',
      paddingLeft: 18,
      borderLeft: `2px solid ${C.krov}`
    }
  }, ch.hard), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 26,
      marginTop: 38,
      flexWrap: 'wrap'
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => setActive(i => Math.min(i + 1, CHAPTERS.length - 1)),
    disabled: active >= CHAPTERS.length - 1,
    style: {
      fontFamily: "'Onest', sans-serif",
      fontSize: 11.5,
      fontWeight: 500,
      letterSpacing: 2,
      textTransform: 'uppercase',
      color: active >= CHAPTERS.length - 1 ? C.stone : C.kostMuted,
      background: 'none',
      border: 'none',
      padding: 0,
      cursor: active >= CHAPTERS.length - 1 ? 'default' : 'pointer',
      transition: 'color 200ms ease'
    },
    onMouseEnter: e => {
      if (active < CHAPTERS.length - 1) e.currentTarget.style.color = C.kostYar;
    },
    onMouseLeave: e => {
      if (active < CHAPTERS.length - 1) e.currentTarget.style.color = C.kostMuted;
    }
  }, "\u0421\u043B\u0435\u0434\u0443\u044E\u0449\u0430\u044F \u0433\u043B\u0430\u0432\u0430 \u2192"), /*#__PURE__*/React.createElement("a", {
    href: "manifest.html",
    style: {
      fontFamily: "'Onest', sans-serif",
      fontSize: 11.5,
      fontWeight: 600,
      letterSpacing: 1.5,
      textTransform: 'uppercase',
      color: C.zolotoYar,
      textDecoration: 'none',
      borderBottom: '1px solid rgba(217,180,90,0.4)',
      paddingBottom: 2
    }
  }, "\u0427\u0438\u0442\u0430\u0442\u044C \u0446\u0435\u043B\u0438\u043A\u043E\u043C")))), /*#__PURE__*/React.createElement(FadeSection, {
    delay: 80
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 'clamp(64px,9vw,110px)',
      textAlign: 'center',
      paddingTop: 'clamp(40px,6vw,64px)',
      borderTop: '1px solid rgba(194,154,72,0.14)'
    }
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      fontFamily: "'Lora', serif",
      fontStyle: 'italic',
      fontSize: 'clamp(17px,2vw,21px)',
      lineHeight: 1.6,
      color: C.kostMuted,
      maxWidth: '54ch',
      margin: '0 auto 26px'
    }
  }, "\u0415\u0441\u043B\u0438 \u043F\u043E\u0441\u043B\u0435 \u041C\u0430\u043D\u0438\u0444\u0435\u0441\u0442\u0430 \u0442\u044B \u043F\u043E\u0447\u0443\u0432\u0441\u0442\u0432\u043E\u0432\u0430\u043B \u043B\u0435\u0434\u044F\u043D\u043E\u0439 \u043E\u0433\u043E\u043D\u044C, \u0437\u043D\u0430\u0447\u0438\u0442 \u0442\u0432\u043E\u0439 \u0432\u043D\u0443\u0442\u0440\u0435\u043D\u043D\u0438\u0439 \u0444\u0438\u0442\u043E\u0431\u043E\u044F\u0440\u0438\u043D \u0437\u0430\u0448\u0435\u0432\u0435\u043B\u0438\u043B\u0441\u044F. \u0422\u044B \u0433\u043E\u0442\u043E\u0432 \u0438\u0434\u0442\u0438 \u0434\u0430\u043B\u044C\u0448\u0435.", /*#__PURE__*/React.createElement("br", null), "\u0415\u0441\u043B\u0438 \u043D\u0435\u0442 \u2014 \u043D\u0430\u0439\u0434\u0438 \u0441\u0435\u0431\u0435 \u0434\u0440\u0443\u0433\u043E\u0435 \u0441\u043E\u043E\u0431\u0449\u0435\u0441\u0442\u0432\u043E."), /*#__PURE__*/React.createElement("button", {
    onClick: () => scrollTo('expedition'),
    style: {
      ...btnGhost,
      borderColor: 'rgba(194,154,72,0.4)',
      color: C.kostDim
    },
    onMouseEnter: e => {
      e.currentTarget.style.borderColor = C.zoloto;
      e.currentTarget.style.color = C.kostYar;
    },
    onMouseLeave: e => {
      e.currentTarget.style.borderColor = 'rgba(194,154,72,0.4)';
      e.currentTarget.style.color = C.kostDim;
    }
  }, "\u041F\u0435\u0440\u0435\u0439\u0442\u0438 \u043A \u042D\u043A\u0441\u043F\u0435\u0434\u0438\u0446\u0438\u0438 \u2193")))));
};

// ─── КАРТА — ТИЗЕР НАПРЯЖЕНИЯ ────────────────────────────────────────────────
const FEARS = ['Страх быть брошенным', 'Страх проиграть эту жизнь', 'Страх собственного величия', 'Страх осуждения близких'];
const KartaSection = () => {
  const [ringsRef, ringsOffset] = useParallax(0.1);
  return /*#__PURE__*/React.createElement("section", {
    id: "karta",
    "data-screen-label": "\u041A\u0430\u0440\u0442\u0430",
    style: {
      background: C.bezdna,
      position: 'relative',
      overflow: 'hidden',
      padding: 'clamp(98px,12vw,172px) clamp(22px,6vw,80px)',
      borderTop: '1px solid rgba(194,154,72,0.08)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 1100,
      margin: '0 auto'
    }
  }, /*#__PURE__*/React.createElement(FadeSection, null, /*#__PURE__*/React.createElement(SecLabel, {
    num: "03",
    text: "\u041A\u0430\u0440\u0442\u0430 \u043C\u0438\u0440\u043E\u0432"
  })), /*#__PURE__*/React.createElement("div", {
    className: "karta-grid",
    style: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: 'clamp(36px,6vw,72px)',
      alignItems: 'center'
    }
  }, /*#__PURE__*/React.createElement(FadeSection, {
    delay: 120,
    y: 24
  }, /*#__PURE__*/React.createElement("figure", {
    ref: ringsRef,
    style: {
      margin: 0,
      position: 'relative',
      borderRadius: '50%',
      overflow: 'hidden',
      aspectRatio: '1 / 1',
      border: '1px solid rgba(194,154,72,0.22)',
      boxShadow: 'inset 0 0 90px rgba(194,154,72,0.12), 0 0 120px rgba(194,154,72,0.05)',
      transform: `translateY(${ringsOffset}px)`
    }
  }, /*#__PURE__*/React.createElement("img", {
    src: MEDIA.rings,
    alt: "\u041A\u0430\u0440\u0442\u0430 \u043C\u0438\u0440\u043E\u0432 \u2014 \u043A\u043E\u043D\u0446\u0435\u043D\u0442\u0440\u0438\u0447\u0435\u0441\u043A\u0438\u0435 \u043A\u043E\u043B\u044C\u0446\u0430",
    style: {
      width: '108%',
      height: '108%',
      objectFit: 'cover',
      display: 'block',
      margin: '-4%'
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      inset: 0,
      background: 'radial-gradient(circle, transparent 55%, rgba(11,16,14,0.5) 100%)'
    }
  }))), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(FadeSection, {
    delay: 100
  }, /*#__PURE__*/React.createElement("h2", {
    style: {
      fontFamily: "'Prata', serif",
      fontWeight: 400,
      fontSize: 'clamp(28px,3.6vw,44px)',
      lineHeight: 1.16,
      color: C.kostYar,
      marginBottom: 24
    }
  }, "\u041A\u0430\u0440\u0442\u0430 \u043C\u0438\u0440\u043E\u0432"), /*#__PURE__*/React.createElement("p", {
    style: {
      fontFamily: "'Lora', serif",
      fontSize: 17.5,
      lineHeight: 1.78,
      color: C.kostDim,
      maxWidth: '46ch',
      marginBottom: 16
    }
  }, "\u041A\u0430\u0440\u0442\u0430 \u043F\u043E\u043C\u043E\u0433\u0430\u0435\u0442 \u0434\u0435\u0440\u0436\u0430\u0442\u044C \u0442\u0432\u043E\u0451 \u0432\u043D\u0438\u043C\u0430\u043D\u0438\u0435, \u0447\u0442\u043E\u0431\u044B \u0442\u044B \u0434\u043E\u0448\u0451\u043B \u0434\u043E \u043A\u043E\u043D\u0446\u0430. 12 \u043C\u0438\u0440\u043E\u0432 \u044D\u0442\u043E 12 \u0433\u043B\u0430\u0432\u043D\u044B\u0445 \u0431\u043E\u0441\u0441\u043E\u0432 \u041C\u0430\u0442\u0440\u0438\u0446\u044B. \u041A\u0430\u0436\u0434\u044B\u0439 \u0431\u043E\u0441\u0441 \u044D\u0442\u043E \u043E\u043F\u0440\u0435\u0434\u0435\u043B\u0435\u043D\u043D\u044B\u0439 \u0434\u0438\u0430\u043F\u0430\u0437\u043E\u043D \u0432\u0438\u0431\u0440\u0430\u0446\u0438\u0438 \u0441\u0442\u0440\u0430\u0445\u0430.", /*#__PURE__*/React.createElement("br", null), "\u042D\u0442\u0430\u043F\u044B \u043E\u0442\u043A\u0440\u044B\u0432\u0430\u044E\u0442\u0441\u044F \u043F\u043E\u0441\u043B\u0435\u0434\u043E\u0432\u0430\u0442\u0435\u043B\u044C\u043D\u043E."), /*#__PURE__*/React.createElement("p", {
    style: {
      fontFamily: "'Lora', serif",
      fontStyle: 'italic',
      fontSize: 16.5,
      lineHeight: 1.7,
      color: C.kostMuted,
      maxWidth: '44ch',
      marginBottom: 36
    }
  }, "\u0417\u043E\u043B\u043E\u0442\u043E\u0435 \u0420\u0443\u043D\u043E \u2014 \u0442\u0432\u043E\u0451 \u0441\u043A\u0440\u044B\u0442\u043E\u0435 \u0415\u0441\u0442\u0435\u0441\u0442\u0432\u043E, \u043A\u043E\u0442\u043E\u0440\u043E\u0435, \u0437\u0430\u0433\u043E\u0440\u0430\u044F\u0441\u044C, \u043C\u0435\u043D\u044F\u0435\u0442 \u0432\u0441\u0451.")), /*#__PURE__*/React.createElement(FadeSection, {
    delay: 180
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
      marginBottom: 16
    }
  }, FEARS.map((f, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 14,
      padding: '13px 16px',
      borderRadius: 6,
      border: `1px solid ${C.frameDeep}`,
      background: C.surface,
      opacity: 1 - i * 0.16
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: "13",
    height: "13",
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: C.stone,
    strokeWidth: "1.3",
    style: {
      flexShrink: 0
    }
  }, /*#__PURE__*/React.createElement("rect", {
    x: "3",
    y: "7",
    width: "10",
    height: "7",
    rx: "1.2"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M5 7V5a3 3 0 0 1 6 0v2"
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "'Onest', sans-serif",
      fontSize: 12.5,
      letterSpacing: 0.5,
      color: C.kostMuted,
      filter: i > 1 ? 'blur(0.4px)' : 'none'
    }
  }, f), /*#__PURE__*/React.createElement("span", {
    style: {
      marginLeft: 'auto',
      fontFamily: "'Onest', sans-serif",
      fontSize: 9.5,
      letterSpacing: 2,
      textTransform: 'uppercase',
      color: C.stone
    }
  }, "\u0417\u0430\u043A\u0440\u044B\u0442\u043E"))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 14,
      marginTop: 6,
      padding: '15px 16px',
      borderRadius: 6,
      border: '1px solid rgba(194,154,72,0.4)',
      background: 'linear-gradient(120deg, rgba(194,154,72,0.1), rgba(194,154,72,0.02))',
      boxShadow: 'inset 0 0 30px rgba(194,154,72,0.08)'
    }
  }, /*#__PURE__*/React.createElement(StarSpark, {
    size: 14,
    color: C.zolotoYar,
    style: {
      flexShrink: 0
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "'Prata', serif",
      fontSize: 16,
      color: C.zolotoYar
    }
  }, "\u0417\u043E\u043B\u043E\u0442\u043E\u0435 \u0420\u0443\u043D\u043E"), /*#__PURE__*/React.createElement("span", {
    style: {
      marginLeft: 'auto',
      fontFamily: "'Onest', sans-serif",
      fontSize: 9.5,
      letterSpacing: 2,
      textTransform: 'uppercase',
      color: C.latun
    }
  }, "\u0422\u0432\u043E\u0451 \u0434\u0435\u043B\u043E")))), /*#__PURE__*/React.createElement(FadeSection, {
    delay: 240
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => scrollTo('expedition'),
    style: {
      ...btnPrimary,
      marginTop: 24,
      background: C.zoloto,
      color: '#0B0E0C'
    },
    onMouseEnter: e => e.currentTarget.style.background = C.zolotoYar,
    onMouseLeave: e => e.currentTarget.style.background = C.zoloto
  }, "\u0417\u0430\u043F\u0438\u0441\u0430\u0442\u044C\u0441\u044F \u043D\u0430 \u0431\u043E\u0440\u0442"))))));
};
Object.assign(window, {
  ManifestoSection,
  KartaSection,
  CHAPTERS
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/argonautika_web/Sections2.jsx", error: String((e && e.message) || e) }); }

// ui_kits/argonautika_web/Sections3.jsx
try { (() => {
// Sections3.jsx — Аргонавтика · Экспедиция (заявка, регистр A) · Footer

// ─── ЭКСПЕДИЦИЯ — ЗАЯВКА (Register A · gold on black) ─────────────────────────
const ExpeditionSection = () => {
  const [val, setVal] = useState('');
  const [sent, setSent] = useState(false);
  const [glowRef, glowOffset] = useParallax(0.08);
  const submit = () => {
    if (val.trim()) setSent(true);
  };
  return /*#__PURE__*/React.createElement("section", {
    id: "expedition",
    "data-screen-label": "\u042D\u043A\u0441\u043F\u0435\u0434\u0438\u0446\u0438\u044F",
    style: {
      background: C.tishina,
      position: 'relative',
      overflow: 'hidden',
      padding: 'clamp(88px,12vw,160px) clamp(22px,6vw,80px)',
      borderTop: '1px solid rgba(194,154,72,0.16)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      top: '-10%',
      left: '50%',
      transform: 'translateX(-50%)',
      width: 'min(900px, 90vw)',
      height: 600,
      zIndex: 0,
      background: 'radial-gradient(ellipse at center, rgba(194,154,72,0.10), transparent 65%)'
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative',
      zIndex: 1,
      maxWidth: 720,
      margin: '0 auto',
      textAlign: 'center'
    }
  }, /*#__PURE__*/React.createElement(FadeSection, null, /*#__PURE__*/React.createElement(MeanderRule, {
    strength: "strong",
    opacity: 0.55,
    style: {
      marginBottom: 44
    }
  })), /*#__PURE__*/React.createElement(FadeSection, {
    delay: 80
  }, /*#__PURE__*/React.createElement(SecLabel, {
    num: "04",
    text: "\u042D\u043A\u0441\u043F\u0435\u0434\u0438\u0446\u0438\u044F",
    color: C.latun,
    accent: C.zoloto,
    style: {
      justifyContent: 'center'
    }
  })), /*#__PURE__*/React.createElement(FadeSection, {
    delay: 140,
    y: 22
  }, /*#__PURE__*/React.createElement("figure", {
    ref: glowRef,
    style: {
      margin: '0 auto 40px',
      width: 'clamp(260px,40vw,420px)',
      transform: `translateY(${glowOffset}px)`,
      filter: 'drop-shadow(0 0 70px rgba(194,154,72,0.22))'
    }
  }, /*#__PURE__*/React.createElement("img", {
    src: MEDIA.argoBoat,
    alt: "\u0410\u0440\u0433\u043E \u2014 \u043A\u043E\u0440\u0430\u0431\u043B\u044C",
    style: {
      width: '100%',
      display: 'block',
      aspectRatio: '3 / 2',
      objectFit: 'contain'
    }
  }))), /*#__PURE__*/React.createElement(FadeSection, {
    delay: 220
  }, /*#__PURE__*/React.createElement("h2", {
    style: {
      fontFamily: "'Prata', serif",
      fontWeight: 400,
      fontSize: 'clamp(30px,4.6vw,56px)',
      lineHeight: 1.1,
      color: C.kostYar,
      letterSpacing: '-0.01em',
      margin: '0 auto 30px',
      maxWidth: '14ch'
    }
  }, "\u042D\u043A\u0441\u043F\u0435\u0434\u0438\u0446\u0438\u044F \u043F\u043E\u0441\u044B\u043B\u0430\u043D\u0438\u044F ", /*#__PURE__*/React.createElement("span", {
    style: {
      color: C.zolotoYar
    }
  }, "\u043D\u0430\xA0\u0445\u0435\u0440"), ".")), /*#__PURE__*/React.createElement(FadeSection, {
    delay: 300
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      fontFamily: "'Lora', serif",
      fontSize: 'clamp(16px,1.9vw,19px)',
      lineHeight: 1.78,
      color: C.kostDim,
      margin: '0 auto 18px',
      maxWidth: '50ch'
    }
  }, "\u0413\u0435\u0440\u043E\u0439 \u0432\u0441\u0442\u0440\u0435\u0447\u0430\u0435\u0442 \u0447\u0443\u0434\u0438\u0449\u0435 \u0438 \u043F\u043E\u0441\u044B\u043B\u0430\u0435\u0442 \u0435\u0433\u043E \u043D\u0430\u0445\u0435\u0440."), /*#__PURE__*/React.createElement("p", {
    style: {
      fontFamily: "'Lora', serif",
      fontStyle: 'italic',
      fontSize: 17,
      lineHeight: 1.7,
      color: C.kostMuted,
      margin: '0 auto 48px',
      maxWidth: '40ch'
    }
  }, "\u041E\u0441\u0442\u0430\u0432\u044C \u0437\u0430\u044F\u0432\u043A\u0443 \u2014 \u043A\u0442\u043E \u0442\u044B \u0438 \u0432 \u043A\u0430\u043A\u043E\u0439 \u0442\u043E\u0447\u043A\u0435 \u043D\u0430\u0445\u043E\u0434\u0438\u0448\u044C\u0441\u044F; \u043C\u044B \u0441\u0432\u044F\u0436\u0435\u043C\u0441\u044F \u0441 \u0442\u043E\u0431\u043E\u0439 \u0438 \u0441\u043E\u043E\u0431\u0449\u0438\u043C \u043A\u0430\u043A \u043F\u043E\u043F\u0430\u0441\u0442\u044C \u043D\u0430 \u0431\u043E\u0440\u0442.")), /*#__PURE__*/React.createElement(FadeSection, {
    delay: 380
  }, sent ? /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 480,
      margin: '0 auto',
      padding: '40px 32px',
      borderRadius: 8,
      border: '1px solid rgba(194,154,72,0.4)',
      background: 'linear-gradient(160deg, rgba(194,154,72,0.08), rgba(194,154,72,0.01))',
      boxShadow: 'inset 0 0 50px rgba(194,154,72,0.08)'
    }
  }, /*#__PURE__*/React.createElement(StarSpark, {
    size: 20,
    color: C.zolotoYar,
    style: {
      marginBottom: 18
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "'Prata', serif",
      fontSize: 22,
      color: C.kostYar,
      marginBottom: 10
    }
  }, "\u0417\u0430\u044F\u0432\u043A\u0430 \u043F\u0440\u0438\u043D\u044F\u0442\u0430."), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "'Lora', serif",
      fontStyle: 'italic',
      fontSize: 15.5,
      color: C.kostMuted,
      lineHeight: 1.6
    }
  }, "\u0421\u0432\u044F\u0436\u0435\u043C\u0441\u044F, \u043A\u043E\u0433\u0434\u0430 \u042D\u043A\u0441\u043F\u0435\u0434\u0438\u0446\u0438\u044F \u043E\u0442\u043A\u0440\u043E\u0435\u0442\u0441\u044F. \u0422\u044B \u2014 \u0441\u0440\u0435\u0434\u0438 \u041F\u0435\u0440\u0432\u044B\u0445.")) : /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 480,
      margin: '0 auto'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "exp-form",
    style: {
      display: 'flex',
      gap: 0
    }
  }, /*#__PURE__*/React.createElement("input", {
    type: "text",
    value: val,
    onChange: e => setVal(e.target.value),
    onKeyDown: e => {
      if (e.key === 'Enter') submit();
    },
    placeholder: "e-mail / telegram",
    style: {
      flex: 1,
      fontFamily: "'Onest', sans-serif",
      fontSize: 14,
      color: C.kostYar,
      background: 'rgba(255,255,255,0.02)',
      border: `1px solid ${C.frameDeep}`,
      borderRight: 'none',
      borderRadius: '6px 0 0 6px',
      padding: '15px 18px',
      outline: 'none',
      caretColor: C.zoloto
    },
    onFocus: e => e.currentTarget.style.borderColor = 'rgba(194,154,72,0.55)',
    onBlur: e => e.currentTarget.style.borderColor = C.frameDeep
  }), /*#__PURE__*/React.createElement("button", {
    onClick: submit,
    style: {
      fontFamily: "'Onest', sans-serif",
      fontSize: 12.5,
      fontWeight: 600,
      letterSpacing: 1,
      textTransform: 'uppercase',
      padding: '15px 26px',
      background: C.zoloto,
      color: '#0B0E0C',
      border: 'none',
      borderRadius: '0 6px 6px 0',
      cursor: 'pointer',
      whiteSpace: 'nowrap',
      transition: 'background 220ms ease'
    },
    onMouseEnter: e => e.currentTarget.style.background = C.zolotoYar,
    onMouseLeave: e => e.currentTarget.style.background = C.zoloto
  }, "\u0412\u0441\u0442\u0430\u0442\u044C \u0432 \u0441\u0442\u0440\u043E\u0439 \u043F\u0435\u0440\u0432\u044B\u0445")), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "'Onest', sans-serif",
      fontSize: 10.5,
      letterSpacing: 1,
      color: C.stone,
      marginTop: 14
    }
  }, "\u0417\u0430\u044F\u0432\u043A\u0430 = \u043F\u0440\u0435\u0434\u0432\u0430\u0440\u0438\u0442\u0435\u043B\u044C\u043D\u044B\u0439 \u043E\u0442\u0431\u043E\u0440. \u041D\u0435 \u0433\u0430\u0440\u0430\u043D\u0442\u0438\u0440\u0443\u0435\u0442 \u0443\u0447\u0430\u0441\u0442\u0438\u044F.")))));
};

// ─── FOOTER (Register A crest) ───────────────────────────────────────────────
const Footer = () => /*#__PURE__*/React.createElement("footer", {
  style: {
    background: C.tishina,
    borderTop: '1px solid rgba(194,154,72,0.16)',
    padding: 'clamp(44px,6vw,64px) clamp(22px,6vw,80px) 40px'
  }
}, /*#__PURE__*/React.createElement("div", {
  style: {
    maxWidth: 1100,
    margin: '0 auto'
  }
}, /*#__PURE__*/React.createElement(MeanderRule, {
  opacity: 0.3,
  style: {
    marginBottom: 40
  }
}), /*#__PURE__*/React.createElement("div", {
  className: "footer-row",
  style: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 28,
    flexWrap: 'wrap'
  }
}, /*#__PURE__*/React.createElement("div", {
  style: {
    display: 'flex',
    alignItems: 'center',
    gap: 13
  }
}, /*#__PURE__*/React.createElement("img", {
  src: MEDIA.monogram,
  alt: "\u0410\u0440\u0433\u043E\u043D\u0430\u0432\u0442\u0438\u043A\u0430",
  style: {
    height: 30,
    width: 'auto',
    filter: 'invert(1)',
    opacity: 0.7
  }
}), /*#__PURE__*/React.createElement(WordMark, {
  size: 12,
  color: C.kostMuted,
  gap: 7,
  withStar: false
})), /*#__PURE__*/React.createElement("div", {
  style: {
    display: 'flex',
    gap: 'clamp(20px,4vw,40px)',
    flexWrap: 'wrap',
    alignItems: 'center'
  }
}, /*#__PURE__*/React.createElement("a", {
  href: "https://t.me/argonautica_systems",
  target: "_blank",
  rel: "noopener",
  style: {
    fontFamily: "'Onest', sans-serif",
    fontSize: 11.5,
    letterSpacing: 1,
    color: C.kostMuted,
    textDecoration: 'none',
    transition: 'color 200ms ease'
  },
  onMouseEnter: e => e.currentTarget.style.color = C.zolotoYar,
  onMouseLeave: e => e.currentTarget.style.color = C.kostMuted
}, "t.me/argonautica_systems"), /*#__PURE__*/React.createElement("span", {
  style: {
    fontFamily: "'Onest', sans-serif",
    fontSize: 11.5,
    letterSpacing: 1,
    color: C.ghost
  }
}, "\u0410\u0440\u0433\u0430\u0442"))), /*#__PURE__*/React.createElement("div", {
  style: {
    marginTop: 30,
    fontFamily: "'Onest', sans-serif",
    fontSize: 10,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: C.stone
  }
}, "MMXXVI \xB7 \u0421\u0418\u0421\u0422\u0415\u041C\u0410 \u041F\u0420\u041E\u042F\u0412\u041B\u0415\u041D\u0418\u042F \u0414\u041B\u042F \u041B\u042E\u0414\u0415\u0419 \u0421 \u041C\u0418\u0421\u0421\u0418\u0415\u0419")));
Object.assign(window, {
  ExpeditionSection,
  Footer
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/argonautika_web/Sections3.jsx", error: String((e && e.message) || e) }); }

// ui_kits/argonautika_web/Shared.jsx
try { (() => {
// Shared.jsx — Аргонавтика Design System
// Tokens, base components, utilities, glyphs, parallax.
// Exports to window: C, StarSpark, FadeSection, SecLabel, Hairline, scrollTo,
//                    WordMark, MovementGlyph, MeanderRule, useParallax, MEDIA

const {
  useState,
  useEffect,
  useRef,
  useCallback,
  useLayoutEffect
} = React;

// ─── COLOR TOKENS ───────────────────────────────────────────────────────────
const argonautikaColors = {
  bezdna: '#0B100E',
  // абзацный фон
  tishina: '#000000',
  // чистая чернота / тишина
  more: '#134E45',
  // море
  moreGlub: '#0E342E',
  // море·глубь
  kost: '#E9E2D4',
  // текст / пена / кость
  kostYar: '#F4F1E9',
  // кость·ярь
  kostDim: '#C7C0B1',
  kostMuted: '#9A9486',
  ghost: '#6A665B',
  stone: '#4F4B42',
  zoloto: '#C29A48',
  // золото
  zolotoYar: '#D9B45A',
  // золото·ярь
  latun: '#9C7A33',
  // латунь
  krov: '#8E2018',
  // кровь
  krovYar: '#B23A2E',
  // кровь·ярь
  kamen: '#6E6A5E',
  kamenTepl: '#8A8478',
  frame: '#1C211E',
  frameDeep: '#2C322E',
  surface: '#0C100F'
};
const C = argonautikaColors;
const MEDIA = {
  sea: 'media/sea.jpg',
  seaShip: 'media/sea_ship.jpg',
  argoLine: 'media/argo_lineart.jpg',
  monogram: 'media/monogram.png',
  argoShip: 'media/argo_ship.png',
  argoBoat: 'media/argo_boat.png',
  thread: 'media/thread.jpg',
  sword: 'media/sword.jpg',
  rings: 'media/rings.jpg',
  ascension: 'media/ascension.jpg',
  helmet: 'media/helmet_meander.jpg',
  vase: 'media/argonaut_vase.jpg'
};

// ─── STAR SPARK ─────────────────────────────────────────────────────────────
const StarSpark = ({
  size = 12,
  color = C.zoloto,
  style
}) => /*#__PURE__*/React.createElement("svg", {
  width: size,
  height: size,
  viewBox: "-11 -11 22 22",
  style: {
    display: 'inline-block',
    flexShrink: 0,
    verticalAlign: 'middle',
    ...style
  }
}, /*#__PURE__*/React.createElement("path", {
  d: "M0,-10 C1.5,-3 3,-1.5 10,0 C3,1.5 1.5,3 0,10 C-1.5,3 -3,1.5 -10,0 C-3,-1.5 -1.5,-3 0,-10 Z",
  fill: color
}));

// ─── WORDMARK — «АРГОНАВТИКА» (T1 placeholder, Prata) ────────────────────────
const WordMark = ({
  text = 'АРГОНАВТИКА',
  size = 13,
  color = C.kostDim,
  gap = 6,
  withStar = true,
  starColor = C.zoloto,
  style
}) => /*#__PURE__*/React.createElement("span", {
  style: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap,
    fontFamily: "'Prata', serif",
    fontSize: size,
    letterSpacing: Math.max(2, size * 0.32),
    textTransform: 'uppercase',
    color,
    lineHeight: 1.4,
    textAlign: 'center',
    flexWrap: 'wrap',
    ...style
  }
}, withStar && /*#__PURE__*/React.createElement(StarSpark, {
  size: size * 0.72,
  color: starColor
}), text);

// ─── THREE MOVEMENT GLYPHS — Явь / Навь / Правь ──────────────────────────────
// kind: 'yav' (crosshair, в точку), 'nav' (sphere+descent, внутри точки),
//       'prav' (radiant burst, из точки)
const MovementGlyph = ({
  kind = 'yav',
  size = 40,
  color = C.kost
}) => {
  const s = {
    display: 'block'
  };
  if (kind === 'yav') {
    return /*#__PURE__*/React.createElement("svg", {
      width: size,
      height: size,
      viewBox: "-24 -24 48 48",
      style: s,
      fill: "none",
      stroke: color,
      strokeWidth: "1.1"
    }, /*#__PURE__*/React.createElement("circle", {
      cx: "0",
      cy: "0",
      r: "17",
      opacity: "0.75"
    }), /*#__PURE__*/React.createElement("line", {
      x1: "-22",
      y1: "0",
      x2: "22",
      y2: "0",
      opacity: "0.55"
    }), /*#__PURE__*/React.createElement("line", {
      x1: "0",
      y1: "-22",
      x2: "0",
      y2: "22",
      opacity: "0.55"
    }), /*#__PURE__*/React.createElement("circle", {
      cx: "0",
      cy: "0",
      r: "2.4",
      fill: color,
      stroke: "none"
    }));
  }
  if (kind === 'nav') {
    return /*#__PURE__*/React.createElement("svg", {
      width: size,
      height: size,
      viewBox: "-24 -24 48 48",
      style: s,
      fill: "none",
      stroke: color,
      strokeWidth: "1.1"
    }, /*#__PURE__*/React.createElement("circle", {
      cx: "0",
      cy: "-3",
      r: "14",
      stroke: color,
      opacity: "0.85"
    }), /*#__PURE__*/React.createElement("path", {
      d: "M0,-3 C5,-3 5,3 0,3 C-5,3 -5,-3 0,-3 Z",
      fill: color,
      stroke: "none",
      opacity: "0.9"
    }), /*#__PURE__*/React.createElement("line", {
      x1: "0",
      y1: "11",
      x2: "0",
      y2: "20",
      opacity: "0.6"
    }), /*#__PURE__*/React.createElement("circle", {
      cx: "0",
      cy: "20",
      r: "1.6",
      fill: color,
      stroke: "none"
    }));
  }
  // prav — radiant burst from a star
  return /*#__PURE__*/React.createElement("svg", {
    width: size,
    height: size,
    viewBox: "-24 -24 48 48",
    style: s,
    fill: "none",
    stroke: color,
    strokeWidth: "1.1"
  }, [0, 45, 90, 135, 180, 225, 270, 315].map(a => {
    const r = a % 90 === 0 ? 21 : 14;
    const rad = a * Math.PI / 180;
    return /*#__PURE__*/React.createElement("line", {
      key: a,
      x1: Math.cos(rad) * 5,
      y1: Math.sin(rad) * 5,
      x2: Math.cos(rad) * r,
      y2: Math.sin(rad) * r,
      opacity: a % 90 === 0 ? 0.85 : 0.4
    });
  }), /*#__PURE__*/React.createElement("path", {
    d: "M0,-7 C1,-2 2,-1 7,0 C2,1 1,2 0,7 C-1,2 -2,1 -7,0 C-2,-1 -1,-2 0,-7 Z",
    fill: color,
    stroke: "none"
  }));
};

// ─── FADE ON SCROLL ──────────────────────────────────────────────────────────
const FadeSection = ({
  children,
  delay = 0,
  y = 28,
  style,
  className
}) => {
  const ref = useRef(null);
  const reduceMotion = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const [visible, setVisible] = useState(reduceMotion);
  useEffect(() => {
    if (reduceMotion) {
      setVisible(true);
      return;
    }
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
    const onScroll = () => {
      if (inView()) reveal();
    };
    function cleanup() {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    }

    // Reveal immediately if in view; otherwise watch scroll/resize.
    if (inView()) {
      reveal();
    } else {
      window.addEventListener('scroll', onScroll, {
        passive: true
      });
      window.addEventListener('resize', onScroll);
      // Re-check across the next few frames in case layout/fonts settle late.
      requestAnimationFrame(() => {
        if (!revealed && inView()) reveal();
      });
      setTimeout(() => {
        if (!revealed && inView()) reveal();
      }, 250);
    }
    // Safety net: never let content stay hidden if scroll never fires.
    const fallback = setTimeout(reveal, 1500 + delay);
    return () => {
      cleanup();
      if (timer) clearTimeout(timer);
      clearTimeout(fallback);
    };
  }, [delay]);
  return /*#__PURE__*/React.createElement("div", {
    ref: ref,
    className: className,
    style: {
      opacity: visible ? 1 : 0,
      transform: visible ? 'translateY(0)' : `translateY(${y}px)`,
      transition: 'opacity 1.1s cubic-bezier(.22,.61,.36,1), transform 1.1s cubic-bezier(.22,.61,.36,1)',
      willChange: 'opacity, transform',
      ...style
    }
  }, children);
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
      const progress = (rect.top + rect.height / 2 - vh / 2) / vh;
      setOffset(progress * speed * vh);
    };
    const onScroll = () => {
      if (raf == null) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', onScroll, {
      passive: true
    });
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
const SecLabel = ({
  num,
  text,
  color = C.ghost,
  accent = C.latun,
  style
}) => /*#__PURE__*/React.createElement("div", {
  style: {
    fontFamily: "'Onest', sans-serif",
    fontSize: 11,
    fontWeight: 500,
    letterSpacing: 3.5,
    textTransform: 'uppercase',
    color,
    marginBottom: 30,
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    ...style
  }
}, /*#__PURE__*/React.createElement("span", {
  style: {
    color: accent
  }
}, num), /*#__PURE__*/React.createElement("span", {
  style: {
    width: 22,
    height: 1,
    background: `${accent}`,
    opacity: 0.5
  }
}), /*#__PURE__*/React.createElement("span", null, text));

// ─── GOLD HAIRLINE ───────────────────────────────────────────────────────────
const Hairline = ({
  strength = 'soft',
  style
}) => /*#__PURE__*/React.createElement("div", {
  style: {
    borderTop: `1px solid rgba(194,154,72,${strength === 'strong' ? 0.42 : strength === 'faint' ? 0.1 : 0.2})`,
    ...style
  }
});

// ─── MEANDER RULE — greek-key gold divider (Register A) ──────────────────────
const MeanderRule = ({
  color = C.zoloto,
  opacity = 0.5,
  height = 12,
  style
}) => /*#__PURE__*/React.createElement("div", {
  style: {
    display: 'flex',
    alignItems: 'center',
    gap: 14,
    ...style
  }
}, /*#__PURE__*/React.createElement("div", {
  style: {
    flex: 1,
    borderTop: `1px solid ${color}`,
    opacity: opacity * 0.5
  }
}), /*#__PURE__*/React.createElement("svg", {
  width: "78",
  height: height,
  viewBox: "0 0 78 12",
  style: {
    opacity,
    flexShrink: 0
  },
  fill: "none",
  stroke: color,
  strokeWidth: "1"
}, /*#__PURE__*/React.createElement("path", {
  d: "M1,11 V4 H8 V8 H5 V6 M14,11 V4 H21 V8 H18 V6 M27,11 V4 H34 V8 H31 V6 M40,11 V4 H47 V8 H44 V6 M53,11 V4 H60 V8 H57 V6 M66,11 V4 H73 V8 H70 V6"
})), /*#__PURE__*/React.createElement("div", {
  style: {
    flex: 1,
    borderTop: `1px solid ${color}`,
    opacity: opacity * 0.5
  }
}));

// ─── SMOOTH SCROLL HELPER ────────────────────────────────────────────────────
const scrollTo = (id, offset = 64) => {
  const el = document.getElementById(id);
  if (!el) return;
  const top = el.getBoundingClientRect().top + window.scrollY - offset;
  window.scrollTo({
    top,
    behavior: 'smooth'
  });
};

// Export all shared items
Object.assign(window, {
  argonautikaColors,
  C,
  MEDIA,
  StarSpark,
  WordMark,
  MovementGlyph,
  FadeSection,
  SecLabel,
  Hairline,
  MeanderRule,
  scrollTo,
  useParallax,
  useState,
  useEffect,
  useRef,
  useCallback,
  useLayoutEffect
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/argonautika_web/Shared.jsx", error: String((e && e.message) || e) }); }

})();
