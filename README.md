# BARQ

Smart Tourism Operations Platform — Oman first, then GCC.

## Start Here

This README is intentionally minimal. The actual entry point to this project's documentation is **[`BARQ_BIBLE.md`](./BARQ_BIBLE.md)** — read that first, not this file.

## Local Development

```bash
cp .env.example .env   # fill in the required values
npm install
npm run dev
```

`npm install` also generates the Prisma Client automatically (`postinstall`). `npm run dev`/`npm run build` validate required environment variables first (`scripts/validate-env.ts`) and fail fast with a clear message if one is missing or malformed — see `.env.example` for the full list.

## Stack

Next.js, React, TypeScript, Tailwind CSS, PostgreSQL via Prisma. Full reasoning: [`docs/02-domain-architecture/TECH_STACK.md`](./docs/02-domain-architecture/TECH_STACK.md).

## Documentation

All project documentation lives under [`docs/`](./docs/), indexed by [`BARQ_BIBLE.md`](./BARQ_BIBLE.md). Engineering workflow: [`docs/00-foundation/ENGINEERING_GUIDE.md`](./docs/00-foundation/ENGINEERING_GUIDE.md).
