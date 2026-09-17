import { Flame, LayoutGrid, BookOpen, List, Wrench, Zap } from "lucide-react";

// Shared domain constants: niche/tone options and post formats are used by
// the Dashboard panels and Settings.
export const NICHES = ["AI", "Web Dev", "Data Science", "Startups", "Productivity"];
export const TONES = ["Professional", "Casual", "Bold"];

export const POST_FORMATS = [
  { id: "hot-take", name: "Hot Take", icon: Flame, description: "Bold contrarian opinion" },
  { id: "carousel", name: "Carousel Idea", icon: LayoutGrid, description: "Multi-slide breakdown" },
  { id: "story", name: "Story Post", icon: BookOpen, description: "Personal narrative" },
  { id: "listicle", name: "Listicle", icon: List, description: "Numbered insights" },
  { id: "how-to", name: "How-To", icon: Wrench, description: "Step-by-step guide" },
  { id: "contrarian", name: "Contrarian Take", icon: Zap, description: "Against the mainstream" },
];
