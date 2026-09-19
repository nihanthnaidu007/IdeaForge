import { Sparkles } from "lucide-react";

// Visible label for AI-generated content (spec: "AI-generated content carries
// a visible 'AI-drafted' label") — applied to generated posts, insight cards,
// and drafted variants.
const AiBadge = ({ className = "" }) => (
  <span
    data-testid="ai-badge"
    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] uppercase tracking-wider bg-lime/10 text-lime border border-lime/20 ${className}`}
  >
    <Sparkles className="w-3 h-3" />
    AI-drafted
  </span>
);

export default AiBadge;
