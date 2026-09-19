import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ChevronDown,
  ChevronUp,
  Star,
  Target,
  Lightbulb,
  ListChecks,
  Compass,
  ShieldQuestion,
  RefreshCw,
  Bookmark,
  Sparkles,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import AiBadge from "@/components/common/AiBadge";
import { LoadingSkeleton } from "@/components/states/AsyncStates";
import TagInput from "@/components/board/TagInput";
import { POST_FORMATS } from "@/lib/constants";

// One scored idea. Collapsed: title + rating bar. Expanded: the insight card
// on the user's explicit action — generation is never fired by expansion
// alone because the card costs the user's own API credits (BYOK rule).
const ratingTier = (rating) => (rating >= 8 ? "high" : rating >= 6 ? "medium" : "low");
const formatLabel = (id) =>
  POST_FORMATS.find((f) => f.id === id || f.id === id?.replace("_", "-"))?.name ?? id;

const IdeaCard = ({
  idea,
  index,
  expanded,
  onToggle,
  insights,
  insightsCostHint,
  onGenerateInsights,
  onExplore,
  onSave,
  tagSuggestions,
}) => {
  // Save-time tag entry (spec Tag completion): ephemeral per card, committed
  // to the backend only when the save button fires. Autocomplete draws from
  // the board's existing tag set so saves extend one consistent set.
  const [saveTags, setSaveTags] = useState([]);
  const tier = ratingTier(idea.rating);
  const ratingWidth = (idea.rating / 10) * 100;
  const card = insights?.status === "done" ? insights.data : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.06 }}
      className={`idea-card glass-card rounded-xl overflow-hidden card-hover ${
        expanded ? "ring-1 ring-lime/30" : ""
      }`}
    >
      {/* Collapsed Header */}
      <button
        onClick={onToggle}
        data-testid={`idea-card-${index}`}
        aria-expanded={expanded}
        className="w-full p-4 text-left"
      >
        <div className="flex items-start justify-between gap-3">
          <h3 className="font-heading font-semibold text-white text-sm leading-tight flex-1">
            {idea.title}
          </h3>
          {expanded ? (
            <ChevronUp className="w-5 h-5 text-zinc-400 flex-shrink-0" />
          ) : (
            <ChevronDown className="w-5 h-5 text-zinc-400 flex-shrink-0" />
          )}
        </div>

        {/* Rating */}
        <div className="mt-3 flex items-center gap-3">
          <div className="flex items-center gap-1">
            <Star className={`w-4 h-4 text-rating-${tier}`} />
            <span className={`font-mono text-sm font-medium text-rating-${tier}`}>
              {idea.rating.toFixed(1)}
            </span>
            <span className="text-zinc-400 text-sm">/ 10</span>
          </div>
          <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 rating-bar-${tier}`}
              style={{ width: `${ratingWidth}%` }}
            />
          </div>
        </div>
      </button>

      {/* Expanded Content */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 space-y-4 border-t border-white/5 pt-4">
              {/* Rating Explanation */}
              <p className="text-zinc-400 text-sm italic">&ldquo;{idea.rating_explanation}&rdquo;</p>

              {/* Insight card — explicit generation with the cost hint shown
                  before the spend (§6 BYOK rule) */}
              {!insights || insights.status === "idle" || insights.status === undefined ? (
                <div
                  className="rounded-lg border border-white/10 bg-white/[0.02] p-4"
                  data-testid={`insights-idle-${index}`}
                >
                  <div className="flex items-start gap-2">
                    <Compass className="w-4 h-4 text-lime mt-0.5" aria-hidden="true" />
                    <div>
                      <p className="text-white text-sm font-medium">Get the insight card</p>
                      <p className="text-zinc-400 text-xs mt-1">
                        Audience, why it matters, key aspects with their tensions, and three
                        ready-to-run post angles — grounded in your research.
                      </p>
                    </div>
                  </div>
                  {insightsCostHint ? (
                    <p
                      className="text-zinc-500 text-xs mt-3"
                      data-testid={`insights-cost-hint-${index}`}
                    >
                      {insightsCostHint}
                    </p>
                  ) : null}
                  <Button
                    onClick={onGenerateInsights}
                    data-testid={`generate-insights-${index}-btn`}
                    size="sm"
                    className="mt-3 bg-lime text-void hover:bg-lime-hover"
                  >
                    <Sparkles className="w-3 h-3 mr-1" aria-hidden="true" />
                    Generate card
                  </Button>
                </div>
              ) : insights.status === "loading" ? (
                <div className="space-y-2" data-testid={`insights-loading-${index}`}>
                  <p className="text-zinc-400 text-sm">Reading this idea from every angle…</p>
                  <LoadingSkeleton className="h-3 w-2/3" />
                  <LoadingSkeleton className="h-3 w-full" />
                  <LoadingSkeleton className="h-3 w-5/6" />
                </div>
              ) : insights.status === "error" ? (
                <div
                  className="text-sm"
                  data-testid={`insights-error-${index}`}
                  role="alert"
                >
                  <p className="text-white font-medium">Insight card failed.</p>
                  <p className="text-zinc-400 mt-1">
                    {insights.error?.message ??
                      "Nothing was saved. The idea itself is untouched — cards are additive."}
                  </p>
                  <Button
                    onClick={onGenerateInsights}
                    data-testid={`retry-insights-${index}-btn`}
                    size="sm"
                    variant="outline"
                    className="border-white/10 text-white hover:bg-white/5"
                  >
                    <RefreshCw className="w-3 h-3 mr-1" />
                    Try again
                  </Button>
                </div>
              ) : (
                <div className="space-y-3" data-testid={`insights-${index}`}>
                  <div className="flex items-center justify-between gap-2">
                    <AiBadge />
                    <span className="text-[10px] uppercase tracking-wider text-white/30">insight card</span>
                  </div>

                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <Target className="w-4 h-4 text-lime" />
                      <span className="text-xs uppercase tracking-wider text-zinc-400">Audience</span>
                    </div>
                    <p className="text-white/80 text-sm">{card.audience?.primary}</p>
                    {card.audience?.reading_trigger ? (
                      <p className="text-zinc-500 text-xs mt-1">Stops them because: {card.audience.reading_trigger}</p>
                    ) : null}
                  </div>

                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <Lightbulb className="w-4 h-4 text-lime" />
                      <span className="text-xs uppercase tracking-wider text-zinc-400">Why It Matters</span>
                    </div>
                    <p className="text-white/80 text-sm">{card.why_it_matters}</p>
                  </div>

                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <ListChecks className="w-4 h-4 text-lime" />
                      <span className="text-xs uppercase tracking-wider text-zinc-400">Key Aspects</span>
                    </div>
                    <ul className="space-y-1.5">
                      {card.key_aspects?.map((aspect, i) => (
                        <li key={i} className="text-white/70 text-sm flex items-start gap-2">
                          <span className="text-lime">•</span>
                          <span>
                            {aspect.aspect}
                            {aspect.tension ? (
                              <span className="text-zinc-500"> — {aspect.tension}</span>
                            ) : null}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {card.post_angles?.length ? (
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <Compass className="w-4 h-4 text-lime" />
                        <span className="text-xs uppercase tracking-wider text-zinc-400">Post Angles</span>
                      </div>
                      <ul className="space-y-2">
                        {card.post_angles.map((angle, i) => (
                          <li
                            key={i}
                            className="rounded-md border border-white/5 bg-white/[0.02] p-2"
                            data-testid={`post-angle-${index}-${i}`}
                          >
                            <p className="text-white/80 text-sm">{angle.angle}</p>
                            <p className="text-zinc-500 text-xs mt-1">
                              <span className="text-lime/80">{formatLabel(angle.format)}</span>
                              {angle.why_now ? ` · ${angle.why_now}` : ""}
                            </p>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {card.evidence_gaps?.length ? (
                    <div
                      className="rounded-md border border-amber-500/20 bg-amber-500/5 p-2"
                      data-testid={`evidence-gaps-${index}`}
                    >
                      <div className="flex items-center gap-1.5 mb-1">
                        <ShieldQuestion className="w-3.5 h-3.5 text-amber-400" aria-hidden="true" />
                        <span className="text-xs uppercase tracking-wider text-amber-300">
                          Not yet sourced
                        </span>
                      </div>
                      <ul className="space-y-0.5">
                        {card.evidence_gaps.map((gap, i) => (
                          <li key={i} className="text-zinc-400 text-xs">
                            — {gap}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              )}

              {/* Save-time tags — keyboard-first, optional, suggested from
                  the board's existing set */}
              <div className="space-y-1.5" data-testid={`save-tags-${index}`}>
                <p className="text-xs uppercase tracking-wider text-zinc-400">
                  Tags <span className="normal-case tracking-normal">(optional)</span>
                </p>
                <TagInput
                  tags={saveTags}
                  onChange={setSaveTags}
                  suggestions={tagSuggestions}
                  ariaLabel={`Tags for “${idea.title}”`}
                  testId={`save-tag-editor-${index}`}
                />
              </div>

              {/* Actions */}
              <div className="flex gap-2 pt-2">
                <Button
                  onClick={onExplore}
                  data-testid={`explore-formats-${index}-btn`}
                  className="flex-1 bg-lime text-void hover:bg-lime-hover"
                >
                  <Zap className="w-4 h-4 mr-2" />
                  Explore Post Formats
                </Button>
                <Button
                  onClick={() => onSave(saveTags)}
                  data-testid={`save-idea-${index}-btn`}
                  variant="outline"
                  aria-label={`Save “${idea.title}” to Board`}
                  className="border-white/10 text-white hover:bg-white/5"
                >
                  <Bookmark className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

export default IdeaCard;
