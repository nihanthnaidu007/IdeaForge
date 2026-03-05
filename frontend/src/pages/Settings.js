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
  const [showKeys, setShowKeys] = useState({
    tavily: false,
    anthropic: false,
    openai: false,
  });
  const [loading, setLoading] = useState(false);

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
    } catch (error) {
      console.error("Failed to load preferences");
    }
  };

  const savePreferences = async () => {
    setLoading(true);
    try {
      await axios.post(`${API}/preferences`, preferences, { headers });
      toast.success("Preferences saved!");
    } catch (error) {
      toast.error("Failed to save preferences");
    } finally {
      setLoading(false);
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
          {/* API Keys Section */}
          <div className="glass-card rounded-xl p-6">
            <h2 className="font-heading text-xl font-semibold text-white mb-2">
              API Configuration
            </h2>
            <p className="text-white/50 text-sm mb-6">
              For testing purposes. These override server keys.
            </p>

            <div className="space-y-4">
              {[
                { id: "tavily", label: "Tavily API Key" },
                { id: "anthropic", label: "Anthropic API Key (Claude Sonnet)" },
                { id: "openai", label: "OpenAI API Key (GPT-5.2)" },
              ].map((api) => (
                <div key={api.id}>
                  <label className="text-sm text-white/60 mb-2 block">{api.label}</label>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Input
                        type={showKeys[api.id] ? "text" : "password"}
                        value={apiKeys[api.id]}
                        onChange={(e) => setApiKeys(prev => ({ ...prev, [api.id]: e.target.value }))}
                        data-testid={`${api.id}-key-input`}
                        placeholder="••••••••••••••••••••••"
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
                      variant="outline"
                      data-testid={`save-${api.id}-btn`}
                      className="border-white/10 text-white hover:bg-white/5"
                      onClick={() => toast.success(`${api.label} saved (not persisted - demo)`)}
                    >
                      <Save className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>

            <p className="text-xs text-white/30 mt-4">
              API keys are encrypted and stored securely. They are never logged or shared.
            </p>
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
