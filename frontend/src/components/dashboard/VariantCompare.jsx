import { useState } from "react";
import { motion } from "framer-motion";
import { AlertTriangle, Check, Copy, History, RefreshCw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import AiBadge from "@/components/common/AiBadge";
import { LoadingSkeleton } from "@/components/states/AsyncStates";
import { POST_FORMATS } from "@/lib/constants";

const formatLabel = (id) => POST_FORMATS.find((f) => f.id === id)?.name ?? id;

const columnLetter = (i) => ["A", "B", "C"][i] ?? String(i + 1);

// Cost-hint banner (UI pack §cost-hint presentation): shown BEFORE the spend
// happens — the locked BYOK rule. The backend computes the number from the
// operator price table; unpriced models render the honest fallback line.
export const CostHintBanner = ({ hint, testId = "cost-hint" }) => {
  if (!hint) return null;
  return (
    <div
      data-testid={testId}
      role="note"
      className="mb-4 rounded-lg border border-lime/20 bg-lime/5 px-4 py-3 text-sm text-zinc-300"
    >
      <span className="mr-2 text-lime" aria-hidden="true">$</span>
      {hint}
    </div>
  );
};

const FailedColumn = ({ variant }) => (
  <div
    data-testid={`variant-failed-${variant.brief_id}`}
    role="alert"
    className="flex h-full flex-col gap-2 rounded-lg border border-red-500/20 bg-red-500/5 p-4"
  >
    <div className="flex items-center gap-2 text-red-300">
      <AlertTriangle className="w-4 h-4" aria-hidden="true" />
      <span className="text-sm font-medium">This variant failed.</span>
    </div>
    <p className="text-zinc-400 text-sm">{variant.error}</p>
    <p className="text-zinc-500 text-xs">
      Nothing was substituted — the other columns are unaffected.
    </p>
  </div>
);

const PreviousAttempts = ({ versions }) => {
  if (!versions?.length) return null;
  return (
    <details className="mt-3" data-testid={`previous-attempts-${versions[0].version}`}>
      <summary className="flex cursor-pointer items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-300">
        <History className="w-3 h-3" aria-hidden="true" />
        Previous attempt{versions.length > 1 ? "s" : ""} ({versions.length})
      </summary>
      <ul className="mt-2 space-y-2">
        {versions.map((v) => (
          <li key={v.version} className="rounded-md border border-white/5 bg-white/[0.02] p-2">
            <p className="text-[10px] uppercase tracking-wider text-white/30 mb-1">
              Version {v.version}
              {v.tweaked_at ? ` · tweaked ${new Date(v.tweaked_at).toLocaleTimeString()}` : ""}
            </p>
            <p className="text-zinc-400 text-xs line-clamp-4 whitespace-pre-wrap">{v.post_text}</p>
          </li>
        ))}
      </ul>
    </details>
  );
};

const ReadyColumn = ({ variant, index, onPick, onCopy, onTweak, tweaking, picked }) => {
  const [tweakOpen, setTweakOpen] = useState(false);
  const [instruction, setInstruction] = useState("");

  const applyTweak = () => {
    if (!instruction.trim()) return;
    onTweak(index, instruction.trim());
  };

  return (
    <div
      data-testid={`variant-column-${index}`}
      aria-label={`Variant ${columnLetter(index)}: ${variant.brief_name}`}
      className={`flex h-full flex-col rounded-lg border p-4 ${
        picked ? "border-lime/40 bg-lime/[0.04]" : "border-white/10 bg-white/[0.02]"
      }`}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <div>
          <p className="font-heading text-sm font-semibold text-white">
            {columnLetter(index)} · {variant.brief_name}
          </p>
          <p className="text-xs text-zinc-400">{variant.intent}</p>
        </div>
        <AiBadge />
      </div>

      <div className="flex-1 whitespace-pre-wrap text-sm text-white/80 leading-relaxed max-h-72 overflow-y-auto">
        {variant.post_text}
      </div>

      {variant.notes ? (
        <p className="mt-2 text-xs text-zinc-500 italic">{variant.notes}</p>
      ) : null}

      <PreviousAttempts versions={variant.versions} />

      {tweakOpen ? (
        <div className="mt-3 space-y-2">
          <Textarea
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            data-testid={`variant-tweak-input-${index}`}
            placeholder="Tell it what to change…"
            className="bg-void border-white/10 text-white min-h-[64px] text-sm"
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={applyTweak}
              disabled={tweaking || !instruction.trim()}
              data-testid={`variant-apply-tweak-${index}-btn`}
              className="bg-lime text-void hover:bg-lime-hover"
            >
              {tweaking ? (
                <RefreshCw className="w-3 h-3 animate-spin" aria-hidden="true" />
              ) : (
                <Sparkles className="w-3 h-3" aria-hidden="true" />
              )}
              Apply
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setTweakOpen(false)}
              className="border-white/10 text-white hover:bg-white/5"
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            size="sm"
            onClick={() => onPick(index)}
            data-testid={`variant-pick-${index}-btn`}
            className="flex-1 bg-lime text-void hover:bg-lime-hover"
          >
            <Check className="w-3 h-3 mr-1" aria-hidden="true" />
            {picked ? "Picked" : "Pick"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onCopy(index)}
            data-testid={`variant-copy-${index}-btn`}
            aria-label={`Copy variant ${columnLetter(index)}`}
            className="border-white/10 text-white hover:bg-white/5"
          >
            <Copy className="w-3 h-3" aria-hidden="true" />
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setTweakOpen(true)}
            data-testid={`variant-tweak-${index}-btn`}
            aria-label={`Tweak variant ${columnLetter(index)} by instruction`}
            className="border-white/10 text-white hover:bg-white/5"
          >
            Tweak
          </Button>
        </div>
      )}
    </div>
  );
};

// The variants stage of the forge (UI pack §variant-compare): before
// generation — instructions + the cost banner; during — three loading
// columns; after — three named, materially different drafts side by side
// with pick / copy / tweak-by-instruction actions and a regenerate that
// always sends a new brief set.
const VariantCompare = ({
  selectedFormat,
  instructions,
  onInstructionsChange,
  onCraft,
  crafting,
  costHint,
  variantSet,
  variantsLoading,
  variantsError,
  onRegenerate,
  onPickVariant,
  onCopyVariant,
  onTweakVariant,
  tweakingIndex,
  pickedIndex,
  pickedBriefName,
}) => {
  const variants = variantSet?.variants ?? [];

  return (
    <motion.section
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      aria-label="Variant compare"
      className="glass-card rounded-xl p-6 mb-8"
    >
      <div className="flex items-center justify-between gap-4 mb-4">
        <div>
          <h3 className="font-heading text-xl font-semibold text-white">
            {formatLabel(selectedFormat)} — compare drafts
          </h3>
          <p className="text-sm text-zinc-400">
            Three drafts, three different angles. Pick the one to refine.
          </p>
        </div>
        {variantSet ? (
          <Button
            variant="outline"
            size="sm"
            onClick={onRegenerate}
            disabled={variantsLoading || crafting}
            data-testid="variants-regenerate-btn"
            className="border-white/10 text-white hover:bg-white/5"
          >
            <RefreshCw className={`w-4 h-4 mr-1 ${variantsLoading ? "animate-spin" : ""}`} aria-hidden="true" />
            Regenerate
          </Button>
        ) : null}
      </div>

      {!variantSet ? (
        <div>
          {/* First-craft failures render the same persistent alert as
              regeneration failures — a toast alone would leave the panel
              silent (fail-loud: the user must see what happened). */}
          {variantsError ? (
            <div role="alert" data-testid="variants-error" className="rounded-lg border border-red-500/20 bg-red-500/5 p-4">
              <p className="text-red-300 text-sm font-medium">Variant generation failed.</p>
              <p className="text-zinc-400 text-sm mt-1">{variantsError.message}</p>
              <p className="text-zinc-500 text-xs mt-2">
                Nothing was saved or charged beyond what the provider already metered.
              </p>
            </div>
          ) : null}
          <CostHintBanner hint={costHint} />
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
                Drafting three variants…
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <Sparkles className="w-4 h-4" aria-hidden="true" />
                Draft three variants
              </span>
            )}
          </Button>
        </div>
      ) : variantsLoading ? (
        <div className="grid md:grid-cols-3 gap-3" data-testid="variants-loading" role="status" aria-label="Generating variants">
          {[0, 1, 2].map((i) => (
            <div key={i} className="rounded-lg border border-white/10 p-4 space-y-2">
              <LoadingSkeleton className="h-4 w-1/2" />
              <LoadingSkeleton className="h-3 w-full" />
              <LoadingSkeleton className="h-3 w-5/6" />
              <LoadingSkeleton className="h-3 w-4/6" />
            </div>
          ))}
        </div>
      ) : variantsError ? (
        <div role="alert" data-testid="variants-error" className="rounded-lg border border-red-500/20 bg-red-500/5 p-4">
          <p className="text-red-300 text-sm font-medium">Variant generation failed.</p>
          <p className="text-zinc-400 text-sm mt-1">{variantsError.message}</p>
          <p className="text-zinc-500 text-xs mt-2">
            Nothing was saved or charged beyond what the provider already metered.
          </p>
        </div>
      ) : (
        <div aria-live="polite">
          <p className="sr-only">
            {variants.filter((v) => v.status === "ready").length} of {variants.length} variants ready.
          </p>
          <div className="grid md:grid-cols-3 gap-3 items-stretch">
            {variants.map((variant, index) =>
              variant.status === "ready" ? (
                <ReadyColumn
                  key={`${variantSet.id}-${index}`}
                  variant={variant}
                  index={index}
                  onPick={onPickVariant}
                  onCopy={onCopyVariant}
                  onTweak={onTweakVariant}
                  tweaking={tweakingIndex === index}
                  picked={pickedIndex === index}
                />
              ) : (
                <FailedColumn key={`${variantSet.id}-${index}`} variant={variant} />
              ),
            )}
          </div>
          {pickedIndex != null ? (
            <p className="mt-3 text-sm text-lime" data-testid="variant-picked-note">
              Variant {columnLetter(pickedIndex)}{pickedBriefName ? ` — ${pickedBriefName}` : ""} picked. The preview below shows your selected draft.
            </p>
          ) : null}
        </div>
      )}
    </motion.section>
  );
};

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
