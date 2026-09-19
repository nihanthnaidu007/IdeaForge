import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { AlarmClock, BellRing, Calendar, CalendarClock, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState, ErrorState, LoadingSkeleton } from "@/components/states/AsyncStates";
import { api } from "@/api/client";
import { formatSchedule, QUICK_PICKS, quickPick } from "@/lib/board";

// Draft Queue (spec §What We Build; UI pack §5): schedule reminders for board
// drafts, see what's scheduled and what fired, snooze or unschedule. The
// channel truth comes from the backend's email_enabled — copy never promises
// email unconditionally. IdeaForge never posts for you; the reminder's only
// action is to hand you the content.

const localInputValue = (date) => {
  // datetime-local wants local wall time: YYYY-MM-DDTHH:mm
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

// Snooze durations (Honesty bundle): the backend's hours parameter accepts
// 1–72, so the UI offers the three honest choices instead of hardcoding 1h.
export const SNOOZE_OPTIONS = [
  { hours: 1, label: "1h" },
  { hours: 4, label: "4h" },
  { hours: 24, label: "24h" },
];

// The three snooze buttons, shared by the due-reminder card and the
// scheduled rows — same options, same order, one place to change.
const SnoozeGroup = ({ ideaId, onSnooze }) => (
  <span role="group" aria-label={`Snooze the reminder for ${ideaId}`} className="flex items-center gap-1">
    <AlarmClock className="w-3 h-3 text-zinc-500" aria-hidden="true" />
    {SNOOZE_OPTIONS.map(({ hours, label }) => (
      <Button
        key={hours}
        variant="outline"
        onClick={() => onSnooze(hours)}
        data-testid={`snooze-${hours}h-btn-${ideaId}`}
        aria-label={`Snooze ${hours} hour${hours > 1 ? "s" : ""}`}
        className="h-7 px-2 text-xs border-white/10 text-white hover:bg-white/5"
      >
        {label}
      </Button>
    ))}
  </span>
);

export function ScheduleForm({ ideas, preselected, onScheduled, queueRefresh }) {
  const [ideaId, setIdeaId] = useState(preselected?.id ?? "");
  const [when, setWhen] = useState(() => localInputValue(quickPick("tomorrow")));
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (preselected?.id) setIdeaId(preselected.id);
  }, [preselected]);

  if (ideas.length === 0) {
    return (
      <p className="text-sm text-zinc-400" data-testid="schedule-form-empty">
        Every draft is scheduled already — nothing left to arm. Move an idea to Drafting or forge
        a new one.
      </p>
    );
  }

  const applyQuickPick = (id) => {
    const date = quickPick(id);
    if (date) setWhen(localInputValue(date));
  };

  const selectedIdea = ideas.find((idea) => idea.id === ideaId);

  const submit = async (e) => {
    e.preventDefault();
    if (!ideaId || !when) return;
    const scheduledFor = new Date(when);
    if (scheduledFor.getTime() <= Date.now()) {
      toast.error("That time is in the past — pick a moment that hasn't happened yet.");
      return;
    }
    setSubmitting(true);
    try {
      await api.post(`/queue/${ideaId}/schedule`, { scheduled_for: scheduledFor.toISOString() });
      const absolute = scheduledFor.toLocaleString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
      toast.success(`Reminder set for ${absolute}. The draft will be waiting here.`);
      queueRefresh();
      onScheduled?.();
    } catch {
      // Fail loud with the data sentence: nothing moved, nothing scheduled.
      toast.error("Couldn't schedule that — nothing was scheduled; the draft is exactly where it was.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={submit} data-testid="schedule-form" className="space-y-4">
      <div className="grid md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <label htmlFor="schedule-idea" className="text-sm text-zinc-300 block">
            Draft
          </label>
          {/* Radix's hidden bubble select wipes a programmatic value that has no
              mounted <option> (picker content is closed) by dispatching a change
              with "" — ignore empty writes; items always carry a real id. */}
          <Select value={ideaId} onValueChange={(v) => v && setIdeaId(v)}>
            <SelectTrigger id="schedule-idea" data-testid="schedule-idea-select" className="bg-void border-white/10 text-white">
              <SelectValue placeholder="Pick a draft…" />
            </SelectTrigger>
            <SelectContent className="bg-void border-white/10">
              {ideas.map((idea) => (
                <SelectItem key={idea.id} value={idea.id}>
                  {idea.topic_title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <label htmlFor="schedule-when" className="text-sm text-zinc-300 block">
            Remind me at
          </label>
          <Input
            id="schedule-when"
            type="datetime-local"
            value={when}
            onChange={(e) => setWhen(e.target.value)}
            data-testid="schedule-when-input"
            className="bg-void border-white/10 text-white"
          />
          <p className="text-xs text-zinc-500">Times are your local timezone.</p>
        </div>
      </div>

      {/* The picker can't display a value set programmatically while it's closed
          (its option list only mounts on open), so the actual target is stated
          here — never just implied by a placeholder. */}
      {selectedIdea && (
        <div data-testid="schedule-target-chip" className="flex items-center gap-2 text-sm">
          <CalendarClock className="w-4 h-4 text-lime" aria-hidden="true" />
          <span className="text-zinc-400">Scheduling:</span>
          <span className="text-white truncate max-w-80">“{selectedIdea.topic_title}”</span>
          <button
            type="button"
            data-testid="schedule-target-clear"
            aria-label="Clear the selected draft"
            onClick={() => setIdeaId("")}
            className="text-zinc-500 hover:text-white text-xs px-1"
          >
            ✕
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-zinc-500">Quick picks:</span>
        {QUICK_PICKS.map((pick) => (
          <Button
            key={pick.id}
            type="button"
            variant="outline"
            onClick={() => applyQuickPick(pick.id)}
            data-testid={`quick-pick-${pick.id}`}
            className="h-7 px-2 text-xs border-white/10 text-white hover:bg-white/5"
          >
            {pick.label}
          </Button>
        ))}
      </div>

      <Button
        type="submit"
        disabled={submitting || !ideaId || !when}
        data-testid="schedule-submit-btn"
        className="bg-lime text-void hover:bg-lime-hover"
      >
        <CalendarClock className="w-4 h-4 mr-2" aria-hidden="true" />
        Schedule reminder
      </Button>
    </form>
  );
}

export default function DraftQueue({ refreshKey, preselected, onPreselectedConsumed, onOpenPreview }) {
  const [queue, setQueue] = useState(null); // { email_enabled, items } — items are SCHEDULED ideas only
  const [notifications, setNotifications] = useState(null);
  const [boardItems, setBoardItems] = useState(null); // all ideas — candidates for scheduling
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      // The queue view only carries scheduled ideas, so the schedule form's
      // candidate list comes from the board — the full idea inventory.
      const [queueData, notificationData, boardData] = await Promise.all([
        api.get("/queue"),
        api.get("/queue/notifications"),
        api.get("/board"),
      ]);
      setQueue(queueData);
      setNotifications(notificationData);
      setBoardItems(Array.isArray(boardData) ? boardData : []);
    } catch (err) {
      setError(err);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const unschedule = async (idea) => {
    try {
      await api.delete(`/queue/${idea.id}/schedule`);
      toast.success(`Reminder removed — “${idea.topic_title}” is back in your hands, unscheduled.`);
      load();
    } catch {
      toast.error("Couldn't remove that reminder — it's still scheduled. Try again.");
    }
  };

  const snooze = async (idea, hours) => {
    try {
      await api.post(`/queue/${idea.id}/snooze`, { hours });
      load();
    } catch {
      toast.error("Couldn't snooze that — the reminder is unchanged. Try again.");
    }
  };

  const markRead = async (notification) => {
    try {
      await api.post(`/queue/notifications/${notification.id}/read`);
      setNotifications((prev) =>
        prev.map((n) => (n.id === notification.id ? { ...n, read: true } : n)),
      );
    } catch {
      toast.error("Couldn't mark that read — try again.");
    }
  };

  if (error) {
    return (
      <ErrorState
        error={error}
        onRetry={() => load()}
        title="The queue didn't load."
        testId="queue-error"
        strings={{
          body: "Nothing was scheduled or changed — the failure is in reading the list. Retry to bring the queue back.",
          primary: "Retry",
        }}
      />
    );
  }

  if (queue === null || notifications === null || boardItems === null) {
    return (
      <div data-testid="queue-loading" className="space-y-3">
        <LoadingSkeleton className="h-20 w-full" />
        <LoadingSkeleton className="h-12 w-full" />
      </div>
    );
  }

  const scheduled = queue.items.filter((idea) => idea.scheduled_for);
  const unread = notifications.filter((n) => !n.read);

  return (
    <div data-testid="draft-queue" className="space-y-8">
      {/* Due reminders first — the whole point of the queue */}
      {unread.length > 0 && (
        <section data-testid="queue-notifications" className="space-y-3">
          <h3 className="font-heading text-sm text-zinc-300 flex items-center gap-2">
            <BellRing className="w-4 h-4 text-lime" aria-hidden="true" />
            Reminders due
          </h3>
          {unread.map((n) => (
            <div
              key={n.id}
              data-testid="queue-reminder-card"
              role="status"
              className="border-l-2 border-lime bg-white/5 rounded-r-lg px-4 py-3"
            >
              <p className="text-white text-sm">Reminder: “{n.idea_title}” is due.</p>
              <p className="text-zinc-400 text-sm mt-1">
                The draft is ready below — preview it, copy it, and post it yourself.
              </p>
              <div className="flex flex-wrap gap-2 mt-3">
                <Button
                  variant="outline"
                  onClick={() => onOpenPreview?.(n.idea_id)}
                  data-testid={`reminder-open-btn-${n.idea_id}`}
                  className="h-7 px-2 text-xs border-white/10 text-white hover:bg-white/5"
                >
                  Open preview
                </Button>
                <SnoozeGroup ideaId={n.idea_id} onSnooze={(hours) => snooze({ id: n.idea_id }, hours)} />
                <Button
                  variant="ghost"
                  onClick={() => markRead(n)}
                  data-testid={`reminder-read-btn-${n.id}`}
                  className="h-7 px-2 text-xs text-zinc-400 hover:text-white"
                >
                  Mark read
                </Button>
              </div>
            </div>
          ))}
        </section>
      )}

      <section data-testid="queue-scheduled" className="space-y-3">
        <h3 className="font-heading text-sm text-zinc-300 flex items-center gap-2">
          <Calendar className="w-4 h-4 text-lime" aria-hidden="true" />
          Scheduled
          <span className="text-xs font-mono text-zinc-500" data-testid="queue-scheduled-count">
            {scheduled.length}
          </span>
        </h3>
        {scheduled.length === 0 ? (
          <EmptyState
            icon={CalendarClock}
            title="Nothing scheduled."
            description="Schedule a draft and a reminder fires at the time you pick — in-app always, and by email if email delivery is connected. The content is ready to copy. IdeaForge never posts for you."
            testId="queue-empty"
          />
        ) : (
          <ul className="space-y-2">
            {scheduled.map((idea) => {
              const schedule = formatSchedule(idea.scheduled_for);
              return (
                <li
                  key={idea.id}
                  data-testid="queue-row"
                  className="flex flex-wrap items-center gap-3 border border-white/10 rounded-lg px-4 py-3"
                >
                  <div className="flex-1 min-w-48">
                    <p className="text-sm text-white">{idea.topic_title}</p>
                    <p
                      data-testid="queue-row-when"
                      className={`text-xs font-mono ${schedule.overdue ? "text-amber-200" : "text-zinc-400"}`}
                    >
                      {schedule.absolute} · {schedule.relative}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      onClick={() => onOpenPreview?.(idea.id)}
                      data-testid={`queue-open-btn-${idea.id}`}
                      className="h-7 px-2 text-xs border-white/10 text-white hover:bg-white/5"
                    >
                      Open preview
                    </Button>
                    <SnoozeGroup ideaId={idea.id} onSnooze={(hours) => snooze(idea, hours)} />
                    <Button
                      variant="outline"
                      onClick={() => unschedule(idea)}
                      data-testid={`queue-unschedule-btn-${idea.id}`}
                      className="h-7 px-2 text-xs border-white/10 text-white hover:bg-white/5"
                    >
                      <Trash2 className="w-3 h-3 mr-1" aria-hidden="true" />
                      Unschedule
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section data-testid="queue-schedule-section" className="space-y-4">
        <h3 className="font-heading text-sm text-zinc-300">Schedule a draft</h3>
        <ScheduleForm
          ideas={boardItems.filter((idea) => !idea.scheduled_for)}
          preselected={preselected}
          onScheduled={onPreselectedConsumed}
          queueRefresh={load}
        />
      </section>

      <p className="text-xs text-zinc-500" data-testid="queue-channel-line">
        {queue.email_enabled
          ? "Reminders fire in-app and by email for this deployment."
          : "Reminders fire in-app. Email delivery appears here when it's connected for this deployment."}
      </p>
    </div>
  );
}
