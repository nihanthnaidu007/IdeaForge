import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import Navbar from "@/components/layout/Navbar";
import { ErrorState } from "@/components/states/AsyncStates";
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
import { AlertCircle, Check, X, Eye, EyeOff, Save } from "lucide-react";
import { NICHES, TONES } from "@/lib/constants";

const KEY_PROVIDERS = [
  {
    id: "tavily",
    label: "Tavily API Key",
    description: "For live trend research from tech news and trend surfaces",
    link: "https://tavily.com",
  },
  {
    id: "anthropic",
    label: "Anthropic API Key (Claude)",
    description: "For AI-powered idea generation and audience insights",
    link: "https://console.anthropic.com",
  },
  {
    id: "openai",
    label: "OpenAI API Key (GPT)",
    description: "For writing LinkedIn posts",
    link: "https://platform.openai.com",
  },
];

const Settings = () => {
  useAuth(); // auth guard is handled by ProtectedRoute
  const [preferences, setPreferences] = useState({
    default_niche: "AI",
    default_tone: "professional",
  });
  const [apiKeys, setApiKeys] = useState({ tavily: "", anthropic: "", openai: "" });
  const [keyStatus, setKeyStatus] = useState({
    has_tavily_key: false,
    has_anthropic_key: false,
    has_openai_key: false,
  });
  const [showKeys, setShowKeys] = useState({ tavily: false, anthropic: false, openai: false });
  const [status, setStatus] = useState("loading"); // loading | error | ready
  const [loadError, setLoadError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [savingKey, setSavingKey] = useState(null);

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
      setStatus("ready");
    } catch (error) {
      // Honest state with retry instead of a silent console error.
      setLoadError(error);
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    fetchPreferences();
  }, [fetchPreferences]);

  const savePreferences = async () => {
    setLoading(true);
    try {
      await api.post("/preferences", {
        default_tone: preferences.default_tone,
        default_niche: preferences.default_niche,
      });
      toast.success("Preferences saved!");
    } catch (error) {
      toast.error(error.message);
    } finally {
      setLoading(false);
    }
  };

  const saveApiKey = async (keyType) => {
    const keyValue = apiKeys[keyType];
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
      await api.post("/preferences", { [fieldMap[keyType]]: keyValue });

      setKeyStatus((prev) => ({
        ...prev,
        [statusMap[keyType]]: !!keyValue,
      }));
      setApiKeys((prev) => ({ ...prev, [keyType]: "" }));
      toast.success(`${keyType.charAt(0).toUpperCase() + keyType.slice(1)} API key ${keyValue ? "saved" : "removed"}!`);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSavingKey(null);
    }
  };

  const clearApiKey = async (keyType) => {
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
      await api.post("/preferences", { [fieldMap[keyType]]: "" });

      setKeyStatus((prev) => ({
        ...prev,
        [statusMap[keyType]]: false,
      }));
      toast.success(`${keyType.charAt(0).toUpperCase() + keyType.slice(1)} API key removed`);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSavingKey(null);
    }
  };

  const toggleShowKey = (key) => {
    setShowKeys((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div className="min-h-screen bg-void">
      <Navbar title="Settings" backTo="/dashboard" />

      {/* Main Content */}
      <main className="pt-20 pb-12 px-6">
        <div className="max-w-2xl mx-auto space-y-8">
          {status === "loading" ? (
            <div className="glass-card rounded-xl p-6 space-y-4" data-testid="settings-skeleton">
              <div className="animate-pulse bg-white/5 rounded-lg h-6 w-1/3" />
              <div className="animate-pulse bg-white/5 rounded-lg h-12 w-full" />
              <div className="animate-pulse bg-white/5 rounded-lg h-12 w-full" />
              <div className="animate-pulse bg-white/5 rounded-lg h-12 w-full" />
            </div>
          ) : status === "error" ? (
            <ErrorState error={loadError} onRetry={fetchPreferences} title="Couldn't load your settings" />
          ) : (
            <>
              {/* Info Banner */}
              <div className="glass-card rounded-xl p-4 border-l-4 border-lime">
                <div className="flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-lime flex-shrink-0 mt-0.5" />
                  <div className="text-sm">
                    <p className="text-white font-medium mb-1">Bring Your Own Keys</p>
                    <p className="text-white/60">
                      Your own API keys (set below) are used first. If a key isn't configured, the app
                      falls back to operator-provided server defaults when available. If no usable key
                      is available — or yours is rejected or out of credit — you'll see a clear error
                      telling you exactly what to fix.
                    </p>
                  </div>
                </div>
              </div>

              {/* API Keys Section */}
              <div className="glass-card rounded-xl p-6">
                <h2 className="font-heading text-xl font-semibold text-white mb-2">
                  API Configuration
                </h2>
                <p className="text-white/50 text-sm mb-6">
                  Add your own API keys to use instead of the server defaults. Keys are encrypted at
                  rest and never shown again after saving.
                </p>

                <div className="space-y-6">
                  {KEY_PROVIDERS.map((api) => (
                    <div key={api.id} className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-sm text-white/80">{api.label}</label>
                        {keyStatus[`has_${api.id}_key`] ? (
                          <span className="flex items-center gap-1 text-xs text-rating-high">
                            <Check className="w-3 h-3" />
                            Configured
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-xs text-white/40">
                            <X className="w-3 h-3" />
                            Not configured
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-white/40 mb-2">
                        {api.description} · <a href={api.link} target="_blank" rel="noopener noreferrer" className="text-lime hover:underline">Get key</a>
                      </p>
                      <div className="flex gap-2">
                        <div className="relative flex-1">
                          <Input
                            type={showKeys[api.id] ? "text" : "password"}
                            value={apiKeys[api.id]}
                            onChange={(e) => setApiKeys((prev) => ({ ...prev, [api.id]: e.target.value }))}
                            data-testid={`${api.id}-key-input`}
                            placeholder={keyStatus[`has_${api.id}_key`] ? "••••••••••••••• (key saved)" : "Enter your API key..."}
                            className="bg-void border-white/10 text-white pr-10"
                          />
                          <button
                            type="button"
                            onClick={() => toggleShowKey(api.id)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white"
                          >
                            {showKeys[api.id] ? (
                              <EyeOff className="w-4 h-4" />
                            ) : (
                              <Eye className="w-4 h-4" />
                            )}
                          </button>
                        </div>
                        <Button
                          onClick={() => saveApiKey(api.id)}
                          disabled={savingKey === api.id || !apiKeys[api.id]}
                          data-testid={`save-${api.id}-btn`}
                          className="bg-lime text-void hover:bg-lime-hover disabled:opacity-50"
                        >
                          {savingKey === api.id ? (
                            <span className="animate-spin">...</span>
                          ) : (
                            <Save className="w-4 h-4" />
                          )}
                        </Button>
                        {keyStatus[`has_${api.id}_key`] && (
                          <Button
                            onClick={() => clearApiKey(api.id)}
                            disabled={savingKey === api.id}
                            data-testid={`clear-${api.id}-btn`}
                            variant="outline"
                            className="border-red-500/30 text-red-400 hover:bg-red-500/10"
                          >
                            <X className="w-4 h-4" />
                          </Button>
                        )}
                      </div>
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
                    <label htmlFor="default-niche-label" className="text-sm text-white/60 mb-2 block">Default Niche</label>
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
                    <label htmlFor="default-tone-label" className="text-sm text-white/60 mb-2 block">Default Tone</label>
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
                    className="w-full bg-lime text-void hover:bg-lime-hover mt-4"
                  >
                    {loading ? "Saving..." : "Save Preferences"}
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
};

export default Settings;
