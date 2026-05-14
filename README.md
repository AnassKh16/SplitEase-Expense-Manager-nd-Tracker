# SplitEase — Expense manager & tracker

A database-backed app for shared expenses and balances across groups (Supabase + React + Vite).

## Run locally

**Prerequisites:** Node.js 20+

1. `npm install`
2. Copy `.env.example` to `.env.local` and set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
3. `npm run dev` (opens on port 3000 by default)

## Deploy

Configured for [Vercel](https://vercel.com) (`vercel.json`). Set the same `VITE_*` variables in the project environment.
