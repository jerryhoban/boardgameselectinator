# Board Game Selectinator — deploying the live version

This folder is a complete, ready-to-upload web app. It has two parts:

- `index.html` — the app itself (what people see and use).
- `functions/api/collection.js` — a small piece of server code that talks to BoardGameGeek on the app's behalf, using your API token. It runs on Cloudflare's servers, never in anyone's browser, so the token is never visible to users.

You don't need to know how to code or use the command line. Everything below happens by clicking around in a web browser.

## What you'll end up with

A web address (something like `board-game-selectinator.pages.dev`) that you can open on your phone or computer, or share with your game group. Anyone who opens it can type in their own BoardGameGeek username and get recommendations from their real, live collection — or just use the built-in demo collection if they don't want to bother.

## Step 1 — Create a free Cloudflare account

1. Go to **dash.cloudflare.com/sign-up** and create an account (email + password is enough — no credit card required for what we're doing).
2. Verify your email if it asks you to.

## Step 2 — Create a Pages project

1. Once logged in, look in the left sidebar for **Workers & Pages** and click it.
2. Click **Create** (or **Create application**), then choose the **Pages** tab.
3. Choose **Upload assets** (this may also be labeled **Direct Upload**) — this is the option that lets you skip GitHub entirely.
4. Give the project a name, for example `board-game-selectinator`. This name becomes part of your web address.

## Step 3 — Upload this folder

1. You should now see a screen asking you to upload files.
2. Upload the **entire `cf-deploy` folder** (or the zip file you were given — if it's a zip, upload the zip and Cloudflare will unpack it). Make sure the `functions` folder and `index.html` both end up at the top level of what gets uploaded — not nested inside an extra folder.
3. Click **Deploy site** (or similar). Cloudflare will publish it and give you a URL like `https://board-game-selectinator.pages.dev`.

Don't worry if the app doesn't work perfectly the moment it's deployed — you still need to add your API token in the next step.

## Step 4 — Add your BGG API token (the important security step)

Your BoardGameGeek API token is a secret, like a password. It should never be typed into this chat, pasted into the `index.html` file, or shared anywhere public. Cloudflare gives you a safe, private place to store it.

1. Get your token: go to **boardgamegeek.com/applications**, find your approved application, and click the **Tokens** button next to it to generate/view your token. Copy it.
2. Back in Cloudflare, open your new Pages project and go to its **Settings** tab.
3. Find **Environment variables** (sometimes under a "Variables and Secrets" section).
4. Add a new variable:
   - **Name:** `BGG_TOKEN`
   - **Value:** paste your token
   - Mark it as **Encrypted** / **Secret** if given the option.
5. Save. Cloudflare will usually tell you that you need to redeploy for the change to take effect — if there's a **Retry deployment** or **Redeploy** button, click it. (If not, just re-uploading the same folder again also works.)

## Step 5 — Try it

1. Open your `*.pages.dev` URL.
2. Type a BoardGameGeek username into the **BoardGameGeek username** field (it starts prefilled with `jerryjfunk`) and click **Load collection**.
3. You should see a message like "Showing 73 games from jerryjfunk's BoardGameGeek collection" and the filters below will now reflect that person's real collection.

If something goes wrong, the app will tell you in plain language and quietly fall back to the built-in demo collection so it's never just broken — common messages you might see:

- **"BoardGameGeek has no user named ___"** — the username was typed wrong.
- **"BGG rejected the request — the API token may be missing or invalid"** — double check Step 4: the variable must be named exactly `BGG_TOKEN`, and you need to redeploy after adding it.
- **"BGG is still preparing that collection"** — BGG sometimes needs a few seconds to compile a collection the first time it's requested for a given username; just try again.
- **"No owned, non-expansion games found"** — that user's collection is empty, private, or has no games marked "owned."

## Making changes later

If you (or I) ever want to tweak the app, the easiest path is: edit the files, then upload the folder again to the same Cloudflare Pages project (Cloudflare keeps a history of every deployment, so nothing is lost, and old versions can be restored from the project's **Deployments** tab if needed). You do not need to re-enter the `BGG_TOKEN` — environment variables stay attached to the project once set.

## A note on privacy

The server code only ever looks up whatever BoardGameGeek username someone types in — it doesn't store anything, log anything, or remember past lookups. That matches what was described in the API application: occasional, on-demand collection lookups, never bulk or scheduled pulls.
