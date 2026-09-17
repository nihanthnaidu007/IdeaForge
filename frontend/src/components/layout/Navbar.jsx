import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Sparkles, LogOut, Settings as SettingsIcon, FolderOpen, ArrowLeft } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import AuthModal from "@/components/layout/AuthModal";
import { Button } from "@/components/ui/button";

// The single shared navbar. Replaces the four per-page copies (Landing,
// Dashboard, Saved, Settings). Composed via props:
//   - title: brand text override (e.g. "Saved Ideas"); defaults to IdeaForge
//   - backTo: shows a back arrow and points the brand link at that route
//   - center: page-specific controls rendered after the brand (used sparingly)
//   - onRequireAuth: landing pages pass this to open their own AuthModal
//     instance (mode: "login" | "signup"); when omitted, unauthenticated
//     users get the shared AuthModal managed internally.
const Navbar = ({ title, backTo, center, onRequireAuth }) => {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [internalAuthMode, setInternalAuthMode] = useState(null);

  const goTo = (path) => navigate(path);
  const brandTarget = backTo ?? "/";

  const requireAuth = (mode) => {
    if (onRequireAuth) {
      onRequireAuth(mode);
    } else {
      setInternalAuthMode(mode);
    }
  };

  const right = user ? (
    <div className="flex items-center gap-4">
      <button
        onClick={() => goTo("/saved")}
        data-testid="nav-saved-btn"
        className="p-2 text-white/60 hover:text-white transition-colors"
        title="Saved Ideas"
        aria-label="Saved Ideas"
      >
        <FolderOpen className="w-5 h-5" />
      </button>
      <button
        onClick={() => goTo("/settings")}
        data-testid="nav-settings-btn"
        className="p-2 text-white/60 hover:text-white transition-colors"
        title="Settings"
        aria-label="Settings"
      >
        <SettingsIcon className="w-5 h-5" />
      </button>
      <button
        onClick={logout}
        data-testid="nav-logout-btn"
        className="p-2 text-white/60 hover:text-red-400 transition-colors"
        title="Logout"
        aria-label="Logout"
      >
        <LogOut className="w-5 h-5" />
      </button>
    </div>
  ) : (
    <div className="flex items-center gap-4">
      <Button
        variant="ghost"
        onClick={() => requireAuth("login")}
        data-testid="nav-login-btn"
        className="text-white/70 hover:text-white"
      >
        Sign In
      </Button>
      <Button
        onClick={() => requireAuth("signup")}
        data-testid="nav-signup-btn"
        className="bg-lime text-void hover:bg-lime-hover btn-glow"
      >
        Get Started
      </Button>
    </div>
  );

  return (
    <nav data-testid="navbar" className="fixed top-0 left-0 right-0 z-50 border-b border-white/5 bg-void/90 backdrop-blur-xl">
      <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          {backTo && (
            <button
              onClick={() => goTo(backTo)}
              data-testid="back-btn"
              className="p-2 text-white/60 hover:text-white transition-colors"
              title="Back"
              aria-label="Go back"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
          )}
          <button
            type="button"
            onClick={() => goTo(brandTarget)}
            className="flex items-center gap-2 cursor-pointer"
          >
            <Sparkles className="w-5 h-5 text-lime" />
            <span className="font-heading font-bold text-lg text-white">{title ?? "IdeaForge"}</span>
          </button>
          {center}
        </div>
        {right}
      </div>

      {internalAuthMode && (
        <AuthModal
          open
          onClose={() => setInternalAuthMode(null)}
          initialMode={internalAuthMode}
        />
      )}
    </nav>
  );
};

export default Navbar;
