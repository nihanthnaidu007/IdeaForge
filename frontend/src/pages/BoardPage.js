import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Download } from "lucide-react";
import Navbar from "@/components/layout/Navbar";
import SkipLink from "@/components/layout/SkipLink";
import ContentBoard from "@/components/board/ContentBoard";
import DraftQueue from "@/components/board/DraftQueue";
import LinkedInPreviewPane from "@/components/board/LinkedInPreviewPane";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api } from "@/api/client";
import { STATUS_COLUMNS } from "@/lib/board";

// The Board page (spec §Frontend structure): the Content Board is the inbox
// for the whole pipeline, the Draft Queue rides below it (they share the
// saved-idea documents), and the LinkedIn-accurate preview opens over either.
// Nothing here posts anywhere — copy and export are the ceiling.

const EXPORT_PATHS = {
  md: "/export/ideas.md",
  csv: "/export/ideas.csv",
  ics: "/export/reminders.ics",
};

// Authenticated file download: the token can't ride an <a href>, so fetch the
// bytes through the api client and hand them to the browser as an object URL.
export async function downloadExport(kind) {
  const path = EXPORT_PATHS[kind];
  if (!path) return;
  try {
    const blob = await api.get(path, { responseType: "blob" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `ideaforge-${kind === "ics" ? "reminders" : "board"}.${kind}`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  } catch {
    toast.error("Export didn't download — try again.");
  }
}

export default function BoardPage() {
  const [previewIdea, setPreviewIdea] = useState(null);
  const [scheduleTarget, setScheduleTarget] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const bumpRefresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  // The queue hands over idea ids only (notifications carry no documents) —
  // resolve against the board list, and never close the dialog if that
  // refresh fails: the draft text is already in hand.
  const openPreviewById = useCallback(
    (ideaId) => setPreviewIdea((prev) => ({ ...(prev ?? {}), id: ideaId })),
    [],
  );

  useEffect(() => {
    if (!previewIdea || previewIdea.topic_title !== undefined) return;
    let cancelled = false;
    (async () => {
      try {
        const board = await api.get("/board");
        const fresh = board.find((idea) => idea.id === previewIdea.id);
        if (!cancelled && fresh) setPreviewIdea(fresh);
      } catch {
        // Keep the dialog open on what it already has.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [previewIdea]);

  const scheduleIdea = useCallback((idea) => {
    setScheduleTarget(idea);
    document
      .getElementById("queue-section")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const draftTextOf = (idea) =>
    idea?.generated_post ??
    (idea?.rating_explanation
      ? `${idea.topic_title}\n\n${idea.rating_explanation}`
      : idea?.topic_title ?? "");

  return (
    <div className="min-h-screen bg-void">
      <SkipLink />
      <Navbar title="Content Board" backTo="/dashboard" />
      <main id="main-content" className="pt-20 pb-12 px-6">
        <div className="max-w-6xl mx-auto">
          <header className="mb-8">
            <h1 className="font-heading text-3xl text-white mb-2">Content Board</h1>
            <p className="text-zinc-400">
              Move ideas from Inbox toward Ready, schedule reminders, and hand the final text to
              LinkedIn yourself — {STATUS_COLUMNS.map((col) => col.label).join(" → ")}.
            </p>
          </header>

          <section className="mb-12" aria-label="Content board">
            <ContentBoard
              onPreview={setPreviewIdea}
              onSchedule={scheduleIdea}
              refreshKey={refreshKey}
              onExport={downloadExport}
            />
          </section>

          <section id="queue-section" aria-label="Draft queue" data-testid="queue-section">
            <h2 className="font-heading text-2xl text-white mb-4 flex items-center gap-2">
              Draft Queue
              <Button
                variant="outline"
                onClick={() => downloadExport("ics")}
                data-testid="queue-export-ics-btn"
                className="border-white/10 text-white hover:bg-white/5"
              >
                <Download className="w-4 h-4 mr-2" aria-hidden="true" />
                Export ICS
              </Button>
            </h2>
            <DraftQueue
              refreshKey={refreshKey}
              preselected={scheduleTarget}
              onPreselectedConsumed={() => setScheduleTarget(null)}
              onOpenPreview={openPreviewById}
            />
          </section>
        </div>
      </main>

      <Dialog
        open={previewIdea !== null}
        onOpenChange={(open) => {
          if (!open) setPreviewIdea(null);
        }}
      >
        <DialogContent className="bg-void border-white/10 max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-heading text-white">
              {previewIdea?.topic_title ?? "Preview"}
            </DialogTitle>
          </DialogHeader>
          {previewIdea && (
            <LinkedInPreviewPane text={draftTextOf(previewIdea)} onCopied={bumpRefresh} />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
