// Sections2.jsx — Аргонавтика · Манифест (книга) · Карта (тизер напряжения)

// ─── MANIFESTO CHAPTERS (excerpts from the real Manifesto) ───────────────────
const CHAPTERS = [
  { num: 'I', title: 'Архитектура симуляции',
    body: 'Мы живём в цифровой симуляции. Это фундаментальная рабочая предпосылка — не метафора. Задача аргонавта — научиться различать живое от неживого. Различать за тысячу шагов: чувствовать, знать и быть готовым ещё до того, как неживое на тебя бросится.',
    pull: 'Различать живое от неживого. За тысячу шагов.' },
  { num: 'IV', title: 'Вертикаль и горизонтали',
    body: 'Пока Ядро не собрано — невозможно участвовать в собственных событийных рядах. Человек включается в чужие игры, созданные другими сценаристами. Первичная задача аргонавта — освободить внимание из внешних горизонтальных игр и сфокусироваться на уплотнении своего Ядра.',
    hard: 'Одиночество — титановая оболочка Ядра.' },
  { num: 'V', title: 'Вещество Матрицы',
    body: 'Матрица ни в коем случае не враг. Воевать с матрицей — сон безумца. Аргонавт понимает принципы её работы и лепит из неё свою великую действительность. Намерение → Сопротивление → Рождение — абсолютная закономерность, работающая как часы.',
    pull: 'Матрица — это пластилин в руках аргонавта.',
    hard: 'Бояться пиздеца — значит отказываться от великих дел.' },
  { num: 'VI', title: 'Мир — зеркало',
    body: 'Ты принял твёрдое решение, Матрица приняла его к исполнению. Но проходит время, ты смотришь в зеркало — а там всё как прежде, и бросаешь начатое на полпути. Физика инертна. Матрица материализует с задержкой; её инерцию нужно воспринимать как благо.',
    pull: 'Аргонавтика начинается, когда ты разбиваешь зеркало.' },
  { num: 'VIII', title: 'Ловушка окружения',
    body: 'Матрица не выключает тебя сразу — она действует через постепенное усыпление. Аргонавт видит вовлекающие ловушки и даже среди людей не теряет состояния трезвого одиночества. Самые сильные проверки часто приходят через близких.',
    hard: 'Отсутствие врагов — признак посредственности человека.' },
  { num: 'IX', title: 'Правило бинера',
    body: 'Энергия вырабатывается на разнице потенциалов. Свет и тьма, день и ночь, напряжение и расслабление. Чем глубже вхождение в тишину и недеяние — тем больше энергии действия черпается из бездонного источника. Аргонавт ловит и держит Баланс.',
    pull: 'Энергия вырабатывается на разнице потенциалов.' },
  { num: 'XIV', title: 'Необходимость действовать',
    body: 'Аргонавт идёт своим путём — он активирует Бездеятеля: того, кто создаёт импульс, из которого рождается действие. Мы встаём в точку, из которой возникает Намерение, и держимся там, пока оно не станет плотным. Намерение → Импульс → Действие.' },
  { num: 'XV', title: 'Оживление',
    body: 'Пробуждение и Просветление — не финал. За ними есть третий этап. Оживление — интеграция всех знаний в жизнь, разворачивание реальности из точки баланса. Аргонавт — человек, активирующий живые структуры.',
    pull: 'Пробуждение — не финал. Есть третий этап: Оживление.' },
  { num: 'XVIII', title: 'Перезагрузка системы 64-х',
    body: 'Здесь всё начинается с чистого импульса. После — всегда Проверка от системы, плодородная Тень. Именно здесь ты опускаешь руки. Ты не слабый — ты просто не знаешь механизма. Проходя плотность Тени, Ядро Намерения укрепляется, и ты обретаешь Дар.',
    pull: 'Сиддхи → Тень → Дар.' },
  { num: 'XXIII', title: 'Карта Аргонавтики',
    body: 'Карта собирает твоё внимание, чтобы ты дошёл. На ней — состояния, что держат тебя; этапы, открывающиеся по одному; и Золотое Руно как пламя, которое, загораясь, меняет всё.' },
];

const ManifestoSection = () => {
  const [active, setActive] = useState(0);
  const ch = CHAPTERS[active];

  return (
    <section id="manifesto" data-screen-label="Манифест" style={{
      background: C.tishina,
      padding: 'clamp(98px,12vw,172px) clamp(22px,6vw,80px)',
      borderTop: '1px solid rgba(194,154,72,0.1)',
    }}>
      <div style={{ maxWidth: 1120, margin: '0 auto' }}>
        <FadeSection>
          <SecLabel num="02" text="Манифест" />
          <h2 style={{
            fontFamily: "'Prata', serif", fontWeight: 400,
            fontSize: 'clamp(26px,3.4vw,40px)', lineHeight: 1.2, color: C.kostYar,
            maxWidth: '16ch', marginBottom: 18,
          }}>Точка притяжения. Выжимка сути.</h2>
          <p style={{
            fontFamily: "'Lora', serif", fontStyle: 'italic', fontSize: 17, lineHeight: 1.7,
            color: C.kostMuted, maxWidth: '54ch', marginBottom: 'clamp(40px,6vw,64px)',
          }}>
            Манифест — ледяной отрезвляющий душ. Двадцать четыре главы, набранные как серьёзная книга.
            Здесь — только верхушка айсберга.
          </p>
        </FadeSection>

        <div className="manifesto-grid" style={{
          display: 'grid', gridTemplateColumns: '54px 210px 1fr', gap: 'clamp(28px,4vw,56px)', alignItems: 'start',
        }}>
          {/* Gold thread (Ariadne) — connector */}
          <div className="thread-rail" style={{
            alignSelf: 'stretch', borderRadius: 6, overflow: 'hidden', minHeight: 460,
            border: '1px solid rgba(194,154,72,0.18)', position: 'relative',
          }}>
            <img src={MEDIA.thread} alt="Золотая нить Ариадны"
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', opacity: 0.85 }} />
            <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to bottom, rgba(0,0,0,0.35), transparent 30%, transparent 70%, rgba(0,0,0,0.45))' }} />
          </div>

          {/* Chapter nav */}
          <nav className="ch-nav">
            <div style={{
              fontFamily: "'Onest', sans-serif", fontSize: 10, fontWeight: 500, letterSpacing: 3,
              textTransform: 'uppercase', color: C.ghost, marginBottom: 18,
            }}>I — XXIV · Главы</div>
            {CHAPTERS.map((c, i) => (
              <button key={i} onClick={() => setActive(i)} style={{
                display: 'flex', alignItems: 'baseline', gap: 12, width: '100%',
                background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer',
                padding: '12px 0', borderBottom: `1px solid rgba(194,154,72,${active === i ? 0.4 : 0.1})`,
                transition: 'border-color 220ms ease',
              }}>
                <span style={{
                  fontFamily: "'Onest', sans-serif", fontSize: 10.5, fontWeight: 600, letterSpacing: 1,
                  color: active === i ? C.zolotoYar : C.stone, width: 38, flexShrink: 0,
                }}>{c.num}</span>
                <span style={{
                  fontFamily: "'Prata', serif", fontSize: 13.5, lineHeight: 1.3,
                  color: active === i ? C.kostYar : C.kostMuted, transition: 'color 220ms ease',
                }}>{c.title}</span>
              </button>
            ))}
            <div style={{ marginTop: 16, fontFamily: "'Onest', sans-serif", fontSize: 10, letterSpacing: 2, color: C.stone }}>
              · · · и далее до XXIV
            </div>
          </nav>

          {/* Reading pane — book mode */}
          <article key={active} className="reader-fade" style={{ maxWidth: '62ch', paddingTop: 4 }}>
            <div style={{
              fontFamily: "'Onest', sans-serif", fontSize: 11, fontWeight: 600, letterSpacing: 3,
              textTransform: 'uppercase', color: C.latun, marginBottom: 14,
              display: 'flex', alignItems: 'center', gap: 10,
            }}>
              <StarSpark size={9} color={C.zoloto} />Глава {ch.num}
            </div>
            <h3 style={{
              fontFamily: "'Prata', serif", fontWeight: 400, fontSize: 'clamp(24px,3vw,36px)',
              lineHeight: 1.22, color: C.kostYar, marginBottom: 26,
            }}>{ch.title}</h3>
            <Hairline strength="soft" style={{ marginBottom: 30 }} />

            <p style={{
              fontFamily: "'Lora', serif", fontSize: 18, lineHeight: 1.85, color: C.kostDim,
              marginBottom: ch.pull || ch.hard ? 30 : 0,
            }}>{ch.body}</p>

            {ch.pull && (
              <blockquote style={{ margin: '0 0 30px', display: 'flex', gap: 16 }}>
                <StarSpark size={12} color={C.zoloto} style={{ marginTop: 14, flexShrink: 0 }} />
                <p style={{
                  fontFamily: "'Prata', serif", fontWeight: 400, fontSize: 'clamp(20px,2.4vw,28px)',
                  lineHeight: 1.34, color: C.kostYar, margin: 0,
                }}>{ch.pull}</p>
              </blockquote>
            )}

            {ch.hard && (
              <p style={{
                fontFamily: "'Onest', sans-serif", fontWeight: 600, fontSize: 'clamp(14px,1.6vw,17px)',
                letterSpacing: 0.5, color: C.krovYar, lineHeight: 1.5, margin: '0 0 30px',
                paddingLeft: 18, borderLeft: `2px solid ${C.krov}`,
              }}>{ch.hard}</p>
            )}

            <div style={{ display: 'flex', alignItems: 'center', gap: 26, marginTop: 38, flexWrap: 'wrap' }}>
              <button onClick={() => setActive(i => Math.min(i + 1, CHAPTERS.length - 1))}
                disabled={active >= CHAPTERS.length - 1}
                style={{
                  fontFamily: "'Onest', sans-serif", fontSize: 11.5, fontWeight: 500, letterSpacing: 2,
                  textTransform: 'uppercase', color: active >= CHAPTERS.length - 1 ? C.stone : C.kostMuted,
                  background: 'none', border: 'none', padding: 0,
                  cursor: active >= CHAPTERS.length - 1 ? 'default' : 'pointer', transition: 'color 200ms ease',
                }}
                onMouseEnter={e => { if (active < CHAPTERS.length - 1) e.currentTarget.style.color = C.kostYar; }}
                onMouseLeave={e => { if (active < CHAPTERS.length - 1) e.currentTarget.style.color = C.kostMuted; }}
              >Следующая глава →</button>
              <a href="manifest.html" style={{
                fontFamily: "'Onest', sans-serif", fontSize: 11.5, fontWeight: 600, letterSpacing: 1.5,
                textTransform: 'uppercase', color: C.zolotoYar, textDecoration: 'none',
                borderBottom: '1px solid rgba(217,180,90,0.4)', paddingBottom: 2,
              }}>Читать целиком</a>
            </div>
          </article>
        </div>

        {/* Explicit transition to application */}
        <FadeSection delay={80}>
          <div style={{
            marginTop: 'clamp(64px,9vw,110px)', textAlign: 'center',
            paddingTop: 'clamp(40px,6vw,64px)', borderTop: '1px solid rgba(194,154,72,0.14)',
          }}>
            <p style={{
              fontFamily: "'Lora', serif", fontStyle: 'italic', fontSize: 'clamp(17px,2vw,21px)',
              lineHeight: 1.6, color: C.kostMuted, maxWidth: '54ch', margin: '0 auto 26px',
            }}>Если после Манифеста ты почувствовал ледяной огонь, значит твой внутренний фитобоярин зашевелился. Ты готов идти дальше.<br />Если нет — найди себе другое сообщество.</p>
            <button onClick={() => scrollTo('expedition')} style={{
              ...btnGhost, borderColor: 'rgba(194,154,72,0.4)', color: C.kostDim,
            }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = C.zoloto; e.currentTarget.style.color = C.kostYar; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(194,154,72,0.4)'; e.currentTarget.style.color = C.kostDim; }}
            >Перейти к Экспедиции ↓</button>
          </div>
        </FadeSection>
      </div>
    </section>
  );
};

// ─── КАРТА МИРОВ — ВЕРТИКАЛЬНАЯ КОСМОЛОГИЯ ───────────────────────────────────
// Слоистое изображение: бордовая атмосфера (растр) + векторная структура поверх.
// Три зоны по вертикали — каждая ОТДЕЛЬНАЯ группа [data-world-zone] для будущей
// анимации наведения в Claude Code (наведение проявляет зону, остальное → полуразмытие).
// В Claude Design — статичный плейсхолдер с лёгким hover-намёком (чистый CSS).

// — Лучи Прави (свет, из которого исходишь) —
const PravRays = () => {
  const rays = [];
  const n = 26;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const x = 60 + t * 1080;
    rays.push(<line key={i} x1="600" y1="-60" x2={x} y2="320"
      stroke="url(#pravRay)" strokeWidth={i % 2 ? 0.8 : 1.4} />);
  }
  return (
    <svg viewBox="0 0 1200 320" preserveAspectRatio="xMidYMin slice" aria-hidden="true"
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
      <defs>
        <linearGradient id="pravRay" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={C.zolotoYar} stopOpacity="0.55" />
          <stop offset="100%" stopColor={C.zolotoYar} stopOpacity="0" />
        </linearGradient>
      </defs>
      {rays}
    </svg>
  );
};

// — Горы-завеса между мирами —
const MountainVeil = ({ flip, opacity = 1 }) => (
  <svg viewBox="0 0 1200 120" preserveAspectRatio="none" aria-hidden="true"
    style={{
      position: 'absolute', left: 0, right: 0, width: '100%', height: 'clamp(70px,9vw,120px)',
      transform: flip ? 'scaleY(-1)' : 'none', opacity, pointerEvents: 'none',
    }}>
    <path d="M0,120 L0,70 L80,84 L160,46 L250,78 L340,30 L430,70 L520,40 L610,80 L700,34 L790,72 L880,44 L980,78 L1080,52 L1160,82 L1200,60 L1200,120 Z"
      fill="#10070A" stroke="rgba(194,154,72,0.22)" strokeWidth="1" />
    <path d="M0,120 L0,96 L120,104 L230,80 L340,100 L450,72 L560,98 L680,76 L800,100 L920,82 L1040,102 L1160,86 L1200,100 L1200,120 Z"
      fill="#060406" opacity="0.92" />
  </svg>
);

// — Солнце Яви в точке баланса (золото + зелень) —
const YavSun = ({ size = 'clamp(150px,22vw,250px)' }) => (
  <svg viewBox="-130 -130 260 260" aria-hidden="true" style={{ width: size, height: 'auto', aspectRatio: '1 / 1', display: 'block', flexShrink: 0 }}>
    <defs>
      <radialGradient id="yavCore" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stopColor="#E9D9A6" />
        <stop offset="34%" stopColor={C.zolotoYar} />
        <stop offset="68%" stopColor="#1E7A56" />
        <stop offset="100%" stopColor="#0E342E" />
      </radialGradient>
      <radialGradient id="yavGlow" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stopColor={C.zolotoYar} stopOpacity="0.4" />
        <stop offset="100%" stopColor={C.zolotoYar} stopOpacity="0" />
      </radialGradient>
    </defs>
    <circle r="125" fill="url(#yavGlow)" />
    <circle r="108" fill="none" stroke={C.zoloto} strokeWidth="0.8" opacity="0.45" />
    <circle r="84" fill="none" stroke={C.zoloto} strokeWidth="1" opacity="0.7" />
    <circle r="58" fill="url(#yavCore)" />
    <circle r="58" fill="none" stroke={C.zolotoYar} strokeWidth="1.4" />
    <g>
      <path d="M0,-13 C2,-4 4,-2 13,0 C4,2 2,4 0,13 C-2,4 -4,2 -13,0 C-4,-2 -2,-4 0,-13 Z"
        fill="#F4F1E9" />
    </g>
  </svg>
);

// — Портал-арка Нави (кровь / тьма) —
const NavPortal = ({ w = 'clamp(180px,26vw,300px)' }) => (
  <svg viewBox="0 0 300 280" aria-hidden="true" style={{ width: w, height: 'auto', display: 'block' }}>
    <defs>
      <linearGradient id="navThresh" x1="0" y1="1" x2="0" y2="0">
        <stop offset="0%" stopColor={C.krov} stopOpacity="0.55" />
        <stop offset="55%" stopColor="#3a0d0a" stopOpacity="0.5" />
        <stop offset="100%" stopColor="#05080699" stopOpacity="0" />
      </linearGradient>
    </defs>
    <path d="M44,280 L44,134 A106,106 0 0 1 256,134 L256,280 Z" fill="url(#navThresh)" />
    <path d="M44,280 L44,134 A106,106 0 0 1 256,134 L256,280" fill="none"
      stroke={C.krovYar} strokeWidth="1.4" opacity="0.75" />
    <path d="M74,280 L74,150 A76,76 0 0 1 226,150 L226,280" fill="none"
      stroke={C.krov} strokeWidth="1" opacity="0.5" />
  </svg>
);

// — Подпись зоны —
const ZoneLabel = ({ pos, name, sub, desc, color }) => (
  <div style={{
    textAlign: 'center', position: 'relative', zIndex: 3,
    padding: '0 24px', maxWidth: 560,
  }}>
    <div style={{
      fontFamily: "'Onest', sans-serif", fontSize: 10.5, fontWeight: 600, letterSpacing: 4,
      textTransform: 'uppercase', color: C.ghost, marginBottom: 12,
    }}>{pos}</div>
    <div style={{
      fontFamily: "'Prata', serif", fontSize: 'clamp(34px,5.5vw,64px)', lineHeight: 1,
      color, letterSpacing: '0.02em', marginBottom: 14,
      textShadow: '0 2px 30px rgba(0,0,0,0.6)',
    }}>{name}</div>
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 9,
      fontFamily: "'Onest', sans-serif", fontSize: 11.5, fontWeight: 500, letterSpacing: 2.5,
      textTransform: 'uppercase', color: C.kostMuted, marginBottom: 16,
    }}>
      <StarSpark size={8} color={color} />{sub}
    </div>
    <p style={{
      fontFamily: "'Lora', serif", fontStyle: 'italic', fontSize: 'clamp(14.5px,1.6vw,17px)',
      lineHeight: 1.65, color: C.kostDim, margin: '0 auto', maxWidth: '34ch',
    }}>{desc}</p>
  </div>
);

const KartaSection = () => {
  const [atmosRef, atmosOffset] = useParallax(0.08);
  return (
    <section id="karta" data-screen-label="Карта" style={{
      background: C.bezdna, position: 'relative', overflow: 'hidden',
      padding: 'clamp(98px,12vw,172px) 0 clamp(90px,11vw,150px)',
      borderTop: '1px solid rgba(194,154,72,0.08)',
    }}>
      {/* ── Section head ── */}
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '0 clamp(22px,6vw,80px)' }}>
        <FadeSection>
          <SecLabel num="03" text="Карта миров" />
          <h2 style={{
            fontFamily: "'Prata', serif", fontWeight: 400, fontSize: 'clamp(28px,3.6vw,46px)',
            lineHeight: 1.16, color: C.kostYar, maxWidth: '15ch', marginBottom: 20,
          }}>Три мира по вертикали.</h2>
          <p style={{
            fontFamily: "'Lora', serif", fontSize: 17.5, lineHeight: 1.78, color: C.kostDim,
            maxWidth: '52ch',
          }}>
            Карта собирает твоё внимание, чтобы ты дошёл. Путь идёт по оси: вниз — за самой
            большой силой, в точку баланса, и оттуда — наверх, в проявленность.
            Золотое Руно — твоё скрытое Естество, которое, загораясь, меняет всё.
          </p>
        </FadeSection>
      </div>

      {/* ── Full-bleed vertical World Map slot (layered placeholder) ── */}
      <FadeSection delay={120} y={28}>
        <div className="world-map-slot" style={{
          position: 'relative', width: '100%', minHeight: '100svh',
          margin: 'clamp(48px,7vw,88px) 0 clamp(40px,6vw,72px)',
          overflow: 'hidden',
          borderTop: '1px solid rgba(194,154,72,0.14)',
          borderBottom: '1px solid rgba(194,154,72,0.14)',
          display: 'flex', flexDirection: 'column',
          background: C.tishina,
        }}>
          {/* Layer 1 — burgundy atmosphere (raster, to be replaced) */}
          <div ref={atmosRef} style={{
            position: 'absolute', inset: '-8% 0', zIndex: 0,
            backgroundImage: `url('${MEDIA.worldsMap}')`,
            backgroundSize: 'cover', backgroundPosition: 'center top',
            transform: `translateY(${atmosOffset}px) scale(1.06)`,
            opacity: 0.5,
          }} />
          {/* tone overlay — gold(Правь) → balance(Явь) → blood+dark(Навь) */}
          <div style={{
            position: 'absolute', inset: 0, zIndex: 1,
            background: 'linear-gradient(to bottom, rgba(194,154,72,0.16) 0%, rgba(11,16,14,0.42) 20%, rgba(11,16,14,0.22) 44%, rgba(11,16,14,0.5) 62%, rgba(142,32,24,0.42) 82%, rgba(5,7,6,0.94) 100%)',
          }} />

          {/* Layer 2 — vector structure: three interactive zones */}
          {/* ▲ ПРАВЬ — сияющая, полупрозрачная, золото */}
          <div className="world-zone" data-world-zone="prav" style={{
            position: 'relative', zIndex: 2, flex: '1 1 0',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            minHeight: '33svh', padding: 'clamp(40px,7vw,80px) 0',
          }}>
            <PravRays />
            <ZoneLabel pos="Верх" name="ПРАВЬ" sub="Сияние · Проявленность" color={C.zolotoYar}
              desc="Свет, из которого ты исходишь. Дело — в мир. Полупрозрачная, золотая высота." />
          </div>

          <div style={{ position: 'relative', zIndex: 2, height: 'clamp(70px,9vw,120px)' }}>
            <MountainVeil opacity={0.85} />
          </div>

          {/* ● ЯВЬ — солнце в точке баланса, фокус композиции */}
          <div className="world-zone" data-world-zone="yav" style={{
            position: 'relative', zIndex: 2, flex: '1 1 0',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            gap: 'clamp(20px,3vw,34px)', minHeight: '34svh', padding: 'clamp(30px,5vw,60px) 0',
          }}>
            <YavSun />
            <ZoneLabel pos="Центр" name="ЯВЬ" sub="Точка баланса" color={C.zolotoYar}
              desc="Солнце на оси. Здесь держишь Баланс — между светом и тенью рождается энергия действия." />
          </div>

          <div style={{ position: 'relative', zIndex: 2, height: 'clamp(70px,9vw,120px)' }}>
            <MountainVeil flip opacity={0.9} />
          </div>

          {/* ▼ НАВЬ — тёмная, бордовая, портал-арка */}
          <div className="world-zone" data-world-zone="nav" style={{
            position: 'relative', zIndex: 2, flex: '1 1 0',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end',
            gap: 'clamp(18px,2.5vw,28px)', minHeight: '33svh', padding: 'clamp(40px,6vw,70px) 0 0',
          }}>
            <ZoneLabel pos="Низ" name="НАВЬ" sub="Глубина · Портал" color={C.krovYar}
              desc="Погружение за самой большой силой. Тьма — строительный материал, а не враг." />
            <NavPortal />
          </div>

          {/* Placeholder tag */}
          <div style={{
            position: 'absolute', top: 14, right: 14, zIndex: 4,
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '7px 12px', borderRadius: 5,
            background: 'rgba(5,7,6,0.7)', border: '1px solid rgba(194,154,72,0.24)',
            backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)',
          }}>
            <StarSpark size={9} color={C.latun} />
            <span style={{
              fontFamily: "'Onest', sans-serif", fontSize: 9.5, fontWeight: 500, letterSpacing: 1.5,
              textTransform: 'uppercase', color: C.kostMuted,
            }}>Плейсхолдер · карта будет заменена</span>
          </div>
          <div style={{
            position: 'absolute', bottom: 14, left: 16, zIndex: 4,
            fontFamily: "'Onest', sans-serif", fontSize: 9, letterSpacing: 1.2,
            textTransform: 'uppercase', color: C.stone, maxWidth: '60vw',
          }}>Слои: бордовая атмосфера (растр) + структура миров (вектор)</div>
        </div>
      </FadeSection>

      {/* ── Lower sub-block: учебное видео (после Манифеста) ── */}
      <div style={{ maxWidth: 920, margin: '0 auto', padding: 'clamp(40px,6vw,80px) clamp(22px,6vw,80px) 0' }}>
        <FadeSection>
          <div style={{
            textAlign: 'center', fontFamily: "'Onest', sans-serif", fontSize: 10.5, fontWeight: 600,
            letterSpacing: 3.5, textTransform: 'uppercase', color: C.latun, marginBottom: 'clamp(28px,4vw,44px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12,
          }}>
            <span style={{ width: 28, height: 1, background: C.latun, opacity: 0.4 }} />
            Короткое погружение с Аргатом
            <span style={{ width: 28, height: 1, background: C.latun, opacity: 0.4 }} />
          </div>
        </FadeSection>

        <FadeSection delay={120} y={22}>
          <button className="video-slot" aria-label="Воспроизвести видео" style={{
            position: 'relative', width: '100%', aspectRatio: '16 / 9', display: 'block',
            borderRadius: 10, overflow: 'hidden', cursor: 'pointer', padding: 0,
            background: 'radial-gradient(ellipse at center, #0E1411 0%, #060908 78%)',
            border: '1px solid rgba(194,154,72,0.28)',
            boxShadow: 'inset 0 0 80px rgba(0,0,0,0.6), 0 30px 80px rgba(0,0,0,0.4)',
          }}>
            {/* gold player ring */}
            <span style={{
              position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
              width: 'clamp(58px,8vw,80px)', height: 'clamp(58px,8vw,80px)', borderRadius: '50%',
              border: `1.5px solid ${C.zoloto}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 0 40px rgba(194,154,72,0.22), inset 0 0 24px rgba(194,154,72,0.1)',
              background: 'rgba(11,16,14,0.4)',
            }}>
              <span style={{
                width: 0, height: 0, marginLeft: 5,
                borderTop: 'clamp(9px,1.2vw,12px) solid transparent',
                borderBottom: 'clamp(9px,1.2vw,12px) solid transparent',
                borderLeft: `clamp(15px,2vw,20px) solid ${C.zolotoYar}`,
              }} />
            </span>
            <span style={{
              position: 'absolute', bottom: 16, left: 18,
              fontFamily: "'Onest', sans-serif", fontSize: 10, letterSpacing: 2,
              textTransform: 'uppercase', color: C.stone,
            }}>Видео-слот · 16:9</span>
          </button>
        </FadeSection>

        <FadeSection delay={200}>
          <figcaption style={{ textAlign: 'center', marginTop: 'clamp(26px,4vw,40px)' }}>
            <p style={{
              fontFamily: "'Prata', serif", fontWeight: 400, fontSize: 'clamp(19px,2.3vw,27px)',
              lineHeight: 1.32, color: C.kostYar, margin: '0 auto 18px', maxWidth: '24ch',
            }}>Как работают генные замки.</p>
            <p style={{
              fontFamily: "'Lora', serif", fontStyle: 'italic', fontSize: 'clamp(16px,1.9vw,20px)',
              lineHeight: 1.6, color: C.kostDim, margin: '0 auto', maxWidth: '30ch',
            }}>«Я есть свет. Я есть сам ключ — этим ключом отпираю тень.»</p>
          </figcaption>
        </FadeSection>
      </div>

      {/* ── Closing CTA → Экспедиция ── */}
      <FadeSection delay={120}>
        <div style={{ textAlign: 'center', marginTop: 'clamp(64px,9vw,110px)', padding: '0 24px' }}>
          <button onClick={() => scrollTo('expedition')} style={{
            ...btnPrimary, background: C.zoloto, color: '#0B0E0C',
          }}
            onMouseEnter={e => e.currentTarget.style.background = C.zolotoYar}
            onMouseLeave={e => e.currentTarget.style.background = C.zoloto}
          >Записаться на борт</button>
        </div>
      </FadeSection>
    </section>
  );
};

Object.assign(window, { ManifestoSection, KartaSection, CHAPTERS });
