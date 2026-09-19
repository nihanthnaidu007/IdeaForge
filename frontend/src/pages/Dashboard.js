import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import Navbar from "@/components/layout/Navbar";
import SkipLink from "@/components/layout/SkipLink";
import TrendRadar from "@/components/dashboard/TrendRadar";
import IdeaCard from "@/components/dashboard/IdeaCard";
import VariantCompare, { FormatPicker } from "@/components/dashboard/VariantCompare";
import HookPicker from "@/components/dashboard/HookPicker";
import PostPreview from "@/components/dashboard/PostPreview";
import { EmptyState, ErrorState, StaleBanner } from "@/components/states/AsyncStates";
import { api, isKeyIssueError } from "@/api/client";
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
  if (kind === "cap") {
    // Wave 1 caps: headline only — the body composes from the typed cap
    // fields (allowance / resource / reset) in ErrorState's capCardBody, and
    // the single primary action is always "Add your own key" → Settings.
    return { headline: "Daily allowance spent." };
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
  const [insightHint, setInsightHint] = useState(null);
  const [researchHint, setResearchHint] = useState(null);
  const [selectedIdea, setSelectedIdea] = useState(null);
  const [selectedFormat, setSelectedFormat] = useState(null);
  const [customInstructions, setCustomInstructions] = useState("");
  const [variantHint, setVariantHint] = useState(null);
  const [variantSet, setVariantSet] = useState(null);
  const [variantsLoading, setVariantsLoading] = useState(false);
  const [variantsError, setVariantsError] = useState(null);
  const [tweakingIndex, setTweakingIndex] = useState(null);
  const [pickedIndex, setPickedIndex] = useState(null);
  const [selectedHookId, setSelectedHookId] = useState(null);
  const [hasSourcedTrends, setHasSourcedTrends] = useState(false);
  const [generatedPost, setGeneratedPost] = useState("");
  const [postLoading, setPostLoading] = useState(false);
  const [tweakMode, setTweakMode] = useState(false);
  const [tweakInstruction, setTweakInstruction] = useState("");
  // The research that produced the current ideas: variants and insight cards
  // carry it forward so generation stays grounded in the same evidence.
  const lastResearchRef = useRef({ trends: [], researched_at: null });

  const generateIdeas = async () => {
    setLoading(true);
    setGenerateError(null);
    setStaleAsOf(null);
    setStaleDismissed(false);
    setExpandedId(null);
    setSelectedIdea(null);
    setSelectedFormat(null);
    setSelectedHookId(null);
    setGeneratedPost("");
    setPickedIndex(null);
    setVariantSet(null);
    setVariantsError(null);
    setInsights({});

    // §3.2 loading: name the machine — this runs a real search on the key —
    // then hand over to §3.3's forging line for the model step.
    setScanningText(`Reading the live web for ${niche} — this runs a real search on your key.`);
    setScanningSub("Live searches take a few seconds; trends arrive with sources and freshness labels.");

    try {
      // Step 1: live trend research (Tavily)
      const research = await api.post("/research", { niche, tone: tone.toLowerCase() });
      // Kept for downstream variant + insight-card generation: the same
      // evidence grounds every later call on this dashboard run.
      lastResearchRef.current = {
        trends: Array.isArray(research.raw_trends) ? research.raw_trends : [],
        researched_at: research.researched_at ?? new Date().toISOString(),
      };
      // Source gate data for the Hook Picker (craft pack §6.2): a
      // requires_source hook unlocks only when the trend context this idea
      // was forged from carries at least one sourced claim. Unknown context
      // (e.g. a page reload) keeps the conservative locked default.
      setHasSourcedTrends(
        (research?.raw_trends ?? []).some((t) => t?.url || t?.source),
      );
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
      // Key-issue states (missing key, auth, quota, bundled cap) are fixed in
      // Settings, not by retrying — their honest card must render even when
      // earlier ideas are on screen (UI pack §3.1: one action per state).
      if (isKeyIssueError(error)) {
        setStaleAsOf(null);
        setGenerateError(error);
      } else if (ideas.length > 0 && lastRunAt) {
        // §3.1 stale contract: when a refresh fails while old data is on
        // screen, the old data stays under the dated stale banner — the error
        // card replaces it only when there was nothing to keep.
        setStaleAsOf(lastRunAt);
      } else {
        setGenerateError(error);
      }
      toast.error(error.message);
    } finally {
      setScanningText("");
      setScanningSub("");
      setLoading(false);
    }
  };

  const generateInsights = async (idea, index) => {
    // Explicit user action (§6 BYOK rule): the card costs the user's own
    // credits, so it never fires on expansion alone.
    setInsights((prev) => ({ ...prev, [index]: { status: "loading" } }));
    try {
      const refresh = insights[index]?.status === "done";
      const data = await api.post("/idea-insights", {
        idea,
        niche,
        tone: tone.toLowerCase(),
        trends: lastResearchRef.current.trends,
        researched_at: lastResearchRef.current.researched_at,
        refresh,
      });
      setInsights((prev) => ({
        ...prev,
        [index]: { status: "done", data: data.insights ?? data, cost_hint: data.cost_hint ?? null },
      }));
    } catch (error) {
      // Retryable inline; nothing fabricated is rendered on failure.
      setInsights((prev) => ({ ...prev, [index]: { status: "error", error } }));
    }
  };

  const toggleExpand = (index) => {
    setExpandedId(expandedId === index ? null : index);
  };

  const selectIdea = (idea, index) => {
    setSelectedIdea({ ...idea, index });
    setSelectedFormat(null);
    setSelectedHookId(null);
    setGeneratedPost("");
    setPickedIndex(null);
    setVariantSet(null);
    setVariantsError(null);
  };

  // Craft three named variants off the idea's insight card + the user's
  // Voice DNA. The response carries the cost hint for the NEXT call and a
  // variant_set whose columns render side by side.
  const generateVariants = async () => {
    if (!selectedIdea || !selectedFormat) return;
    setVariantsLoading(true);
    setVariantsError(null);
    try {
      const data = await api.post("/generate-variants", {
        idea: selectedIdea,
        format: selectedFormat,
        tone: tone.toLowerCase(),
        custom_instructions: customInstructions,
        insights: insights[selectedIdea.index]?.data || null,
        trends: lastResearchRef.current.trends,
        researched_at: lastResearchRef.current.researched_at,
        // §1.3 hook injection: the selected pattern governs the first line.
        hook_id: selectedHookId || null,
      });
      setVariantSet(data.variant_set);
      setVariantHint(data.cost_hint?.hint ?? null);
      setGeneratedPost("");
      setPickedIndex(null);
      toast.success("Three variants ready");
    } catch (error) {
      // Typed provider errors (missing key / quota / refusal) surface with
      // their honest message — no substitute content, no silent fallback.
      setVariantsError(error);
      toast.error(error.message);
    } finally {
      setVariantsLoading(false);
    }
  };

  // Regenerate re-sends the SAME idea but the backend rotates the brief
  // assignments — new strategic instructions every round, never a re-run
  // of identical prompts (the audited §1.3 route-9 defect).
  const regenerateVariants = async () => {
    if (!selectedIdea || !selectedFormat || !variantSet) return;
    setVariantsLoading(true);
    setVariantsError(null);
    try {
      const data = await api.post("/regenerate-post", {
        idea: selectedIdea,
        format: selectedFormat,
        tone: tone.toLowerCase(),
        custom_instructions: customInstructions,
        insights: insights[selectedIdea.index]?.data || null,
        parent_set_id: variantSet.id,
        trends: lastResearchRef.current.trends,
        researched_at: lastResearchRef.current.researched_at,
      });
      setVariantSet(data.variant_set);
      setVariantHint(data.cost_hint?.hint ?? null);
      setGeneratedPost("");
      setPickedIndex(null);
      toast.success("Fresh variants drafted");
    } catch (error) {
      setVariantsError(error);
      toast.error(error.message);
    } finally {
      setVariantsLoading(false);
    }
  };

  const pickVariant = (index) => {
    const variant = variantSet?.variants?.[index];
    if (!variant || variant.status !== "ready") return;
    setGeneratedPost(variant.post_text);
    setPickedIndex(index);
    setTweakMode(false);
    setTweakInstruction("");
  };

  const copyVariant = (index) => {
    const variant = variantSet?.variants?.[index];
    if (!variant || variant.status !== "ready") return;
    navigator.clipboard.writeText(variant.post_text);
    toast.success(`Variant ${["A", "B", "C"][index] ?? index + 1} copied to clipboard`);
  };

  // Tweak by instruction: versioned on the backend (the prior draft lands
  // in the variant's versions trail — never silently overwritten). The
  // response carries the updated variant only; it merges into the local set.
  const tweakVariant = async (index, instruction) => {
    if (!variantSet || !instruction) return;
    setTweakingIndex(index);
    try {
      const data = await api.post("/tweak-variant", {
        set_id: variantSet.id,
        variant_index: index,
        instruction,
      });
      const updated = data.variant;
      setVariantSet((prev) => ({
        ...prev,
        variants: prev.variants.map((v, i) => (i === index ? updated : v)),
      }));
      setVariantHint(data.cost_hint?.hint ?? null);
      if (pickedIndex === index) {
        setGeneratedPost(updated.post_text);
      }
      toast.success(`Variant ${["A", "B", "C"][index] ?? index + 1} tweaked`);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setTweakingIndex(null);
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

  // Cost hints (§6 BYOK rule): one batched estimate for insight cards when a
  // fresh idea set lands, and a per-format estimate for variant generation
  // when a format is picked — both fetched BEFORE any spend happens.
  // §6 cost law at the loop's FIRST spend: the combined research→forge run's
  // estimate loads with the dashboard, before the button can fire. The hint
  // covers what the run costs by end of wave — Tavily search + trend
  // enrichment + one ideas call ("a few model calls" per the backend string).
  // Advisory like the other hints: if estimation fails, no invented number is
  // rendered and the run stays possible.
  useEffect(() => {
    let cancelled = false;
    api
      .get("/cost-estimate?action=research")
      .then((hint) => {
        if (!cancelled) setResearchHint(hint.hint ?? null);
      })
      .catch(() => {
        if (!cancelled) setResearchHint(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (ideas.length === 0) return;
    api
      .get("/cost-estimate?action=insight_card_first")
      .then((hint) => {
        if (!cancelled) setInsightHint(hint.hint);
      })
      .catch(() => {
        // Estimation is advisory; its failure never blocks generation.
        if (!cancelled) setInsightHint(null);
      });
    return () => {
      cancelled = true;
    };
  }, [ideas]);

  useEffect(() => {
    let cancelled = false;
    setVariantHint(null);
    if (!selectedFormat || variantSet) return;
    api
      .get(
        `/cost-estimate?action=generate_variant&format=${encodeURIComponent(selectedFormat)}`,
      )
      .then((hint) => {
        if (!cancelled) setVariantHint(hint.hint);
      })
      .catch(() => {
        // Estimation is advisory; its failure never blocks generation.
        if (!cancelled) setVariantHint(null);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedFormat, variantSet]);

  const saveIdea = async (idea, index, withPost = false) => {
    const ideaInsights = insights[index]?.data || {};
    try {
      await api.post("/save-idea", {
        topic_title: idea.title,
        rating: idea.rating,
        rating_explanation: idea.rating_explanation,
        targeted_audience: ideaInsights.audience?.primary ?? null,
        why_it_matters: ideaInsights.why_it_matters ?? null,
        // The save contract (SaveIdeaRequest.key_aspects) stores plain strings;
        // insight cards carry structured {aspect, tension} rows — map to names.
        key_aspects: Array.isArray(ideaInsights.key_aspects)
          ? ideaInsights.key_aspects
              .map((a) => (typeof a === "string" ? a : a.aspect))
              .filter(Boolean)
          : null,
        post_angles: ideaInsights.post_angles ?? null,
        evidence_gaps: ideaInsights.evidence_gaps ?? null,
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
            costHint={researchHint}
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
                  insightsCostHint={insightHint}
                  onGenerateInsights={() => generateInsights(idea, index)}
                  onExplore={() => selectIdea(idea, index)}
                  onSave={() => saveIdea(idea, index)}
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

          {/* Variant Compare: stays up after picking so the picked note and
              the version trail remain visible next to the preview */}
          {selectedFormat && pickedIndex == null && (
            <VariantCompare
              selectedFormat={selectedFormat}
              instructions={customInstructions}
              onInstructionsChange={setCustomInstructions}
              onCraft={generateVariants}
              crafting={variantsLoading}
              costHint={variantHint}
              variantSet={variantSet}
              variantsLoading={variantsLoading}
              variantsError={variantsError}
              onRegenerate={regenerateVariants}
              onPickVariant={pickVariant}
              onCopyVariant={copyVariant}
              onTweakVariant={tweakVariant}
              tweakingIndex={tweakingIndex}
              pickedIndex={pickedIndex}
              pickedBriefName={variantSet?.variants?.[pickedIndex]?.brief_name}
            />
          )}

          {/* §6.2 Hook Picker (select mode): gates requires_source hooks on
              the trend context's sourced claims; the pick rides into
              generate/regenerate as hook_id. */}
          {selectedFormat && !generatedPost && (
            <HookPicker
              format={selectedFormat}
              selectedHookId={selectedHookId}
              onSelect={setSelectedHookId}
              hasSourcedClaims={hasSourcedTrends}
            />
          )}

          {/* Generated Post — the picked variant, refined via /tweak-post */}
          {pickedIndex != null && generatedPost && (
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
              onRegenerate={regenerateVariants}
              onSave={() => saveIdea(selectedIdea, selectedIdea.index, true)}
            />
          )}

          {/* §6.2 Hook Picker (swap mode): on a live draft the picker swaps
              the opening line and regenerates — §6.5 cost line rendered
              inside the picker's own panel. */}
          {generatedPost && selectedFormat && (
            <HookPicker
              format={selectedFormat}
              originalPost={generatedPost}
              idea={selectedIdea}
              tone={tone.toLowerCase()}
              onSwapped={(post) => setGeneratedPost(post)}
              hasSourcedClaims={hasSourcedTrends}
            />
          )}
        </div>
      </main>
    </div>
  );
};

export default Dashboard;
