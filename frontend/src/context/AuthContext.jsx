import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api, onUnauthorized } from "@/api/client";

// Auth context extracted from App.js so shared components (Navbar,
// AuthModal, pages) import it directly instead of reaching into the App
// module — that circular import is what forced pages to import from App.
const AuthContext = createContext(null);

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(localStorage.getItem("ideaforge_token"));
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const verifyToken = async () => {
      if (token) {
        try {
          const me = await api.get("/auth/me");
          setUser(me);
        } catch {
          localStorage.removeItem("ideaforge_token");
          setToken(null);
          setUser(null);
        }
      }
      setLoading(false);
    };
    verifyToken();
  }, [token]);

  const login = async (email, password) => {
    const data = await api.post("/auth/login", { email, password });
    localStorage.setItem("ideaforge_token", data.token);
    if (data.refresh_token) localStorage.setItem("ideaforge_refresh", data.refresh_token);
    setToken(data.token);
    setUser(data.user);
    return data;
  };

  const register = async (email, password, name) => {
    const data = await api.post("/auth/register", { email, password, name });
    localStorage.setItem("ideaforge_token", data.token);
    if (data.refresh_token) localStorage.setItem("ideaforge_refresh", data.refresh_token);
    setToken(data.token);
    setUser(data.user);
    return data;
  };

  // Revoke the server-side refresh token so the session is dead even if the
  // JWT outlives this device. Failure is non-blocking (the token still
  // expires by TTL) but is surfaced, not swallowed.
  const logout = useCallback(() => {
    const refreshToken = localStorage.getItem("ideaforge_refresh");
    localStorage.removeItem("ideaforge_token");
    localStorage.removeItem("ideaforge_refresh");
    setToken(null);
    setUser(null);
    if (refreshToken) {
      api.post("/auth/logout", { refresh_token: refreshToken }).catch((error) => {
        console.warn("Refresh token revocation failed (expires by TTL anyway):", error?.message);
      });
    }
  }, []);

  // A 401 from any authenticated request means the session token is dead.
  // Clear local state so protected routes bounce back to the landing page.
  // Re-registered on each render is fine — registration is an idempotent
  // assignment and logout only touches stable setters.
  useEffect(() => {
    onUnauthorized(logout);
  }, [logout]);

  return (
    <AuthContext.Provider value={{ user, token, login, register, logout, loading }}>
      {children}
    </AuthContext.Provider>
  );
};

export default AuthContext;
