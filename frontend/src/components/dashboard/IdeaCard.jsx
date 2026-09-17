import { motion, AnimatePresence } from "framer-motion";
import {
  ChevronDown,
  ChevronUp,
  Star,
  Target,
  Lightbulb,
  ListChecks,
  RefreshCw,
  Bookmark,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import AiBadge from "@/components/common/AiBadge";
import { LoadingSkeleton } from "@/components/states/AsyncStates";

// One scored idea. Collapsed: title + rating bar. Expanded: the AI-drafted
// insight card (audience / why-it-matters / key aspects) with loading and
// retry states when insight generation is pending or fails.
const ratingTier = (rating) => (rating >= 8 ? "high" : rating >= 6 ? "medium" : "low");

const IdeaCard = ({ idea, index, expanded, onToggle, insights, onExplore, onSave, onRetryInsights }) => {
  const tier = ratingTier(idea.rating);
  const ratingWidth = (idea.rating / 10) * 100;

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
        className="w-full p-4 text-left"
      >
        <div className="flex items-start justify-between gap-3">
          <h3 className="font-heading font-semibold text-white text-sm leading-tight flex-1">
            {idea.title}
          </h3>
          {expanded ? (
            <ChevronUp className="w-5 h-5 text-white/40 flex-shrink-0" />
          ) : (
            <ChevronDown className="w-5 h-5 text-white/40 flex-shrink-0" />
          )}
        </div>

        {/* Rating */}
        <div className="mt-3 flex items-center gap-3">
          <div className="flex items-center gap-1">
            <Star className={`w-4 h-4 text-rating-${tier}`} />
            <span className={`font-mono text-sm font-medium text-rating-${tier}`}>
              {idea.rating.toFixed(1)}
            </span>
            <span className="text-white/40 text-sm">/ 10</span>
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
              <p className="text-white/60 text-sm italic">&ldquo;{idea.rating_explanation}&rdquo;</p>

              {/* Insights */}
              {!insights || insights.status === "loading" ? (
                <div className="space-y-2" data-testid={`insights-loading-${index}`}>
                  <LoadingSkeleton className="h-3 w-2/3" />
                  <LoadingSkeleton className="h-3 w-full" />
                  <LoadingSkeleton className="h-3 w-5/6" />
                </div>
              ) : insights.status === "error" ? (
                <div
                  className="flex items-center justify-between gap-2 text-sm"
                  data-testid={`insights-error-${index}`}
                >
                  <span className="text-white/50">
                    {insights.error?.message ?? "Couldn't load insights."}
                  </span>
                  <Button
                    onClick={onRetryInsights}
                    data-testid={`retry-insights-${index}-btn`}
                    size="sm"
                    variant="outline"
                    className="border-white/10 text-white hover:bg-white/5"
                  >
                    <RefreshCw className="w-3 h-3 mr-1" />
                    Retry
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
                      <span className="text-xs uppercase tracking-wider text-white/40">Targeted Audience</span>
                    </div>
                    <p className="text-white/80 text-sm">{insights.data.targeted_audience}</p>
                  </div>

                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <Lightbulb className="w-4 h-4 text-lime" />
                      <span className="text-xs uppercase tracking-wider text-white/40">Why It Matters</span>
                    </div>
                    <p className="text-white/80 text-sm">{insights.data.why_it_matters}</p>
                  </div>

                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <ListChecks className="w-4 h-4 text-lime" />
                      <span className="text-xs uppercase tracking-wider text-white/40">Key Aspects to Cover</span>
                    </div>
                    <ul className="space-y-1">
                      {insights.data.key_aspects?.map((aspect, i) => (
                        <li key={i} className="text-white/70 text-sm flex items-start gap-2">
                          <span className="text-lime">•</span>
                          {aspect}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}

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
                  onClick={onSave}
                  data-testid={`save-idea-${index}-btn`}
                  variant="outline"
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
