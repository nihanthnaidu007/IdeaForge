import { motion } from "framer-motion";
import { RefreshCw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { POST_FORMATS } from "@/lib/constants";

const formatLabel = (id) => POST_FORMATS.find((f) => f.id === id)?.name ?? id;

// Variant selection stage of the forge: pick a post format (the variant
// axis that exists today) and add personal instructions before crafting.
// Side-by-side variant comparison expands here when the variants backend
// lands (spec §Variants & A/B).
const VariantCompare = ({
  selectedFormat,
  instructions,
  onInstructionsChange,
  onCraft,
  crafting,
}) => (
  <motion.div
    initial={{ opacity: 0, height: 0 }}
    animate={{ opacity: 1, height: "auto" }}
    className="glass-card rounded-xl p-6 mb-8"
  >
    <h3 className="font-heading text-xl font-semibold text-white mb-2">
      Add instructions for your {formatLabel(selectedFormat)} post (optional)
    </h3>
    <Textarea
      value={instructions}
      onChange={(e) => onInstructionsChange(e.target.value)}
      data-testid="custom-instructions-input"
      placeholder='e.g. "Mention my 5 years of ML experience, keep it under 200 words, add a personal story about a failed AI project..."'
      className="bg-void border-white/10 text-white mb-4 min-h-[100px]"
    />
    <Button
      onClick={onCraft}
      disabled={crafting}
      data-testid="craft-post-btn"
      className="w-full bg-lime text-void hover:bg-lime-hover btn-glow"
    >
      {crafting ? (
        <span className="flex items-center gap-2">
          <RefreshCw className="w-4 h-4 animate-spin" aria-hidden="true" />
          Drafting…
        </span>
      ) : (
        <span className="flex items-center gap-2">
          <Sparkles className="w-4 h-4" aria-hidden="true" />
          Craft my post
        </span>
      )}
    </Button>
  </motion.div>
);

// Format picker: which post format (variant) to draft. Rendered before the
// instructions panel.
export const FormatPicker = ({ onSelect }) => (
  <motion.div
    initial={{ opacity: 0, height: 0 }}
    animate={{ opacity: 1, height: "auto" }}
    className="glass-card rounded-xl p-6 mb-8"
  >
    <h3 className="font-heading text-xl font-semibold text-white mb-4">
      Choose Your Post Format
    </h3>
    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
      {POST_FORMATS.map((format) => (
        <button
          key={format.id}
          onClick={() => onSelect(format.id)}
          data-testid={`format-${format.id}-btn`}
          className="p-4 rounded-lg border border-white/10 hover:border-lime/30 hover:bg-lime/5 transition-all text-left group"
        >
          <format.icon className="w-6 h-6 text-lime mb-2" />
          <p className="font-medium text-white">{format.name}</p>
          <p className="text-xs text-zinc-400">{format.description}</p>
        </button>
      ))}
    </div>
  </motion.div>
);

export default VariantCompare;
