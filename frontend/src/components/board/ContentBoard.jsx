import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Calendar,
  Download,
  Eye,
  LayoutGrid,
  Plus,
  Search,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState, ErrorState, SkeletonCardGrid } from "@/components/states/AsyncStates";
import { api } from "@/api/client";
import { formatSchedule, STATUS_COLUMNS, validTargets, columnLabel } from "@/lib/board";

// The Content Board (spec §What We Build): one kanban per status pipeline,
// tag chips, text/tag filters, and adjacent-step button transitions — buttons
// because they're keyboard-accessible and honest about the one-stage rule
// (drag would imply free moves the backend rejects). Transitions are
// optimistic with a named revert; exports honor the active filter.

function TagChip({ tag }) {
  return (
    <span
      data-testid="board-tag-chip"
      className="inline-flex items-center rounded-full bg-white/5 border border-white/10 px-2 py-0.5 text-[11px] text-zinc-300"
    >
      {tag}
    </span>
  );
}

function BoardCard({ idea, onTransition, onPreview, onSchedule }) {
  const targets = validTargets(idea.status);
  const schedule = formatSchedule(idea.scheduled_for);
  return (
    <div data-testid="board-card" className="glass-card rounded-lg p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <h4 className="font-heading text-sm text-white leading-snug">{idea.topic_title}</h4>
        <span className="shrink-0 text-xs font-mono text-lime" aria-label={`Rated ${idea.rating} of 10`}>
          {idea.rating}
        </span>
      </div>

      {idea.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {idea.tags.map((tag) => (
            <TagChip key={tag} tag={tag} />
          ))}
        </div>
      )}

      {schedule && (
        <p
          data-testid="board-card-reminder"
          className={`text-xs font-mono ${schedule.overdue ? "text-amber-200" : "text-zinc-400"}`}
        >
          <Calendar className="w-3 h-3 inline mr-1" aria-hidden="true" />
          Reminder {schedule.relative} ({schedule.absolute})
        </p>
      )}

      <div className="flex flex-wrap gap-1.5 pt-1">
        <Button
          variant="outline"
          onClick={() => onPreview(idea)}
          data-testid="board-card-preview-btn"
          aria-label={`Preview “${idea.topic_title}”`}
          className="h-7 px-2 text-xs border-white/10 text-white hover:bg-white/5"
        >
          <Eye className="w-3 h-3 mr-1" aria-hidden="true" />
          Preview
        </Button>
        <Button
          variant="outline"
          onClick={() => onSchedule(idea)}
          data-testid="board-card-schedule-btn"
          aria-label={`Schedule a reminder for “${idea.topic_title}”`}
          className="h-7 px-2 text-xs border-white/10 text-white hover:bg-white/5"
        >
          <Calendar className="w-3 h-3 mr-1" aria-hidden="true" />
          {idea.scheduled_for ? "Reschedule" : "Remind me"}
        </Button>
        {targets.map((target) => (
          <Button
            key={target}
            variant="outline"
            onClick={() => onTransition(idea, target)}
            data-testid={`board-move-${idea.id}-${target}`}
            aria-label={`Move “${idea.topic_title}” to ${columnLabel(target)}`}
            className="h-7 px-2 text-xs border-lime/30 text-lime hover:bg-lime/10"
          >
            → {columnLabel(target)}
          </Button>
        ))}
      </div>
    </div>
  );
}

export default function ContentBoard({ onPreview, onSchedule, refreshKey, onExport }) {
  const [ideas, setIdeas] = useState(null); // null = loading
  const [tags, setTags] = useState([]);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const [tagFilter, setTagFilter] = useState("all");
  const filtersDirty = search.trim() !== "" || tagFilter !== "all";

  const loadBoard = useCallback(
    async ({ keepData = false } = {}) => {
      if (!keepData) setError(null);
      try {
        const params = {};
        if (search.trim()) params.q = search.trim();
        if (tagFilter !== "all") params.tag = tagFilter;
        const data = await api.get("/board", { params });
        setIdeas(data);
        const tagList = await api.get("/board/tags");
        setTags(tagList);
      } catch (err) {
        setError(err);
        if (!keepData) setIdeas(null);
      }
    },
    [search, tagFilter],
  );

  // Debounced so typing in the search box doesn't fire a request per key.
  // loadBoard already re-creates itself per search/tag change; the delay is
  // named so the dependency is explicit rather than a hidden closure read.
  const debounceMs = search ? 300 : 0;
  useEffect(() => {
    const timer = setTimeout(() => loadBoard(), debounceMs);
    return () => clearTimeout(timer);
  }, [loadBoard, refreshKey, debounceMs]);

  // Optimistic transition with a named revert (UI pack §3.7): the card moves
  // immediately; a failed call puts it back in its original column with the
  // pack's move-failure toast — the board never lies about where an idea is.
  const transition = async (idea, to) => {
    const from = idea.status;
    setIdeas((prev) =>
      prev.map((item) => (item.id === idea.id ? { ...item, status: to } : item)),
    );
    try {
      const updated = await api.post(`/board/${idea.id}/transition`, { to });
      setIdeas((prev) => prev.map((item) => (item.id === idea.id ? updated : item)));
    } catch {
      setIdeas((prev) =>
        prev.map((item) => (item.id === idea.id ? { ...item, status: from } : item)),
      );
      toast.error(
        `Move didn't save — “${idea.topic_title}” is back in ${columnLabel(from)}. Retry from there.`,
      );
    }
  };

  const clearFilters = () => {
    setSearch("");
    setTagFilter("all");
  };

  const byStatus = useMemo(() => {
    const grouped = Object.fromEntries(STATUS_COLUMNS.map((col) => [col.id, []]));
    for (const idea of ideas ?? []) {
      (grouped[idea.status] ?? grouped.inbox).push(idea);
    }
    return grouped;
  }, [ideas]);

  if (error && ideas === null) {
    return (
      <ErrorState
        error={error}
        onRetry={() => loadBoard()}
        title="The board didn't load."
        testId="board-error"
        strings={{
          body: "Your ideas are untouched — the failure is in reading the list, not the data. Retry to bring the columns back.",
          primary: "Retry",
        }}
      />
    );
  }

  if (ideas === null) {
    return (
      <div data-testid="board-loading" className="space-y-4">
        <SkeletonCardGrid count={2} />
      </div>
    );
  }

  if (ideas.length === 0 && !filtersDirty) {
    return (
      <EmptyState
        icon={LayoutGrid}
        title="The board is where ideas grow up."
        description="Forge ideas in Idea Forge, save the good ones, and they land here in Inbox — tagged, searchable, and ready to drag toward Ready."
        testId="board-empty"
      />
    );
  }

  return (
    <div data-testid="content-board">
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <div className="relative flex-1 min-w-48">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" aria-hidden="true" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search the board…"
            data-testid="board-search-input"
            aria-label="Search the board"
            className="pl-9 bg-void border-white/10 text-white"
          />
        </div>
        <Select value={tagFilter} onValueChange={setTagFilter}>
          <SelectTrigger data-testid="board-tag-filter" aria-label="Filter by tag" className="w-40 bg-void border-white/10 text-white">
            <SelectValue placeholder="All tags" />
          </SelectTrigger>
          <SelectContent className="bg-void border-white/10">
            <SelectItem value="all">All tags</SelectItem>
            {tags.map((tag) => (
              <SelectItem key={tag} value={tag}>
                {tag}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {filtersDirty && (
          <Button
            variant="ghost"
            onClick={clearFilters}
            data-testid="board-clear-filters"
            className="text-zinc-400 hover:text-white"
          >
            <X className="w-4 h-4 mr-1" aria-hidden="true" />
            Clear
          </Button>
        )}
        <div className="flex gap-2 ml-auto">
          <Button
            variant="outline"
            onClick={() => onExport("md")}
            data-testid="board-export-md-btn"
            className="border-white/10 text-white hover:bg-white/5"
          >
            <Download className="w-4 h-4 mr-2" aria-hidden="true" />
            Export MD
          </Button>
          <Button
            variant="outline"
            onClick={() => onExport("csv")}
            data-testid="board-export-csv-btn"
            className="border-white/10 text-white hover:bg-white/5"
          >
            <Download className="w-4 h-4 mr-2" aria-hidden="true" />
            Export CSV
          </Button>
        </div>
      </div>

      {filtersDirty && ideas.length === 0 ? (
        <EmptyState
          icon={Plus}
          title="Nothing matches that filter."
          description="No idea on the board matches the current search and tag — clear the filter to see everything."
          testId="board-filter-empty"
        />
      ) : (
        <div className="grid md:grid-cols-4 gap-4" data-testid="board-columns">
          {STATUS_COLUMNS.map((col) => (
            <section key={col.id} aria-label={col.label} data-testid={`board-column-${col.id}`} className="space-y-3">
              <header className="flex items-center justify-between">
                <h3 className="font-heading text-sm text-zinc-300">{col.label}</h3>
                <span className="text-xs font-mono text-zinc-500" data-testid={`board-count-${col.id}`}>
                  {byStatus[col.id].length}
                </span>
              </header>
              {byStatus[col.id].length === 0 ? (
                <p className="text-xs text-zinc-500 border border-dashed border-white/10 rounded-lg p-3">
                  {col.hint}
                </p>
              ) : (
                byStatus[col.id].map((idea) => (
                  <BoardCard
                    key={idea.id}
                    idea={idea}
                    onTransition={transition}
                    onPreview={onPreview}
                    onSchedule={onSchedule}
                  />
                ))
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
