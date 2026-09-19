import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { KeyRound, PartyPopper } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/api/client";
import { useOnboarding } from "@/context/OnboardingContext";

// The welcome mat (Wave 1 §Onboarding, step 1): the first login lands here.
// It explains the bundled-first promise with real allowance facts from
// /usage/caps — facts, not marketing — and offers the optional, skippable
// "Add your own keys" path. Leaving the mat (either CTA) completes the
// welcome step; the guide itself continues as the dashboard stepper.

// Pure so the allowance summary is testable without the component: one line
// per resource the server knows about, only claims the server actually makes.
export const capsSummary = (caps) => {
  if (!caps?.resources) return [];
  return Object.entries(caps.resources).map(([resource, state]) => ({
    resource,
    used: state?.used ?? 0,
    limit: state?.limit,
    bundled: Boolean(state?.bundled_available),
    byok: Boolean(state?.byok_connected),
  }));
};

const RESOURCE_LABELS = { research: "research runs", llm: "idea batches" };

const AllowanceLine = ({ resource, used, limit, bundled, byok }) => {
  const label = RESOURCE_LABELS[resource] ?? resource;
  if (byok) {
    return (
      <li data-testid={`onboarding-allowance-${resource}`}>
        {label.charAt(0).toUpperCase() + label.slice(1)} run on your own key —
        uncapped, billed only to your account.
      </li>
    );
  }
  if (!bundled) {
    return (
      <li data-testid={`onboarding-allowance-${resource}`}>
        {label.charAt(0).toUpperCase() + label.slice(1)} need a key — add yours
        in Settings to get started.
      </li>
    );
  }
  return (
    <li data-testid={`onboarding-allowance-${resource}`}>
      {label.charAt(0).toUpperCase() + label.slice(1)}: {used}
      {limit != null ? ` of ${limit} today` : ""} on the bundled key — resets
      daily, no card, no setup.
    </li>
  );
};

const WelcomeMat = () => {
  const { completeWelcome, dismiss } = useOnboarding();
  const navigate = useNavigate();
  const [caps, setCaps] = useState(null);

  // Allowance facts for the promise ("it already works"). A failed read is
  // logged and the mat keeps its copy — the CTAs do not depend on it, and
  // the dashboard below carries the honest error states if keys are missing.
  useEffect(() => {
    let cancelled = false;
    api
      .get("/usage/caps")
      .then((body) => {
        if (!cancelled) setCaps(body);
      })
      .catch((error) => console.error("Allowance load failed:", error));
    return () => {
      cancelled = true;
    };
  }, []);

  const lines = capsSummary(caps);

  const handleStart = async () => {
    // The mat closes and the stepper takes over; the Trend Radar right below
    // is the next action (first sweep).
    await completeWelcome();
  };

  const handleByok = async () => {
    // Optional and skippable: leaving the mat for Settings still completes
    // the welcome step — the user saw the promise and chose their own keys.
    await completeWelcome();
    navigate("/settings");
  };

  return (
    <section
      aria-labelledby="onboarding-mat-title"
      data-testid="onboarding-welcome-mat"
      className="glass-card rounded-xl p-6 mb-8 border border-lime/20"
    >
      <div className="flex items-start gap-3">
        <PartyPopper className="text-lime mt-1" aria-hidden="true" />
        <div className="flex-1">
          <h2
            id="onboarding-mat-title"
            className="font-heading text-2xl font-semibold text-white"
          >
            Your forge is live
          </h2>
          <p className="text-zinc-300 mt-2">
            IdeaForge works from your very first click — research and idea
            forging run on our bundled key, so there is nothing to set up
            before you see real results.
          </p>
          {lines.length > 0 && (
            <ul className="text-sm text-zinc-400 mt-3 space-y-1 list-disc list-inside">
              {lines.map((line) => (
                <AllowanceLine key={line.resource} {...line} />
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-center gap-3 mt-5">
            <Button
              onClick={handleStart}
              data-testid="onboarding-start-btn"
              className="bg-lime text-void hover:bg-lime-hover"
            >
              Start your first sweep
            </Button>
            <Button
              variant="outline"
              onClick={handleByok}
              data-testid="onboarding-byok-btn"
              className="border-white/10 text-white hover:bg-white/5"
            >
              <KeyRound aria-hidden="true" />
              Add your own keys
            </Button>
            <button
              type="button"
              onClick={dismiss}
              data-testid="onboarding-dismiss-btn"
              className="text-sm text-zinc-500 hover:text-zinc-300 underline underline-offset-4"
            >
              Dismiss — I'll figure it out
            </button>
          </div>
          <p className="text-xs text-zinc-500 mt-3">
            Dismissal hides this guide until you replay it from Settings. Your
            progress is always kept.
          </p>
        </div>
      </div>
    </section>
  );
};

export default WelcomeMat;
