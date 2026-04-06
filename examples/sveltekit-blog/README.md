# SvelteKit Blog — @loewen-digital/fullstack example

A minimal blog app demonstrating how to use `@loewen-digital/fullstack` with SvelteKit.

## What it demonstrates

| Feature | Where |
|---|---|
| `defineConfig` + `createStack` | `src/lib/server/stack.ts` |
| Drizzle schema (users, posts, sessions) | `src/lib/server/schema.ts` |
| `AuthDbAdapter` implementation | `src/lib/server/auth-adapter.ts` |
| `createHandle` SvelteKit middleware | `src/hooks.server.ts` |
| `App.Locals` type augmentation | `src/app.d.ts` |
| Registration with password hashing + welcome email | `src/routes/auth/register/` |
| Login / logout with session cookie | `src/routes/auth/login/`, `src/routes/auth/logout/` |
| Form validation with `validateForm` + old input flash | `src/routes/posts/new/` |
| Protected routes (redirect if unauthenticated) | `src/routes/posts/new/+page.server.ts` |
| Flash messages forwarded to layout | `src/routes/+layout.server.ts` |

## Getting started

```bash
# 1. Install dependencies
npm install

# 2. Copy and fill in the env file
cp .env.example .env

# 3. Run database migrations
npm run db:migrate

# 4. Start the dev server
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

The **Dev UI** is available at [http://localhost:5173/__fullstack/](http://localhost:5173/__fullstack/) and shows:
- Mail preview (captured emails from the console driver)
- Database browser
- Log viewer

## Project structure

```
src/
├── app.d.ts                    # App.Locals type augmentation
├── hooks.server.ts             # createHandle — session, auth, CSRF
├── lib/server/
│   ├── stack.ts                # defineConfig + createStack
│   ├── schema.ts               # Drizzle schema
│   └── auth-adapter.ts         # AuthDbAdapter implementation
└── routes/
    ├── +layout.server.ts       # Forward flash messages to all pages
    ├── +layout.svelte          # Nav + flash message display
    ├── +page.{svelte,server.ts}
    ├── auth/
    │   ├── register/
    │   ├── login/
    │   └── logout/
    └── posts/
        ├── new/
        └── [slug]/
```
