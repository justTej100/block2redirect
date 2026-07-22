/**
 * SHARED STORAGE OPERATIONS
 *
 * Chrome storage read/write functions used across popup, settings, and background.
 */

/** Read blocked site data from storage */
function readBlockedSiteData(callback) {
    chrome.storage.sync.get(["blockedSites", "blockedSiteMeta", "siteMappings"], (data) => {
        callback({
            blockedSites: data.blockedSites || [],
            blockedSiteMeta: data.blockedSiteMeta || {},
            siteMappings: data.siteMappings || {}
        });
    });
}

/** Save a blocked site with favicon metadata */
function saveBlockedSite(host, meta, callback) {
    readBlockedSiteData((data) => {
        const blockedSites = data.blockedSites.slice();
        const blockedSiteMeta = { ...data.blockedSiteMeta };

        if (!blockedSites.includes(host)) {
            blockedSites.push(host);
        }

        blockedSiteMeta[host] = {
            host,
            sourceUrl: meta?.sourceUrl || ensureUrl(host),
            faviconUrl: meta?.faviconUrl || getFaviconUrl(host, meta?.sourceUrl || ensureUrl(host)),
            title: meta?.title || host
        };

        chrome.storage.sync.set({ blockedSites, blockedSiteMeta }, () => {
            if (typeof callback === "function") {
                callback();
            }
        });
    });
}

/** Remove a blocked site at index and clean up mappings */
function removeBlockedSite(index, callback) {
    chrome.storage.sync.get(["blockedSites", "siteMappings", "blockedSiteMeta"], (data) => {
        const blockedSites = data.blockedSites || [];
        const siteMappings = data.siteMappings || {};
        const blockedSiteMeta = data.blockedSiteMeta || {};
        const [removed] = blockedSites.splice(index, 1);
        if (removed) {
            delete siteMappings[removed];
            delete blockedSiteMeta[removed];
        }
        chrome.storage.sync.set({ blockedSites, siteMappings, blockedSiteMeta }, () => {
            if (typeof callback === "function") {
                callback();
            }
        });
    });
}

/** Migrate legacy rules format to new storage schema (reads from sync) */
function migrateLegacyRules(callback) {
    chrome.storage.sync.get([
        "rules",
        "blockedSites",
        "productiveSites",
        "siteMappings",
        "defaultProductiveSite",
        "blockedSiteMeta"
    ], (data) => {
        if (Array.isArray(data.blockedSites)) {
            callback();
            return;
        }

        const rules = data.rules || [];
        const blockedSites = [];
        const productiveSites = [...DEFAULT_PRODUCTIVE_SITES];
        const siteMappings = {};

        rules.forEach((rule) => {
            const blocked = normalizeHost(rule.block);
            const redirect = ensureUrl(rule.redirect);
            if (blocked && !blockedSites.includes(blocked)) {
                blockedSites.push(blocked);
            }
            if (redirect && !productiveSites.includes(redirect)) {
                productiveSites.push(redirect);
            }
            if (blocked && redirect && !siteMappings[blocked]) {
                siteMappings[blocked] = redirect;
            }
        });

        chrome.storage.sync.set({
            blockedSites,
            productiveSites,
            siteMappings,
            blockedSiteMeta: data.blockedSiteMeta || {},
            defaultProductiveSite: pickDefaultProductiveSite(data.defaultProductiveSite, productiveSites)
        }, callback);
    });
}

/**
 * Migrate legacy rules when settings were already fetched (background path).
 * Calls back with merged settings object.
 */
function migrateLegacySettings(settings, callback) {
    if (Array.isArray(settings.blockedSites)) {
        callback(settings);
        return;
    }

    const rules = settings.rules || [];
    const blockedSites = [];
    const productiveSites = [...DEFAULT_PRODUCTIVE_SITES];
    const siteMappings = {};

    rules.forEach((rule) => {
        const blocked = normalizeHost(rule.block);
        const redirect = ensureUrl(rule.redirect);
        if (blocked && !blockedSites.includes(blocked)) {
            blockedSites.push(blocked);
        }
        if (blocked && redirect && !siteMappings[blocked]) {
            siteMappings[blocked] = redirect;
        }
        if (redirect && !productiveSites.includes(redirect)) {
            productiveSites.push(redirect);
        }
    });

    const patch = {
        blockedSites,
        productiveSites,
        siteMappings,
        defaultProductiveSite: pickDefaultProductiveSite(settings.defaultProductiveSite, productiveSites)
    };

    chrome.storage.sync.set(patch, () => callback({ ...settings, ...patch }));
}

/** Generic local storage get */
function getLocal(keys, callback) {
    chrome.storage.local.get(keys, (data) => {
        callback(data || {});
    });
}

/** Generic local storage set */
function setLocal(obj, callback) {
    chrome.storage.local.set(obj, () => {
        if (typeof callback === "function") callback();
    });
}

/** Generic session storage get */
function getSession(keys, callback) {
    chrome.storage.session.get(keys, (data) => {
        callback(data || {});
    });
}

/** Generic session storage set */
function setSession(obj, callback) {
    chrome.storage.session.set(obj, () => {
        if (typeof callback === "function") callback();
    });
}

/** Cache last detected solve for manual push */
function cacheLastSolve(problem, callback) {
    setSession({ lastSolve: problem }, callback);
}

/** Read last detected solve */
function getLastSolve(callback) {
    getSession(["lastSolve"], (data) => callback(data.lastSolve || null));
}

/** GitHub config (token stays in local only) */
function getGitHubConfig(callback) {
    getLocal(["githubToken", "githubRepo", "githubOwner", "githubAutoPush", "githubUser"], (data) => {
        callback({
            token: data.githubToken || "",
            repo: data.githubRepo || "",
            owner: data.githubOwner || "",
            autoPush: data.githubAutoPush !== false,
            user: data.githubUser || null
        });
    });
}

function setGitHubConfig(patch, callback) {
    const mapped = {};
    if ("token" in patch) mapped.githubToken = patch.token;
    if ("repo" in patch) mapped.githubRepo = patch.repo;
    if ("owner" in patch) mapped.githubOwner = patch.owner;
    if ("autoPush" in patch) mapped.githubAutoPush = patch.autoPush;
    if ("user" in patch) mapped.githubUser = patch.user;
    setLocal(mapped, callback);
}

function clearGitHubAuth(callback) {
    setLocal({
        githubToken: "",
        githubUser: null
    }, callback);
}

/** Google Sheets config */
function getSheetsConfig(callback) {
    getLocal([
        "googleAccessToken",
        "googleTokenExpiry",
        "spreadsheetId",
        "spreadsheetUrl",
        "jobAppGoal",
        "loggedJobUrls",
        "googleUser",
        "googleSignedIn"
    ], (data) => {
        callback({
            accessToken: data.googleAccessToken || "",
            tokenExpiry: data.googleTokenExpiry || 0,
            spreadsheetId: data.spreadsheetId || "",
            spreadsheetUrl: data.spreadsheetUrl || "",
            jobAppGoal: Number(data.jobAppGoal) || 5,
            loggedJobUrls: data.loggedJobUrls || [],
            user: data.googleUser || null,
            signedIn: Boolean(data.googleSignedIn) || Boolean(data.googleAccessToken) || Boolean(data.googleUser)
        });
    });
}

function setSheetsConfig(patch, callback) {
    const mapped = {};
    if ("accessToken" in patch) mapped.googleAccessToken = patch.accessToken;
    if ("tokenExpiry" in patch) mapped.googleTokenExpiry = patch.tokenExpiry;
    if ("spreadsheetId" in patch) mapped.spreadsheetId = patch.spreadsheetId;
    if ("spreadsheetUrl" in patch) mapped.spreadsheetUrl = patch.spreadsheetUrl;
    if ("jobAppGoal" in patch) mapped.jobAppGoal = patch.jobAppGoal;
    if ("loggedJobUrls" in patch) mapped.loggedJobUrls = patch.loggedJobUrls;
    if ("user" in patch) mapped.googleUser = patch.user;
    if ("signedIn" in patch) mapped.googleSignedIn = patch.signedIn;
    setLocal(mapped, callback);
}

function clearGoogleAuth(callback) {
    setLocal({
        googleAccessToken: "",
        googleTokenExpiry: 0,
        googleUser: null,
        googleSignedIn: false
    }, callback);
}

/**
 * Daily activity counters: { date, solves, apps, commits }
 */
function getDailyStats(callback) {
    getLocal(["dailyStats"], (data) => {
        const key = todayKey();
        const stats = data.dailyStats || {};
        if (stats.date !== key) {
            callback({ date: key, solves: 0, apps: 0, commits: 0 });
            return;
        }
        callback({
            date: key,
            solves: Number(stats.solves) || 0,
            apps: Number(stats.apps) || 0,
            commits: Number(stats.commits) || 0
        });
    });
}

function incrementDailyStat(field, callback) {
    getDailyStats((stats) => {
        const next = { ...stats, [field]: (Number(stats[field]) || 0) + 1 };
        setLocal({ dailyStats: next }, () => {
            if (typeof callback === "function") callback(next);
        });
    });
}

/** Follow-up reminder state for job apps */
function getFollowUpState(callback) {
    getLocal(["jobFollowUps"], (data) => {
        callback(Array.isArray(data.jobFollowUps) ? data.jobFollowUps : []);
    });
}

function setFollowUpState(entries, callback) {
    setLocal({ jobFollowUps: entries }, callback);
}

/** Codeforces poll cursor */
function getCodeforcesState(callback) {
    getLocal(["cfHandle", "cfLastSubmissionId"], (data) => {
        callback({
            handle: data.cfHandle || "",
            lastSubmissionId: data.cfLastSubmissionId || 0
        });
    });
}

function setCodeforcesState(patch, callback) {
    const mapped = {};
    if ("handle" in patch) mapped.cfHandle = patch.handle;
    if ("lastSubmissionId" in patch) mapped.cfLastSubmissionId = patch.lastSubmissionId;
    setLocal(mapped, callback);
}
