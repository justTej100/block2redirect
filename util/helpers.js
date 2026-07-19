/**
 * SHARED HELPER FUNCTIONS
 *
 * Utility functions used across popup, settings, and background scripts.
 */

/** Normalize input domain: strip protocol, www, subpaths, lowercase */
function normalizeHost(value) {
    if (!value) return "";
    let host = value.trim().toLowerCase();
    host = host.replace(/^https?:\/\//, "");
    host = host.replace(/^www\./, "");
    host = host.split("/")[0];
    return host;
}

/** Ensure URL has protocol (defaults to https://) */
function ensureUrl(value) {
    if (!value) return "";
    const trimmed = value.trim();
    if (!trimmed) return "";
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    return `https://${trimmed}`;
}

/** Get favicon URL for a site using Google Favicons API or fallback */
function getFaviconUrl(host, sourceUrl = "") {
    if (host) {
        return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`;
    }
    return DEFAULT_FAVICON_FALLBACK;
}

/** Extract hostname from tab URL */
function getTabHostname(tabUrl) {
    if (!tabUrl || !/^https?:\/\//i.test(tabUrl)) return "";
    try {
        return new URL(tabUrl).hostname;
    } catch (_error) {
        return "";
    }
}

/** Check if string looks like a valid hostname (has dot, is localhost, or IP) */
function isLikelyHost(host) {
    if (!host) return false;
    if (host.includes(".")) return true;
    return /^localhost(?::\d+)?$/i.test(host) || /^(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?$/.test(host);
}

/** Hostname match including subdomains */
function hostMatches(hostname, target) {
    const normalizedHost = normalizeHost(hostname);
    const normalizedTarget = normalizeHost(target);
    if (!normalizedHost || !normalizedTarget) return false;
    return (
        normalizedHost === normalizedTarget ||
        normalizedHost.endsWith(`.${normalizedTarget}`)
    );
}

/** Whether current time falls in a start:end schedule window */
function isWithinSchedule(start, end) {
    const now = new Date();
    let minutes = now.getHours() * 60 + now.getMinutes();
    const [sh, sm] = (start || "00:00").split(":").map(Number);
    const [eh, em] = (end || "23:59").split(":").map(Number);
    const startMin = sh * 60 + sm;
    let endMin = eh * 60 + em;
    if (endMin < startMin) {
        endMin += 24 * 60;
        if (minutes < startMin) {
            minutes += 24 * 60;
        }
    }
    return minutes >= startMin && minutes <= endMin;
}

/** Resolve session state, auto-advancing phases if needed */
function resolveSessionState(sessionState, sessionConfig) {
    if (!sessionState || !sessionState.isActive) {
        return sessionState || { isActive: false, phase: "work", startedAt: 0, endsAt: 0 };
    }
    const now = Date.now();
    const resolved = {
        ...sessionState,
        phase: sessionState.phase === "break" ? "break" : "work"
    };
    const safeConfig = {
        workMinutes: Number(sessionConfig?.workMinutes) || DEFAULT_SESSION_CONFIG.workMinutes,
        breakMinutes: Number(sessionConfig?.breakMinutes) || DEFAULT_SESSION_CONFIG.breakMinutes
    };
    let guard = 0;
    while (resolved.endsAt && now >= resolved.endsAt && guard < 10) {
        if (resolved.phase === "work") {
            resolved.phase = "break";
            resolved.startedAt = resolved.endsAt;
            resolved.endsAt = resolved.startedAt + safeConfig.breakMinutes * 60 * 1000;
        } else {
            resolved.phase = "work";
            resolved.startedAt = resolved.endsAt;
            resolved.endsAt = resolved.startedAt + safeConfig.workMinutes * 60 * 1000;
        }
        guard += 1;
    }
    if (!resolved.endsAt) {
        resolved.isActive = false;
    }
    return resolved;
}

/** Format milliseconds into MM:SS display */
function formatTimeLeft(ms) {
    const safeMs = Math.max(0, ms);
    const totalSeconds = Math.floor(safeMs / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/** Get the currently active browser tab */
function getCurrentTab(callback) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        callback(Array.isArray(tabs) ? tabs[0] || null : null);
    });
}

/** Pick a valid default productive site from a list */
function pickDefaultProductiveSite(defaultProductiveSite, productiveSites) {
    const normalizedSites = (productiveSites || []).map(ensureUrl).filter(Boolean);
    const storedDefault = ensureUrl(defaultProductiveSite);
    if (storedDefault && normalizedSites.includes(storedDefault)) {
        return storedDefault;
    }
    return normalizedSites[0] || DEFAULT_PRODUCTIVE_SITES[0];
}

/** Get default productive site from storage */
function getDefaultProductiveSite() {
    return new Promise((resolve) => {
        chrome.storage.sync.get(["defaultProductiveSite", "productiveSites"], (data) => {
            resolve(pickDefaultProductiveSite(data.defaultProductiveSite, data.productiveSites));
        });
    });
}

/** Map language name to file extension */
function languageToExtension(language) {
    if (!language) return "txt";
    const key = String(language).toLowerCase().replace(/\s+/g, "");
    return LANG_EXTENSIONS[key] || key.slice(0, 8) || "txt";
}

/** Slugify a problem title for paths */
function slugify(value) {
    return String(value || "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 80) || "solution";
}

/** Today's date key YYYY-MM-DD in local time */
function todayKey() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}

/** Encode string to base64 (UTF-8 safe) */
function utf8ToBase64(str) {
    const bytes = new TextEncoder().encode(str);
    let binary = "";
    bytes.forEach((b) => {
        binary += String.fromCharCode(b);
    });
    return btoa(binary);
}
