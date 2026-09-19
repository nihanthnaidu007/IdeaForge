import { lazy, Suspense } from "react";
import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "./components/ui/sonner";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { OnboardingProvider } from "@/context/OnboardingContext";
import NotFound from "@/pages/NotFound";

// Route-level code splitting: each page becomes its own async chunk instead of
// one monolithic bundle.
const LandingPage = lazy(() => import("./pages/LandingPage"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const SavedIdeas = lazy(() => import("./pages/SavedIdeas"));
const BoardPage = lazy(() => import("./pages/BoardPage"));
const Settings = lazy(() => import("./pages/Settings"));
const Analytics = lazy(() => import("./pages/Analytics"));

const RouteFallback = () => (
  <div className="min-h-screen bg-void flex items-center justify-center">
    <div className="animate-loading-pulse text-lime">Loading...</div>
  </div>
);

const ProtectedRoute = ({ children }) => {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-void flex items-center justify-center">
        <div className="animate-loading-pulse text-lime">Loading...</div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/" replace />;
  }

  return children;
};

function App() {
  return (
    <AuthProvider>
      {/* Onboarding state rides inside auth: progress loads when a user is
          present and clears on sign-out (Wave 1 §Onboarding). */}
      <OnboardingProvider>
      <div className="App min-h-screen bg-void">
        <BrowserRouter>
          <Suspense fallback={<RouteFallback />}>
            <Routes>
              <Route path="/" element={<LandingPage />} />
              <Route path="/dashboard" element={
                <ProtectedRoute>
                  <Dashboard />
                </ProtectedRoute>
              } />
              <Route path="/saved" element={
                <ProtectedRoute>
                  <SavedIdeas />
                </ProtectedRoute>
              } />
              <Route path="/board" element={
                <ProtectedRoute>
                  <BoardPage />
                </ProtectedRoute>
              } />
              <Route path="/settings" element={
                <ProtectedRoute>
                  <Settings />
                </ProtectedRoute>
              } />
              <Route path="/analytics" element={
                <ProtectedRoute>
                  <Analytics />
                </ProtectedRoute>
              } />
              {/* Unknown routes land on the shared 404 page */}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
        <Toaster position="bottom-right" richColors />
      </div>
      </OnboardingProvider>
    </AuthProvider>
  );
}

export default App;
