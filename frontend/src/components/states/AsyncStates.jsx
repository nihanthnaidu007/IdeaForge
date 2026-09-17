import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";

// Honest async states — the frontend counterpart of the fail-loud backend.
// Every async surface renders one of these explicitly instead of leaving
// stale or placeholder data looking real. Strings follow the UI & Copy Craft
// Pack (§3 honest-states catalog): one primary action per state, the honest
// backend message as the body, and a collapsed detail line for support.

// Loading skeleton: shape-matched placeholder blocks, no fake content.
export const LoadingSkeleton = ({ className = "" }) => (
  <div className={`animate-pulse bg-white/5 rounded-lg ${className}`} />
);

export const SkeletonCardGrid = ({ count = 4, testId = "skeleton-grid" }) => (
  <div data-testid={testId} className="grid md:grid-cols-2 gap-4">
    {Array.from({ length: count }).map((_, i) => (
      <div key={i} className="glass-card rounded-xl p-4 space-y-3">
        <LoadingSkeleton className="h-4 w-3/4" />
        <LoadingSkeleton className="h-1.5 w-1/2" />
        <LoadingSkeleton className="h-16 w-full" />
      </div>
    ))}
  </div>
);

export const EmptyState = ({ icon: Icon, title, description, children, testId = "empty-state" }) => (
  <div data-testid={testId} className="text-center py-20">
    {Icon && <Icon className="w-16 h-16 text-white/10 mx-auto mb-4" aria-hidden="true" />}
    <h3 className="font-heading text-xl text-white mb-2">{title}</h3>
    {description && <p className="text-zinc-400 mb-6 max-w-md mx-auto">{description}</p>}
    {children}
  </div>
);

// Stale-data banner (UI pack §3.1): when a refresh fails while old data is
// still on screen, the old data stays and this banner says so — the surface
// may never show old data as if it were fresh. Retry inline; Dismiss hides
// the strip until the next successful run resets the state.
const relativeTime = (iso) => {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return "moments ago";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours} hour${hours === 1 ? "" : "s"} ago`;
};

export const StaleBanner = ({ asOf, onRetry, onDismiss, testId = "stale-banner" }) => (
  <div
    data-testid={testId}
    className="border-l-2 border-lime bg-white/5 rounded-r-lg px-4 py-3 mb-6 flex flex-wrap items-center gap-x-4 gap-y-2"
    role="status"
  >
    <p className="text-zinc-400 text-sm flex-1 min-w-64">
      Showing research from {relativeTime(asOf)} ({new Date(asOf).toLocaleString()}). The refresh
      failed — nothing was overwritten.
    </p>
    {onRetry && (
      <Button
        onClick={onRetry}
        data-testid="stale-retry-btn"
        variant="outline"
        className="border-white/10 text-white hover:bg-white/5"
      >
        Retry
      </Button>
    )}
    {onDismiss && (
      <button
        type="button"
        onClick={onDismiss}
        data-testid="stale-dismiss-btn"
        className="text-zinc-400 text-sm hover:text-white"
      >
        Dismiss
      </button>
    )}
  </div>
);

// Live countdown for rate-limited retries (UI pack §3.1): Retry stays
// disabled until the window closes, with the remaining seconds visible.
const useCountdown = (seconds) => {
  const [remaining, setRemaining] = useState(seconds ?? 0);
  useEffect(() => {
    setRemaining(seconds ?? 0);
    if (!seconds) return undefined;
    const timer = setInterval(() => {
      setRemaining((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [seconds]);
  return remaining;
};

// Provider console homes (UI pack §5.3): where a quota failure's primary
// action leads. Only these three providers exist in the product.
const PROVIDER_BILLING_URLS = {
  tavily: "https://app.tavily.com",
  openai: "https://platform.openai.com",
  anthropic: "https://console.anthropic.com",
};

// Error states split by what the user can do next (UI pack §3.1 kind map):
//  - missing_key/auth: only Settings can fix them — retry is pointless
//  - quota: the fix is the provider's own billing page; Settings is secondary
//  - rate_limited: retry exists but waits out the Retry-After window
//  - everything else offers retry with the honest message from the backend
// Surfaces pass `strings` ({headline, body, primary, secondary}) with their
// pack copy; actions always follow the kind. `secondary` is the §3.2 pattern:
// a second action is allowed only when the primary or secondary leaves the
// app (provider billing) or is equal-weight navigation (§3.14).
export const ErrorState = ({ error, onRetry, title, strings, testId }) => {
  const navigate = useNavigate();
  const kind = error?.kind ?? "unknown";
  const retryAfter = useCountdown(error?.retryAfter);
  const isKeyIssue = kind === "missing_key" || kind === "auth" || kind === "quota";

  const headline = strings?.headline ?? title ?? "That failed";
  const body = strings?.body ?? error?.message ?? "An unexpected error occurred.";
  const secondary = strings?.secondary;

  const detail =
    error?.code || error?.requestId
      ? [error?.code, error?.requestId ? `req: ${error.requestId}` : null].filter(Boolean).join(" · ")
      : null;

  const primaryLabel =
    strings?.primary ??
    (kind === "missing_key" ? "Add key" : kind === "auth" ? "Check keys" : null);

  const renderPrimary = () => {
    if (kind === "quota") {
      const url = PROVIDER_BILLING_URLS[error?.provider] ?? PROVIDER_BILLING_URLS.openai;
      return (
        <div className="flex flex-col items-center gap-3">
          <Button
            onClick={() => window.open(url, "_blank", "noopener")}
            data-testid="error-billing-btn"
            className="bg-lime text-void hover:bg-lime-hover"
          >
            Open provider billing
          </Button>
          <button
            type="button"
            onClick={() => navigate("/settings")}
            data-testid="error-open-settings-btn"
            className="text-zinc-400 text-sm underline-offset-4 hover:text-white hover:underline"
          >
            Check keys in Settings
          </button>
        </div>
      );
    }
    if (primaryLabel) {
      return (
        <Button
          onClick={() => navigate("/settings")}
          data-testid="error-open-settings-btn"
          className="bg-lime text-void hover:bg-lime-hover"
        >
          {primaryLabel}
        </Button>
      );
    }
    if (kind === "rate_limited") {
      return (
        <Button
          onClick={onRetry}
          disabled={retryAfter > 0}
          aria-disabled={retryAfter > 0}
          data-testid="error-retry-btn"
          variant="outline"
          className="border-white/10 text-white hover:bg-white/5"
        >
          {retryAfter > 0 ? `Retry (${retryAfter}s)` : "Retry"}
        </Button>
      );
    }
    return onRetry ? (
      <Button
        onClick={onRetry}
        data-testid="error-retry-btn"
        variant="outline"
        className="border-white/10 text-white hover:bg-white/5"
      >
        Retry
      </Button>
    ) : null;
  };

  return (
    <div
      data-testid={testId ?? (isKeyIssue ? "key-issue-state" : "error-state")}
      className="glass-card rounded-xl p-8 text-center card-hover"
      role="alert"
    >
      {kind === "quota" || kind === "missing_key" || kind === "auth" ? (
        <KeyRound className="w-12 h-12 text-rating-medium mx-auto mb-4" aria-hidden="true" />
      ) : (
        <AlertTriangle className="w-12 h-12 text-rating-medium mx-auto mb-4" aria-hidden="true" />
      )}
      <h3 className="font-heading text-xl text-white mb-2">{headline}</h3>
      <p className="text-zinc-400 text-sm max-w-md mx-auto mb-6">{body}</p>
      {renderPrimary()}
      {secondary && (
        <a
          href={secondary.href ?? "#"}
          onClick={(e) => {
            if (secondary.to) {
              e.preventDefault();
              navigate(secondary.to);
            }
          }}
          target={secondary.href ? "_blank" : undefined}
          rel={secondary.href ? "noreferrer" : undefined}
          data-testid="error-secondary-btn"
          className="block mt-3 text-zinc-400 text-sm underline-offset-4 hover:text-white hover:underline"
        >
          {secondary.label}
        </a>
      )}
      {detail && (
        <details className="mt-6 text-left max-w-md mx-auto">
          <summary className="text-zinc-400 text-xs cursor-pointer">Details</summary>
          <p className="font-mono text-zinc-400 text-xs mt-2">{detail}</p>
        </details>
      )}
    </div>
  );
};
