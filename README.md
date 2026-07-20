# block2redirect

A Chrome extension that redirects distracting websites to productive ones — plus a CS-student toolkit for syncing coding practice to GitHub and logging job applications to Google Sheets.

Example:
- YouTube → Indeed
- Twitter → GitHub

## Features

- Custom website blocking and redirect targets
- Focus / random / punishment / timer modes
- Productivity statistics
- **GitHub solve sync** — auto or manual commit of LeetCode / NeetCode / Codeforces solves
- **Job application tracker** — save applications to a Google Sheet (manual or on supported job boards)
- Daily dashboard in the popup (solves / apps / commits + app goal)
- Follow-up badge when applications sit 7+ days without a status update
- Solve ↔ redirect crossover: if you have 0 solves today, blocking stays strict even outside timer windows

## Installation (Developer Mode)

1. Clone the repository
2. Open Chrome → `chrome://extensions`
3. Enable **Developer Mode**
4. Click **Load Unpacked**
5. Select the project folder

## OAuth setup (toolkit features)

Paste client IDs in the extension **Settings** UI. They are stored in `chrome.storage.local` (not in the repo).

OAuth **client IDs** are public identifiers. Never put a GitHub/Google **client secret** in the extension — this project uses Device Flow and `chrome.identity` so secrets are not required.

### GitHub (Device Flow)

1. GitHub → Settings → Developer settings → OAuth Apps → New OAuth App
2. Homepage URL: `https://github.com` (or your repo)
3. Authorization callback URL: `http://localhost` (unused for device flow, but required)
4. Enable Device Flow on the OAuth App if prompted
5. In Settings → paste the **Client ID** → Save → **Connect GitHub** → enter the device code → pick or create a repo

### Google Sheets

1. Google Cloud Console → create a project → enable **Google Sheets API**
2. Create an OAuth client ID of type **Chrome Extension**
3. Use your extension ID from `chrome://extensions` as the application ID
4. In Settings → paste the client ID → Save → **Connect Google** → paste a Sheet URL → **Link sheet**

Redirect URI used by the extension: `https://<extension-id>.chromiumapp.org/` (from `chrome.identity.getRedirectURL()`).

## How It Works

- **Redirects:** the service worker listens for tab updates, matches hostnames against your block list, and redirects via `chrome.tabs.update`.
- **Solves:** content scripts detect Accepted submissions (or poll Codeforces), message the service worker, which commits via the GitHub Contents API.
- **Jobs:** content scripts / popup capture application details; the service worker appends a row via the Sheets API.

Shared helpers live under [`util/`](util/) and are loaded by the background worker, popup, and settings page.

## Privacy

- Block/redirect settings sync via `chrome.storage.sync`
- OAuth tokens and toolkit data stay in `chrome.storage.local` (never sync)
- Tokens are only sent to GitHub / Google when you connect those services
- No analytics or third-party tracking

## Tech Stack

- Chrome Extensions API (Manifest V3)
- JavaScript / HTML / CSS (no bundler)

## License

MIT
