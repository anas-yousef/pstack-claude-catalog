---
name: local-supabase
description: Use when a side-hustle or product build needs a real database, auth, or row-level security. Prefer one local Docker Supabase per machine until the product ships.
---

# Local Supabase

When the product needs Postgres, Auth, Storage, and row-level security with production parity, run the official local Supabase stack on the machine doing the work. `supabase start` brings that stack up in Docker. Create a hosted Supabase project when the product graduates to shipping.

## One stack per machine

Each agent VM and each local dev machine runs its own Docker Supabase. The stack is ephemeral and disposable. Leave it on that machine.

Initialize with `supabase init` when the repo has no `supabase/` config, then `supabase start`. Point the app at the URLs and keys `supabase status` prints for that machine.

A cloud agent builds against the Docker Supabase on its own VM. Hosted project creation waits until the product is shipping.

## Lighter stores

SQLite, PGlite, and an in-repo fixture double stay right for a thin app or a pure client or offline path. Prefer Docker Supabase when the app's real backend is Supabase-shaped.

When the product prefers a document store, run MongoDB in Docker on that same machine. A SQL product stays on Postgres.

Payments, including Grow, stay on the mock or sandbox the product already uses.
