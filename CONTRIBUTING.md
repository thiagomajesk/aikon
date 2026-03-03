# Contributing to Aikon

Thanks for considering a contribution.

Aikon is a vibe-coded side project built in spare time. I don't have deep React knowledge yet, so if you spot a cleaner approach, feel free to suggest it.

## Ways to Contribute

You do not need to be technical to help.

- Report bugs with steps, expected behavior, and screenshots.
- Propose UX/copy improvements.
- Improve docs for beginner-friendly readability.
- Add focused tests for existing behavior.
- Submit code changes for bugs, performance, and features.

## Before You Start

- For larger changes, open an issue/discussion first.
- Keep scope small and focused. Smaller changes have a much better chance of being reviewed and merged quickly.
- Prefer incremental improvements over broad rewrites.

## Development Setup

```bash
npm install
npm run dev
```

Open: `http://localhost:5173`

## Contribution Workflow

1. Create a branch from `master`.
2. Implement one clear change at a time.
3. Follow existing project structure and naming conventions.
4. Add or update tests when behavior changes.
5. Run all quality checks locally.
6. Commit using [Conventional Commits](https://www.conventionalcommits.org/).
7. Keep history linear (`git rebase` over merge commits before opening/updating your PR).
8. Open a PR with context and evidence.

## Quality Checks

Run before opening a PR:

```bash
npm run typecheck
npm run test
npm run build
```

## Testing

Use focused unit tests to validate behavior at context boundaries and critical module contracts.

```bash
npm run test
```

When behavior changes, update or add tests under `tests/core` and `tests/utils`.

## Code Expectations

- Prefer simple, obvious solutions.
- Keep strong TypeScript typing.
- Keep UI logic in `src/ui`, domain logic inside core contexts in `src/core/`, and orchestration in `src/hooks`.
- Write beginner-friendly comments and docs when adding non-obvious logic.
- Update `README.md` and this Architecture section when structure or behavior changes.

## Commit Messages

Use [Conventional Commits](https://www.conventionalcommits.org/) for all commits.

## Pull Request Guidelines

Include in your PR:

- What changed and why.
- Which model/tooling you used (if AI-assisted work was involved).
- Screenshots/GIFs for UI changes.
- Validation evidence (`typecheck`, `test`, `build`).
- Any tradeoffs, known issues, or follow-up ideas.

Respond to review feedback with additional commits (or a clean rebase before merge).

## Game Icons Data and Credits

Aikon uses Game Icons data and keeps a local icon copy in `public/icons`.

- Repository: <https://github.com/game-icons/icons>
- Website: <https://game-icons.net>

Please avoid excessive sync/download activity and prefer local icon assets during normal development.

## Architecture

Aikon is a local-first React app with client-side routing and no backend service.

### Design principle: domain contexts

The codebase is organized into a small number of **domain contexts** in `src/core/`. You can also think of these as capabilities. Each context owns one business area behind a small, stable public interface (its `index.ts` entrypoint). This avoids scattered logic and keeps boundaries explicit.

An agent (human or AI) entering the codebase should:

1. See a handful of clearly named context folders in `src/core/`.
2. Read a context `index.ts` to understand its public API first.
3. Only dive into internal files when changing that context behavior.

Outside callers **import only from the context entrypoint**, never from internal files.

### Top-level folders

| Folder | Purpose |
|---|---|
| `src/core/` | Domain contexts/capabilities (see below). |
| `src/hooks/` | Orchestration hooks that wire multiple contexts together for the UI. Own no domain logic. |
| `src/ui/` | React components and page-level panels. |
| `public/` | Static assets served by Vite (`icons/`, `icons.lock.json`). |
| `scripts/` | Node scripts for syncing/downloading icon data from upstream. |
| `docs/` | Project documentation and media. |

### Core contexts

We document contexts and boundaries here, not individual files.

- `editor/`: Owns editor state and editing behavior, including current selection, style state, animation state, and icon settings persistence.
- `export/`: Owns icon export behavior, including format support, animation frame rendering, and file download helpers.
- `svg-compositor/`: Owns SVG composition and rendering behavior, including parsing, layering, path breakout and styling, and final SVG assembly for previews.
- `icon-catalog/`: Owns icon catalog retrieval and querying, including lock-file loading, pagination/filtering, icon SVG fetching, and catalog stats.
- `navigation/`: Owns app route parsing/building and URL-to-domain mapping.
- `platform/`: Owns shared platform utilities used by contexts, such as local-storage and formatting helpers.

### Guardrails and Tests

- Keep cross-context imports pointed at `src/core/<context>/index.ts` only.
- `tests/core/architecture-boundaries.test.ts` enforces public-entrypoint imports and context entrypoint presence.
- External API contexts (currently `icon-catalog`) must keep boundary-level contract tests in `tests/core/*` for success and failure cases.
- If a context public behavior changes, update both its `index.ts` surface and its contract tests in the same PR.

### Runtime notes

- Entry point: `src/main.tsx` mounts React + Mantine and renders `RootApp`.
- Router shell: `src/RootApp.tsx` handles `/`, `/gallery`, and `/:category/:icon`.
- Editor shell: `src/App.tsx` orchestrates store state, hooks, preview composition, and responsive layout.
- Metadata is loaded from `public/icons.lock.json`; SVG payloads are loaded from `public/icons`.
- Edit/history state is persisted in browser localStorage via the editor context.
