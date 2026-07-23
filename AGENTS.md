# Repository Guidelines

## Project Structure & Module Organization

This Next.js 16 application uses the App Router and TypeScript. Pages, layouts, and API handlers live in `src/app/`; keep route-specific code near its route. Shared UI belongs in `src/components/`, hooks in `src/hooks/`, contexts in `src/contexts/`, and data, cache, security, and integration logic in `src/lib/`. Workers and global styles are under `src/workers/` and `src/styles/`. Static files live in `public/`, documentation in `docs/`, and build helpers in `scripts/`.

## Build, Test, and Development Commands

Use Node 24 (`.nvmrc`) and pnpm 10 (`packageManager` in `package.json`).

- `pnpm install --frozen-lockfile`: install the exact locked dependencies.
- `pnpm dev`: generate the web manifest and start Next.js on all interfaces.
- `pnpm build`: generate the manifest and create a production build.
- `pnpm test` / `pnpm test:watch`: run Jest once or in watch mode.
- `pnpm typecheck`: run TypeScript without emitting files.
- `pnpm lint:strict`: lint `src/` with zero warnings allowed.
- `pnpm format:check`: verify Prettier formatting.
- `pnpm edgeone:build`: create the EdgeOne deployment output.

## Coding Style & Naming Conventions

Prettier enforces 2-space indentation, semicolons, single quotes, and parenthesized arrow parameters; its Tailwind plugin sorts utility classes. ESLint checks core web vitals, import order, and unused imports. Prefer the `@/` alias for `src/` and `~/` for `public/`. Use PascalCase for React components and contexts (`VideoCard.tsx`), camelCase for utilities, and `useXxx` for hooks. Follow App Router names such as `page.tsx`, `layout.tsx`, and `route.ts`.

## Testing Guidelines

Jest runs in `jsdom` with Testing Library and `jest-dom`. Colocate tests with source files as `*.test.ts` or `*.test.tsx`, following `src/lib/user-menu-indicator.test.ts`. Add focused regression tests for changed logic and user-visible behavior. No coverage threshold is configured; prioritize meaningful branch and edge-case coverage. Run `pnpm test`, `pnpm typecheck`, and `pnpm lint:strict` before opening a PR.

## Commit & Pull Request Guidelines

Husky runs lint-staged and commitlint. Use Conventional Commit subjects such as `fix: refresh user menu` or `feat: add source filter`; allowed types include `feat`, `fix`, `docs`, `chore`, `refactor`, `test`, `perf`, and `ci`. Keep commits scoped and imperative. PRs should explain the problem and solution, note configuration or deployment impact, link relevant issues, list verification commands, and include screenshots for UI changes.

## Security & Configuration

Never commit `.env` files, tokens, credentials, or production URLs. Document new variables in `docs/deployment/CONFIGURATION.md`, and preserve SSRF, authentication, and proxy protections unless the change explicitly targets them.
