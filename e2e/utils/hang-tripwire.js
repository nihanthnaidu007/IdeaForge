// F04 diagnosis (art_vqwfyodR): the CI-only failure class is a proxied POST
// that never completes — no response, no backend error, no client timeout —
// so the test budget expires with zero evidence naming the dead request.
// This tripwire records every request lifecycle event the page emits and,
// when the test fails, attaches a HAR-shaped timeline (finished / failed /
// never settled) plus a one-line annotation. A hung request names itself in
// the failure report instead of dying in silence.

export function installHangTripwire(page, testInfo) {
  const t0 = Date.now();
  const elapsedMs = () => Date.now() - t0;
  const entries = [];
  const pending = new Map();

  const onRequest = (request) => {
    const entry = {
      startedMs: elapsedMs(),
      method: request.method(),
      url: request.url(),
      resourceType: request.resourceType(),
    };
    entries.push(entry);
    pending.set(request, entry);
  };
  const onResponse = (response) => {
    const entry = pending.get(response.request());
    if (entry) entry.status = response.status();
  };
  const onRequestFinished = (request) => {
    const entry = pending.get(request);
    if (!entry) return;
    entry.settledMs = elapsedMs();
    pending.delete(request);
  };
  const onRequestFailed = (request) => {
    const entry = pending.get(request);
    if (!entry) return;
    entry.settledMs = elapsedMs();
    entry.failure = request.failure()?.errorText ?? "unknown failure";
    pending.delete(request);
  };

  page.on("request", onRequest);
  page.on("response", onResponse);
  page.on("requestfinished", onRequestFinished);
  page.on("requestfailed", onRequestFailed);

  return () => {
    page.off("request", onRequest);
    page.off("response", onResponse);
    page.off("requestfinished", onRequestFinished);
    page.off("requestfailed", onRequestFailed);

    if (testInfo.status === testInfo.expectedStatus) return;

    const neverSettled = entries.filter((e) => !e.settledMs);
    const failed = entries.filter((e) => e.failure);
    testInfo.attach("request-timeline.har", {
      body: JSON.stringify(
        {
          log: {
            version: "1.2",
            creator: { name: "ideaforge-hang-tripwire", version: "1" },
            entries: entries.map((e) => ({
              startedDateTime: new Date(t0 + e.startedMs).toISOString(),
              time: e.settledMs != null ? e.settledMs - e.startedMs : -1,
              request: { method: e.method, url: e.url },
              response: e.failure
                ? { status: 0, statusText: e.failure }
                : e.settledMs != null
                  ? { status: e.status ?? 0, statusText: "" }
                  : // Chrome's own HAR export reports -1 for a request that
                    // never completes — the exact F04 signature.
                    {
                      status: -1,
                      statusText:
                        "NEVER SETTLED — in flight when the test ended",
                    },
              _resourceType: e.resourceType,
            })),
          },
        },
        null,
        2,
      ),
      contentType: "application/har+json",
    });

    const suspects = [...neverSettled, ...failed];
    if (suspects.length) {
      const first = suspects[0];
      testInfo.annotations.push({
        type: "hang-tripwire",
        description:
          `${neverSettled.length} never-settled / ${failed.length} failed of ` +
          `${entries.length} requests — first: ${first.method} ${first.url}` +
          (first.failure ? ` (${first.failure})` : ""),
      });
    }
  };
}
