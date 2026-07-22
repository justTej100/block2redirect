/**
 * BACKGROUND SERVICE WORKER
 *
 * Core enforcement engine + toolkit message router (GitHub sync, job tracker).
 */

try {
    importScripts(
        "util/constants.js",
        "util/helpers.js",
        "util/storage.js",
        "util/validation.js",
        "util/github.js",
        "util/sheets.js"
    );
} catch (err) {
    // Surface import failures in the extension error page
    console.error("[Block2Redirect] importScripts failed:", err);
    throw err;
}

function ensureAlarms() {
    try {
        chrome.alarms.create("codeforces-poll", { periodInMinutes: 5 });
        chrome.alarms.create("followup-check", { periodInMinutes: 60 });
    } catch (err) {
        console.error("[Block2Redirect] alarms setup failed:", err);
    }
}

chrome.runtime.onInstalled.addListener(ensureAlarms);
chrome.runtime.onStartup.addListener(ensureAlarms);
ensureAlarms();

function trackBlock(site) {
    chrome.storage.local.get(["stats"], (data) => {
        const stats = data.stats || {};
        stats[site] = (stats[site] || 0) + 1;
        chrome.storage.local.set({ stats });
    });
}

function trackAttempt(site) {
    chrome.storage.local.get(["attempts"], (data) => {
        const attempts = data.attempts || {};
        attempts[site] = (attempts[site] || 0) + 1;
        chrome.storage.local.set({ attempts });
    });
}

function shouldPunish(site, threshold, callback) {
    chrome.storage.local.get(["attempts"], (data) => {
        const attempts = data.attempts || {};
        callback((attempts[site] || 0) >= threshold);
    });
}

function shouldEnforceBlock(timerMode, sessionState, sessionConfig, dailySolves) {
    // Solve ↔ redirect crossover: if no solves today, always enforce when focus is on
    if (Number(dailySolves) === 0) {
        return true;
    }
    if (!timerMode) return true;
    const resolved = resolveSessionState(sessionState, sessionConfig);
    if (!resolved.isActive) return false;
    return resolved.phase === "work";
}

function chooseRedirectUrl(settings, blockedSite, legacyRule) {
    const siteMappings = settings.siteMappings || {};
    const productiveSites = (settings.productiveSites || []).map(ensureUrl).filter(Boolean);
    const mapped = ensureUrl(siteMappings[blockedSite]);
    const validMapped = mapped && productiveSites.includes(mapped);
    const defaultProductiveSite = ensureUrl(settings.defaultProductiveSite);
    const hasValidDefault = defaultProductiveSite && productiveSites.includes(defaultProductiveSite);
    const legacyRedirect = ensureUrl(legacyRule?.redirect);
    const validLegacyRedirect = legacyRedirect && productiveSites.includes(legacyRedirect);
    const forceURL = ensureUrl(settings.forceURL);

    if (settings.forceMode && forceURL) return forceURL;
    if (validMapped) return mapped;
    if (settings.randomMode && productiveSites.length > 0) {
        return productiveSites[Math.floor(Math.random() * productiveSites.length)];
    }
    if (hasValidDefault) return defaultProductiveSite;
    if (validLegacyRedirect) return legacyRedirect;
    if (productiveSites.length > 0) return productiveSites[0];
    return DEFAULT_PRODUCTIVE_SITES[0];
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status !== "loading") return;
    if (!tab.url || !/^https?:/i.test(tab.url)) return;

    let tabHostname = "";
    try {
        tabHostname = new URL(tab.url).hostname;
    } catch (_error) {
        return;
    }

    chrome.storage.sync.get([
        "focusMode",
        "randomMode",
        "forceMode",
        "forceURL",
        "punishmentMode",
        "punishThreshold",
        "rules",
        "blockedSites",
        "productiveSites",
        "siteMappings",
        "defaultProductiveSite",
        "timerMode",
        "sessionConfig",
        "sessionState"
    ], (rawSettings) => {
        migrateLegacySettings(rawSettings, (settings) => {
            if (settings.focusMode === false) return;

            const blockedSites = settings.blockedSites || [];
            const rules = settings.rules || [];

            let blockedSite = blockedSites.find((site) => hostMatches(tabHostname, site));
            let matchedRule = null;

            if (!blockedSite) {
                matchedRule = rules.find((rule) => {
                    return (
                        hostMatches(tabHostname, rule.block) &&
                        isWithinSchedule(rule.start, rule.end)
                    );
                }) || null;
                if (matchedRule) {
                    blockedSite = normalizeHost(matchedRule.block);
                }
            }

            if (!blockedSite) return;

            const sessionState = resolveSessionState(settings.sessionState, settings.sessionConfig);

            if (
                settings.timerMode &&
                settings.sessionState &&
                sessionState.phase !== settings.sessionState.phase
            ) {
                chrome.storage.sync.set({ sessionState });
            }

            getDailyStats((daily) => {
                if (!shouldEnforceBlock(
                    settings.timerMode,
                    sessionState,
                    settings.sessionConfig,
                    daily.solves
                )) {
                    return;
                }

                trackAttempt(blockedSite);

                shouldPunish(blockedSite, settings.punishThreshold || 5, (punish) => {
                    let redirectURL = chooseRedirectUrl(settings, blockedSite, matchedRule);

                    if (punish && settings.punishmentMode) {
                        redirectURL = DEFAULT_PRODUCTIVE_SITES[0];
                    }

                    if (!redirectURL || tab.url.startsWith(redirectURL)) {
                        return;
                    }

                    chrome.tabs.update(tabId, { url: redirectURL });
                    trackBlock(blockedSite);
                });
            });
        });
    });
});

/** Handle a detected solve: cache, optionally push, bump daily stats */
async function handleSolveDetected(problem, options = {}) {
    const forcePush = Boolean(options.forcePush);
    const countSolve = options.countSolve !== false;

    await new Promise((resolve) => cacheLastSolve(problem, resolve));
    if (countSolve) {
        await new Promise((resolve) => incrementDailyStat("solves", resolve));
    }

    const config = await new Promise((resolve) => getGitHubConfig(resolve));
    const shouldPush = forcePush || config.autoPush;
    if (!shouldPush || !config.token || !config.repo) {
        return { cached: true, pushed: false };
    }

    const result = await pushToGitHub(problem);
    await new Promise((resolve) => incrementDailyStat("commits", resolve));
    return { cached: true, pushed: true, ...result };
}

async function handleSaveJob(row, options = {}) {
    if (!options.skipDuplicateCheck) {
        const dup = await isDuplicateJob(row.link, row.company, row.role);
        if (dup.duplicate) {
            return { ok: false, duplicate: true, reason: dup.reason };
        }
    }
    await appendApplication(row);
    await new Promise((resolve) => incrementDailyStat("apps", resolve));
    return { ok: true };
}

async function pollCodeforces() {
    const state = await new Promise((resolve) => getCodeforcesState(resolve));
    if (!state.handle) return;

    const res = await fetch(
        `https://api.codeforces.com/api/user.status?handle=${encodeURIComponent(state.handle)}&from=1&count=20`
    );
    const data = await res.json();
    if (data.status !== "OK" || !Array.isArray(data.result)) return;

    const accepted = data.result
        .filter((s) => s.verdict === "OK")
        .sort((a, b) => a.id - b.id);

    let maxId = state.lastSubmissionId || 0;
    for (const sub of accepted) {
        if (sub.id <= (state.lastSubmissionId || 0)) continue;
        maxId = Math.max(maxId, sub.id);

        let code = "";
        try {
            const pageRes = await fetch(`https://codeforces.com/contest/${sub.contestId}/submission/${sub.id}`);
            const html = await pageRes.text();
            const match = html.match(/<pre[^>]*id="program-source-text"[^>]*>([\s\S]*?)<\/pre>/i)
                || html.match(/<pre[^>]*class="[^"]*prettyprint[^"]*"[^>]*>([\s\S]*?)<\/pre>/i);
            if (match) {
                code = match[1]
                    .replace(/&lt;/g, "<")
                    .replace(/&gt;/g, ">")
                    .replace(/&amp;/g, "&")
                    .replace(/&quot;/g, '"')
                    .replace(/&#39;/g, "'");
            }
        } catch (_err) {
            code = `// Source unavailable for submission ${sub.id}\n`;
        }

        const problem = {
            platform: "codeforces",
            title: sub.problem?.name || `${sub.contestId}${sub.problem?.index || ""}`,
            slug: slugify(sub.problem?.name || String(sub.id)),
            contestId: sub.contestId,
            problemIndex: sub.problem?.index || "",
            language: sub.programmingLanguage || "cpp",
            code,
            url: `https://codeforces.com/contest/${sub.contestId}/problem/${sub.problem?.index || ""}`,
            id: sub.id
        };

        try {
            await handleSolveDetected(problem);
        } catch (_pushErr) {
            await new Promise((resolve) => cacheLastSolve(problem, resolve));
        }
    }

    if (maxId > (state.lastSubmissionId || 0)) {
        await new Promise((resolve) => setCodeforcesState({ lastSubmissionId: maxId }, resolve));
    }
}

async function checkFollowUpReminders() {
    const followUps = await new Promise((resolve) => getFollowUpState(resolve));
    const weekMs = 7 * 24 * 60 * 60 * 1000;
    const stale = followUps.filter(
        (e) => e.status === "Applied" && Date.now() - (e.appliedAt || 0) >= weekMs
    );
    if (stale.length === 0) {
        chrome.action.setBadgeText({ text: "" });
        return;
    }
    chrome.action.setBadgeBackgroundColor({ color: "#f59e0b" });
    chrome.action.setBadgeText({ text: String(Math.min(stale.length, 99)) });
    chrome.notifications.create("job-followups", {
        type: "basic",
        iconUrl: chrome.runtime.getURL("icons/icon128.png"),
        title: "Job follow-ups due",
        message: `${stale.length} application(s) need a status update (7+ days).`
    });
}

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "codeforces-poll") {
        pollCodeforces().catch(() => {});
    }
    if (alarm.name === "followup-check") {
        checkFollowUpReminders().catch(() => {});
    }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const type = message?.type;
    if (!type) return false;

    const reply = (promise) => {
        promise
            .then((result) => sendResponse({ ok: true, result }))
            .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
        return true;
    };

    switch (type) {
        case "SOLVE_DETECTED":
            return reply(handleSolveDetected(message.problem, { forcePush: false, countSolve: true }));

        case "PUSH_LAST_SOLVE":
            return reply((async () => {
                const last = await new Promise((resolve) => getLastSolve(resolve));
                if (!last) throw new Error("No recent solve cached");
                return handleSolveDetected(last, { forcePush: true, countSolve: false });
            })());

        case "PUSH_SOLVE":
            return reply(handleSolveDetected(message.problem, { forcePush: true, countSolve: false }));

        case "GET_SYNC_STATUS":
            return reply((async () => {
                const [github, sheets, daily, lastSolve, cf, followUps] = await Promise.all([
                    new Promise((resolve) => getGitHubConfig(resolve)),
                    new Promise((resolve) => getSheetsConfig(resolve)),
                    new Promise((resolve) => getDailyStats(resolve)),
                    new Promise((resolve) => getLastSolve(resolve)),
                    new Promise((resolve) => getCodeforcesState(resolve)),
                    new Promise((resolve) => getFollowUpState(resolve))
                ]);
                let googleSignedIn = Boolean(sheets.accessToken);
                try {
                    await new Promise((resolve, reject) => {
                        chrome.identity.getAuthToken({ interactive: false }, (token) => {
                            if (chrome.runtime.lastError || !token) {
                                reject(new Error("no token"));
                                return;
                            }
                            googleSignedIn = true;
                            resolve(token);
                        });
                    });
                } catch (_err) {
                    // not signed in via identity
                }
                const weekMs = 7 * 24 * 60 * 60 * 1000;
                const staleFollowUps = followUps.filter(
                    (e) => e.status === "Applied" && Date.now() - (e.appliedAt || 0) >= weekMs
                );
                return {
                    githubConnected: Boolean(github.token),
                    githubUser: github.user,
                    githubRepo: github.repo ? `${github.owner}/${github.repo}` : "",
                    githubAutoPush: github.autoPush,
                    githubLoginReady: Boolean(GITHUB_OAUTH_CLIENT_ID),
                    sheetsConnected: googleSignedIn,
                    spreadsheetId: sheets.spreadsheetId,
                    spreadsheetUrl: sheets.spreadsheetUrl,
                    googleLoginReady: Boolean(chrome.runtime.getManifest().oauth2?.client_id),
                    jobAppGoal: sheets.jobAppGoal,
                    daily,
                    lastSolve,
                    cfHandle: cf.handle,
                    staleFollowUps: staleFollowUps.length
                };
            })());

        case "GITHUB_START_DEVICE_CODES":
            return reply((async () => {
                const device = await startGitHubDeviceFlow();
                // Use local (not session) — SW restarts wipe session between poll messages
                await new Promise((resolve) => setLocal({
                    githubDeviceCode: device.device_code,
                    githubDeviceInterval: device.interval || 5,
                    githubDeviceExpires: Date.now() + (Number(device.expires_in) || 900) * 1000
                }, resolve));
                const userCode = device.user_code;
                const verificationUri = device.verification_uri_complete
                    || `${device.verification_uri || "https://github.com/login/device"}?user_code=${encodeURIComponent(userCode)}`;
                return {
                    userCode,
                    verificationUri,
                    interval: device.interval || 5
                };
            })());

        case "GITHUB_POLL_DEVICE_ONCE":
            return reply((async () => {
                const sess = await new Promise((resolve) => getLocal([
                    "githubDeviceCode",
                    "githubDeviceExpires"
                ], resolve));
                if (!sess.githubDeviceCode) throw new Error("No pending GitHub device auth — click Login again");
                if (sess.githubDeviceExpires && Date.now() > sess.githubDeviceExpires) {
                    throw new Error("GitHub login code expired — click Login again");
                }
                const poll = await pollGitHubDeviceTokenOnce(sess.githubDeviceCode);
                if (poll.status !== "ok") {
                    return poll;
                }
                const result = await saveGitHubToken(poll.token);
                await new Promise((resolve) => setLocal({
                    githubDeviceCode: null,
                    githubDeviceInterval: null,
                    githubDeviceExpires: null
                }, resolve));
                return { status: "ok", user: result.user };
            })());

        case "GITHUB_SET_PAT":
            return reply((async () => {
                const token = (message.token || "").trim();
                if (!token) throw new Error("Paste a GitHub personal access token");
                return saveGitHubToken(token);
            })());

        case "GITHUB_LIST_REPOS":
            return reply(listGitHubRepos());

        case "GITHUB_CREATE_REPO":
            return reply((async () => {
                const repo = await createGitHubRepo(message.name, Boolean(message.private));
                await new Promise((resolve) => setGitHubConfig({
                    owner: repo.owner.login,
                    repo: repo.name
                }, resolve));
                return repo;
            })());

        case "GITHUB_SET_REPO":
            return reply((async () => {
                await new Promise((resolve) => setGitHubConfig({
                    owner: message.owner,
                    repo: message.repo
                }, resolve));
                return { owner: message.owner, repo: message.repo };
            })());

        case "GITHUB_SET_AUTO":
            return reply((async () => {
                await new Promise((resolve) => setGitHubConfig({ autoPush: Boolean(message.autoPush) }, resolve));
                return { autoPush: Boolean(message.autoPush) };
            })());

        case "GITHUB_DISCONNECT":
            return reply((async () => {
                await new Promise((resolve) => clearGitHubAuth(resolve));
                return { disconnected: true };
            })());

        case "GOOGLE_CONNECT":
            return reply(connectGoogle());

        case "GOOGLE_DISCONNECT":
            return reply(disconnectGoogle());

        case "SHEETS_LINK":
            return reply(linkSpreadsheet(message.urlOrId));

        case "SAVE_JOB":
            return reply(handleSaveJob(message.job || {}, { skipDuplicateCheck: message.force }));

        case "CHECK_JOB_DUPLICATE":
            return reply(isDuplicateJob(message.link, message.company, message.role));

        case "SET_CF_HANDLE":
            return reply((async () => {
                await new Promise((resolve) => setCodeforcesState({ handle: message.handle || "" }, resolve));
                pollCodeforces().catch(() => {});
                return { handle: message.handle || "" };
            })());

        case "SET_JOB_GOAL":
            return reply((async () => {
                await new Promise((resolve) => setSheetsConfig({
                    jobAppGoal: Math.max(1, Number(message.goal) || 5)
                }, resolve));
                return { jobAppGoal: Math.max(1, Number(message.goal) || 5) };
            })());

        case "POLL_CODEFORCES":
            return reply(pollCodeforces().then(() => ({ polled: true })));

        default:
            sendResponse({ ok: false, error: `Unknown message type: ${type}` });
            return false;
    }
});
