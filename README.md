# block2redirect

A Chrome extension that redirects distracting websites to productive ones — plus a CS-student toolkit for syncing coding practice to GitHub and logging job applications to Google Sheets.

Example:
- YouTube → Indeed
- Twitter → GitHub

## Features

- Custom website blocking and redirect targets
- Site mappings and a default productive fallback
- Productivity statistics
- **GitHub solve sync** — auto or manual commit of LeetCode / NeetCode / Codeforces solves
- **Job application tracker** — save applications to a Google Sheet (manual or on supported job boards)
- Daily dashboard in the popup (solves / apps / commits + app goal)
- Follow-up badge when applications sit 7+ days without a status update

## Installation (Developer Mode)

1. Clone the repository
2. Open Chrome → `chrome://extensions`
3. Enable **Developer Mode**
4. Click **Load Unpacked**
5. Select the project folder

## OAuth setup (toolkit features)

Users only click **Login with GitHub** / **Login with Google**. You (the extension author) register OAuth apps once and put the public client IDs in [`util/constants.js`](util/constants.js):

```js
const GITHUB_OAUTH_CLIENT_ID = "Iv1....";
const GOOGLE_OAUTH_CLIENT_ID = "....apps.googleusercontent.com";
```

Client IDs are public identifiers (safe in source). Never put a **client secret** in the extension.

### GitHub (Device Flow)

1. GitHub → Settings → Developer settings → OAuth Apps → New OAuth App
2. Homepage URL: your repo URL
3. Authorization callback URL: `http://localhost` (required but unused for device flow)
4. Enable **Device Flow**
5. Paste the Client ID into `GITHUB_OAUTH_CLIENT_ID`
6. Users: Settings → **Login with GitHub** → enter the code on the opened tab → pick/create a repo

### Google Sheets

1. Google Cloud Console → create a project → enable **Google Sheets API**
2. Create an OAuth client ID of type **Chrome Extension**
3. Application ID = your extension ID from `chrome://extensions`
4. Paste the Client ID into `GOOGLE_OAUTH_CLIENT_ID`
5. Users: Settings → **Login with Google** → link a Sheet URL

Redirect URI: `https://<extension-id>.chromiumapp.org/` (`chrome.identity.getRedirectURL()`).


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
