import { useState } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import Navbar from "@/components/layout/Navbar";
import AuthModal from "@/components/layout/AuthModal";
import SkipLink from "@/components/layout/SkipLink";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/context/AuthContext";
import { Sparkles, ArrowRight, Radar, Mic, Columns3, KeyRound, ChevronDown } from "lucide-react";

// Landing page copy is verbatim from the UI & Copy Craft Pack §4 — the
// strings are the deliverable; don't reword them here.
const FEATURES = [
  {
    icon: Radar,
    eyebrow: "Live Trend Radar",
    title: "Find the trend before it's old news.",
    body: "IdeaForge runs live research in your niche and returns trend cards with real source URLs and freshness labels. No scraped repost library, no recycled hot takes.",
    proof: "Your radar reads the live web on your own API key — the same search you could run yourself, scored for post-worthiness.",
  },
  {
    icon: Mic,
    eyebrow: "Voice DNA",
    title: "Drafts that sound like you wrote them.",
    body: "Paste a few of your own past posts. IdeaForge learns your structure, vocabulary, and energy, then conditions every draft on it.",
    proof: "Voice is learned from the posts you paste in — your words, your cadence. Not a persona, not a preset.",
  },
  {
    icon: Columns3,
    eyebrow: "Real Variants",
    title: "Three angles, one idea — compare and pick.",
    body: "Generate genuinely different takes on the same idea — distinct hooks, distinct energy — and pick the one worth finishing.",
    proof: "Variants differ on purpose: each is generated with its own angle and hook, so comparing them is a real decision.",
  },
  {
    icon: KeyRound,
    eyebrow: "Byok Pricing",
    title: "Your keys. Your bill. No subscription.",
    body: "IdeaForge charges no AI subscription. Research and drafting run on your OpenAI, Anthropic, and Tavily keys, billed only by those providers.",
    proof: "Connect your keys once; every draft is created inside your own provider account.",
  },
];

const HOW_IT_WORKS = [
  {
    title: "Connect your keys.",
    body: "Paste your OpenAI, Anthropic, and Tavily API keys in Settings. They're encrypted and used only for your account.",
  },
  {
    title: "Run your radar.",
    body: "Pick a niche. IdeaForge researches what's moving right now and scores the angles worth posting.",
  },
  {
    title: "Forge, compare, post.",
    body: "Get scored ideas, generate drafts in your voice, compare variants, copy the winner, and post it yourself.",
  },
];

const FAQ = [
  {
    q: "Can't a subscription be simpler than three API keys?",
    a: "A subscription is simpler — and you pay for it every month whether you draft twice or two hundred times. Your API keys mean the provider bills you exactly for what you use.",
  },
  {
    q: "What happens if I run out of API credit mid-draft?",
    a: "The draft stops and tells you which provider is out, with a link to that provider's billing page. Nothing is saved and nothing is charged twice.",
  },
  {
    q: "What does IdeaForge see in my drafts?",
    a: "Whatever you run through it. The draft you paste is stored so you can come back to it; LinkedIn itself is never read — we don't log into your account, ever.",
  },
  {
    q: "Do I still own the posts?",
    a: "Yes, completely. IdeaForge drafts, you finish and post. Nothing is published automatically.",
  },
  {
    q: "Can it really sound like me?",
    a: "Voice DNA learns from posts you paste in. It's grounded in your actual writing, not a generic persona.",
  },
  {
    q: "What if a trend turns out to be wrong or outdated?",
    a: "Every trend card shows its source and when it was found. If a source looks stale, skip the idea — the radar makes staleness visible instead of hiding it.",
  },
];

const REPO_URL = "https://github.com/nihanthnaidu007/IdeaForge";

// Landing page. The navbar and auth modal are shared components; the page
// composes them and owns only its hero/marketing content (§4 of the pack).
const LandingPage = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState("login");

  const openAuth = (mode) => {
    setAuthMode(mode);
    setAuthOpen(true);
  };

  const handleGetStarted = () => {
    if (user) {
      navigate("/dashboard");
    } else {
      // §4.2: the primary CTA lands on the Register tab.
      openAuth("signup");
    }
  };

  const landingNav = (
    <div className="hidden md:flex items-center gap-6 text-sm text-zinc-400">
      <a href="#how-it-works" className="hover:text-white transition-colors">How it works</a>
      <a href="#pricing" className="hover:text-white transition-colors">Pricing</a>
      <a href="#faq" className="hover:text-white transition-colors">FAQ</a>
    </div>
  );

  return (
    <div className="min-h-screen bg-void gradient-mesh overflow-hidden">
      {/* §7.4: skip link is the first tab stop */}
      <SkipLink />
      <Navbar onRequireAuth={openAuth} center={landingNav} />

      {/* Hero Section — §4.2 */}
      <section className="pt-32 pb-20 px-6">
        <div className="max-w-5xl mx-auto text-left">
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-xs uppercase tracking-[0.2em] text-zinc-400 font-mono mb-6"
          >
            Live Trend Intelligence for LinkedIn
          </motion.p>

          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="font-heading text-5xl md:text-7xl font-bold text-white leading-tight mb-6"
          >
            Catch the trend while it&apos;s{" "}
            <span className="text-lime">still a trend.</span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="text-lg md:text-xl text-zinc-400 max-w-2xl mb-10"
          >
            IdeaForge watches the live Tech and AI web, scores the angles worth posting, and drafts
            LinkedIn posts in your actual voice — every claim sourced, every draft yours to finish.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="flex flex-col sm:flex-row gap-4 items-start"
          >
            <Button
              size="lg"
              onClick={handleGetStarted}
              data-testid="hero-cta-btn"
              className="bg-lime text-void hover:bg-lime-hover btn-glow text-lg px-8 py-6"
            >
              Start with your own keys
              <ArrowRight className="ml-2 w-5 h-5" aria-hidden="true" />
            </Button>
            <Button
              size="lg"
              variant="ghost"
              onClick={() => document.getElementById("how-it-works")?.scrollIntoView({ behavior: "smooth" })}
              data-testid="hero-secondary-cta-btn"
              className="text-white hover:bg-white/5 text-lg px-8 py-6"
            >
              See how it works
            </Button>
          </motion.div>
          <p className="text-sm text-zinc-400 mt-6">
            No subscription. No credit packs. Bring your own API keys and pay the providers directly.
          </p>
        </div>
      </section>

      {/* Feature blocks — §4.3 */}
      <section className="py-16 px-6">
        <div className="max-w-6xl mx-auto grid md:grid-cols-2 gap-6">
          {FEATURES.map((feature, index) => (
            <motion.div
              key={feature.eyebrow}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: index * 0.05 }}
              className="glass-card rounded-xl p-8 card-hover flex flex-col"
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-lg bg-lime/10 flex items-center justify-center">
                  <feature.icon className="w-5 h-5 text-lime" aria-hidden="true" />
                </div>
                <span className="text-xs uppercase tracking-[0.2em] text-zinc-400 font-mono">
                  {feature.eyebrow}
                </span>
              </div>
              <h3 className="font-heading text-xl font-semibold text-white mb-3">{feature.title}</h3>
              <p className="text-zinc-400 text-sm leading-relaxed mb-4">{feature.body}</p>
              <p className="text-zinc-400 text-sm leading-relaxed mt-auto border-t border-white/5 pt-4">
                {feature.proof}
              </p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* How it works — §4.4 */}
      <section id="how-it-works" className="py-20 px-6 scroll-mt-20">
        <div className="max-w-6xl mx-auto">
          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="font-heading text-3xl md:text-4xl font-bold text-white mb-12"
          >
            How it works
          </motion.h2>

          <div className="grid md:grid-cols-3 gap-6">
            {HOW_IT_WORKS.map((item, index) => (
              <motion.div
                key={item.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.1 }}
                className="glass-card rounded-xl p-6 card-hover"
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="w-12 h-12 rounded-lg bg-lime/10 flex items-center justify-center font-heading font-bold text-lime">
                    {index + 1}
                  </div>
                  <span className="text-4xl font-heading font-bold text-white/10">
                    0{index + 1}
                  </span>
                </div>
                <h3 className="font-heading text-xl font-semibold text-white mb-2">{item.title}</h3>
                <p className="text-zinc-400 text-sm leading-relaxed">{item.body}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing — §4.5 */}
      <section id="pricing" className="py-20 px-6 scroll-mt-20">
        <div className="max-w-4xl mx-auto glass-card rounded-2xl p-10">
          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="font-heading text-3xl md:text-4xl font-bold text-white mb-6"
          >
            What it costs.
          </motion.h2>
          <p className="text-zinc-400 mb-4 max-w-2xl">
            There is no IdeaForge subscription. You bring your own API keys — OpenAI or Anthropic
            for drafting, Tavily for research — and the providers bill you directly for what you
            use. A typical month of drafting costs less than a coffee, on your plan, with no
            markup.
          </p>
          <p className="text-zinc-400 max-w-2xl">
            IdeaForge itself is self-hosted and open source: the cost of the product is the time it
            takes you to run it.
          </p>
          <p className="text-sm text-zinc-400 mt-6">
            The trade: you create three API keys once. We think keeping your bill at provider price
            is worth three sign-up forms.
          </p>
        </div>
      </section>

      {/* FAQ — §4.6 */}
      <section id="faq" className="py-20 px-6 scroll-mt-20">
        <div className="max-w-3xl mx-auto">
          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="font-heading text-3xl md:text-4xl font-bold text-white mb-12"
          >
            FAQ
          </motion.h2>
          <div className="space-y-3">
            {FAQ.map((item) => (
              <details
                key={item.q}
                data-testid="faq-item"
                className="glass-card rounded-xl group"
              >
                <summary className="flex items-center justify-between gap-4 px-6 py-4 cursor-pointer text-white font-medium list-none">
                  {item.q}
                  <ChevronDown
                    className="w-4 h-4 text-zinc-400 group-open:rotate-180 transition-transform flex-shrink-0"
                    aria-hidden="true"
                  />
                </summary>
                <p className="px-6 pb-5 text-zinc-400 text-sm leading-relaxed">{item.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* Bottom CTA — honest restatement of the hero offer */}
      <section className="py-20 px-6">
        <div className="max-w-4xl mx-auto text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="glass-card rounded-2xl p-12"
          >
            <h2 className="font-heading text-3xl md:text-4xl font-bold text-white mb-4">
              Catch the trend while it&apos;s still a trend.
            </h2>
            <p className="text-zinc-400 mb-8 max-w-xl mx-auto">
              Bring your own keys and pay the providers directly — no subscription, no credit packs.
            </p>
            <Button
              size="lg"
              onClick={handleGetStarted}
              data-testid="cta-btn"
              className="bg-lime text-void hover:bg-lime-hover btn-glow text-lg px-8 py-6"
            >
              Start with your own keys
              <ArrowRight className="ml-2 w-5 h-5" aria-hidden="true" />
            </Button>
          </motion.div>
        </div>
      </section>

      {/* Footer — §4.7 */}
      <footer className="border-t border-white/5 py-10 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-lime" aria-hidden="true" />
              <span className="font-heading font-semibold text-white">IdeaForge</span>
            </div>
            <p className="text-sm text-zinc-400 max-w-md">
              IdeaForge — live trend intelligence for LinkedIn, priced as your keys, not your
              subscription.
            </p>
            <div className="flex flex-wrap items-center gap-4 text-sm text-zinc-400">
              <a href="#how-it-works" className="hover:text-white transition-colors">How it works</a>
              <a href="#pricing" className="hover:text-white transition-colors">Pricing</a>
              <a href="#faq" className="hover:text-white transition-colors">FAQ</a>
              <a
                href={`${REPO_URL}/blob/main/SECURITY.md`}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-white transition-colors"
              >
                Security policy
              </a>
              <a
                href={`${REPO_URL}/blob/main/docs/operator-guide.md`}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-white transition-colors"
              >
                Self-hosting guide
              </a>
              <a
                href={REPO_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-white transition-colors"
              >
                GitHub
              </a>
            </div>
          </div>
          <p className="text-xs text-zinc-400 mt-6">
            Not affiliated with LinkedIn. IdeaForge never posts, likes, or scrapes on your behalf.
          </p>
        </div>
      </footer>

      {/* Shared auth modal — one instance, every entry point */}
      <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} initialMode={authMode} />
    </div>
  );
};

export default LandingPage;
