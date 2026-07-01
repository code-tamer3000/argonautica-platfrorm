// App.jsx — Аргонавтика · сайт-манифест (единый кинематографичный скролл)

const App = () => {
  const [activeSection, setActiveSection] = useState('hero');

  useEffect(() => {
    const sections = ['hero', 'about', 'manifesto', 'karta', 'expedition'];
    const observers = sections.map(id => {
      const el = document.getElementById(id);
      if (!el) return null;
      const obs = new IntersectionObserver(
        ([entry]) => { if (entry.isIntersecting) setActiveSection(id); },
        { threshold: 0.001, rootMargin: '-45% 0px -45% 0px' }
      );
      obs.observe(el);
      return obs;
    }).filter(Boolean);
    return () => observers.forEach(o => o.disconnect());
  }, []);

  return (
    <div style={{ background: C.bezdna, minHeight: '100vh' }}>
      <Header activeSection={activeSection} />
      <main>
        <HeroSection />
        <AboutSection />
        <ManifestoSection />
        <KartaSection />
        <ExpeditionSection />
      </main>
      <Footer />
    </div>
  );
};

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
