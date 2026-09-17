import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import Navbar from "@/components/layout/Navbar";
import { EmptyState, ErrorState, SkeletonCardGrid } from "@/components/states/AsyncStates";
import AiBadge from "@/components/common/AiBadge";
import { api } from "@/api/client";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Star,
  Bookmark,
  BookmarkCheck,
  Trash2,
  Copy,
  Search,
  FileText,
  Calendar,
} from "lucide-react";

const SavedIdeas = () => {
  const navigate = useNavigate();
  useAuth(); // auth guard is handled by ProtectedRoute
  const [ideas, setIdeas] = useState([]);
  const [status, setStatus] = useState("loading"); // loading | error | ready
  const [loadError, setLoadError] = useState(null);
  const [filter, setFilter] = useState("all");
  const [sortBy, setSortBy] = useState("newest");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedIdea, setSelectedIdea] = useState(null);

  const fetchIdeas = useCallback(async () => {
    setStatus("loading");
    try {
      const data = await api.get("/saved");
      setIdeas(data);
      setStatus("ready");
    } catch (error) {
      setLoadError(error);
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    fetchIdeas();
  }, [fetchIdeas]);

  const toggleBookmark = async (id) => {
    try {
      const data = await api.patch(`/saved/${id}/bookmark`, {});
      setIdeas(ideas.map((idea) =>
        idea.id === id ? { ...idea, is_bookmarked: data.is_bookmarked } : idea
      ));
      toast.success(data.is_bookmarked ? "Bookmarked!" : "Bookmark removed");
    } catch (error) {
      toast.error(error.message);
    }
  };

  const deleteIdea = async (id) => {
    try {
      await api.delete(`/saved/${id}`);
      setIdeas(ideas.filter((idea) => idea.id !== id));
      toast.success("Idea deleted");
    } catch (error) {
      toast.error(error.message);
    }
  };

  const copyPost = (post) => {
    navigator.clipboard.writeText(post);
    toast.success("Copied to clipboard!");
  };

  // Filter and sort ideas
  const filteredIdeas = ideas
    .filter((idea) => {
      if (filter === "bookmarked") return idea.is_bookmarked;
      if (filter === "with-post") return idea.generated_post;
      return true;
    })
    .filter((idea) =>
      idea.topic_title.toLowerCase().includes(searchQuery.toLowerCase())
    )
    .sort((a, b) => {
      if (sortBy === "newest") return new Date(b.created_at) - new Date(a.created_at);
      if (sortBy === "highest") return b.rating - a.rating;
      if (sortBy === "niche") return a.niche.localeCompare(b.niche);
      return 0;
    });

  return (
    <div className="min-h-screen bg-void">
      <Navbar title="Saved Ideas" backTo="/dashboard" />

      {/* Main Content */}
      <main className="pt-20 pb-12 px-6">
        <div className="max-w-6xl mx-auto">
          {/* Filters */}
          <div className="flex flex-wrap items-center gap-4 mb-8">
            <div className="flex items-center gap-2 bg-void border border-white/10 rounded-lg p-1">
              {[
                { id: "all", label: "All" },
                { id: "bookmarked", label: "Bookmarked" },
                { id: "with-post", label: "With Posts" },
              ].map((f) => (
                <button
                  key={f.id}
                  onClick={() => setFilter(f.id)}
                  data-testid={`filter-${f.id}-btn`}
                  className={`px-4 py-1.5 rounded-md text-sm transition-all ${
                    filter === f.id
                      ? "bg-lime text-void font-medium"
                      : "text-white/60 hover:text-white"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            <Select value={sortBy} onValueChange={setSortBy}>
              <SelectTrigger className="w-36 bg-void border-white/10 text-white" data-testid="sort-selector">
                <SelectValue placeholder="Sort by" />
              </SelectTrigger>
              <SelectContent className="bg-deep border-white/10">
                <SelectItem value="newest" className="text-white hover:bg-white/5">Newest</SelectItem>
                <SelectItem value="highest" className="text-white hover:bg-white/5">Highest Rated</SelectItem>
                <SelectItem value="niche" className="text-white hover:bg-white/5">By Niche</SelectItem>
              </SelectContent>
            </Select>

            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                data-testid="search-input"
                placeholder="Search by title..."
                className="pl-10 bg-void border-white/10 text-white"
              />
            </div>
          </div>

          {/* Ideas Grid — explicit loading / error / empty / ready states */}
          {status === "loading" ? (
            <SkeletonCardGrid testId="saved-ideas-skeleton" />
          ) : status === "error" ? (
            <ErrorState
              error={loadError}
              onRetry={fetchIdeas}
              title="Couldn't load saved ideas"
            />
          ) : filteredIdeas.length === 0 ? (
            <EmptyState
              icon={FileText}
              title="No saved ideas yet"
              description="Generate your first idea on the dashboard."
            >
              <Button
                onClick={() => navigate("/dashboard")}
                data-testid="go-to-dashboard-btn"
                className="bg-lime text-void hover:bg-lime-hover"
              >
                Go to Dashboard
              </Button>
            </EmptyState>
          ) : (
            <div className="grid md:grid-cols-2 gap-4">
              {filteredIdeas.map((idea, index) => (
                <motion.div
                  key={idea.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.05 }}
                  className="glass-card rounded-xl p-4 card-hover"
                >
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <h3 className="font-heading font-semibold text-white text-sm leading-tight flex-1">
                      {idea.topic_title}
                    </h3>
                    <button
                      onClick={() => toggleBookmark(idea.id)}
                      data-testid={`bookmark-${idea.id}-btn`}
                      className="text-white/40 hover:text-lime transition-colors"
                    >
                      {idea.is_bookmarked ? (
                        <BookmarkCheck className="w-5 h-5 text-lime" />
                      ) : (
                        <Bookmark className="w-5 h-5" />
                      )}
                    </button>
                  </div>

                  {/* Rating */}
                  <div className="flex items-center gap-2 mb-3">
                    <Star className={`w-4 h-4 ${
                      idea.rating >= 8 ? "text-rating-high" :
                      idea.rating >= 6 ? "text-rating-medium" : "text-rating-low"
                    }`} />
                    <span className={`font-mono text-sm ${
                      idea.rating >= 8 ? "text-rating-high" :
                      idea.rating >= 6 ? "text-rating-medium" : "text-rating-low"
                    }`}>
                      {idea.rating.toFixed(1)}
                    </span>
                  </div>

                  {/* Tags */}
                  <div className="flex flex-wrap gap-2 mb-3">
                    <span className="px-2 py-0.5 rounded text-xs bg-white/5 text-white/60">
                      {idea.niche}
                    </span>
                    <span className="px-2 py-0.5 rounded text-xs bg-white/5 text-white/60 capitalize">
                      {idea.tone}
                    </span>
                    {idea.generated_post && (
                      <span className="px-2 py-0.5 rounded text-xs bg-rating-high/20 text-rating-high">
                        Post Generated
                      </span>
                    )}
                  </div>

                  {/* Date */}
                  <div className="flex items-center gap-1 text-xs text-white/40 mb-3">
                    <Calendar className="w-3 h-3" />
                    {new Date(idea.created_at).toLocaleDateString()}
                  </div>

                  {/* Actions */}
                  <div className="flex gap-2">
                    {idea.generated_post && (
                      <Button
                        onClick={() => setSelectedIdea(idea)}
                        data-testid={`view-post-${idea.id}-btn`}
                        size="sm"
                        className="flex-1 bg-lime text-void hover:bg-lime-hover"
                      >
                        View Full Post
                      </Button>
                    )}
                    <Button
                      onClick={() => deleteIdea(idea.id)}
                      data-testid={`delete-${idea.id}-btn`}
                      size="sm"
                      variant="outline"
                      className="border-white/10 text-white/60 hover:text-red-400 hover:border-red-400/30"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </div>
      </main>

      {/* View Post Modal */}
      <Dialog open={!!selectedIdea} onOpenChange={() => setSelectedIdea(null)}>
        <DialogContent className="bg-deep border-white/10 max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-heading text-xl text-white">
              {selectedIdea?.topic_title}
            </DialogTitle>
          </DialogHeader>

          {selectedIdea && (
            <div className="space-y-4 mt-4">
              {/* Meta */}
              <div className="flex flex-wrap gap-2">
                <span className="px-2 py-1 rounded text-xs bg-white/5 text-white/60">
                  {selectedIdea.niche}
                </span>
                <span className="px-2 py-1 rounded text-xs bg-white/5 text-white/60 capitalize">
                  {selectedIdea.tone}
                </span>
                {selectedIdea.post_format && (
                  <span className="px-2 py-1 rounded text-xs bg-lime/10 text-lime capitalize">
                    {selectedIdea.post_format.replace("-", " ")}
                  </span>
                )}
              </div>

              {/* Insights */}
              {selectedIdea.targeted_audience && (
                <div className="space-y-2">
                  <p className="text-xs uppercase tracking-wider text-white/40">Target Audience</p>
                  <p className="text-white/80 text-sm">{selectedIdea.targeted_audience}</p>
                </div>
              )}

              {selectedIdea.why_it_matters && (
                <div className="space-y-2">
                  <p className="text-xs uppercase tracking-wider text-white/40">Why It Matters</p>
                  <p className="text-white/80 text-sm">{selectedIdea.why_it_matters}</p>
                </div>
              )}

              {/* Post */}
              {selectedIdea.generated_post && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <AiBadge />
                    <p className="text-xs uppercase tracking-wider text-white/40">Generated Post</p>
                  </div>
                  <div className="bg-void rounded-lg p-4 border border-white/5">
                    <pre className="text-white/90 font-mono text-sm whitespace-pre-wrap">
                      {selectedIdea.generated_post}
                    </pre>
                  </div>
                  <Button
                    onClick={() => copyPost(selectedIdea.generated_post)}
                    data-testid="modal-copy-btn"
                    variant="outline"
                    className="border-white/10 text-white hover:bg-white/5"
                  >
                    <Copy className="w-4 h-4 mr-2" />
                    Copy Post
                  </Button>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default SavedIdeas;
