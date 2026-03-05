import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { toast } from "sonner";
import { useAuth, API } from "../App";
import { Button } from "../components/ui/button";
import { Textarea } from "../components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import {
  Sparkles,
  ChevronDown,
  ChevronUp,
  Star,
  Target,
  Lightbulb,
  ListChecks,
  Copy,
  RefreshCw,
  Edit3,
  Bookmark,
  Flame,
  LayoutGrid,
  BookOpen,
  List,
  Wrench,
  Zap,
  LogOut,
  Settings,
  FolderOpen,
} from "lucide-react";

const NICHES = ["AI", "Web Dev", "Data Science", "Startups", "Productivity"];
const TONES = ["Professional", "Casual", "Bold"];
const POST_FORMATS = [
  { id: "hot-take", name: "Hot Take", icon: Flame, description: "Bold contrarian opinion" },
  { id: "carousel", name: "Carousel Idea", icon: LayoutGrid, description: "Multi-slide breakdown" },
  { id: "story", name: "Story Post", icon: BookOpen, description: "Personal narrative" },
  { id: "listicle", name: "Listicle", icon: List, description: "Numbered insights" },
  { id: "how-to", name: "How-To", icon: Wrench, description: "Step-by-step guide" },
  { id: "contrarian", name: "Contrarian Take", icon: Zap, description: "Against the mainstream" },
];

const Dashboard = () => {
  const navigate = useNavigate();
  const { user, token, logout } = useAuth();
  const [niche, setNiche] = useState("AI");
  const [tone, setTone] = useState("Professional");
  const [loading, setLoading] = useState(false);
  const [scanningText, setScanningText] = useState("");
  const [ideas, setIdeas] = useState([]);
  const [expandedId, setExpandedId] = useState(null);
  const [insights, setInsights] = useState({});
  const [selectedIdea, setSelectedIdea] = useState(null);
  const [selectedFormat, setSelectedFormat] = useState(null);
  const [customInstructions, setCustomInstructions] = useState("");
  const [generatedPost, setGeneratedPost] = useState("");
  const [postLoading, setPostLoading] = useState(false);
  const [tweakMode, setTweakMode] = useState(false);
  const [tweakInstruction, setTweakInstruction] = useState("");

  const headers = { Authorization: `Bearer ${token}` };

  const scanningMessages = [
    "Scanning Reddit trends...",
    "Checking Google Trends...",
    "Analyzing AI news...",
    "Scoring ideas with Claude...",
  ];

  const generateIdeas = async () => {
    setLoading(true);
    setIdeas([]);
    setExpandedId(null);
    setSelectedIdea(null);
    setSelectedFormat(null);
    setGeneratedPost("");
    setInsights({});

    let messageIndex = 0;
    const interval = setInterval(() => {
      setScanningText(scanningMessages[messageIndex % scanningMessages.length]);
      messageIndex++;
    }, 1500);

    try {
      // Step 1: Research trends with Tavily
      const researchRes = await axios.post(
        `${API}/research`,
        { niche, tone: tone.toLowerCase() },
        { headers }
      );

      // Step 2: Generate ideas with Claude
      const ideasRes = await axios.post(
        `${API}/generate-ideas`,
        { 
          raw_trends: researchRes.data.raw_trends,
          niche,
          tone: tone.toLowerCase()
        },
        { headers }
      );

      setIdeas(ideasRes.data.ideas);
      toast.success("Ideas generated successfully!");
    } catch (error) {
      console.error("Error generating ideas:", error);
      if (error.response?.status === 402) {
        toast.error("API budget exceeded. Please add balance to your Universal Key in Profile -> Universal Key -> Add Balance");
      } else {
        toast.error("Failed to generate ideas. Please try again.");
      }
    } finally {
      clearInterval(interval);
      setScanningText("");
      setLoading(false);
    }
  };

  const loadInsights = async (idea, index) => {
    if (insights[index]) return;

    try {
      const res = await axios.post(
        `${API}/idea-insights`,
        { idea, niche, tone: tone.toLowerCase() },
        { headers }
      );
      setInsights(prev => ({ ...prev, [index]: res.data }));
    } catch (error) {
      console.error("Error loading insights:", error);
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

  const generatePost = async () => {
    if (!selectedIdea || !selectedFormat) return;

    setPostLoading(true);
    try {
      const res = await axios.post(
        `${API}/generate-post`,
        {
          idea: selectedIdea,
          format: selectedFormat,
          tone: tone.toLowerCase(),
          custom_instructions: customInstructions,
          insights: insights[selectedIdea.index] || null
        },
        { headers }
      );
      setGeneratedPost(res.data.post);
      toast.success("Post generated!");
    } catch (error) {
      console.error("Error generating post:", error);
      if (error.response?.status === 402) {
        toast.error("API budget exceeded. Please add balance to your Universal Key in Profile -> Universal Key -> Add Balance");
      } else {
        toast.error("Failed to generate post. Please try again.");
      }
    } finally {
      setPostLoading(false);
    }
  };

  const regeneratePost = async () => {
    setPostLoading(true);
    try {
      const res = await axios.post(
        `${API}/regenerate-post`,
        {
          idea: selectedIdea,
          format: selectedFormat,
          tone: tone.toLowerCase(),
          custom_instructions: customInstructions,
          insights: insights[selectedIdea.index] || null
        },
        { headers }
      );
      setGeneratedPost(res.data.post);
      toast.success("Post regenerated!");
    } catch (error) {
      if (error.response?.status === 402) {
        toast.error("API budget exceeded. Please add balance to your Universal Key.");
      } else {
        toast.error("Failed to regenerate post");
      }
    } finally {
      setPostLoading(false);
    }
  };

  const tweakPost = async () => {
    if (!tweakInstruction.trim()) return;

    setPostLoading(true);
    try {
      const res = await axios.post(
        `${API}/tweak-post`,
        {
          original_post: generatedPost,
          tweak_instruction: tweakInstruction,
          idea: selectedIdea,
          format: selectedFormat
        },
        { headers }
      );
      setGeneratedPost(res.data.post);
      setTweakMode(false);
      setTweakInstruction("");
      toast.success("Post updated!");
    } catch (error) {
      if (error.response?.status === 402) {
        toast.error("API budget exceeded. Please add balance to your Universal Key.");
      } else {
        toast.error("Failed to tweak post");
      }
    } finally {
      setPostLoading(false);
    }
  };

  const copyPost = () => {
    navigator.clipboard.writeText(generatedPost);
    toast.success("Copied to clipboard!");
  };

  const saveIdea = async (idea, index, withPost = false) => {
    try {
      const ideaInsights = insights[index] || {};
      await axios.post(
        `${API}/save-idea`,
        {
          topic_title: idea.title,
          rating: idea.rating,
          rating_explanation: idea.rating_explanation,
          targeted_audience: ideaInsights.targeted_audience,
          why_it_matters: ideaInsights.why_it_matters,
          key_aspects: ideaInsights.key_aspects,
          generated_post: withPost ? generatedPost : null,
          post_format: withPost ? selectedFormat : null,
          niche,
          tone: tone.toLowerCase()
        },
        { headers }
      );
      toast.success("Idea saved!");
    } catch (error) {
      toast.error("Failed to save idea");
    }
  };

  return (
    <div className="min-h-screen bg-void">
      {/* Navbar */}
      <nav className="fixed top-0 left-0 right-0 z-50 border-b border-white/5 bg-void/90 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2 cursor-pointer" onClick={() => navigate("/")}>
            <Sparkles className="w-5 h-5 text-lime" />
            <span className="font-heading font-bold text-lg text-white">IdeaForge</span>
          </div>

          {/* Niche Pills */}
          <div className="hidden md:flex items-center gap-2">
            {NICHES.map((n) => (
              <button
                key={n}
                onClick={() => setNiche(n)}
                data-testid={`niche-${n.toLowerCase()}-btn`}
                className={`px-4 py-1.5 rounded-full text-sm transition-all ${
                  niche === n
                    ? "bg-lime text-void font-medium"
                    : "text-white/60 hover:text-white hover:bg-white/5"
                }`}
              >
                {n}
              </button>
            ))}
          </div>

          {/* Right side */}
          <div className="flex items-center gap-4">
            <Select value={tone} onValueChange={setTone}>
              <SelectTrigger className="w-32 bg-transparent border-white/10 text-white" data-testid="tone-selector">
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

            <button
              onClick={() => navigate("/saved")}
              data-testid="nav-saved-btn"
              className="p-2 text-white/60 hover:text-white transition-colors"
              title="Saved Ideas"
            >
              <FolderOpen className="w-5 h-5" />
            </button>

            <button
              onClick={() => navigate("/settings")}
              data-testid="nav-settings-btn"
              className="p-2 text-white/60 hover:text-white transition-colors"
              title="Settings"
            >
              <Settings className="w-5 h-5" />
            </button>

            <button
              onClick={logout}
              data-testid="nav-logout-btn"
              className="p-2 text-white/60 hover:text-red-400 transition-colors"
              title="Logout"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="pt-20 pb-12 px-6">
        <div className="max-w-4xl mx-auto">
          {/* Generate Ideas Panel */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="glass-card rounded-xl p-8 mb-8"
          >
            <h2 className="font-heading text-2xl font-bold text-white mb-2">
              What's trending in Tech & AI right now?
            </h2>
            <p className="text-white/50 mb-6">
              IdeaForge will scan the live web and find the best LinkedIn post opportunities for you.
            </p>

            <div className="flex flex-wrap items-center gap-4 mb-6">
              <div className="flex items-center gap-2">
                <span className="text-sm text-white/60">Niche:</span>
                <Select value={niche} onValueChange={setNiche}>
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
                <span className="text-sm text-white/60">Tone:</span>
                <Select value={tone} onValueChange={setTone}>
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
              onClick={generateIdeas}
              disabled={loading}
              data-testid="generate-ideas-btn"
              className="w-full bg-lime text-void hover:bg-lime-hover btn-glow text-lg py-6"
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <RefreshCw className="w-5 h-5 animate-spin" />
                  Generating...
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  <Sparkles className="w-5 h-5" />
                  Generate Ideas
                </span>
              )}
            </Button>

            {loading && scanningText && (
              <div className="mt-4 text-center">
                <p className="text-white/60 animate-scan-pulse">{scanningText}</p>
              </div>
            )}
          </motion.div>

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
                />
              ))}
            </div>
          )}

          {/* Format Selector */}
          <AnimatePresence>
            {selectedIdea && !selectedFormat && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="glass-card rounded-xl p-6 mb-8"
              >
                <h3 className="font-heading text-xl font-semibold text-white mb-4">
                  Choose Your Post Format
                </h3>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {POST_FORMATS.map((format) => (
                    <button
                      key={format.id}
                      onClick={() => setSelectedFormat(format.id)}
                      data-testid={`format-${format.id}-btn`}
                      className="p-4 rounded-lg border border-white/10 hover:border-lime/30 hover:bg-lime/5 transition-all text-left group"
                    >
                      <format.icon className="w-6 h-6 text-lime mb-2" />
                      <p className="font-medium text-white">{format.name}</p>
                      <p className="text-xs text-white/50">{format.description}</p>
                    </button>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Custom Instructions */}
          <AnimatePresence>
            {selectedFormat && !generatedPost && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="glass-card rounded-xl p-6 mb-8"
              >
                <h3 className="font-heading text-xl font-semibold text-white mb-2">
                  Add Your Personal Touch (Optional)
                </h3>
                <Textarea
                  value={customInstructions}
                  onChange={(e) => setCustomInstructions(e.target.value)}
                  data-testid="custom-instructions-input"
                  placeholder='e.g. "Mention my 5 years of ML experience, keep it under 200 words, add a personal story about a failed AI project..."'
                  className="bg-void border-white/10 text-white mb-4 min-h-[100px]"
                />
                <Button
                  onClick={generatePost}
                  disabled={postLoading}
                  data-testid="craft-post-btn"
                  className="w-full bg-lime text-void hover:bg-lime-hover btn-glow"
                >
                  {postLoading ? (
                    <span className="flex items-center gap-2">
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      Crafting...
                    </span>
                  ) : (
                    <span className="flex items-center gap-2">
                      <Sparkles className="w-4 h-4" />
                      Craft My Post
                    </span>
                  )}
                </Button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Generated Post */}
          <AnimatePresence>
            {generatedPost && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="glass-card rounded-xl p-6 animate-post-reveal"
              >
                <div className="flex items-center gap-2 mb-4 text-sm text-white/50">
                  <span>Your LinkedIn Post</span>
                  <span>·</span>
                  <span className="capitalize">{selectedFormat?.replace("-", " ")}</span>
                  <span>·</span>
                  <span>{tone} Tone</span>
                </div>

                <div className="bg-void rounded-lg p-4 mb-4 border border-white/5">
                  <pre className="post-content text-white/90 font-mono text-sm whitespace-pre-wrap">
                    {generatedPost}
                  </pre>
                </div>

                {tweakMode ? (
                  <div className="space-y-3">
                    <Textarea
                      value={tweakInstruction}
                      onChange={(e) => setTweakInstruction(e.target.value)}
                      data-testid="tweak-input"
                      placeholder="What would you like to change?"
                      className="bg-void border-white/10 text-white"
                    />
                    <div className="flex gap-2">
                      <Button
                        onClick={tweakPost}
                        disabled={postLoading}
                        data-testid="apply-tweak-btn"
                        className="bg-lime text-void hover:bg-lime-hover"
                      >
                        Apply Changes
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => { setTweakMode(false); setTweakInstruction(""); }}
                        className="border-white/10 text-white hover:bg-white/5"
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-3">
                    <Button
                      onClick={copyPost}
                      data-testid="copy-post-btn"
                      variant="outline"
                      className="border-white/10 text-white hover:bg-white/5"
                    >
                      <Copy className="w-4 h-4 mr-2" />
                      Copy Post
                    </Button>
                    <Button
                      onClick={regeneratePost}
                      disabled={postLoading}
                      data-testid="regenerate-btn"
                      variant="outline"
                      className="border-white/10 text-white hover:bg-white/5"
                    >
                      <RefreshCw className={`w-4 h-4 mr-2 ${postLoading ? "animate-spin" : ""}`} />
                      Regenerate
                    </Button>
                    <Button
                      onClick={() => setTweakMode(true)}
                      data-testid="tweak-btn"
                      variant="outline"
                      className="border-white/10 text-white hover:bg-white/5"
                    >
                      <Edit3 className="w-4 h-4 mr-2" />
                      Tweak It
                    </Button>
                    <Button
                      onClick={() => saveIdea(selectedIdea, selectedIdea.index, true)}
                      data-testid="save-with-post-btn"
                      variant="outline"
                      className="border-white/10 text-white hover:bg-white/5"
                    >
                      <Bookmark className="w-4 h-4 mr-2" />
                      Save
                    </Button>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
};

const IdeaCard = ({ idea, index, expanded, onToggle, insights, onExplore, onSave }) => {
  const ratingColor = idea.rating >= 8 ? "high" : idea.rating >= 6 ? "medium" : "low";
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
            <Star className={`w-4 h-4 ${
              ratingColor === "high" ? "text-rating-high" :
              ratingColor === "medium" ? "text-rating-medium" : "text-rating-low"
            }`} />
            <span className={`font-mono text-sm font-medium ${
              ratingColor === "high" ? "text-rating-high" :
              ratingColor === "medium" ? "text-rating-medium" : "text-rating-low"
            }`}>
              {idea.rating.toFixed(1)}
            </span>
            <span className="text-white/40 text-sm">/ 10</span>
          </div>
          <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                ratingColor === "high" ? "rating-bar-green" :
                ratingColor === "medium" ? "rating-bar-amber" : "rating-bar-muted"
              }`}
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
              <p className="text-white/60 text-sm italic">"{idea.rating_explanation}"</p>

              {/* Insights */}
              {insights ? (
                <>
                  <div className="space-y-3">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <Target className="w-4 h-4 text-lime" />
                        <span className="text-xs uppercase tracking-wider text-white/40">Targeted Audience</span>
                      </div>
                      <p className="text-white/80 text-sm">{insights.targeted_audience}</p>
                    </div>

                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <Lightbulb className="w-4 h-4 text-lime" />
                        <span className="text-xs uppercase tracking-wider text-white/40">Why It Matters</span>
                      </div>
                      <p className="text-white/80 text-sm">{insights.why_it_matters}</p>
                    </div>

                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <ListChecks className="w-4 h-4 text-lime" />
                        <span className="text-xs uppercase tracking-wider text-white/40">Key Aspects to Cover</span>
                      </div>
                      <ul className="space-y-1">
                        {insights.key_aspects?.map((aspect, i) => (
                          <li key={i} className="text-white/70 text-sm flex items-start gap-2">
                            <span className="text-lime">•</span>
                            {aspect}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </>
              ) : (
                <div className="flex items-center gap-2 text-white/40 text-sm">
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Loading insights...
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

export default Dashboard;
