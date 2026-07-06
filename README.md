# BARQ

Smart Tourism Operations Platform — Oman first, then GCC.

## Start Here

This README is intentionally minimal. The actual entry point to this project's documentation is **[`BARQ_BIBLE.md`](./BARQ_BIBLE.md)** — read that first, not this file.

## Local Development

```bash
npm install
npm run dev
```

> **Note:** This project was scaffolded in a sandboxed environment without package-registry network access. Dependencies in `package.json` have not yet been installed or verified in this environment — run `npm install` in a normal development environment before first use.

## Stack

Next.js, React, TypeScript, Tailwind CSS, PostgreSQL via Prisma. Full reasoning: [`docs/02-domain-architecture/TECH_STACK.md`](./docs/02-domain-architecture/TECH_STACK.md).

## Documentation

All project documentation lives under [`docs/`](./docs/), indexed by [`BARQ_BIBLE.md`](./BARQ_BIBLE.md). Engineering workflow: [`docs/00-foundation/ENGINEERING_GUIDE.md`](./docs/00-foundation/ENGINEERING_GUIDE.md).
