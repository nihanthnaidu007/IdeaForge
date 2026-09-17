import { useNavigate } from "react-router-dom";
import { AlertTriangle, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";

// Honest async states — the frontend counterpart of the fail-loud backend.
// Every async surface renders one of these explicitly instead of leaving
// stale or placeholder data looking real.

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
    {Icon && <Icon className="w-16 h-16 text-white/10 mx-auto mb-4" />}
    <h3 className="font-heading text-xl text-white mb-2">{title}</h3>
    {description && <p className="text-white/50 mb-6 max-w-md mx-auto">{description}</p>}
    {children}
  </div>
);

// Error states split by what the user can do next:
//  - key/quota problems cannot be retried away; they route to Settings
//  - everything else offers retry with the honest message from the backend
const KEY_ISSUE_KINDS = new Set(["missing_key", "quota", "auth"]);

export const ErrorState = ({ error, onRetry, title, testId }) => {
  const navigate = useNavigate();
  const kind = error?.kind ?? "unknown";
  const isKeyIssue = KEY_ISSUE_KINDS.has(kind);

  const headline =
    title ??
    (isKeyIssue ? "Provider setup needed" : "Something went wrong");

  return (
    <div
      data-testid={testId ?? (isKeyIssue ? "key-issue-state" : "error-state")}
      className="glass-card rounded-xl p-8 text-center card-hover"
      role="alert"
    >
      {isKeyIssue ? (
        <KeyRound className="w-12 h-12 text-rating-medium mx-auto mb-4" />
      ) : (
        <AlertTriangle className="w-12 h-12 text-rating-medium mx-auto mb-4" />
      )}
      <h3 className="font-heading text-xl text-white mb-2">{headline}</h3>
      <p className="text-white/50 text-sm max-w-md mx-auto mb-6">
        {error?.message ?? "An unexpected error occurred."}
      </p>
      {isKeyIssue ? (
        <Button
          onClick={() => navigate("/settings")}
          data-testid="error-open-settings-btn"
          className="bg-lime text-void hover:bg-lime-hover"
        >
          Open Settings
        </Button>
      ) : (
        onRetry && (
          <Button
            onClick={onRetry}
            data-testid="error-retry-btn"
            variant="outline"
            className="border-white/10 text-white hover:bg-white/5"
          >
            Try Again
          </Button>
        )
      )}
    </div>
  );
};
