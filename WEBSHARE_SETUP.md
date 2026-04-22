# Bypassing Jumia's IP Block with Webshare (Free Tier)

Jumia's WAF blocks outbound requests from most cloud datacenters, including
Render. When you search from a Render-deployed instance you get an empty
product list and the tRPC response contains
`error: "Jumia blocked the request (HTTP 403)..."`.

The fix is to route the scraper's outbound fetches through a proxy whose
IPs Jumia has not blocked. This app already supports that — it honors a
`PROXY_URL` environment variable. This guide gets you from zero to working
using Webshare's permanent free tier (10 proxies, 1 GB/month, no credit
card required).

---

## Prerequisite — Render's build & start commands

If the service was created *before* `render.yaml` existed (or created
manually via the dashboard's "New Web Service" flow rather than via
Blueprint), Render will not pick up the commands in `render.yaml`. You
have to set them in the dashboard.

The symptom of the wrong commands being set is a build log that starts
with `pnpm install --frozen-lockfile` and fails with
`ERR_PNPM_NO_LOCKFILE` or `sh: 1: vite: not found`.

Fix once:

1. Render dashboard → your service → **Settings** (left sidebar)
2. Scroll to **Build & Deploy**.
3. Set **Build Command** to:
   ```
   npm install --legacy-peer-deps && npm run build
   ```
4. Set **Start Command** to:
   ```
   npm run start
   ```
5. Click **Save Changes**. Render re-deploys automatically with the new
   commands.

After this succeeds, continue to Step 1 below for the proxy setup.

---

## Step 1 — Sign up for Webshare (2 minutes)

1. Go to [webshare.io](https://webshare.io).
2. Click **Sign Up**. Email and password only; no credit card.
3. You'll land on the dashboard with 10 free datacenter proxies already
   provisioned.

## Step 2 — Get a proxy URL

1. In the Webshare dashboard, click **Proxy** in the left sidebar, then
   **List**.
2. At the top of the proxy list, click **Download** → **Username:Password**.
   You'll see lines like:
   ```
   123.45.67.89:8080:proxyuser-1:secretpassword
   123.45.67.90:8080:proxyuser-1:secretpassword
   ...
   ```
3. Pick any one line. Convert it into a URL of this form:
   ```
   http://proxyuser-1:secretpassword@123.45.67.89:8080
   ```
   That is: `http://<user>:<password>@<ip>:<port>`.

   Webshare also offers a **rotating** endpoint that cycles through all 10
   IPs automatically — in the dashboard, Proxy → List → the "Rotating
   Proxy" tab. Use that if you want the proxy IP to change per request
   (better for avoiding rate limits). Its form:
   ```
   http://proxyuser-1:secretpassword@p.webshare.io:80
   ```

## Step 3 — Paste it into Render

1. In the Render dashboard, open your deployed service
   (e.g. `testfinder.onrender.com`).
2. Click **Environment** in the left sidebar.
3. Click **Add Environment Variable**.
   - Key: `PROXY_URL`
   - Value: the URL you built in Step 2
4. Click **Save Changes**. Render will automatically restart the service —
   takes ~30 seconds.

## Step 4 — Verify it works

1. Open your app: `https://<your-service>.onrender.com/`
2. Press F12, open the **Network** tab, filter by `trpc`.
3. Type "shoe" in the search box, click Search.
4. Click the `jumia.search?batch=1&...` request, then the **Response** tab.
5. Look at the JSON:

   **Case A — it worked:**
   ```json
   {
     "products": [ ...40 products... ],
     "hasMore": true,
     "error": null,
     "debug": {
       "httpStatus": 200,
       "fetchedBytes": 450000,
       "storeBlockFound": true,
       "rawProductCount": 40,
       "proxied": true
     }
   }
   ```
   Done. You're running on $0/month.

   **Case B — still blocked:**
   ```json
   {
     "products": [],
     "error": "Jumia blocked the request (HTTP 403) even when routed through the proxy...",
     "debug": { "httpStatus": 403, "proxied": true }
   }
   ```
   Webshare's free datacenter IPs are on Jumia's blocklist too. Go to
   Step 5.

   **Case C — proxied is false:**
   ```json
   {
     "debug": { "proxied": false }
   }
   ```
   `PROXY_URL` didn't take effect. Check Render's Environment tab — the
   variable must be named exactly `PROXY_URL` (uppercase, no trailing
   spaces) and the service must have restarted since you added it. Render's
   deploy log shows the restart.

## Step 5 — Upgrade to residential (only if Case B)

Webshare's free tier uses **datacenter** IPs. Some sites (Jumia among
them, based on current behavior) block datacenter proxy IPs too.
Residential IPs — real home broadband connections — aren't blocked.

On Webshare, residential proxies are paid but cheap:
- **$1.40/GB** at the current (April 2026) promotional rate
- One Jumia catalog page is ~100 KB, so 1 GB ≈ 10,000 searches
- Light personal use will be well under $2/month

Steps:
1. In the Webshare dashboard, click **Proxy** → **Residential** tab.
2. Buy the smallest increment (1 GB, usually).
3. The residential dashboard gives you a new endpoint — typically
   `http://<user>:<pass>@p.webshare.io:80` or similar.
4. Replace the `PROXY_URL` in Render with the new residential URL.
5. Save. Redeploy automatically. Repeat Step 4.

## How to turn the proxy off temporarily

Remove the `PROXY_URL` environment variable from Render (Environment →
click the trash icon next to `PROXY_URL` → Save). The scraper falls back
to direct fetches on the next restart. You'll see `proxied: false` in
the debug response.

## How the code uses it

`server/proxy-fetch.ts` exports `proxiedFetch(url, init)`, a drop-in
replacement for global `fetch`. When `PROXY_URL` is set it attaches an
`undici.ProxyAgent` dispatcher to each request; when unset it's a plain
fetch. The scraper's two outbound calls (catalog page + product detail
page) both route through it.

No new npm packages were added — Node 22's built-in fetch is already
built on undici, which ships `ProxyAgent` out of the box.
