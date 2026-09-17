# User guide

IdeaForge is live trend intelligence for LinkedIn. It scans real Tech & AI signal,
scores post ideas, and drafts human-sounding posts in six formats. You bring your own
API keys (BYOK) — IdeaForge never sells you AI credits, and every AI action spends your
own provider account, with a cost estimate shown before it runs.

> These docs describe the production rebuild on the
> [`release/production-rebuild`](https://github.com/nihanthnaidu007/IdeaForge/tree/release/production-rebuild)
> branch. Features land PR-by-PR; track the
> [release PR](https://github.com/nihanthnaidu007/IdeaForge/pull/2) for what has merged.

## Getting started

1. Create an account with your email and a password.
2. Open **Settings** and add your API keys (next section). Generation and research are
   unavailable until at least the relevant provider key exists — either yours or a
   server default.
3. Set your default **niche** and **tone** in Settings. Trend Radar scopes research to
   your niche; drafts start from your tone.
4. Head to **Trend Radar**, run a search, and work the pipeline: trends → ideas →
   variants → save to the board → draft → export.

## Bring your own keys (BYOK)

IdeaForge calls providers directly with your keys. It needs:

| Provider  | What it powers                                            | Where to get a key                                                        |
| --------- | --------------------------------------------------------- | ------------------------------------------------------------------------- |
| Tavily    | Trend Radar — all live research                           | [Tavily Platform](https://app.tavily.com) — sign in, keys are in your dashboard (new accounts start with 1,000 free credits/month, no card required) |
| Anthropic | Post generation, idea scoring, Voice DNA extraction       | [Claude Console → Settings → API keys](https://platform.claude.com/settings/api-keys) — the full key is shown once at creation; copy it immediately |
| OpenAI    | Post generation, idea scoring, Voice DNA extraction       | [OpenAI platform → API keys](https://platform.openai.com/api-keys) — create a key and copy it |

Either Anthropic **or** OpenAI is enough for generation — both are optional to have;
research always needs Tavily.

To add keys: **Settings → API keys**, paste the key for each provider, and save. Keys
are encrypted before storage and are never shown in full again — every response shows
only a masked hint like `****last4`.

### Test your keys

Next to each saved key, **Test key** runs a real validation call against that provider
and tells you immediately whether the key works. Use it after pasting a key, and again
if you ever see an "auth failed" error — it distinguishes a rejected key from a quota
problem.

### What server-default keys mean

The operator running your IdeaForge instance may configure server-level fallback keys.
If a server default exists for a provider, it is used only when you have **not** saved
your own key for that provider. Your saved key always wins. If neither exists, the
action fails with an explicit setup message telling you which provider key to add —
it never silently substitutes made-up content.

### Cost hints before generation

Every AI action (research, idea scoring, generation, variants, tweak, voice
extraction) shows a lightweight cost estimate **before** it runs. You approve the
spend from your own provider account explicitly — variants in particular make
multiple calls, and the hint reflects that.

## Trend Radar

Trend Radar runs live research against your niche and returns trend cards. Each card
carries:

- **Source URL** — a real link to where the signal came from. Read it before you build
  a post on it.
- **Freshness label** — how recent the signal is, so stale news doesn't masquerade as
  a trend.
- **Why now** — one line on what makes this post-worthy today.
- **Post-worthiness score** — a ranking of the trend for LinkedIn posting.

A failed or empty search is shown as an error or an empty state with a retry — IdeaForge
never invents trends to fill the screen. If you see an error, check your Tavily key
(Setup message in the error) and retry.

## Idea Forge

From a trend, Idea Forge generates post ideas, each with:

- **Rating (1–10) and explanation** — why this idea would or wouldn't land.
- **Insight cards** — structured context: audience, why it matters, key aspects.
- **Post angles** — concrete directions you could take the idea.

Save ideas you like to the Content Board, where you can develop them into drafts.

Every generation supports the **six formats**: Hot Take, Carousel Idea, Story Post,
Listicle, How-To, Contrarian Take.

## Voice DNA

Voice DNA teaches IdeaForge your writing voice:

1. Open **Voice DNA** and paste **3–5 of your own past LinkedIn posts** — real ones,
   unedited.
2. The backend extracts a structured style profile: your **structure**, **vocabulary**,
   **energy**, and **signature moves**.
3. Every subsequent generation is conditioned on that profile — drafts come out in your
   voice, not generic-AI voice. (This is retrieval into the prompt, not model training;
   nothing about your samples is used to train anyone's model.)
4. The profile is **editable** and **versioned** — retrain or tweak anytime; older
   versions are kept.

No samples yet? Generation still works — it just won't sound like you yet.

## Hook Bank

The Hook Bank is a curated, tagged library of hook patterns (roughly 40 at launch,
tagged by **style** and **format**), plus any hooks you save yourself.

- During generation, select hooks to steer the opening line.
- On any variant, **swap the hook** — pick a different pattern without regenerating the
  whole post.
- Save hooks that work for you; they sit alongside the built-in set.

## Variants and A/B compare

"Regenerate" here is not a reroll that returns the same post. For any idea you can
generate **2–3 genuinely different variants** — each instructed to take a distinct
angle, hook, and energy, so they read as separate posts, not paraphrases.

- **Side-by-side compare** — read variants next to each other and pick a winner.
- **Tweak by instruction** — after picking, refine with plain instructions ("shorter
  intro", "punchier ending", "add a number") instead of editing raw text.

Variants cost multiple generation calls — the cost hint tells you before you run.

## Preview, and posting yourself

Before anything leaves IdeaForge:

- **Post preview** — a LinkedIn-accurate rendering of the draft, with
  unicode-formatting checks that flag characters LinkedIn mangles.
- **Copy to clipboard** — paste into LinkedIn.

**IdeaForge never auto-posts.** There is no scheduled or unattended posting, ever —
LinkedIn's API terms prohibit it, and the risk shouldn't be yours or ours. When a draft
is ready, you copy or export it and post manually.

## Content Board

The Board is the inbox for the whole pipeline. Saved ideas carry a status:

```
Inbox → Forged → Drafting → Ready
```

- **Inbox** — saved from Trend Radar/Idea Forge, not started.
- **Forged** — variants generated, a direction chosen.
- **Drafting** — a draft in progress.
- **Ready** — final draft, previewed, waiting to be posted manually.

Ideas can be tagged and searched/filtered, so a week of work stays navigable.

## Draft queue and reminders

Schedule a draft for a future slot. At the due time, IdeaForge raises a **reminder**
with the content ready to go — in-app, plus email if the operator configured email
delivery. The reminder hands you the draft; posting is still one manual copy-paste.

## Exports

Export ideas and drafts as:

- **Markdown** — for your editor or notes tool.
- **CSV** — for spreadsheets; one row per idea/draft.
- **ICS calendar file** — imports your scheduled queue into Google Calendar, Outlook,
  or any calendar app, so reminders follow you outside IdeaForge.

## Progress analytics

Honest by construction — IdeaForge shows what it can actually know:

- **Usage streaks** — days you forged, drafted, posted.
- **Ideas forged / posts drafted** — pipeline counts over time.
- **Manual post metrics** — after you post, paste the real numbers (impressions,
  reactions, comments) onto the draft. Analytics compares periods so you can see what
  changed.

Metrics are **manual on purpose**: LinkedIn's analytics API for this data is closed to
products like IdeaForge, and scraping is off the table. Pasting your own numbers keeps
the analytics real instead of estimated — no fake reach numbers anywhere in the product.

## Errors and what they mean

IdeaForge fails loudly instead of showing made-up content:

| Error                | Meaning                                   | What to do                                     |
| -------------------- | ----------------------------------------- | ---------------------------------------------- |
| Missing key (400)    | No key for the needed provider            | Add the provider key in Settings (the message says which) |
| Provider auth (401)  | Your key was rejected by the provider     | Re-check the key in Settings, use **Test key** |
| Provider quota (402) | Your provider account is out of credit    | Top up or change plans with the provider       |
| Research failed (502)| Tavily search failed or timed out         | Retry; if it persists, check Tavily status/quota |
| Generation failed (502) | The model call failed or returned garbage | Retry; persistent failures — check provider status |
