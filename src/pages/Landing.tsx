import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { Database, MessageSquare, BarChart3, History, ArrowRight, Zap, Search, TrendingUp, ShieldCheck, ChevronRight } from 'lucide-react';

const FEATURES = [
  {
    icon: <MessageSquare className="h-5 w-5" />,
    title: 'Natural Language Queries',
    desc: 'Ask questions about your SAP data in plain English. AI translates them into precise SQL instantly.',
  },
  {
    icon: <Database className="h-5 w-5" />,
    title: 'Live SAP O2C Data',
    desc: 'Query real Order-to-Cash data spanning sales orders, deliveries, billing, payments, and more.',
  },
  {
    icon: <BarChart3 className="h-5 w-5" />,
    title: 'Instant Visualizations',
    desc: 'Results automatically rendered as bar, line, or pie charts — or as a sortable data table.',
  },
  {
    icon: <History className="h-5 w-5" />,
    title: 'Query History',
    desc: 'Every query is saved. Replay, review, or delete past queries from the persistent history panel.',
  },
];

const STEPS = [
  { num: '01', title: 'Ask a question', desc: 'Type a business question in plain language — no SQL knowledge required.' },
  { num: '02', title: 'AI generates SQL', desc: 'The AI selects the right tables, applies filters, and produces an optimized query.' },
  { num: '03', title: 'Explore the results', desc: 'View data as charts or tables. Drill down or refine your question instantly.' },
];

const ENTITIES = [
  'Sales Orders', 'Order Items', 'Schedule Lines', 'Outbound Deliveries',
  'Billing Documents', 'Payments', 'Business Partners', 'Products', 'Plants',
];

const stagger = {
  hidden: {},
  show: { transition: { staggerChildren: 0.12 } },
};
const fadeUp = {
  hidden: { opacity: 0, y: 30 },
  show: { opacity: 1, y: 0, transition: { duration: 0.6 } },
};

export default function Landing() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background text-foreground overflow-x-hidden">
      {/* Nav */}
      <nav className="fixed top-0 left-0 right-0 z-50 border-b border-border/50 bg-background/70 backdrop-blur-xl">
        <div className="max-w-6xl mx-auto flex items-center justify-between h-14 px-6">
          <div className="flex items-center gap-2.5">
            <div className="h-7 w-7 rounded-md bg-primary flex items-center justify-center">
              <Database className="h-3.5 w-3.5 text-primary-foreground" />
            </div>
            <span className="text-base font-semibold tracking-tight">SAP O2C Explorer</span>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate('/login')}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors hidden sm:block"
            >
              Sign In
            </button>
            <button
              onClick={() => navigate('/signup')}
              className="flex items-center gap-1.5 h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
            >
              Get Started <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative pt-32 pb-20 px-6">
        {/* Ambient light effects */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-20 left-1/4 w-[500px] h-[500px] rounded-full bg-primary/[0.04] blur-[100px]" />
          <div className="absolute bottom-0 right-1/4 w-[400px] h-[400px] rounded-full bg-accent/[0.03] blur-[80px]" />
        </div>

        <motion.div
          variants={stagger}
          initial="hidden"
          animate="show"
          className="relative max-w-3xl mx-auto text-center"
        >
          <motion.div variants={fadeUp} className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-primary/20 bg-primary/5 mb-8">
            <Zap className="h-3 w-3 text-primary" />
            <span className="text-xs font-mono text-primary tracking-wide">AI-POWERED SAP DATA EXPLORATION</span>
          </motion.div>

          <motion.h1 variants={fadeUp} className="text-5xl sm:text-6xl lg:text-7xl font-semibold leading-[1.08] tracking-tight mb-6">
            Query SAP data
            <br />
            <span className="text-primary">in plain language.</span>
          </motion.h1>

          <motion.p variants={fadeUp} className="text-lg text-muted-foreground max-w-xl mx-auto mb-10 leading-relaxed">
            Ask business questions about your Order-to-Cash data. AI converts them to SQL, runs them against live data, and renders the results as charts or tables — instantly.
          </motion.p>

          <motion.div variants={fadeUp} className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <button
              onClick={() => navigate('/signup')}
              className="flex items-center gap-2 h-12 px-8 rounded-xl bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-all hover:shadow-[0_0_30px_-5px_hsl(38_95%_60%_/_0.3)]"
            >
              <Search className="h-4 w-4" />
              Start Exploring
            </button>
            <button
              onClick={() => navigate('/login')}
              className="flex items-center gap-2 h-12 px-8 rounded-xl border border-border text-foreground hover:bg-muted transition-colors"
            >
              Sign In <ChevronRight className="h-4 w-4" />
            </button>
          </motion.div>
        </motion.div>

        {/* Mock UI Preview */}
        <motion.div
          initial={{ opacity: 0, y: 60 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.5 }}
          className="relative max-w-4xl mx-auto mt-20"
        >
          <div className="rounded-xl border border-border bg-card overflow-hidden shadow-2xl shadow-background/80">
            {/* Title bar */}
            <div className="flex items-center gap-2 px-4 py-3 border-b border-border bg-muted/30">
              <div className="flex gap-1.5">
                <div className="h-2.5 w-2.5 rounded-full bg-destructive/60" />
                <div className="h-2.5 w-2.5 rounded-full bg-primary/40" />
                <div className="h-2.5 w-2.5 rounded-full bg-accent/40" />
              </div>
              <span className="text-[10px] font-mono text-muted-foreground ml-2">SAP O2C Explorer · Data Explorer</span>
            </div>
            {/* Query mockup */}
            <div className="p-6 space-y-4">
              <div className="rounded-lg border border-border bg-background/60 px-4 py-3">
                <p className="text-sm font-mono text-muted-foreground/70">
                  <span className="text-primary">›</span> Show total revenue by customer for the last 30 days
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: 'GLOBAL TECH INC', val: '$284,500' },
                  { label: 'ACME CORP', val: '$197,200' },
                  { label: 'NEXUS SOLUTIONS', val: '$153,800' },
                  { label: 'VERTEX PARTNERS', val: '$98,400' },
                ].map((row) => (
                  <div key={row.label} className="flex items-center justify-between rounded-lg border border-border bg-muted/20 px-3 py-2">
                    <span className="text-[10px] font-mono text-muted-foreground truncate">{row.label}</span>
                    <span className="text-[10px] font-mono text-primary ml-2 shrink-0">{row.val}</span>
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                {['Bar Chart', 'Line', 'Table'].map((t, i) => (
                  <div
                    key={t}
                    className={`px-3 py-1 rounded-md text-[10px] font-mono border ${i === 0 ? 'border-primary/40 bg-primary/10 text-primary' : 'border-border text-muted-foreground/50'}`}
                  >
                    {t}
                  </div>
                ))}
              </div>
            </div>
          </div>
          {/* Glow under preview */}
          <div className="absolute -bottom-10 left-1/2 -translate-x-1/2 w-3/4 h-20 bg-primary/[0.06] rounded-full blur-[40px]" />
        </motion.div>
      </section>

      {/* Features */}
      <section className="py-24 px-6">
        <div className="max-w-5xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-16"
          >
            <h2 className="text-3xl sm:text-4xl font-semibold mb-4">
              Everything you need to
              <span className="text-primary"> understand your data</span>
            </h2>
            <p className="text-muted-foreground max-w-lg mx-auto">
              SAP O2C Explorer bridges the gap between raw ERP data and business insight — no SQL expertise required.
            </p>
          </motion.div>

          <motion.div
            variants={stagger}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true }}
            className="grid grid-cols-1 sm:grid-cols-2 gap-4"
          >
            {FEATURES.map((f, i) => (
              <motion.div
                key={i}
                variants={fadeUp}
                className="rounded-xl border border-border bg-card p-6 hover:border-primary/15 transition-colors group"
              >
                <div className="h-10 w-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center mb-4 group-hover:bg-primary/15 transition-colors">
                  {f.icon}
                </div>
                <h3 className="text-base font-semibold text-foreground mb-2">{f.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{f.desc}</p>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* Dataset coverage */}
      <section className="py-16 px-6 border-t border-border/50">
        <div className="max-w-4xl mx-auto text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <ShieldCheck className="h-7 w-7 text-primary mx-auto mb-4" />
            <h2 className="text-2xl sm:text-3xl font-semibold mb-3">
              Full O2C cycle coverage
            </h2>
            <p className="text-muted-foreground mb-8 max-w-md mx-auto text-sm">
              Query across all SAP Order-to-Cash entities with a single natural language prompt.
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {ENTITIES.map((e) => (
                <span
                  key={e}
                  className="px-3 py-1.5 rounded-full border border-border bg-muted/20 text-xs font-mono text-muted-foreground"
                >
                  {e}
                </span>
              ))}
            </div>
          </motion.div>
        </div>
      </section>

      {/* How it works */}
      <section className="py-24 px-6 border-t border-border/50">
        <div className="max-w-4xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-16"
          >
            <h2 className="text-3xl sm:text-4xl font-semibold mb-4">
              From question to
              <span className="text-primary"> insight in seconds</span>
            </h2>
          </motion.div>

          <motion.div
            variants={stagger}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true }}
            className="grid grid-cols-1 md:grid-cols-3 gap-8"
          >
            {STEPS.map((s, i) => (
              <motion.div key={i} variants={fadeUp} className="text-center md:text-left">
                <span className="text-4xl font-semibold text-primary/20 font-mono">{s.num}</span>
                <h3 className="text-lg font-semibold text-foreground mt-2 mb-2">{s.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{s.desc}</p>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-24 px-6">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="max-w-2xl mx-auto text-center"
        >
          <div className="rounded-2xl border border-primary/15 bg-primary/[0.03] p-12">
            <TrendingUp className="h-8 w-8 text-primary mx-auto mb-6" />
            <h2 className="text-3xl font-semibold mb-4">Ready to explore your data?</h2>
            <p className="text-muted-foreground mb-8 max-w-md mx-auto">
              Sign up for free and start querying your SAP Order-to-Cash data in plain language.
            </p>
            <button
              onClick={() => navigate('/signup')}
              className="inline-flex items-center gap-2 h-12 px-8 rounded-xl bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-all hover:shadow-[0_0_30px_-5px_hsl(38_95%_60%_/_0.3)]"
            >
              Get Started Free <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </motion.div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border/50 py-8 px-6">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="h-6 w-6 rounded-md bg-primary flex items-center justify-center">
              <Database className="h-3 w-3 text-primary-foreground" />
            </div>
            <span className="text-sm font-semibold">SAP O2C Explorer</span>
          </div>
          <p className="text-xs text-muted-foreground font-mono">
            © {new Date().getFullYear()} SAP O2C Explorer. Powered by AI.
          </p>
        </div>
      </footer>
    </div>
  );
}
