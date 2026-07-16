This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Database setup (required before `npm run dev`)

The app is backed by Postgres via `packages/db` (`lib/repository/postgres.ts`) --
there is no in-memory fallback wired up anymore. Before running the app:

1. Follow `packages/db/README.md` to get a reachable Postgres instance and
   apply migrations (`npm run db:migrate:deploy --workspace=auto-job-applier-db`).
2. Copy `packages/db/.env.example` to `packages/db/.env` and fill in
   `DATABASE_URL` / `FIELD_ENCRYPTION_KEY` -- both are read by this app too
   (Prisma reads `DATABASE_URL` from the process env wherever the client
   runs; `packages/db/lib/encryption.ts`'s `EnvKeyProvider` reads
   `FIELD_ENCRYPTION_KEY` the same way). The simplest way to get both into
   this app's `next dev` process is to also place a `.env` at
   `apps/web/.env` with the same two variables.
3. Auth (issue #3) is a hand-rolled email magic-link + session-cookie flow
   -- see `AUTH.md` for the decision and how it works. There is no real
   email integration configured, so `/login` (and `POST
   /api/auth/request-login`) surface the login link directly in dev mode
   instead of actually sending an email -- sign in there before using the
   rest of the app locally.
4. Resume file bytes are stored via `ResumeStorage` (`packages/db/lib/resume-storage.ts`),
   not in Postgres. The dev default (`LocalDiskResumeStorage`) writes under
   `packages/db/.data/resumes` (gitignored) -- fine for local dev, **not**
   for production (see that file's doc comment for what a real S3-backed
   implementation needs to satisfy).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
