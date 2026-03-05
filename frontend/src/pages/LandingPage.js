import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../App";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Search, Star, PenTool, Sparkles, ArrowRight, Zap, Target, TrendingUp } from "lucide-react";

const LandingPage = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [isLogin, setIsLogin] = useState(true);

  const handleGetStarted = () => {
    if (user) {
      navigate("/dashboard");
    } else {
      setShowAuthModal(true);
    }
  };

  return (
    <div className="min-h-screen bg-void gradient-mesh overflow-hidden">
      {/* Navbar */}
      <nav className="fixed top-0 left-0 right-0 z-50 border-b border-white/5 bg-void/80 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="w-6 h-6 text-lime" />
            <span className="font-heading font-bold text-xl text-white">IdeaForge</span>
          </div>
          <div className="flex items-center gap-4">
            {user ? (
              <>
                <Button 
                  variant="ghost" 
                  onClick={() => navigate("/dashboard")}
                  data-testid="nav-dashboard-btn"
                  className="text-white/70 hover:text-white"
                >
                  Dashboard
                </Button>
                <Button 
                  onClick={() => navigate("/dashboard")}
                  data-testid="nav-get-started-btn"
                  className="bg-lime text-void hover:bg-lime-hover btn-glow"
                >
                  Open App
                </Button>
              </>
            ) : (
              <>
                <Button 
                  variant="ghost" 
                  onClick={() => { setIsLogin(true); setShowAuthModal(true); }}
                  data-testid="nav-login-btn"
                  className="text-white/70 hover:text-white"
                >
                  Sign In
                </Button>
                <Button 
                  onClick={() => { setIsLogin(false); setShowAuthModal(true); }}
                  data-testid="nav-signup-btn"
                  className="bg-lime text-void hover:bg-lime-hover btn-glow"
                >
                  Get Started
                </Button>
              </>
            )}
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="pt-32 pb-20 px-6">
        <div className="max-w-5xl mx-auto text-left">
          <motion.p 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-xs uppercase tracking-[0.2em] text-white/40 font-mono mb-6"
          >
            Powered by Tavily · Claude · GPT-5.2
          </motion.p>
          
          <motion.h1 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="font-heading text-5xl md:text-7xl font-bold text-white leading-tight mb-6"
          >
            Turn Today's Trends Into{" "}
            <span className="text-lime">Tomorrow's Viral Posts</span>
          </motion.h1>
          
          <motion.p 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="text-lg md:text-xl text-white/60 max-w-2xl mb-10"
          >
            IdeaForge scans live Tech & AI trends and generates LinkedIn post ideas 
            scored by viral potential — then writes the post for you.
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
              Start Generating Ideas
              <ArrowRight className="ml-2 w-5 h-5" />
            </Button>
            <p className="text-sm text-white/40 self-center">
              No credit card required · Free to start
            </p>
          </motion.div>
        </div>
      </section>

      {/* Feature Pills */}
      <section className="py-8 px-6">
        <div className="max-w-5xl mx-auto">
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4 }}
            className="flex flex-wrap gap-4"
          >
            {[
              { icon: Search, text: "Live Trend Research" },
              { icon: Star, text: "AI-Scored Ideas" },
              { icon: PenTool, text: "Human-Sounding Posts" }
            ].map((item, index) => (
              <div 
                key={index}
                className="flex items-center gap-2 px-4 py-2 rounded-full border border-white/10 bg-white/5"
              >
                <item.icon className="w-4 h-4 text-lime" />
                <span className="text-sm text-white/80">{item.text}</span>
              </div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-20 px-6">
        <div className="max-w-6xl mx-auto">
          <motion.h2 
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="font-heading text-3xl md:text-4xl font-bold text-white mb-12"
          >
            How It Works
          </motion.h2>
          
          <div className="grid md:grid-cols-3 gap-6">
            {[
              {
                icon: TrendingUp,
                step: "01",
                title: "Generate Ideas",
                description: "Tavily scans Reddit, Google trends, and tech news in real time to find what's hot right now."
              },
              {
                icon: Target,
                step: "02",
                title: "Pick Your Idea",
                description: "Each idea is rated and explained. Expand for full audience insights and strategic angles."
              },
              {
                icon: Zap,
                step: "03",
                title: "Craft Your Post",
                description: "Choose a format, add instructions, get a post ready to publish that sounds 100% human."
              }
            ].map((item, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.1 }}
                className="glass-card rounded-xl p-6 card-hover"
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="w-12 h-12 rounded-lg bg-lime/10 flex items-center justify-center">
                    <item.icon className="w-6 h-6 text-lime" />
                  </div>
                  <span className="text-4xl font-heading font-bold text-white/10">{item.step}</span>
                </div>
                <h3 className="font-heading text-xl font-semibold text-white mb-2">{item.title}</h3>
                <p className="text-white/50 text-sm leading-relaxed">{item.description}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 px-6">
        <div className="max-w-4xl mx-auto text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="glass-card rounded-2xl p-12"
          >
            <h2 className="font-heading text-3xl md:text-4xl font-bold text-white mb-4">
              Ready to Create Content That Converts?
            </h2>
            <p className="text-white/50 mb-8 max-w-xl mx-auto">
              Join thousands of professionals using IdeaForge to stay ahead of trends 
              and create engaging LinkedIn content.
            </p>
            <Button 
              size="lg"
              onClick={handleGetStarted}
              data-testid="cta-btn"
              className="bg-lime text-void hover:bg-lime-hover btn-glow text-lg px-8 py-6"
            >
              Start for Free
              <ArrowRight className="ml-2 w-5 h-5" />
            </Button>
          </motion.div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/5 py-8 px-6">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-lime" />
            <span className="font-heading font-semibold text-white">IdeaForge</span>
          </div>
          <p className="text-sm text-white/40">Trend-Powered LinkedIn Intelligence</p>
        </div>
      </footer>

      {/* Auth Modal */}
      <AuthModal 
        open={showAuthModal} 
        onClose={() => setShowAuthModal(false)}
        isLogin={isLogin}
        setIsLogin={setIsLogin}
      />
    </div>
  );
};

const AuthModal = ({ open, onClose, isLogin, setIsLogin }) => {
  const { login, register } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      if (isLogin) {
        await login(email, password);
      } else {
        await register(email, password, name);
      }
      onClose();
      navigate("/dashboard");
    } catch (err) {
      setError(err.response?.data?.detail || "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="bg-deep border-white/10 max-w-md">
        <DialogHeader>
          <DialogTitle className="font-heading text-2xl text-white">
            {isLogin ? "Sign in to IdeaForge" : "Create your account"}
          </DialogTitle>
        </DialogHeader>
        
        <form onSubmit={handleSubmit} className="space-y-4 mt-4">
          {!isLogin && (
            <div>
              <label className="text-sm text-white/60 mb-1 block">Name</label>
              <Input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                data-testid="auth-name-input"
                placeholder="Your name"
                className="bg-void border-white/10 text-white"
              />
            </div>
          )}
          
          <div>
            <label className="text-sm text-white/60 mb-1 block">Email</label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              data-testid="auth-email-input"
              placeholder="you@example.com"
              className="bg-void border-white/10 text-white"
              required
            />
          </div>
          
          <div>
            <label className="text-sm text-white/60 mb-1 block">Password</label>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              data-testid="auth-password-input"
              placeholder="••••••••"
              className="bg-void border-white/10 text-white"
              required
            />
          </div>
          
          {error && (
            <p className="text-red-400 text-sm">{error}</p>
          )}
          
          <Button 
            type="submit" 
            disabled={loading}
            data-testid="auth-submit-btn"
            className="w-full bg-lime text-void hover:bg-lime-hover"
          >
            {loading ? "Loading..." : (isLogin ? "Sign In" : "Create Account")}
          </Button>
          
          <p className="text-center text-sm text-white/50">
            {isLogin ? "Don't have an account?" : "Already have an account?"}{" "}
            <button
              type="button"
              onClick={() => setIsLogin(!isLogin)}
              className="text-lime hover:underline"
            >
              {isLogin ? "Sign up" : "Sign in"}
            </button>
          </p>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default LandingPage;
