import { useState } from "react";
import { toast } from "sonner";
import Navbar from "@/components/layout/Navbar";
import SkipLink from "@/components/layout/SkipLink";
import TrendRadar from "@/components/dashboard/TrendRadar";
import IdeaCard from "@/components/dashboard/IdeaCard";
import VariantCompare, { FormatPicker } from "@/components/dashboard/VariantCompare";
import PostPreview from "@/components/dashboard/PostPreview";
import { EmptyState, ErrorState, StaleBanner } from "@/components/states/AsyncStates";
import { api } from "@/api/client";
import { useAuth } from "@/context/AuthContext";
import { Sparkles } from "lucide-react";

// Error-card strings for the combined research→forge flow, per the UI & Copy
// Craft Pack: §3.2 (Trend Radar) and §3.3 (Idea Forge) give this surface's
// copy verbatim; §3.3 defers 401/402/429/503/network to the §3.1 kind map,
// so those bodies are honest operator sentences (flagged for pack backport).
const RESEARCH_PROVIDERS = new Set(["tavily"]);
const PROVIDER_BILLING_URLS = {
  tavily: "https://app.tavily.com",
  openai: "https://platform.openai.com",
  anthropic: "https://console.anthropic.com",
};
const PROVIDER_NAMES = { tavily: "Tavily", openai: "OpenAI", anthropic: "Anthropic" };

const forgeStrings = (error) => {
  if (!error) return undefined;
  const kind = error.kind;
  const provider = error.provider ?? "openai";
  const isResearch = RESEARCH_PROVIDERS.has(provider);

  if (kind === "missing_key") {
    if (isResearch) {
      // §3.2 400 verbatim.
      return {
        headline: "No Tavily key connected.",
        body: "Trend Radar reads the live web, and that requires a Tavily key. Add one in Settings — research runs on your key and bills only to your Tavily account.",
        primary: "Add Tavily key",
      };
    }
    // §3.3 400 verbatim.
    return {
      headline: "No generation key connected.",
      body: "Forging ideas runs a model call, which needs an Anthropic or OpenAI key. Add one in Settings — it's billed only to your own account.",
      primary: "Add key",
    };
  }
  if (kind === "quota") {
    if (isResearch) {
      // §3.2 402 verbatim: primary Retry (post-top-up), secondary billing link.
      return {
        headline: "Your Tavily account is out of quota or credit.",
        body: "Add credit in your Tavily billing page, then retry. IdeaForge never meters or marks up provider usage.",
        primary: "Retry",
        secondary: { label: "Open Tavily billing", href: PROVIDER_BILLING_URLS.tavily },
      };
    }
    // §3.1 map: the fix is the provider console; Settings remains reachable.
    return { headline: `Your ${PROVIDER_NAMES[provider] ?? provider} account is out of quota or credit.` };
  }
  if (kind === "research_failed") {
    // §3.2 502 verbatim, {cause} filled from the backend's detail sentence.
    const cause = error.message && error.message !== "The research service didn't return usable results — try again."
      ? ` (${error.message})`
      : "";
    return {
      headline: "Research failed.",
      body: `Tavily didn't return usable results${cause}. Nothing was saved; your previous research is untouched.`,
    };
  }
  if (kind === "generation_failed") {
    // §3.3 502 verbatim.
    return {
      headline: "Idea forging failed.",
      body: "The model's response wasn't usable after a retry. Nothing was saved; retrying runs a new call on your key.",
    };
  }
  if (kind === "rate_limited") {
    if (isResearch) {
      // §3.2 429 verbatim; {retry_after} filled from Retry-After (live
      // countdown continues on the button).
      return {
        headline: "Too many searches, too fast.",
        body: `Tavily is rate-limiting your key. Retry unlocks in ${error.retryAfter ?? "?"}s.`,
      };
    }
    // New string for the drafting-engine case — flag for pack backport.
    return {
      headline: "Too many requests, too fast.",
      body: `Your ${PROVIDER_NAMES[provider] ?? provider} key is rate-limited. Retry unlocks in ${error.retryAfter ?? "?"}s.`,
    };
  }
  if (kind === "unavailable") {
    if (isResearch) {
      // §3.2 503 verbatim.
      return {
        headline: "Tavily is unreachable right now.",
        body: "This is on Tavily's side and usually clears in minutes. Nothing was saved; your previous research is untouched.",
      };
    }
    // New string for the drafting-engine case — flag for pack backport.
    const name = PROVIDER_NAMES[provider] ?? provider;
    return {
      headline: `${name} is unreachable right now.`,
      body: `This is on ${name}'s side and usually clears in minutes. Nothing was saved; your previous research is untouched.`,
    };
  }
  if (kind === "network") {
    // New strings (§3.1 defers network to Retry) — flag for pack backport.
    return {
      headline: "Couldn't reach the forge.",
      body: "Nothing was saved — check your connection and retry.",
    };
  }
  if (kind === "server") {
    // §1: "That failed" is the sanctioned 500-class opener we own.
    return {
      headline: "That failed.",
      body: "Nothing was saved — retrying runs the request again on your key.",
    };
  }
  return undefined;
};

const Dashboard = () => {
  const { user } = useAuth();
  const [niche, setNiche] = useState("AI");
  const [tone, setTone] = useState("Professional");
  const [loading, setLoading] = useState(false);
  const [scanningText, setScanningText] = useState("");
  const [scanningSub, setScanningSub] = useState("");
  const [ideas, setIdeas] = useState([]);
  const [generateError, setGenerateError] = useState(null);
  const [lastRunAt, setLastRunAt] = useState(null);
  const [staleAsOf, setStaleAsOf] = useState(null);
  const [staleDismissed, setStaleDismissed] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const [insights, setInsights] = useState({});
  const [selectedIdea, setSelectedIdea] = useState(null);
  const [selectedFormat, setSelectedFormat] = useState(null);
  const [customInstructions, setCustomInstructions] = useState("");
  const [generatedPost, setGeneratedPost] = useState("");
  const [postLoading, setPostLoading] = useState(false);
  const [tweakMode, setTweakMode] = useState(false);
  const [tweakInstruction, setTweakInstruction] = useState("");

  const generateIdeas = async () => {
    setLoading(true);
    setGenerateError(null);
    setStaleAsOf(null);
    setStaleDismissed(false);
    setExpandedId(null);
    setSelectedIdea(null);
    setSelectedFormat(null);
    setGeneratedPost("");
    setInsights({});

    // §3.2 loading: name the machine — this runs a real search on the key —
    // then hand over to §3.3's forging line for the model step.
    setScanningText(`Reading the live web for ${niche} — this runs a real search on your key.`);
    setScanningSub("Live searches take a few seconds; trends arrive with sources and freshness labels.");

    try {
      // Step 1: live trend research (Tavily)
      const research = await api.post("/research", { niche, tone: tone.toLowerCase() });
      setScanningText("Forging ideas from your research…");
      setScanningSub("");
      // Step 2: scored idea generation
      const data = await api.post("/generate-ideas", {
        raw_trends: research.raw_trends,
        niche,
        tone: tone.toLowerCase(),
      });
      // Guard the response shape: a malformed payload renders as an empty
      // honest state, never as a runtime crash or fabricated content.
      setIdeas(Array.isArray(data.ideas) ? data.ideas : []);
      setLastRunAt(new Date().toISOString());
      toast.success("Ideas forged");
    } catch (error) {
      // §3.1 stale contract: when a refresh fails while old data is on
      // screen, the old data stays under the dated stale banner — the error
      // card replaces it only when there was nothing to keep.
      if (ideas.length > 0 && lastRunAt) {
        setStaleAsOf(lastRunAt);
        toast.error(error.message);
      } else {
        setGenerateError(error);
        toast.error(error.message);
      }
    } finally {
      setScanningText("");
      setScanningSub("");
      setLoading(false);
    }
  };

  const loadInsights = async (idea, index) => {
    setInsights((prev) => ({ ...prev, [index]: { status: "loading" } }));
    try {
      const data = await api.post("/idea-insights", {
        idea,
        niche,
        tone: tone.toLowerCase(),
      });
      setInsights((prev) => ({ ...prev, [index]: { status: "done", data } }));
    } catch (error) {
      // Retryable inline; nothing fabricated is rendered on failure.
      setInsights((prev) => ({ ...prev, [index]: { status: "error", error } }));
    }
  };

  const toggleExpand = async (index) => {
    if (expandedId === index) {
      setExpandedId(null);
    } else {
      setExpandedId(index);
      await loadInsights(ideas[index], index);
    }
  };

  const selectIdea = (idea, index) => {
    setSelectedIdea({ ...idea, index });
    setSelectedFormat(null);
    setGeneratedPost("");
  };

  const generatePost = async (endpoint, successMessage) => {
    setPostLoading(true);
    try {
      const data = await api.post(endpoint, {
        idea: selectedIdea,
        format: selectedFormat,
        tone: tone.toLowerCase(),
        custom_instructions: customInstructions,
        insights: insights[selectedIdea.index]?.data || null,
      });
      setGeneratedPost(data.post);
      toast.success(successMessage);
    } catch (error) {
      // Surface the honest message (missing-key guidance, quota, etc.).
      toast.error(error.message);
    } finally {
      setPostLoading(false);
    }
  };

  const tweakPost = async () => {
    if (!tweakInstruction.trim()) return;
    setPostLoading(true);
    try {
      const data = await api.post("/tweak-post", {
        original_post: generatedPost,
        tweak_instruction: tweakInstruction,
        idea: selectedIdea,
        format: selectedFormat,
      });
      setGeneratedPost(data.post);
      setTweakMode(false);
      setTweakInstruction("");
      toast.success("Post updated");
    } catch (error) {
      toast.error(error.message);
    } finally {
      setPostLoading(false);
    }
  };

  const copyPost = () => {
    navigator.clipboard.writeText(generatedPost);
    toast.success("Copied to clipboard");
  };

  const saveIdea = async (idea, index, withPost = false) => {
    const ideaInsights = insights[index]?.data || {};
    try {
      await api.post("/save-idea", {
        topic_title: idea.title,
        rating: idea.rating,
        rating_explanation: idea.rating_explanation,
        targeted_audience: ideaInsights.targeted_audience,
        why_it_matters: ideaInsights.why_it_matters,
        key_aspects: ideaInsights.key_aspects,
        generated_post: withPost ? generatedPost : null,
        post_format: withPost ? selectedFormat : null,
        niche,
        tone: tone.toLowerCase(),
      });
      toast.success("Idea saved");
    } catch (error) {
      toast.error(error.message);
    }
  };

  return (
    <div className="min-h-screen bg-void">
      <SkipLink />
      <Navbar
        center={
          <span className="hidden md:inline text-sm text-zinc-400">
            {user?.name ?? user?.email}
          </span>
        }
      />

      {/* Main Content */}
      <main id="main-content" className="pt-20 pb-12 px-6">
        <div className="max-w-4xl mx-auto">
          <TrendRadar
            niche={niche}
            onNicheChange={setNiche}
            tone={tone}
            onToneChange={setTone}
            loading={loading}
            scanningText={scanningText}
            scanningSub={scanningSub}
            onGenerate={generateIdeas}
          />

          {/* §3.1 stale-data banner: old data stays after a failed refresh,
              dated — never presented as fresh */}
          {staleAsOf && !staleDismissed && !loading && (
            <StaleBanner
              asOf={staleAsOf}
              onRetry={generateIdeas}
              onDismiss={() => setStaleDismissed(true)}
            />
          )}

          {/* Honest failure state for idea generation — replaces the old
              behavior of leaving stale ideas on screen */}
          {generateError && !loading && !staleAsOf && (
            <div className="mb-8">
              <ErrorState
                error={generateError}
                onRetry={generateIdeas}
                strings={forgeStrings(generateError)}
                title="Idea forging failed."
              />
            </div>
          )}

          {/* Ideas Grid */}
          {ideas.length > 0 && (
            <div className="grid md:grid-cols-2 gap-4 mb-8">
              {ideas.map((idea, index) => (
                <IdeaCard
                  key={index}
                  idea={idea}
                  index={index}
                  expanded={expandedId === index}
                  onToggle={() => toggleExpand(index)}
                  insights={insights[index]}
                  onExplore={() => selectIdea(idea, index)}
                  onSave={() => saveIdea(idea, index)}
                  onRetryInsights={() => loadInsights(idea, index)}
                />
              ))}
            </div>
          )}

          {/* §3.3 empty — no research yet (first run) */}
          {!loading && !generateError && !staleAsOf && ideas.length === 0 && !lastRunAt && (
            <EmptyState
              icon={Sparkles}
              title="The forge burns trend context."
              description="Run research first — ideas are scored against live signals, not vibes."
              testId="dashboard-empty-state"
            />
          )}

          {/* §3.3 empty — research ran clean but forged nothing usable */}
          {!loading && !generateError && !staleAsOf && ideas.length === 0 && lastRunAt && (
            <EmptyState
              icon={Sparkles}
              title="Nothing forged from this research yet."
              description="Forge ideas and you'll get a scored set with one-line explanations of every rating."
              testId="dashboard-empty-state"
            />
          )}

          {/* Format Selector */}
          {selectedIdea && !selectedFormat && (
            <FormatPicker onSelect={setSelectedFormat} />
          )}

          {/* Custom Instructions */}
          {selectedFormat && !generatedPost && (
            <VariantCompare
              selectedFormat={selectedFormat}
              instructions={customInstructions}
              onInstructionsChange={setCustomInstructions}
              onCraft={() => generatePost("/generate-post", "Post generated")}
              crafting={postLoading}
            />
          )}

          {/* Generated Post */}
          {generatedPost && (
            <PostPreview
              post={generatedPost}
              formatLabel={selectedFormat}
              tone={tone}
              postLoading={postLoading}
              tweakMode={tweakMode}
              tweakInstruction={tweakInstruction}
              onTweakInstructionChange={setTweakInstruction}
              onApplyTweak={tweakPost}
              onStartTweak={() => setTweakMode(true)}
              onCancelTweak={() => {
                setTweakMode(false);
                setTweakInstruction("");
              }}
              onCopy={copyPost}
              onRegenerate={() => generatePost("/regenerate-post", "Post regenerated")}
              onSave={() => saveIdea(selectedIdea, selectedIdea.index, true)}
            />
          )}
        </div>
      </main>
    </div>
  );
};

export default Dashboard;
