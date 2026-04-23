# Running the Backend Locally with Cloudflare Tunnel

This setup lets you run the Jumia scraper on your own computer, where your
home/office internet connection provides a residential IP that Jumia doesn't
block. Cloudflare Tunnel gives the backend a permanent public HTTPS URL so
the frontend (hosted on Netlify or Render) can reach it from anywhere.

**Cost: $0 forever.**

---

## What you need

- A computer that stays on when you're using the app (laptop/desktop)
- Node.js v22 LTS — download from https://nodejs.org
- A free Cloudflare account — https://cloudflare.com (email only, no card)

---

## Step 1 — Install Node.js

1. Go to https://nodejs.org and download the **LTS** version (v22.x).
2. Install it. Accept all defaults.
3. Verify: open a terminal and run `node --version`. Should print `v22.x.x`.

---

## Step 2 — Run the backend

### Windows
Double-click `run-local.bat` in this folder.

### Mac / Linux
Open a terminal in this folder and run:
```bash
chmod +x run-local.sh
./run-local.sh
```

The script will:
1. Install dependencies (first run only, takes ~2 min)
2. Build the project (first run only, takes ~20 s)
3. Start the server at http://localhost:3000

You should see:
```
Server running on http://localhost:3000/
```

**Leave this terminal open.** The server stops when you close it.

**Test it works:** Open http://localhost:3000 in your browser. You should
see the Jumia SKU Finder app. Search for "shoe" — products should appear
within 5–10 seconds.

---

## Step 3 — Install cloudflared

Cloudflare Tunnel makes your local server reachable from the internet via a
permanent HTTPS URL.

### Windows
Download the installer from:
https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/

Run the `.msi` installer.

### Mac (with Homebrew)
```bash
brew install cloudflare/cloudflare/cloudflared
```

### Mac (without Homebrew) / Linux
Download the binary from:
https://github.com/cloudflare/cloudflared/releases/latest

- Mac: `cloudflared-darwin-amd64.tgz` (Intel) or `cloudflared-darwin-arm64.tgz` (M1/M2)
- Linux: `cloudflared-linux-amd64`

Move it somewhere in your PATH and make it executable:
```bash
chmod +x cloudflared
sudo mv cloudflared /usr/local/bin/
```

Verify: `cloudflared --version`

---

## Step 4 — Create a permanent tunnel

> If you want a quick test first, skip to Step 4b (temporary URL, no
> Cloudflare account needed). For permanent use, do Step 4a.

### Step 4a — Permanent tunnel (recommended)

1. Log in to Cloudflare:
   ```bash
   cloudflared tunnel login
   ```
   This opens a browser window — log in and pick any domain you own (or
   create a free workers.dev subdomain).

2. Create a named tunnel:
   ```bash
   cloudflared tunnel create jumia-backend
   ```
   This prints a **tunnel ID** (a UUID like `a1b2c3d4-...`). Note it.

3. Create a config file at `~/.cloudflared/config.yml`:
   ```yaml
   tunnel: <YOUR_TUNNEL_ID>
   credentials-file: /Users/<your-name>/.cloudflared/<YOUR_TUNNEL_ID>.json

   ingress:
     - service: http://localhost:3000
   ```
   Replace `<YOUR_TUNNEL_ID>` and `<your-name>` with your actual values.
   On Windows, use `C:\Users\<your-name>\.cloudflared\` paths.

4. Add a DNS record pointing at your tunnel:
   ```bash
   cloudflared tunnel route dns jumia-backend backend.yourdomain.com
   ```
   Replace `backend.yourdomain.com` with whatever subdomain you want.

5. Start the tunnel:
   ```bash
   cloudflared tunnel run jumia-backend
   ```
   Your backend is now live at `https://backend.yourdomain.com`.

### Step 4b — Quick test (temporary URL, no account needed)

If you just want to verify it works before setting up a permanent tunnel:
```bash
cloudflared tunnel --url http://localhost:3000
```
Cloudflare will print a temporary URL like:
```
https://random-words-1234.trycloudflare.com
```
This URL changes every time you restart. Use it for testing only.

---

## Step 5 — Point the frontend at your local backend

Your frontend (Netlify or Render) needs to know the backend URL.

### If using Netlify
1. Netlify dashboard → your site → **Site settings → Environment variables**
2. Add: `VITE_API_URL` = `https://backend.yourdomain.com` (no trailing slash)
3. Click **Save**, then trigger a redeploy.

### If using Render (frontend only)
Same as above but in Render's Environment section.

### If running everything locally
Skip this step — the app at http://localhost:3000 already talks to itself.

---

## Step 6 — Start automatically on login (optional)

If you don't want to manually run the server and tunnel every time:

### Windows — Task Scheduler
1. Open Task Scheduler
2. Create Basic Task → "Jumia Backend"
3. Trigger: "When I log on"
4. Action: Start a program → `node` with arguments `dist/index.js` in the project folder

### Mac — launchd
Create `~/Library/LaunchAgents/com.jumia.backend.plist`:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.jumia.backend</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/node</string>
    <string>/path/to/testfinder2_fixed/dist/index.js</string>
  </array>
  <key>WorkingDirectory</key>
  <string>/path/to/testfinder2_fixed</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>NODE_ENV</key>
    <string>production</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
</dict>
</plist>
```
Load it: `launchctl load ~/Library/LaunchAgents/com.jumia.backend.plist`

### Linux — systemd
```ini
[Unit]
Description=Jumia Backend
After=network.target

[Service]
ExecStart=/usr/bin/node /path/to/testfinder2_fixed/dist/index.js
WorkingDirectory=/path/to/testfinder2_fixed
Environment=NODE_ENV=production
Restart=always

[Install]
WantedBy=multi-user.target
```
Save as `/etc/systemd/system/jumia-backend.service`, then:
```bash
sudo systemctl enable jumia-backend
sudo systemctl start jumia-backend
```

---

## Troubleshooting

**"vite: not found" during build**
```bash
npm install
npm run build
```

**Server starts but searches return empty**
- The first search after starting takes ~5 s (Jumia response time). Normal.
- If still empty, open http://localhost:3000, search "shoe", press F12 →
  Network → click the `jumia.search` request → Response tab. The `debug`
  field will show exactly what happened.

**Cloudflare tunnel disconnects**
The tunnel reconnects automatically. If it keeps dropping, add
`--reconnect-timeout 5m` to the cloudflared command.

**Port 3000 is already in use**
Set a different port: `PORT=3001 node dist/index.js`

**Computer goes to sleep**
Disable sleep mode while the server is running, or use a dedicated low-power
device (old laptop, Raspberry Pi) as a home server.
