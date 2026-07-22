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
                reject(new Error(chrome.runtime.lastError?.message || "Google login failed"));
                return;
            }
            resolve(token);
        });
    });
}

async function connectGoogle() {
    const manifest = chrome.runtime.getManifest();
    if (!manifest.oauth2?.client_id) {
        throw new Error("Add oauth2.client_id to manifest.json (Google Chrome Extension OAuth client)");
    }
    const accessToken = await getAuthToken(true);
    await new Promise((resolve) => setSheetsConfig({
        accessToken,
        tokenExpiry: Date.now() + 55 * 60 * 1000
    }, resolve));
    return { accessToken };
}

async function disconnectGoogle() {
    try {
        const token = await getAuthToken(false);
        await new Promise((resolve) => {
            chrome.identity.removeCachedAuthToken({ token }, () => {
                if (chrome.identity.clearAllCachedAuthTokens) {
                    chrome.identity.clearAllCachedAuthTokens(() => resolve());
                } else {
                    resolve();
                }
            });
        });
    } catch (_err) {
        // already signed out
    }
    await new Promise((resolve) => clearGoogleAuth(resolve));
}

async function getValidGoogleToken() {
    try {
        return await getAuthToken(false);
    } catch (_err) {
        return getAuthToken(true);
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
        // Invalidate bad cached token once
        if (res.status === 401) {
            try {
                await new Promise((resolve) => {
                    chrome.identity.removeCachedAuthToken({ token }, () => resolve());
                });
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
