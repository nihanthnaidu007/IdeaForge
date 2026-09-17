import { useState, useRef } from "react";
import { toast } from "sonner";
import Navbar from "@/components/layout/Navbar";
import TrendRadar from "@/components/dashboard/TrendRadar";
import IdeaCard from "@/components/dashboard/IdeaCard";
import VariantCompare, { FormatPicker } from "@/components/dashboard/VariantCompare";
import PostPreview from "@/components/dashboard/PostPreview";
import { EmptyState, ErrorState } from "@/components/states/AsyncStates";
import { api } from "@/api/client";
import { useAuth } from "@/context/AuthContext";
import { Sparkles } from "lucide-react";

const SCANNING_MESSAGES = [
  "Scanning live trends...",
  "Checking tech news...",
  "Analyzing AI news...",
  "Scoring ideas...",
];

const Dashboard = () => {
  const { user } = useAuth();
  const [niche, setNiche] = useState("AI");
  const [tone, setTone] = useState("Professional");
  const [loading, setLoading] = useState(false);
  const [scanningText, setScanningText] = useState("");
  const [ideas, setIdeas] = useState([]);
  const [generateError, setGenerateError] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [insights, setInsights] = useState({});
  const [selectedIdea, setSelectedIdea] = useState(null);
  const [selectedFormat, setSelectedFormat] = useState(null);
  const [customInstructions, setCustomInstructions] = useState("");
  const [generatedPost, setGeneratedPost] = useState("");
  const [postLoading, setPostLoading] = useState(false);
  const [tweakMode, setTweakMode] = useState(false);
  const [tweakInstruction, setTweakInstruction] = useState("");

  const scanTimer = useRef(null);
  const stopScanTimer = () => {
    if (scanTimer.current) {
      clearInterval(scanTimer.current);
      scanTimer.current = null;
    }
    setScanningText("");
  };

  const generateIdeas = async () => {
    setLoading(true);
    setIdeas([]);
    setGenerateError(null);
    setExpandedId(null);
    setSelectedIdea(null);
    setSelectedFormat(null);
    setGeneratedPost("");
    setInsights({});

    let messageIndex = 0;
    scanTimer.current = setInterval(() => {
      setScanningText(SCANNING_MESSAGES[messageIndex % SCANNING_MESSAGES.length]);
      messageIndex++;
    }, 1500);

    try {
      // Step 1: live trend research (Tavily)
      const research = await api.post("/research", { niche, tone: tone.toLowerCase() });
      // Step 2: scored idea generation
      const data = await api.post("/generate-ideas", {
        raw_trends: research.raw_trends,
        niche,
        tone: tone.toLowerCase(),
      });
      // Guard the response shape: a malformed payload renders as an empty
      // honest state, never as a runtime crash or fabricated content.
      setIdeas(Array.isArray(data.ideas) ? data.ideas : []);
      toast.success("Ideas generated successfully!");
    } catch (error) {
      // Honest failure: the typed error renders in place — no fabricated
      // trends, no stale data pretending to be fresh.
      setGenerateError(error);
      toast.error(error.message);
    } finally {
      stopScanTimer();
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
      toast.success("Post updated!");
    } catch (error) {
      toast.error(error.message);
    } finally {
      setPostLoading(false);
    }
  };

  const copyPost = () => {
    navigator.clipboard.writeText(generatedPost);
    toast.success("Copied to clipboard!");
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
      toast.success("Idea saved!");
    } catch (error) {
      toast.error(error.message);
    }
  };

  return (
    <div className="min-h-screen bg-void">
      <Navbar
        center={
          <span className="hidden md:inline text-sm text-white/40">
            {user?.name ?? user?.email}
          </span>
        }
      />

      {/* Main Content */}
      <main className="pt-20 pb-12 px-6">
        <div className="max-w-4xl mx-auto">
          <TrendRadar
            niche={niche}
            onNicheChange={setNiche}
            tone={tone}
            onToneChange={setTone}
            loading={loading}
            scanningText={scanningText}
            onGenerate={generateIdeas}
          />

          {/* Honest failure state for idea generation — replaces the old
              behavior of leaving stale ideas on screen */}
          {generateError && !loading && (
            <div className="mb-8">
              <ErrorState error={generateError} onRetry={generateIdeas} title="Couldn't generate ideas" />
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

          {/* First-run guidance when nothing has been generated yet */}
          {!loading && !generateError && ideas.length === 0 && (
            <EmptyState
              icon={Sparkles}
              title="Your idea forge is ready"
              description="Pick a niche and generate ideas — IdeaForge scans live Tech & AI trends and scores the best post opportunities for you."
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
              onCraft={() => generatePost("/generate-post", "Post generated!")}
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
              onRegenerate={() => generatePost("/regenerate-post", "Post regenerated!")}
              onSave={() => saveIdea(selectedIdea, selectedIdea.index, true)}
            />
          )}
        </div>
      </main>
    </div>
  );
};

export default Dashboard;
