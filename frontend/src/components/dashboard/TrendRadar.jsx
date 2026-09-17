import { motion } from "framer-motion";
import { RefreshCw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { NICHES, TONES } from "@/lib/constants";

// Trend Radar panel: the live-research trigger. Owns the niche/tone controls
// (moved out of the old dashboard navbar so this is the single source of
// truth for them) and the scanning feedback while research runs.
const TrendRadar = ({ niche, onNicheChange, tone, onToneChange, loading, scanningText, scanningSub, onGenerate }) => (
  <motion.div
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    className="glass-card rounded-xl p-8 mb-8"
    aria-busy={loading}
  >
    <h2 className="font-heading text-2xl font-bold text-white mb-2">
      What's trending in Tech & AI right now?
    </h2>
    <p className="text-zinc-400 mb-6">
      Run research to pull what's moving in Tech & AI right now. Every trend comes with its real
      source URL, a freshness label, and a one-line “why now”.
    </p>

    <div className="flex flex-wrap items-center gap-4 mb-6">
      <div className="flex items-center gap-2">
        <span className="text-sm text-zinc-400">Niche:</span>
        <Select value={niche} onValueChange={onNicheChange}>
          <SelectTrigger className="w-32 bg-void border-white/10 text-white" data-testid="niche-selector">
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

      <div className="flex items-center gap-2">
        <span className="text-sm text-zinc-400">Tone:</span>
        <Select value={tone} onValueChange={onToneChange}>
          <SelectTrigger className="w-32 bg-void border-white/10 text-white" data-testid="tone-selector-main">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-deep border-white/10">
            {TONES.map((t) => (
              <SelectItem key={t} value={t} className="text-white hover:bg-white/5">
                {t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>

    <Button
      onClick={onGenerate}
      disabled={loading}
      data-testid="generate-ideas-btn"
      className="w-full bg-lime text-void hover:bg-lime-hover btn-glow text-lg py-6"
    >
      {loading ? (
        <span className="flex items-center gap-2">
          <RefreshCw className="w-5 h-5 animate-spin" aria-hidden="true" />
          Forging…
        </span>
      ) : (
        <span className="flex items-center gap-2">
          <Sparkles className="w-5 h-5" aria-hidden="true" />
          Forge ideas
        </span>
      )}
    </Button>

    {loading && scanningText && (
      <div className="mt-4 text-center">
        <p className="text-zinc-400 animate-scan-pulse">{scanningText}</p>
        {scanningSub && <p className="text-zinc-400 text-sm mt-1">{scanningSub}</p>}
      </div>
    )}
  </motion.div>
);

export default TrendRadar;
