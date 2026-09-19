import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import Navbar from "@/components/layout/Navbar";
import SkipLink from "@/components/layout/SkipLink";
import { ErrorState } from "@/components/states/AsyncStates";
import VoiceDNAEditor from "@/components/settings/VoiceDNAEditor";
import { api } from "@/api/client";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertCircle, Check, X, Eye, EyeOff, Loader2 } from "lucide-react";
import { NICHES, TONES } from "@/lib/constants";
import { useOnboarding } from "@/context/OnboardingContext";

// §5.2 card contract: connected cards show the Connected chip + masked hint
// and never re-expose the key; "Replace" is the only path to a new value.
// §5.3 gives each provider's setup line verbatim; PR #9 shipped
// POST /keys/{provider}/test, so the one-click validation renders for real.
const KEY_PROVIDERS = [
  {
    id: "tavily",
    name: "Tavily",
    label: "Tavily API key",
    placeholder: "tvly-…",
    purpose: "Tavily powers Trend Radar. Create a key in your Tavily account console — research bills only to your Tavily plan.",
    link: "https://tavily.com",
  },
  {
    id: "anthropic",
    name: "Anthropic",
    label: "Anthropic API key",
    placeholder: "sk-ant-…",
    purpose: "Anthropic is one of the two drafting engines. Create a key in the Anthropic Console — drafts bill only to your Anthropic account.",
    link: "https://console.anthropic.com",
  },
  {
    id: "openai",
    name: "OpenAI",
    label: "OpenAI API key",
    placeholder: "sk-…",
    purpose: "OpenAI is one of the two drafting engines. Create a key at platform.openai.com — drafts bill only to your OpenAI account.",
    link: "https://platform.openai.com",
  },
];

// Server-default banner line (Wave 1 caps): the bundled allowance with the
// current usage and reset, stated as facts from GET /usage/caps. Renders only
// when the deployment actually offers a bundled key — no allowance is claimed
// that doesn't exist. BYOK keys are never capped and never counted.
const BundledAllowanceLine = ({ caps }) => {
  const llm = caps.resources.llm;
  const research = caps.resources.research;
  if (!llm && !research) return null;
  if (!llm?.bundled_available && !research?.bundled_available) return null;
  const reset = caps.resets_at
    ? ` Resets ${new Date(caps.resets_at).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      })}.`
    : "";
  const parts = [];
  if (llm?.bundled_available) parts.push(`${llm.limit} AI-generation calls`);
  if (research?.bundled_available) parts.push(`${research.limit} research runs`);
  const used = [];
  if (llm?.bundled_available) used.push(`${llm.used} AI-generation`);
  if (research?.bundled_available) used.push(`${research.used} research`);
  return (
    <p className="text-zinc-400 mt-2" data-testid="bundled-allowance-line">
      Without your own keys, the app runs on the bundled server key: {parts.join(" and ")}{" "}
      per day — used today: {used.join(" and ")}.{reset} Your own keys are never capped.
    </p>
  );
};

const Settings = () => {
  useAuth(); // auth guard is handled by ProtectedRoute
  // Onboarding replay (Wave 1 §Onboarding): re-open the dashboard guide.
  // State lives on the server — the POST returns the updated progress, and
  // nothing here resets it.
  const { replay } = useOnboarding();
  const [replaying, setReplaying] = useState(false);
  const [preferences, setPreferences] = useState({
    default_niche: "AI",
    default_tone: "professional",
  });
  const [keyHints, setKeyHints] = useState({
    tavily: null,
    anthropic: null,
    openai: null,
  });
  const [apiKeys, setApiKeys] = useState({ tavily: "", anthropic: "", openai: "" });
  const [keyStatus, setKeyStatus] = useState({
    has_tavily_key: false,
    has_anthropic_key: false,
    has_openai_key: false,
  });
  const [showKeys, setShowKeys] = useState({ tavily: false, anthropic: false, openai: false });
  const [replacing, setReplacing] = useState({ tavily: false, anthropic: false, openai: false });
  const [status, setStatus] = useState("loading"); // loading | error | ready
  const [loadError, setLoadError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [savingKey, setSavingKey] = useState(null);
  const [testState, setTestState] = useState({});
  const [usageCaps, setUsageCaps] = useState(null);

  const fetchPreferences = useCallback(async () => {
    setStatus("loading");
    try {
      const data = await api.get("/preferences");
      setPreferences({
        default_niche: data.default_niche || "AI",
        default_tone: data.default_tone || "professional",
      });
      setKeyStatus({
        has_tavily_key: data.has_tavily_key || false,
        has_anthropic_key: data.has_anthropic_key || false,
        has_openai_key: data.has_openai_key || false,
      });
      // key_hints is PR #9's masked-hint map — the ONLY key-derived data any
      // response carries. Never fabricate a **** when a provider is connected
      // but unhinted (pre-#9 documents have no hint until re-saved).
      const hints = data.key_hints ?? {};
      setKeyHints({
        tavily: hints.tavily ?? null,
        anthropic: hints.anthropic ?? null,
        openai: hints.openai ?? null,
      });
      setStatus("ready");
    } catch (error) {
      setLoadError(error);
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    fetchPreferences();
  }, [fetchPreferences]);

  // Bundled-allowance state for the server-default banner (GET /usage/caps).
  // Secondary surface: a failed read removes the allowance line — it never
  // blocks Settings — but the failure is logged, never swallowed.
  useEffect(() => {
    api
      .get("/usage/caps")
      .then(setUsageCaps)
      .catch((error) => console.error("usage caps read failed", error));
  }, []);

  const savePreferences = async () => {
    setLoading(true);
    try {
      await api.put("/preferences", {
        default_tone: preferences.default_tone,
        default_niche: preferences.default_niche,
      });
      toast.success("Preferences saved");
    } catch (error) {
      toast.error(error.message);
    } finally {
      setLoading(false);
    }
  };

  // Replay (spec §Onboarding): the server lifts the dismissal and keeps every
  // completed step — the guide re-opens on the dashboard in the state it was.
  const handleReplayGuide = async () => {
    setReplaying(true);
    try {
      await replay();
      toast.success("Setup guide is back on your dashboard.");
    } catch (error) {
      toast.error(error.message);
    } finally {
      setReplaying(false);
    }
  };

  const saveApiKey = async (keyType) => {
    const fieldMap = {
      tavily: "tavily_api_key",
      anthropic: "anthropic_api_key",
      openai: "openai_api_key",
    };
    const statusMap = {
      tavily: "has_tavily_key",
      anthropic: "has_anthropic_key",
      openai: "has_openai_key",
    };

    setSavingKey(keyType);
    try {
      await api.put("/preferences", { [fieldMap[keyType]]: apiKeys[keyType] });

      setKeyStatus((prev) => ({
        ...prev,
        [statusMap[keyType]]: !!apiKeys[keyType],
      }));
      setApiKeys((prev) => ({ ...prev, [keyType]: "" }));
      setReplacing((prev) => ({ ...prev, [keyType]: false }));
      toast.success("Key saved");
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSavingKey(null);
    }
  };

  const clearApiKey = async (keyType) => {
    const statusMap = {
      tavily: "has_tavily_key",
      anthropic: "has_anthropic_key",
      openai: "has_openai_key",
    };

    setSavingKey(keyType);
    try {
      // Removal is the dedicated route — PUT /preferences skips empty
      // strings by design, so an "empty means delete" convention would lie.
      await api.delete(`/keys/${keyType}`);

      setKeyStatus((prev) => ({
        ...prev,
        [statusMap[keyType]]: false,
      }));
      setKeyHints((prev) => ({ ...prev, [keyType]: null }));
      toast.success("Key removed");
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSavingKey(null);
    }
  };

  const toggleShowKey = (key) => {
    setShowKeys((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  // §5.3 state machine: idle → testing → passed | failed. The test is one
  // real, cheap provider call — a pass means the key authenticates, and the
  // copy says "accepted", never "unlimited".
  const testKey = async (providerId) => {
    setTestState((prev) => ({ ...prev, [providerId]: { phase: "testing" } }));
    try {
      await api.post(`/keys/${providerId}/test`);
      setTestState((prev) => ({ ...prev, [providerId]: { phase: "passed" } }));
    } catch (error) {
      setTestState((prev) => ({
        ...prev,
        [providerId]: {
          phase: "failed",
          kind: error.kind,
          retryAfter: error.retryAfter,
          message: error.message,
        },
      }));
    }
  };

  // §5.3's per-kind failed lines. Anything off the table falls back to the
  // ApiError's own honest copy rather than a generic "try again".
  const testFailureLine = (providerName, failure) => {
    switch (failure.kind) {
      case "auth":
        return "Key rejected — check for a paste error or a revoked key, then re-enter it.";
      case "quota":
        return "Key is live, but the account is out of credit or over quota.";
      case "rate_limited":
        return failure.retryAfter
          ? `${providerName} is rate-limiting the test. Wait ${failure.retryAfter}s and test again.`
          : `${providerName} is rate-limiting the test. Wait a moment and test again.`;
      case "network":
      case "unavailable":
        return `Couldn't reach ${providerName} to test. Your key is saved — try again in a minute.`;
      default:
        return failure.message;
    }
  };

  const connected = (id) => keyStatus[`has_${id}_key`];

  return (
    <div className="min-h-screen bg-void">
      <SkipLink />
      <Navbar title="Settings" backTo="/dashboard" />

      {/* Main Content */}
      <main id="main-content" className="pt-20 pb-12 px-6">
        <div className="max-w-2xl mx-auto space-y-8">
          {status === "loading" ? (
            <div className="glass-card rounded-xl p-6 space-y-4" data-testid="settings-skeleton" aria-busy="true">
              <p className="text-zinc-400 text-sm">Loading your settings…</p>
              <div className="animate-pulse bg-white/5 rounded-lg h-6 w-1/3" />
              <div className="animate-pulse bg-white/5 rounded-lg h-12 w-full" />
              <div className="animate-pulse bg-white/5 rounded-lg h-12 w-full" />
              <div className="animate-pulse bg-white/5 rounded-lg h-12 w-full" />
            </div>
          ) : status === "error" ? (
            // §3.11 verbatim: reassure that keys are untouched.
            <ErrorState
              error={loadError}
              onRetry={fetchPreferences}
              strings={{
                headline: "Settings didn't load.",
                body: "Your keys are encrypted at rest and untouched — this is a read failure.",
              }}
            />
          ) : (
            <>
              {/* Info Banner */}
              <div className="glass-card rounded-xl p-4 border-l-4 border-lime">
                <div className="flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-lime flex-shrink-0 mt-0.5" aria-hidden="true" />
                  <div className="text-sm">
                    <p className="text-white font-medium mb-1">Bring Your Own Keys</p>
                    <p className="text-zinc-400">
                      Your own API keys (set below) are used first. If a key isn't configured, the app
                      falls back to operator-provided server defaults when available. If no usable key
                      is available — or yours is rejected or out of credit — you'll see a clear error
                      telling you exactly what to fix.
                    </p>
                    {usageCaps?.resources && <BundledAllowanceLine caps={usageCaps} />}
                  </div>
                </div>
              </div>

              {/* API Keys Section */}
              <div className="glass-card rounded-xl p-6">
                <h2 className="font-heading text-xl font-semibold text-white mb-2">
                  API Configuration
                </h2>
                <p className="text-zinc-400 text-sm mb-6">
                  Add your own API keys to use instead of the server defaults. Keys are encrypted at
                  rest and never shown again after saving.
                </p>

                <div className="space-y-6">
                  {KEY_PROVIDERS.map((provider) => (
                    <div key={provider.id} className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label
                          htmlFor={`${provider.id}-key-input`}
                          className="text-sm text-zinc-400"
                        >
                          {provider.label}
                        </label>
                        {connected(provider.id) ? (
                          <span className="flex items-center gap-1 text-xs text-rating-high">
                            <Check className="w-3 h-3" aria-hidden="true" />
                            Connected
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-xs text-zinc-400">
                            <X className="w-3 h-3" aria-hidden="true" />
                            Not connected
                          </span>
                        )}
                      </div>

                      {connected(provider.id) && !replacing[provider.id] ? (
                        <>
                          {/* §5.2: masked hint only when the backend supplies
                              one — never a fabricated **** */}
                          {keyHints[provider.id] && (
                            <p className="text-xs text-zinc-400" data-testid={`${provider.id}-key-hint`}>
                              Key on file: {keyHints[provider.id]}
                            </p>
                          )}
                          <div className="flex gap-2 flex-wrap items-center">
                            {/* §5.3: one-click validation against the real
                                endpoint PR #9 shipped — never a fake control. */}
                            <Button
                              onClick={() => testKey(provider.id)}
                              disabled={
                                testState[provider.id]?.phase === "testing" ||
                                savingKey === provider.id
                              }
                              data-testid={`test-${provider.id}-btn`}
                              variant="outline"
                              size="sm"
                              className="border-white/10 text-white hover:bg-white/5"
                            >
                              {testState[provider.id]?.phase === "testing" ? (
                                <>
                                  <Loader2
                                    className="w-3 h-3 animate-spin"
                                    aria-hidden="true"
                                  />
                                  Testing…
                                </>
                              ) : (
                                "Test key"
                              )}
                            </Button>
                            <Button
                              onClick={() =>
                                setReplacing((prev) => ({ ...prev, [provider.id]: true }))
                              }
                              data-testid={`replace-${provider.id}-btn`}
                              variant="outline"
                              size="sm"
                              className="border-white/10 text-white hover:bg-white/5"
                            >
                              Replace
                            </Button>
                            <Button
                              onClick={() => clearApiKey(provider.id)}
                              disabled={savingKey === provider.id}
                              data-testid={`clear-${provider.id}-btn`}
                              variant="outline"
                              size="sm"
                              className="border-red-500/30 text-red-400 hover:bg-red-500/10"
                            >
                              Remove
                            </Button>
                          </div>
                          {/* §5.3 feedback line, below the button: neutral
                              text; accents only (lime pass, red fail) per the
                              §2.1 color law. */}
                          {testState[provider.id]?.phase === "testing" && (
                            <p
                              className="text-xs text-zinc-400"
                              data-testid={`${provider.id}-test-line`}
                              aria-live="polite"
                            >
                              Runs a free validation call against {provider.name} — no generation
                              cost.
                            </p>
                          )}
                          {testState[provider.id]?.phase === "passed" && (
                            <p
                              className="text-xs text-zinc-400"
                              data-testid={`${provider.id}-test-line`}
                              aria-live="polite"
                            >
                              <Check className="w-3 h-3 inline text-lime mr-1" aria-hidden="true" />
                              Key works — {provider.name} accepted it just now.
                            </p>
                          )}
                          {testState[provider.id]?.phase === "failed" && (
                            <p
                              className="text-xs text-zinc-400"
                              data-testid={`${provider.id}-test-line`}
                              role="alert"
                            >
                              <X className="w-3 h-3 inline text-red-400 mr-1" aria-hidden="true" />
                              {testFailureLine(provider.name, testState[provider.id])}
                            </p>
                          )}
                        </>
                      ) : (
                        <>
                          <p className="text-xs text-zinc-400 mb-2">
                            {provider.purpose}{" "}
                            <a
                              href={provider.link}
                              target="_blank"
                              rel="noreferrer"
                              className="text-lime hover:underline"
                            >
                              Create a key
                            </a>
                          </p>
                          <div className="flex gap-2">
                            <div className="relative flex-1">
                              <Input
                                id={`${provider.id}-key-input`}
                                type={showKeys[provider.id] ? "text" : "password"}
                                value={apiKeys[provider.id]}
                                onChange={(e) =>
                                  setApiKeys((prev) => ({ ...prev, [provider.id]: e.target.value }))
                                }
                                data-testid={`${provider.id}-key-input`}
                                placeholder={provider.placeholder}
                                className="bg-void border-white/10 text-white pr-16"
                              />
                              <button
                                type="button"
                                onClick={() => toggleShowKey(provider.id)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-white"
                                aria-label={showKeys[provider.id] ? "Hide key" : "Show key"}
                              >
                                {showKeys[provider.id] ? (
                                  <EyeOff className="w-4 h-4" aria-hidden="true" />
                                ) : (
                                  <Eye className="w-4 h-4" aria-hidden="true" />
                                )}
                              </button>
                            </div>
                            <Button
                              onClick={() => saveApiKey(provider.id)}
                              disabled={savingKey === provider.id || !apiKeys[provider.id]}
                              data-testid={`save-${provider.id}-btn`}
                              className="bg-lime text-void hover:bg-lime-hover disabled:opacity-50"
                            >
                              {savingKey === provider.id ? "Saving…" : "Save key"}
                            </Button>
                            {connected(provider.id) && (
                              <Button
                                onClick={() => {
                                  setReplacing((prev) => ({ ...prev, [provider.id]: false }));
                                  setApiKeys((prev) => ({ ...prev, [provider.id]: "" }));
                                }}
                                data-testid={`cancel-replace-${provider.id}-btn`}
                                variant="ghost"
                                size="sm"
                                className="text-zinc-400 hover:text-white"
                              >
                                Cancel
                              </Button>
                            )}
                          </div>
                          <p className="text-xs text-zinc-400">
                            Stored encrypted (AES-256-GCM). Shown once, masked after.
                          </p>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Preferences Section */}
              <div className="glass-card rounded-xl p-6">
                <h2 className="font-heading text-xl font-semibold text-white mb-6">
                  Default Preferences
                </h2>

                <div className="space-y-4">
                  <div>
                    <label htmlFor="default-niche-label" className="text-sm text-zinc-400 mb-2 block">
                      Default niche
                    </label>
                    <Select
                      value={preferences.default_niche}
                      onValueChange={(value) => setPreferences((prev) => ({ ...prev, default_niche: value }))}
                    >
                      <SelectTrigger id="default-niche-label" className="w-full bg-void border-white/10 text-white" data-testid="default-niche-selector">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-deep border-white/10">
                        {NICHES.map((n) => (
                          <SelectItem key={n} value={n} className="text-white hover:bg-white/5">
                            {n}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label htmlFor="default-tone-label" className="text-sm text-zinc-400 mb-2 block">
                      Default tone
                    </label>
                    <Select
                      value={preferences.default_tone}
                      onValueChange={(value) => setPreferences((prev) => ({ ...prev, default_tone: value }))}
                    >
                      <SelectTrigger id="default-tone-label" className="w-full bg-void border-white/10 text-white" data-testid="default-tone-selector">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-deep border-white/10">
                        {TONES.map((t) => (
                          <SelectItem key={t} value={t.toLowerCase()} className="text-white hover:bg-white/5">
                            {t}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button
                    onClick={savePreferences}
                    disabled={loading}
                    data-testid="save-preferences-btn"
                    className="bg-lime text-void hover:bg-lime-hover"
                  >
                    {loading ? "Saving…" : "Save preferences"}
                  </Button>
                </div>
              </div>

              {/* Setup guide (Wave 1 §Onboarding): replay re-opens the
                  dashboard guide without resetting anything — completed steps
                  stay done, the dismissal just lifts. */}
              <div className="glass-card rounded-xl p-6">
                <h2 className="font-heading text-xl font-semibold text-white mb-2">
                  Setup guide
                </h2>
                <p className="text-sm text-zinc-400 mb-4">
                  Missed the walkthrough? Replay it on your dashboard — your
                  progress is kept, nothing is reset.
                </p>
                <Button
                  onClick={handleReplayGuide}
                  disabled={replaying}
                  data-testid="replay-onboarding-btn"
                  className="border border-white/10 bg-transparent text-white hover:bg-white/5"
                >
                  {replaying ? "Opening…" : "Replay setup guide"}
                </Button>
              </div>

              {/* Voice DNA (spec §Voice DNA row): extraction from past posts,
                  confidence-labeled profile, do/don't editing, versions. */}
              <VoiceDNAEditor />
            </>
          )}
        </div>
      </main>
    </div>
  );
};

export default Settings;
