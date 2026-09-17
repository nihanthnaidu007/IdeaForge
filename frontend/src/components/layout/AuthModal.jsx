import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { ApiError } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

// Shared auth modal — extracted from the Landing page so every auth entry
// point (navbar, hero CTA, get-started) renders the same component. Copy per
// UI & Copy Craft Pack §5.1 (fields) and §3.12 (route-level errors): one
// route-level error above the submit button with role=alert, field errors
// inline, no invented password-reset link (v1 has no reset route).

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// §5.4: the same sentence whether the client or the server caught the input.
const EMAIL_SHAPE_MESSAGE = "That doesn't look like an email address.";
const PASSWORD_FLOOR_MESSAGE = "Password is required — at least 8 characters.";

// Route-level error copy per §3.12, keyed by ApiError kind.
const ROUTE_ERRORS = {
  auth: {
    headline: "Email or password didn't match.",
    body: "No account yet? Switch to Register — wrong-guessing which field was wrong tells nobody anything.",
  },
  conflict: {
    headline: "That email already has an account.",
    body: "Log in instead — passwords aren't reset from here, so try your usual one.",
  },
  network: {
    headline: "Couldn't reach the forge.",
    body: "Nothing was created — no half-accounts. Check your connection and retry.",
  },
  server: {
    headline: "Couldn't reach the forge.",
    body: "Nothing was created — no half-accounts. Check your connection and retry.",
  },
};

const RouteError = ({ error }) => {
  const [remaining, setRemaining] = useState(error?.retryAfter ?? 0);

  useEffect(() => {
    setRemaining(error?.retryAfter ?? 0);
    if (!error?.retryAfter) return undefined;
    const timer = setInterval(() => {
      setRemaining((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [error]);

  if (!error) return null;

  const kind = error.kind;
  const pack = ROUTE_ERRORS[kind];

  if (kind === "rate_limited") {
    const seconds = error.retryAfter ?? 0;
    return (
      <div role="alert" data-testid="auth-error" className="text-sm">
        <p className="text-red-400 font-medium">Too many attempts.</p>
        <p className="text-zinc-400 mt-1">
          Try again in {remaining || seconds}s — the limit is 10 attempts per minute, then it
          clears.
        </p>
      </div>
    );
  }

  if (pack) {
    return (
      <div role="alert" data-testid="auth-error" className="text-sm">
        <p className="text-red-400 font-medium">{pack.headline}</p>
        <p className="text-zinc-400 mt-1">{pack.body}</p>
      </div>
    );
  }

  // Unknown shape: the client's product-neutral fallback message.
  return (
    <p role="alert" data-testid="auth-error" className="text-red-400 text-sm">
      {error.message}
    </p>
  );
};

const AuthModal = ({ open, onClose, initialMode = "login" }) => {
  const { login, register } = useAuth();
  const navigate = useNavigate();
  const [isLogin, setIsLogin] = useState(initialMode === "login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [routeError, setRouteError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [loading, setLoading] = useState(false);

  const switchTab = (toLogin) => {
    // Switching tabs replaces any previous route-level error (§5.1).
    setRouteError(null);
    setFieldErrors({});
    setIsLogin(toLogin);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setRouteError(null);

    // §5.4 client-side pre-validation: instant feedback, same strings the
    // server's 422 maps to.
    const fields = {};
    if (!EMAIL_SHAPE.test(email)) fields.email = EMAIL_SHAPE_MESSAGE;
    if (!isLogin && password.length < 8) fields.password = PASSWORD_FLOOR_MESSAGE;
    if (Object.keys(fields).length > 0) {
      setFieldErrors(fields);
      return;
    }
    setFieldErrors({});
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
      // Non-ApiError throws (network blips) surface as the §3.12 network
      // state; ApiErrors carry their kind and render their own copy.
      setRouteError(
        err instanceof ApiError ? err : new ApiError({ kind: "network", message: "" }),
      );
    } finally {
      setLoading(false);
    }
  };

  const emailError = fieldErrors.email;
  const passwordError = fieldErrors.password;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="bg-deep border-white/10 max-w-md" data-testid="auth-modal">
        <DialogHeader>
          <DialogTitle className="font-heading text-2xl text-white">
            {isLogin ? "Sign in to IdeaForge" : "Create your account"}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 mt-4" aria-busy={loading}>
          {!isLogin && (
            <div>
              <label htmlFor="auth-name" className="text-sm text-zinc-400 mb-1 block">
                Name (optional)
              </label>
              <Input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                id="auth-name"
                data-testid="auth-name-input"
                placeholder="How IdeaForge should greet you"
                className="bg-void border-white/10 text-white"
                autoComplete="name"
              />
            </div>
          )}

          <div>
            <label htmlFor="auth-email" className="text-sm text-zinc-400 mb-1 block">
              Email
            </label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              id="auth-email"
              data-testid="auth-email-input"
              placeholder="you@example.com"
              className="bg-void border-white/10 text-white"
              autoComplete="email"
              inputMode="email"
              aria-invalid={Boolean(emailError)}
              aria-describedby={emailError ? "auth-email-error" : undefined}
              required
            />
            {emailError && (
              <p id="auth-email-error" className="text-red-400 text-sm mt-1">
                {emailError}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="auth-password" className="text-sm text-zinc-400 mb-1 block">
              Password
            </label>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              id="auth-password"
              data-testid="auth-password-input"
              placeholder="••••••••"
              className="bg-void border-white/10 text-white"
              autoComplete={isLogin ? "current-password" : "new-password"}
              aria-invalid={Boolean(passwordError)}
              aria-describedby={passwordError ? "auth-password-error" : isLogin ? undefined : "auth-password-help"}
              required
            />
            {passwordError ? (
              <p id="auth-password-error" className="text-red-400 text-sm mt-1">
                {passwordError}
              </p>
            ) : (
              !isLogin && (
                <p id="auth-password-help" className="text-zinc-400 text-sm mt-1">
                  At least 8 characters. Longer is better — this password guards your API keys.
                </p>
              )
            )}
          </div>

          <RouteError error={routeError} />

          <Button
            type="submit"
            disabled={loading}
            data-testid="auth-submit-btn"
            className="w-full bg-lime text-void hover:bg-lime-hover"
          >
            {loading ? (
              <span className="flex items-center gap-2 justify-center">
                <span className="w-4 h-4 border-2 border-void/30 border-t-void rounded-full animate-spin" aria-hidden="true" />
                {isLogin ? "Log in" : "Create account"}
              </span>
            ) : (
              isLogin ? "Log in" : "Create account"
            )}
          </Button>

          <p className="text-center text-sm text-zinc-400">
            {isLogin ? "New here? Create an account" : "Already forging? Log in"}{" "}
            <button
              type="button"
              onClick={() => switchTab(!isLogin)}
              data-testid="auth-toggle-btn"
              className="text-lime hover:underline"
            >
              {isLogin ? "Register" : "Log in"}
            </button>
          </p>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default AuthModal;
