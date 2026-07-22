/**
 * GOOGLE OAUTH + SHEETS APPEND
 *
 * Uses chrome.identity.getAuthToken (Client ID lives in manifest.json → oauth2).
 */

const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";

function extractSpreadsheetId(urlOrId) {
    if (!urlOrId) return "";
    const trimmed = urlOrId.trim();
    const match = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (match) return match[1];
    if (/^[a-zA-Z0-9-_]+$/.test(trimmed)) return trimmed;
    return "";
}

function getAuthToken(interactive) {
    return new Promise((resolve, reject) => {
        chrome.identity.getAuthToken({ interactive: Boolean(interactive) }, (token) => {
            if (chrome.runtime.lastError || !token) {
                reject(new Error(explainGoogleAuthError(
                    chrome.runtime.lastError?.message || "Google login failed"
                )));
                return;
            }
            resolve(token);
        });
    });
}

function removeCachedAuthToken(token) {
    return new Promise((resolve) => {
        if (!token) {
            resolve();
            return;
        }
        chrome.identity.removeCachedAuthToken({ token }, () => resolve());
    });
}

function explainGoogleAuthError(rawMessage) {
    const msg = String(rawMessage || "Google login failed");
    const extensionId = chrome.runtime.id;
    if (/status code[: ]*2|bad client|invalid_client|OAuth2 request failed/i.test(msg)) {
        return `${msg} — In Google Cloud, set the Chrome Extension OAuth client Application ID to: ${extensionId}`;
    }
    return `${msg} (extension ID: ${extensionId})`;
}

function normalizeGoogleUser(data) {
    if (!data || typeof data !== "object") {
        return { name: "", email: "", picture: "", id: "" };
    }
    return {
        name: String(data.name || data.given_name || "").trim(),
        email: String(data.email || "").trim(),
        picture: String(data.picture || "").trim(),
        id: String(data.id || data.sub || "").trim()
    };
}

async function fetchGoogleUserProfile(accessToken) {
    const endpoints = [
        "https://www.googleapis.com/oauth2/v3/userinfo",
        "https://www.googleapis.com/oauth2/v2/userinfo"
    ];
    let lastError = null;
    for (const url of endpoints) {
        try {
            const res = await fetch(url, {
                headers: { Authorization: `Bearer ${accessToken}` }
            });
            if (!res.ok) {
                const text = await res.text();
                lastError = new Error(`Google profile ${res.status}: ${text.slice(0, 120)}`);
                continue;
            }
            const user = normalizeGoogleUser(await res.json());
            if (user.name || user.email) return user;
            lastError = new Error("Google profile returned empty name/email");
        } catch (err) {
            lastError = err;
        }
    }
    throw lastError || new Error("Could not load Google profile");
}

/** Drop cached token and re-prompt so new scopes (profile/email) are granted. */
async function getAuthTokenWithFreshScopes(interactive) {
    try {
        const stale = await getAuthToken(false);
        await removeCachedAuthToken(stale);
    } catch (_err) {
        // no cached token
    }
    if (chrome.identity.clearAllCachedAuthTokens) {
        await new Promise((resolve) => chrome.identity.clearAllCachedAuthTokens(() => resolve()));
    }
    return getAuthToken(interactive);
}

function googleDisplayName(user) {
    if (!user) return "";
    return user.name || user.email || "Google user";
}

async function connectGoogle() {
    const manifest = chrome.runtime.getManifest();
    if (!manifest.oauth2?.client_id) {
        throw new Error("Add oauth2.client_id to manifest.json (Google Chrome Extension OAuth client)");
    }
    // Prefer being called from an extension page (settings). SW interactive auth is unreliable.
    let accessToken = await getAuthToken(true);
    let user;
    try {
        user = await fetchGoogleUserProfile(accessToken);
    } catch (_err) {
        // Old cached tokens often lack userinfo scopes — force a fresh grant.
        accessToken = await getAuthTokenWithFreshScopes(true);
        user = await fetchGoogleUserProfile(accessToken);
    }
    await new Promise((resolve) => setSheetsConfig({
        accessToken,
        tokenExpiry: 0,
        user,
        signedIn: true
    }, resolve));
    return { accessToken, user };
}

/**
 * Restore Google session without prompting.
 * Keeps profile + token cached in local storage for Settings display.
 */
async function ensureGoogleSession() {
    try {
        const accessToken = await getAuthToken(false);
        const config = await new Promise((resolve) => getSheetsConfig(resolve));
        let user = normalizeGoogleUser(config.user);
        if (!user.name && !user.email) {
            try {
                user = await fetchGoogleUserProfile(accessToken);
            } catch (_err) {
                // Keep whatever we had; caller may still show signed-in from token.
            }
        }
        await new Promise((resolve) => setSheetsConfig({
            accessToken,
            tokenExpiry: 0,
            user,
            signedIn: true
        }, resolve));
        return { accessToken, user, signedIn: true };
    } catch (_err) {
        return { accessToken: "", user: null, signedIn: false };
    }
}

async function disconnectGoogle() {
    try {
        const token = await getAuthToken(false);
        await removeCachedAuthToken(token);
        if (chrome.identity.clearAllCachedAuthTokens) {
            await new Promise((resolve) => chrome.identity.clearAllCachedAuthTokens(() => resolve()));
        }
    } catch (_err) {
        // already signed out
    }
    await new Promise((resolve) => clearGoogleAuth(resolve));
}

async function getValidGoogleToken() {
    // Chrome refreshes cached tokens silently — no interactive re-login until Logout / revoke.
    try {
        const token = await getAuthToken(false);
        await new Promise((resolve) => setSheetsConfig({
            accessToken: token,
            tokenExpiry: 0,
            signedIn: true
        }, resolve));
        return token;
    } catch (_err) {
        throw new Error("Not signed in with Google — open Settings and click Login with Google");
    }
}

async function sheetsFetch(path, options = {}) {
    const token = await getValidGoogleToken();
    const res = await fetch(`${SHEETS_API}${path}`, {
        ...options,
        headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            ...(options.headers || {})
        }
    });
    if (!res.ok) {
        const text = await res.text();
        if (res.status === 401) {
            try {
                await removeCachedAuthToken(token);
            } catch (_e) {
                // ignore
            }
        }
        throw new Error(`Sheets API ${res.status}: ${text.slice(0, 200)}`);
    }
    return res.json();
}

async function linkSpreadsheet(urlOrId) {
    const spreadsheetId = extractSpreadsheetId(urlOrId);
    if (!spreadsheetId) {
        throw new Error("Invalid Google Sheet URL or ID");
    }
    const meta = await sheetsFetch(`/${spreadsheetId}?fields=spreadsheetId,properties.title`);
    await ensureJobSheetHeaders(spreadsheetId);
    const spreadsheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}`;
    await new Promise((resolve) => setSheetsConfig({
        spreadsheetId,
        spreadsheetUrl
    }, resolve));
    return { spreadsheetId, title: meta.properties?.title || "Sheet", spreadsheetUrl };
}

async function ensureJobSheetHeaders(spreadsheetId) {
    const id = spreadsheetId || (await new Promise((resolve) => getSheetsConfig(resolve))).spreadsheetId;
    if (!id) throw new Error("Link a Google Sheet first");

    const data = await sheetsFetch(`/${id}/values/A1:I1`);
    const existing = data.values?.[0] || [];
    const needsHeaders = existing.length === 0 ||
        existing[0] !== JOB_SHEET_HEADERS[0];

    if (needsHeaders) {
        await sheetsFetch(`/${id}/values/A1:I1?valueInputOption=RAW`, {
            method: "PUT",
            body: JSON.stringify({ values: [JOB_SHEET_HEADERS] })
        });
    }
}

/**
 * @param {object} row - { company, role, location, source, link, status, followUpDate, notes, dateApplied }
 */
async function appendApplication(row) {
    const config = await new Promise((resolve) => getSheetsConfig(resolve));
    if (!config.spreadsheetId) {
        throw new Error("Link a Google Sheet in settings first");
    }

    const values = [[
        row.dateApplied || new Date().toISOString().slice(0, 10),
        row.company || "",
        row.role || "",
        row.location || "",
        row.source || "",
        row.link || "",
        row.status || "Applied",
        row.followUpDate || "",
        row.notes || ""
    ]];

    await sheetsFetch(
        `/${config.spreadsheetId}/values/A:I:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
        {
            method: "POST",
            body: JSON.stringify({ values })
        }
    );

    if (row.link) {
        const urls = config.loggedJobUrls || [];
        if (!urls.includes(row.link)) {
            urls.push(row.link);
            if (urls.length > 500) urls.splice(0, urls.length - 500);
            await new Promise((resolve) => setSheetsConfig({ loggedJobUrls: urls }, resolve));
        }
    }

    const followUps = await new Promise((resolve) => getFollowUpState(resolve));
    followUps.push({
        company: row.company || "",
        role: row.role || "",
        link: row.link || "",
        appliedAt: Date.now(),
        status: row.status || "Applied"
    });
    await new Promise((resolve) => setFollowUpState(followUps.slice(-200), resolve));

    return { ok: true };
}

async function isDuplicateJob(link, company, role) {
    const config = await new Promise((resolve) => getSheetsConfig(resolve));
    if (link && (config.loggedJobUrls || []).includes(link)) {
        return { duplicate: true, reason: "url" };
    }
    const followUps = await new Promise((resolve) => getFollowUpState(resolve));
    const c = (company || "").toLowerCase().trim();
    const r = (role || "").toLowerCase().trim();
    if (c && r) {
        const hit = followUps.find(
            (e) => (e.company || "").toLowerCase() === c && (e.role || "").toLowerCase() === r
        );
        if (hit) return { duplicate: true, reason: "company+role" };
    }
    return { duplicate: false };
}
