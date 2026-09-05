# Board Game Selectinator — deploying the live version

This folder is a complete, ready-to-deploy web app, built for Cloudflare Workers (with static assets). It has three parts:

- `index.html` — the app itself (what people see and use).
- `worker.js` — a small piece of server code that talks to BoardGameGeek on the app's behalf, using your API token, and hands every other request off to `index.html`. It runs on Cloudflare's servers, never in anyone's browser, so the token is never visible to users.
- `wrangler.jsonc` — a small config file that tells Cloudflare how the other two fit together. You won't need to edit it.

You already have a Cloudflare project connected to a GitHub repo — this replaces an earlier version of this folder that assumed a different (older) Cloudflare product called "Pages," which turned out not to be what got created when you connected your repo. The fix below matches what Cloudflare actually built for you.

## What changed, in plain terms

When you connected your repo, Cloudflare created a **Worker** for it (that's what the `workers.dev` address and the `workers_dev` warning you saw are about), not the older "Pages" product. Workers and Pages both host a site fine, but they wire up server-side code differently: Pages looks for a `functions` folder and auto-routes it, while a Worker needs one script that explicitly handles every kind of request itself. `worker.js` is written to do exactly that — it checks whether a request is for `/api/collection` (and answers it directly) or for anything else (and hands it to `index.html`/the static files).

If you already pushed an earlier version of `index.html` on its own, that's also why the live site was showing an older screen without the username field — this package's `index.html` is the current one with that field included.

## Getting this onto your existing project

1. In your GitHub repo, replace whatever is there with the contents of this folder — specifically, make sure `index.html`, `worker.js`, and `wrangler.jsonc` all end up sitting next to each other at the same folder level (the repo root, unless you've deliberately put this project in a subfolder, in which case all three go in that same subfolder together). Remove any leftover `functions` folder from an earlier attempt — it's not used by this setup and won't cause harm, but there's no reason to keep it.
2. Commit and push. Since your Cloudflare project is already connected to this repo, it should pick up the push and redeploy automatically — check the project's **Deployments** tab in the Cloudflare dashboard to watch it happen.
3. If it doesn't redeploy on its own, open the project in Cloudflare, go to **Deployments**, and look for a **Retry deployment** / **Create deployment** button to trigger one manually.

## Setting your BGG API token (the important security step)

Your BoardGameGeek API token is a secret, like a password. It should never be typed into this chat, pasted into any file, or committed into the GitHub repo (even a private one). Cloudflare gives you a safe, private place to store it instead.

There's one thing worth knowing up front: Cloudflare's dashboard has a "Build" settings page (with things like an API token for builds, Deploy Hooks, and Build cache) that also happens to have a "Variables and secrets" box on it — but that one only feeds Cloudflare's own build process, not your running app. The one that actually matters is on the Worker's **Bindings** tab.

1. Get your token: go to **boardgamegeek.com/applications**, find your approved application, and click the **Tokens** button next to it to generate/view your token. Copy it.
2. In the Cloudflare dashboard, open your Worker project (Workers & Pages → your project). Along the top you'll see tabs like Overview, Metrics, Deployments, **Bindings**, Observability, Domains, Access, Settings — click **Bindings**.
3. Click **Add** (or "Add a binding"). Depending on what Cloudflare shows you:
   - If you see a simple "Secret" or "Environment Variable" option, pick that, name it exactly `BGG_TOKEN`, and paste your token as the value.
   - If the closest option is **Secrets Store** (Cloudflare's newer, centralized way of managing secrets), pick that instead — it'll ask you to create/pick a store, add a new secret in it with your token as the value, and then set the **binding name** to `BGG_TOKEN`. That binding name is what matters for the app; the secret's own name inside the store can be anything.
4. Save/confirm. You should see `BGG_TOKEN` show up alongside `Assets` in the Bindings list for this Worker.
5. If it doesn't take effect within a minute, check the **Deployments** tab — adding a binding usually creates a new active deployment automatically, but if not, trigger one manually.

(`worker.js` in this package is written to handle either style of secret automatically, so you don't need to tell it which one you used.)

## Keeping BGG_TOKEN safe across future deploys

`wrangler.jsonc` now includes a `secrets_store_secrets` block that points at the same Secrets Store secret you set up in the Bindings tab. This is a small but important safety net: Cloudflare treats `wrangler.jsonc` as the source of truth on every deploy, and a future git-triggered deploy that doesn't mention a dashboard-added binding can silently drop it. With this block in place, the `BGG_TOKEN` binding is declared right in the file, so it survives every future push instead of needing to be re-added by hand. The block only references where the secret lives (a store ID and a secret name) — never the token's actual value — so it's safe to have in the repo.

## Trying it

1. Open your Worker's URL — the one ending in `.workers.dev`, e.g. `https://boardgameselectinator.jerryhoban.workers.dev/`.
2. You should see the "BoardGameGeek username" field (prefilled with `jerryjfunk`) and a "Load collection" button — if you only see the older filter screen without that field, the new `index.html` hasn't deployed yet (recheck step 2 above).
3. Click **Load collection**. You should see a message like "Showing 73 games from jerryjfunk's BoardGameGeek collection."

If something goes wrong, the app will tell you in plain language and quietly fall back to a built-in demo collection so it's never just broken — common messages you might see:

- **"BoardGameGeek has no user named ___"** — the username was typed wrong.
- **"BGG rejected the request — the API token may be missing or invalid"** — double-check the token step above: the variable must be named exactly `BGG_TOKEN` and marked as a Secret, and the project needs to have redeployed after you added it.
- **"BGG is still preparing that collection"** — BGG sometimes needs a few seconds to compile a collection the first time it's requested for a given username; just try again.
- **"No owned, non-expansion games found"** — that user's collection is empty, private, or has no games marked "owned."
- A blank page, or a 404 for the whole site — usually means `wrangler.jsonc` didn't end up next to `index.html` and `worker.js` in the repo; double-check step 1.

## About that `.workers.dev` address, and shortening it

The address Cloudflare gave you follows the pattern `<project-name>.<your-account-name>.workers.dev` — that's why it reads `boardgameselectinator.jerryhoban.workers.dev`. The warning about `workers_dev` you saw just means Cloudflare will keep that address turned on by default since `wrangler.jsonc` doesn't say otherwise (this package's copy leaves it on, since right now it's the only way to reach the site).

Turning `workers_dev` off would **remove** that address rather than shorten it — without your own domain attached, that address is the site's only public entrance, so turning it off would make the site unreachable. If you'd like a shorter address, there are two real options:

- **Rename the project** (in `wrangler.jsonc`, change `"name": "boardgameselectinator"` to something shorter, e.g. `"selectinator"`) — this only shortens the first part of the address, before `.jerryhoban.workers.dev`.
- **Attach a custom domain you own** — under the Worker's **Settings > Domains & Routes**, add a domain (something you've bought, even a short/cheap one). This fully replaces the `.workers.dev` address with your own, and can be as short as the domain itself.

There's no way to get a shorter address than `.workers.dev` gives you without owning a domain — Cloudflare doesn't offer a shorter free alternative.

## Making changes later

Edit the files in the repo (or ask me to, and I'll hand you updated files to commit) and push — since the project is Git-connected, Cloudflare redeploys automatically. `BGG_TOKEN` stays set across deploys; you never need to re-enter it.

## A note on privacy

The server code only ever looks up whatever BoardGameGeek username someone types in — it doesn't store anything, log anything, or remember past lookups. That matches what was described in the API application: occasional, on-demand collection lookups, never bulk or scheduled pulls.
