import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { toast } from "sonner";
import { useAuth, API } from "../App";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import {
  Sparkles,
  ArrowLeft,
  Eye,
  EyeOff,
  Save,
  Check,
  X,
  AlertCircle,
} from "lucide-react";

const NICHES = ["AI", "Web Dev", "Data Science", "Startups", "Productivity"];
const TONES = ["Professional", "Casual", "Bold"];

const Settings = () => {
  const navigate = useNavigate();
  const { token } = useAuth();
  const [preferences, setPreferences] = useState({
    default_niche: "AI",
    default_tone: "professional",
  });
  const [apiKeys, setApiKeys] = useState({
    tavily: "",
    anthropic: "",
    openai: "",
  });
  const [keyStatus, setKeyStatus] = useState({
    has_tavily_key: false,
    has_anthropic_key: false,
    has_openai_key: false,
  });
  const [showKeys, setShowKeys] = useState({
    tavily: false,
    anthropic: false,
    openai: false,
  });
  const [loading, setLoading] = useState(false);
  const [savingKey, setSavingKey] = useState(null);

  const headers = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    fetchPreferences();
  }, []);

  const fetchPreferences = async () => {
    try {
      const res = await axios.get(`${API}/preferences`, { headers });
      setPreferences({
        default_niche: res.data.default_niche || "AI",
        default_tone: res.data.default_tone || "professional",
      });
      setKeyStatus({
        has_tavily_key: res.data.has_tavily_key || false,
        has_anthropic_key: res.data.has_anthropic_key || false,
        has_openai_key: res.data.has_openai_key || false,
      });
    } catch (error) {
      console.error("Failed to load preferences");
    }
  };

  const savePreferences = async () => {
    setLoading(true);
    try {
      await axios.post(`${API}/preferences`, {
        default_tone: preferences.default_tone,
        default_niche: preferences.default_niche,
      }, { headers });
      toast.success("Preferences saved!");
    } catch (error) {
      toast.error("Failed to save preferences");
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
      await axios.post(`${API}/preferences`, {
        [fieldMap[keyType]]: keyValue,
      }, { headers });
      
      setKeyStatus(prev => ({
        ...prev,
        [statusMap[keyType]]: !!keyValue,
      }));
      setApiKeys(prev => ({ ...prev, [keyType]: "" }));
      toast.success(`${keyType.charAt(0).toUpperCase() + keyType.slice(1)} API key ${keyValue ? "saved" : "removed"}!`);
    } catch (error) {
      toast.error(`Failed to save ${keyType} API key`);
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
      await axios.post(`${API}/preferences`, {
        [fieldMap[keyType]]: "",
      }, { headers });
      
      setKeyStatus(prev => ({
        ...prev,
        [statusMap[keyType]]: false,
      }));
      toast.success(`${keyType.charAt(0).toUpperCase() + keyType.slice(1)} API key removed`);
    } catch (error) {
      toast.error(`Failed to remove ${keyType} API key`);
    } finally {
      setSavingKey(null);
    }
  };

  const toggleShowKey = (key) => {
    setShowKeys(prev => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div className="min-h-screen bg-void">
      {/* Navbar */}
      <nav className="fixed top-0 left-0 right-0 z-50 border-b border-white/5 bg-void/90 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate("/dashboard")}
              data-testid="back-btn"
              className="p-2 text-white/60 hover:text-white transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-lime" />
              <span className="font-heading font-bold text-lg text-white">Settings</span>
            </div>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="pt-20 pb-12 px-6">
        <div className="max-w-2xl mx-auto space-y-8">
          {/* Info Banner */}
          <div className="glass-card rounded-xl p-4 border-l-4 border-lime">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-lime flex-shrink-0 mt-0.5" />
              <div className="text-sm">
                <p className="text-white font-medium mb-1">API Key Priority</p>
                <p className="text-white/60">
                  Your own API keys (set below) are used first. If not configured, the app falls back to the Universal Key. 
                  If that's also unavailable or out of balance, you'll see an error message.
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
              Add your own API keys to use instead of the Universal Key. Keys are stored securely.
            </p>

            <div className="space-y-6">
              {[
                { 
                  id: "tavily", 
                  label: "Tavily API Key",
                  description: "For live trend research from Reddit, Google Trends, and news",
                  link: "https://tavily.com"
                },
                { 
                  id: "anthropic", 
                  label: "Anthropic API Key (Claude)",
                  description: "For AI-powered idea generation and audience insights",
                  link: "https://console.anthropic.com"
                },
                { 
                  id: "openai", 
                  label: "OpenAI API Key (GPT)",
                  description: "For writing LinkedIn posts",
                  link: "https://platform.openai.com"
                },
              ].map((api) => (
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
                        Using fallback
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
                        onChange={(e) => setApiKeys(prev => ({ ...prev, [api.id]: e.target.value }))}
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
                <label className="text-sm text-white/60 mb-2 block">Default Niche</label>
                <Select
                  value={preferences.default_niche}
                  onValueChange={(value) => setPreferences(prev => ({ ...prev, default_niche: value }))}
                >
                  <SelectTrigger className="w-full bg-void border-white/10 text-white" data-testid="default-niche-selector">
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
                <label className="text-sm text-white/60 mb-2 block">Default Tone</label>
                <Select
                  value={preferences.default_tone}
                  onValueChange={(value) => setPreferences(prev => ({ ...prev, default_tone: value }))}
                >
                  <SelectTrigger className="w-full bg-void border-white/10 text-white" data-testid="default-tone-selector">
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
        </div>
      </main>
    </div>
  );
};

export default Settings;
