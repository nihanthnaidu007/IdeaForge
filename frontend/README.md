# IdeaForge Frontend

Vite + React 19 app. Dark-premium design system: Syne/DM Mono, void `#050508`, electric lime `#D4F844`.

## Quickstart

```bash
cp .env.example .env.local   # set VITE_BACKEND_URL to your API base
npm ci
npm run dev                  # http://localhost:3000
```

## Scripts

| Command           | What it does                                    |
| ----------------- | ----------------------------------------------- |
| `npm run dev`     | Vite dev server on port 3000                    |
| `npm test`        | Vitest (jsdom) route-shell smoke tests, one run |
| `npm run test:watch` | Vitest in watch mode                         |
| `npm run build`   | Production build to `dist/` (route-split chunks) |
| `npm run preview` | Serve the production build locally              |

## Environment

Only `VITE_*`-prefixed variables are exposed to the app.

- `VITE_BACKEND_URL` — API base URL, no trailing slash, no `/api` suffix (the app appends `/api`). Defaults to `http://127.0.0.1:8001` in dev and same-origin in a built app. `REACT_APP_BACKEND_URL` is still read as a legacy fallback for pre-migration `.env.local` files.

Notes:

- JSX compiles from both `.js` and `.jsx` source files (CRA-era convention kept so page files keep their names).
- `@/` is an alias for `src/`.
