import { Check, Circle, CircleDot } from "lucide-react";
import { useOnboarding } from "@/context/OnboardingContext";

// The dashboard stepper (Wave 1 §Onboarding, steps 2-3): the guide continues
// here after the welcome mat. Pure presentation — every status comes from
// the server's progress doc, and steps advance only on real events (a
// successful research run / forge, wired in the backend routes). The guide
// disappears for good once every step is done or the user dismissed it.

export const STEPS = [
  {
    key: "first_sweep",
    label: "First sweep",
    detail: "Run research and watch real trend cards arrive — sources, freshness, all of it.",
  },
  {
    key: "first_forge",
    label: "First forge with voice",
    detail: "Forge ideas from a trend. Voice DNA is optional — set it now or any time later.",
  },
];

const STATUS_ICON = {
  done: Check,
  current: CircleDot,
  pending: Circle,
};

const Stepper = () => {
  const { progress } = useOnboarding();
  if (!progress?.steps) return null;

  return (
    <section
      aria-label="Setup guide"
      data-testid="onboarding-stepper"
      className="glass-card rounded-xl p-5 mb-8"
    >
      <ol className="space-y-3">
        {STEPS.map(({ key, label, detail }) => {
          const status = progress.steps[key] ?? "pending";
          const Icon = STATUS_ICON[status] ?? Circle;
          return (
            <li
              key={key}
              aria-current={status === "current" ? "step" : undefined}
              data-testid={`onboarding-step-${key}`}
              data-status={status}
              className="flex items-start gap-3"
            >
              <Icon
                aria-hidden="true"
                className={
                  status === "done"
                    ? "text-lime mt-0.5"
                    : status === "current"
                      ? "text-lime mt-0.5 animate-pulse"
                      : "text-zinc-600 mt-0.5"
                }
              />
              <div>
                <p
                  className={`text-sm font-medium ${
                    status === "pending" ? "text-zinc-500" : "text-white"
                  }`}
                >
                  {label}
                  {status === "current" && (
                    <span className="text-lime ml-2 text-xs">— up next</span>
                  )}
                  {status === "done" && (
                    <span className="text-zinc-500 ml-2 text-xs">— done</span>
                  )}
                </p>
                {status !== "done" && (
                  <p className="text-xs text-zinc-500 mt-0.5">{detail}</p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
};

export default Stepper;
