import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { ApiError } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

// Shared auth modal — extracted from the Landing page so every auth entry
// point (navbar sign-in, hero CTA, get-started) renders the same component.
const AuthModal = ({ open, onClose, initialMode = "login" }) => {
  const { login, register } = useAuth();
  const navigate = useNavigate();
  const [isLogin, setIsLogin] = useState(initialMode === "login");
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
      // ApiError carries the honest message from the fail-loud backend
      // (validation detail, rate limit, etc.); fall back for anything else.
      setError(err instanceof ApiError ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="bg-deep border-white/10 max-w-md" data-testid="auth-modal">
        <DialogHeader>
          <DialogTitle className="font-heading text-2xl text-white">
            {isLogin ? "Sign in to IdeaForge" : "Create your account"}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 mt-4">
          {!isLogin && (
            <div>
              <label htmlFor="auth-name" className="text-sm text-white/60 mb-1 block">Name</label>
              <Input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                id="auth-name" data-testid="auth-name-input"
                placeholder="Your name"
                className="bg-void border-white/10 text-white"
              />
            </div>
          )}

          <div>
            <label htmlFor="auth-email" className="text-sm text-white/60 mb-1 block">Email</label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              id="auth-email" data-testid="auth-email-input"
              placeholder="you@example.com"
              className="bg-void border-white/10 text-white"
              required
            />
          </div>

          <div>
            <label htmlFor="auth-password" className="text-sm text-white/60 mb-1 block">Password</label>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              id="auth-password" data-testid="auth-password-input"
              placeholder="••••••••"
              className="bg-void border-white/10 text-white"
              required
            />
          </div>

          {error && (
            <p data-testid="auth-error" className="text-red-400 text-sm">
              {error}
            </p>
          )}

          <Button
            type="submit"
            disabled={loading}
            data-testid="auth-submit-btn"
            className="w-full bg-lime text-void hover:bg-lime-hover"
          >
            {loading ? "Loading..." : isLogin ? "Sign In" : "Create Account"}
          </Button>

          <p className="text-center text-sm text-white/50">
            {isLogin ? "Don't have an account?" : "Already have an account?"}{" "}
            <button
              type="button"
              onClick={() => setIsLogin(!isLogin)}
              data-testid="auth-toggle-btn"
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

export default AuthModal;
