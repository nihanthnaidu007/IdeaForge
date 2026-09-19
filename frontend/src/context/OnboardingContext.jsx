import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api } from "@/api/client";
import { useAuth } from "@/context/AuthContext";

// Onboarding context (Wave 1 §Onboarding): the guide's state lives on the
// server — this provider only materializes it. Steps advance on real events
// (the research/forge routes advance the checklist server-side), so the
// context exposes a refresh() for pages to call after those events, plus the
// three explicit actions (welcome mat CTA, dismissal, Settings replay).
// Every action returns the server's normalized progress body, so the UI
// always renders the server's view of reality — never a local guess.

const OnboardingContext = createContext(null);

export const useOnboarding = () => useContext(OnboardingContext);

export const OnboardingProvider = ({ children }) => {
  const { user } = useAuth();
  const [progress, setProgress] = useState(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!user) return null;
    setLoading(true);
    try {
      const body = await api.get("/onboarding");
      setProgress(body);
      return body;
    } catch (error) {
      // Fail-open (spec §Onboarding): a broken progress read must never block
      // the dashboard. The existing empty states remain the fallback.
      console.error("Onboarding progress load failed:", error);
      setProgress(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (!user) {
      setProgress(null);
      setReplayRequested(false);
      return;
    }
    refresh();
  }, [user, refresh]);

  const post = useCallback(
    async (path) => {
      try {
        const body = await api.post(path);
        setProgress(body);
        return body;
      } catch (error) {
        console.error(`Onboarding ${path} failed:`, error);
        // Re-read the server's truth rather than guessing locally.
        await refresh();
        return null;
      }
    },
    [refresh],
  );

  const completeWelcome = useCallback(() => post("/onboarding/welcome"), [post]);
  const dismiss = useCallback(() => post("/onboarding/dismiss"), [post]);
  // Session-only flag: replay re-opens the guide even when every step is
  // already done (it shows the completed checklist, never a reset). The
  // server never tracks this — it changes only what this session displays.
  const [replayRequested, setReplayRequested] = useState(false);
  const replay = useCallback(async () => {
    setReplayRequested(true);
    return post("/onboarding/replay");
  }, [post]);

  const value = useMemo(() => {
    const steps = progress?.steps ?? null;
    const dismissed = Boolean(progress?.dismissed_at);
    const completed = Boolean(progress?.completed_at);
    return {
      progress,
      loading,
      refresh,
      completeWelcome,
      dismiss,
      replay,
      // The guide is active while it still has something to show and the
      // user has neither dismissed it nor finished every step.
      guideActive: Boolean(progress) && !dismissed && !completed,
      dismissed,
      completed,
      replayRequested,
      // Welcome mat: the guide is active and the user has not yet left it.
      matVisible: Boolean(steps) && !dismissed && !completed && steps.welcome !== "done",
      // Stepper: the guide is active past the mat. After an explicit replay
      // of a completed flow it shows again with every step marked done.
      stepperVisible:
        Boolean(steps) &&
        !dismissed &&
        steps.welcome === "done" &&
        (!completed || replayRequested),
    };
  }, [progress, loading, refresh, completeWelcome, dismiss, replay, replayRequested]);

  return (
    <OnboardingContext.Provider value={value}>{children}</OnboardingContext.Provider>
  );
};

export default OnboardingContext;
