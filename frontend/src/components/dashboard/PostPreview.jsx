import { motion } from "framer-motion";
import { Copy, RefreshCw, Edit3, Bookmark } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import AiBadge from "@/components/common/AiBadge";

// The generated LinkedIn post: honest AI-drafted labeling, LinkedIn-style
// preview, and the copy / regenerate / tweak / save actions. Purely
// presentational — every action is a prop callback.
const PostPreview = ({
  post,
  formatLabel,
  tone,
  postLoading,
  tweakMode,
  tweakInstruction,
  onTweakInstructionChange,
  onApplyTweak,
  onStartTweak,
  onCancelTweak,
  onCopy,
  onRegenerate,
  onSave,
}) => (
  <motion.div
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    className="glass-card rounded-xl p-6 animate-post-reveal"
  >
    <div className="flex flex-wrap items-center gap-2 mb-4 text-sm text-zinc-400">
      <span>Your LinkedIn Post</span>
      <span>·</span>
      <span className="capitalize">{formatLabel?.replace("-", " ")}</span>
      <span>·</span>
      <span>{tone} Tone</span>
      <AiBadge className="ml-auto" />
    </div>

    <div className="bg-void rounded-lg p-4 mb-4 border border-white/5">
      <pre data-testid="post-content" className="post-content text-white/90 font-mono text-sm whitespace-pre-wrap">
        {post}
      </pre>
    </div>

    {tweakMode ? (
      <div className="space-y-3">
        <Textarea
          value={tweakInstruction}
          onChange={(e) => onTweakInstructionChange(e.target.value)}
          data-testid="tweak-input"
          placeholder="Tell it what to change…"
          className="bg-void border-white/10 text-white"
        />
        <div className="flex gap-2">
          <Button
            onClick={onApplyTweak}
            disabled={postLoading}
            data-testid="apply-tweak-btn"
            className="bg-lime text-void hover:bg-lime-hover"
          >
            Apply Changes
          </Button>
          <Button
            variant="outline"
            onClick={onCancelTweak}
            className="border-white/10 text-white hover:bg-white/5"
          >
            Cancel
          </Button>
        </div>
      </div>
    ) : (
      <div className="flex flex-wrap gap-3">
        <Button
          onClick={onCopy}
          data-testid="copy-post-btn"
          variant="outline"
          className="border-white/10 text-white hover:bg-white/5"
        >
          <Copy className="w-4 h-4 mr-2" aria-hidden="true" />
          Copy
        </Button>
        <Button
          onClick={onRegenerate}
          disabled={postLoading}
          data-testid="regenerate-btn"
          variant="outline"
          className="border-white/10 text-white hover:bg-white/5"
        >
          <RefreshCw className={`w-4 h-4 mr-2 ${postLoading ? "animate-spin" : ""}`} aria-hidden="true" />
          Regenerate
        </Button>
        <Button
          onClick={onStartTweak}
          data-testid="tweak-btn"
          variant="outline"
          className="border-white/10 text-white hover:bg-white/5"
        >
          <Edit3 className="w-4 h-4 mr-2" aria-hidden="true" />
          Tweak
        </Button>
        <Button
          onClick={onSave}
          data-testid="save-with-post-btn"
          variant="outline"
          className="border-white/10 text-white hover:bg-white/5"
        >
          <Bookmark className="w-4 h-4 mr-2" aria-hidden="true" />
          Save
        </Button>
      </div>
    )}
  </motion.div>
);

export default PostPreview;
