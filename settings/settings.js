/**
 * SETTINGS PAGE SCRIPT
 *
 * Site management, modes/timer, GitHub sync, and Google Sheets job tracker.
 */

const blockedSiteInput = document.getElementById("blockedSiteInput");
const addBlockedBtn = document.getElementById("addBlockedBtn");
const blockedSitesList = document.getElementById("blockedSitesList");

const productiveSiteInput = document.getElementById("productiveSiteInput");
const addProductiveBtn = document.getElementById("addProductiveBtn");
const productiveSitesList = document.getElementById("productiveSitesList");
const defaultProductiveSelect = document.getElementById("defaultProductiveSelect");
const saveDefaultBtn = document.getElementById("saveDefaultBtn");

const mappingList = document.getElementById("mappingList");

const focusToggle = document.getElementById("focusToggle");
const randomToggle = document.getElementById("randomToggle");
const punishToggle = document.getElementById("punishToggle");
const timerToggle = document.getElementById("timerToggle");
const punishThresholdInput = document.getElementById("punishThresholdInput");
const saveThresholdBtn = document.getElementById("saveThresholdBtn");

const workMinutesInput = document.getElementById("workMinutesInput");
const breakMinutesInput = document.getElementById("breakMinutesInput");
const saveSessionConfigBtn = document.getElementById("saveSessionConfigBtn");
const startSessionBtn = document.getElementById("startSessionBtn");
const stopSessionBtn = document.getElementById("stopSessionBtn");
const sessionStatus = document.getElementById("sessionStatus");

const statsList = document.getElementById("statsList");

const githubStatus = document.getElementById("githubStatus");
const githubDeviceHint = document.getElementById("githubDeviceHint");
const githubConnectBtn = document.getElementById("githubConnectBtn");
const githubDisconnectBtn = document.getElementById("githubDisconnectBtn");
const githubPatInput = document.getElementById("githubPatInput");
const githubPatSaveBtn = document.getElementById("githubPatSaveBtn");
const githubRepoSelect = document.getElementById("githubRepoSelect");
const githubRefreshReposBtn = document.getElementById("githubRefreshReposBtn");
const githubNewRepoInput = document.getElementById("githubNewRepoInput");
const githubCreateRepoBtn = document.getElementById("githubCreateRepoBtn");
const githubAutoPushToggle = document.getElementById("githubAutoPushToggle");
const cfHandleInput = document.getElementById("cfHandleInput");
const cfHandleSaveBtn = document.getElementById("cfHandleSaveBtn");

const sheetsStatus = document.getElementById("sheetsStatus");
const googleConnectBtn = document.getElementById("googleConnectBtn");
const googleDisconnectBtn = document.getElementById("googleDisconnectBtn");
const sheetUrlInput = document.getElementById("sheetUrlInput");
const sheetLinkBtn = document.getElementById("sheetLinkBtn");
const jobGoalInput = document.getElementById("jobGoalInput");
const jobGoalSaveBtn = document.getElementById("jobGoalSaveBtn");

function sendMessage(message) {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(message, (response) => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
            }
            if (!response?.ok) {
                reject(new Error(response?.error || "Request failed"));
                return;
            }
            resolve(response.result);
        });
    });
}

function loadStats() {
    chrome.storage.local.get(["stats"], (data) => {
        const stats = data.stats || {};
        const entries = Object.entries(stats).sort((a, b) => b[1] - a[1]);
        statsList.innerHTML = "";
        if (entries.length === 0) {
            const li = document.createElement("li");
            li.textContent = "No blocked attempts recorded yet.";
            statsList.appendChild(li);
            return;
        }
        entries.forEach(([site, count]) => {
            const li = document.createElement("li");
            li.innerHTML = `<b>${site}</b><span>${count} blocks</span>`;
            statsList.appendChild(li);
        });
    });
}

function renderState() {
    chrome.storage.sync.get([
        "blockedSites",
        "blockedSiteMeta",
        "productiveSites",
        "siteMappings",
        "defaultProductiveSite",
        "focusMode",
        "randomMode",
        "punishmentMode",
        "timerMode",
        "punishThreshold",
        "sessionConfig",
        "sessionState"
    ], (data) => {
        const blockedSites = data.blockedSites || [];
        const blockedSiteMeta = data.blockedSiteMeta || {};
        const productiveSites = (data.productiveSites || DEFAULT_PRODUCTIVE_SITES).map(ensureUrl).filter(Boolean);
        const siteMappings = data.siteMappings || {};
        const defaultProductiveSite = pickDefaultProductiveSite(data.defaultProductiveSite, productiveSites);

        if (ensureUrl(data.defaultProductiveSite) !== defaultProductiveSite) {
            chrome.storage.sync.set({ defaultProductiveSite });
        }

        blockedSitesList.innerHTML = "";
        blockedSites.forEach((site, index) => {
            const meta = blockedSiteMeta[site] || {};
            const faviconUrl = meta.faviconUrl || getFaviconUrl(site, meta.sourceUrl || ensureUrl(site));
            const li = document.createElement("li");
            li.className = "site-card";
            li.innerHTML = `
                <div class="site-icon">
                    <img src="${faviconUrl}" alt="${site}" onerror="this.src='${DEFAULT_FAVICON_FALLBACK}'">
                </div>
                <div class="site-name">${site}</div>
                <button class="site-remove" data-remove-blocked="${index}">Remove</button>
            `;
            blockedSitesList.appendChild(li);
        });
        document.querySelectorAll("button[data-remove-blocked]").forEach((btn) => {
            btn.onclick = () => removeBlockedSite(Number(btn.dataset.removeBlocked), renderState);
        });

        productiveSitesList.innerHTML = "";
        productiveSites.forEach((site, index) => {
            const host = normalizeHost(site);
            const li = document.createElement("li");
            li.className = "site-card";
            const faviconUrl = getFaviconUrl(host, site);
            li.innerHTML = `
                <div class="site-icon">
                    <img src="${faviconUrl}" alt="${site}" onerror="this.src='${DEFAULT_FAVICON_FALLBACK}'">
                </div>
                <div class="site-name">${site}</div>
                <button class="site-remove" data-remove-productive="${index}">Remove</button>
            `;
            productiveSitesList.appendChild(li);
        });
        document.querySelectorAll("button[data-remove-productive]").forEach((btn) => {
            btn.onclick = () => removeProductiveSite(Number(btn.dataset.removeProductive));
        });

        defaultProductiveSelect.innerHTML = "";
        productiveSites.forEach((site) => {
            const option = document.createElement("option");
            option.value = site;
            option.textContent = site;
            option.selected = site === defaultProductiveSite;
            defaultProductiveSelect.appendChild(option);
        });

        mappingList.innerHTML = "";
        blockedSites.forEach((blockedSite) => {
            const meta = blockedSiteMeta[blockedSite] || {};
            const faviconUrl = meta.faviconUrl || getFaviconUrl(blockedSite, meta.sourceUrl || ensureUrl(blockedSite));
            const selected = ensureUrl(siteMappings[blockedSite] || "");
            const options = ["<option value=\"\">Use fallback</option>"];
            productiveSites.forEach((site) => {
                const isSelected = site === selected ? "selected" : "";
                options.push(`<option value="${site}" ${isSelected}>${site}</option>`);
            });
            const li = document.createElement("li");
            li.className = "mapping-item";
            li.innerHTML = `
                <div class="mapping-icon">
                    <img src="${faviconUrl}" alt="${blockedSite}" onerror="this.src='${DEFAULT_FAVICON_FALLBACK}'">
                </div>
                <div class="mapping-blocked">${blockedSite}</div>
                <select class="mapping-select" data-map-blocked="${blockedSite}">${options.join("")}</select>
            `;
            mappingList.appendChild(li);
        });
        document.querySelectorAll("select[data-map-blocked]").forEach((select) => {
            select.onchange = () => saveMapping(select.dataset.mapBlocked, select.value);
        });

        focusToggle.checked = data.focusMode ?? true;
        randomToggle.checked = data.randomMode ?? true;
        punishToggle.checked = data.punishmentMode ?? false;
        timerToggle.checked = data.timerMode ?? false;
        punishThresholdInput.value = data.punishThreshold || 5;

        const sessionConfig = {
            workMinutes: Number(data.sessionConfig?.workMinutes) || DEFAULT_SESSION_CONFIG.workMinutes,
            breakMinutes: Number(data.sessionConfig?.breakMinutes) || DEFAULT_SESSION_CONFIG.breakMinutes
        };
        const sessionState = resolveSessionState(data.sessionState, sessionConfig);
        if (JSON.stringify(sessionState) !== JSON.stringify(data.sessionState)) {
            chrome.storage.sync.set({ sessionState });
        }
        workMinutesInput.value = sessionConfig.workMinutes;
        breakMinutesInput.value = sessionConfig.breakMinutes;
        if (!sessionState.isActive) {
            sessionStatus.textContent = "Session inactive";
        } else {
            const timeLeft = formatTimeLeft(sessionState.endsAt - Date.now());
            sessionStatus.textContent = `${sessionState.phase.toUpperCase()} - ${timeLeft}`;
        }
    });
}

async function refreshToolkitStatus() {
    try {
        const status = await sendMessage({ type: "GET_SYNC_STATUS" });
        if (status.githubConnected) {
            githubStatus.textContent = `Logged in as ${status.githubUser?.login || "user"}${status.githubRepo ? ` · ${status.githubRepo}` : ""}`;
            githubStatus.dataset.kind = "success";
        } else if (!status.githubLoginReady) {
            githubStatus.textContent = "Login unavailable — set GITHUB_OAUTH_CLIENT_ID in util/constants.js";
            githubStatus.dataset.kind = "info";
        } else {
            githubStatus.textContent = "Not logged in";
            githubStatus.dataset.kind = "info";
        }
        githubAutoPushToggle.checked = status.githubAutoPush !== false;
        cfHandleInput.value = status.cfHandle || "";

        if (status.sheetsConnected || status.spreadsheetId) {
            sheetsStatus.textContent = status.spreadsheetUrl
                ? `Sheet linked: ${status.spreadsheetUrl}`
                : (status.sheetsConnected ? "Logged in — paste a Sheet URL" : "Not logged in");
            sheetsStatus.dataset.kind = status.spreadsheetId ? "success" : "info";
        } else if (!status.googleLoginReady) {
            sheetsStatus.textContent = "Login unavailable — add oauth2.client_id in manifest.json";
            sheetsStatus.dataset.kind = "info";
        } else {
            sheetsStatus.textContent = "Not logged in — click Login with Google";
            sheetsStatus.dataset.kind = "info";
        }
        if (status.spreadsheetUrl) sheetUrlInput.value = status.spreadsheetUrl;
        jobGoalInput.value = status.jobAppGoal || 5;

        if (status.githubConnected) {
            await loadRepos(status.githubRepo);
        }
    } catch (err) {
        githubStatus.textContent = err.message;
        githubStatus.dataset.kind = "error";
    }
}

async function loadRepos(selectedFull) {
    try {
        const repos = await sendMessage({ type: "GITHUB_LIST_REPOS" });
        githubRepoSelect.innerHTML = "<option value=\"\">Select a repository</option>";
        (repos || []).forEach((repo) => {
            const option = document.createElement("option");
            option.value = `${repo.owner.login}/${repo.name}`;
            option.textContent = repo.full_name || option.value;
            if (selectedFull && option.value === selectedFull) option.selected = true;
            githubRepoSelect.appendChild(option);
        });
    } catch (_err) {
        // ignore until connected
    }
}

function addBlockedSite() {
    const blockedSite = normalizeHost(blockedSiteInput.value);
    if (!blockedSite) return;
    chrome.storage.sync.get(["blockedSites"], (data) => {
        const blockedSites = data.blockedSites || [];
        if (!blockedSites.includes(blockedSite)) {
            blockedSites.push(blockedSite);
        }
        chrome.storage.sync.set({ blockedSites }, () => {
            blockedSiteInput.value = "";
            renderState();
        });
    });
}

function addProductiveSite() {
    const productiveSite = ensureUrl(productiveSiteInput.value);
    if (!productiveSite) return;
    chrome.storage.sync.get(["productiveSites", "defaultProductiveSite"], (data) => {
        const productiveSites = (data.productiveSites || DEFAULT_PRODUCTIVE_SITES).map(ensureUrl).filter(Boolean);
        if (!productiveSites.includes(productiveSite)) {
            productiveSites.push(productiveSite);
        }
        chrome.storage.sync.set({
            productiveSites,
            defaultProductiveSite: pickDefaultProductiveSite(data.defaultProductiveSite, productiveSites)
        }, () => {
            productiveSiteInput.value = "";
            renderState();
        });
    });
}

function removeProductiveSite(index) {
    chrome.storage.sync.get([
        "productiveSites",
        "siteMappings",
        "defaultProductiveSite"
    ], (data) => {
        const productiveSites = (data.productiveSites || DEFAULT_PRODUCTIVE_SITES).map(ensureUrl).filter(Boolean);
        const siteMappings = data.siteMappings || {};
        const [removed] = productiveSites.splice(index, 1);
        if (!removed) return;
        for (const blockedSite of Object.keys(siteMappings)) {
            if (ensureUrl(siteMappings[blockedSite]) === removed) {
                delete siteMappings[blockedSite];
            }
        }
        const nextDefault = pickDefaultProductiveSite(data.defaultProductiveSite, productiveSites);
        chrome.storage.sync.set({
            productiveSites,
            siteMappings,
            defaultProductiveSite: nextDefault
        }, renderState);
    });
}

function saveMapping(blockedSite, productiveSite) {
    chrome.storage.sync.get(["siteMappings"], (data) => {
        const siteMappings = data.siteMappings || {};
        if (!productiveSite) {
            delete siteMappings[blockedSite];
        } else {
            siteMappings[blockedSite] = ensureUrl(productiveSite);
        }
        chrome.storage.sync.set({ siteMappings });
    });
}

function saveDefaultProductive() {
    const url = ensureUrl(defaultProductiveSelect.value);
    if (!url) return;
    chrome.storage.sync.set({ defaultProductiveSite: url });
}

function saveThreshold() {
    const threshold = Math.max(1, Number(punishThresholdInput.value) || 5);
    chrome.storage.sync.set({ punishThreshold: threshold }, renderState);
}

function saveSessionConfig() {
    const workMinutes = Math.max(1, Number(workMinutesInput.value) || DEFAULT_SESSION_CONFIG.workMinutes);
    const breakMinutes = Math.max(1, Number(breakMinutesInput.value) || DEFAULT_SESSION_CONFIG.breakMinutes);
    chrome.storage.sync.set({ sessionConfig: { workMinutes, breakMinutes } }, renderState);
}

function startSession() {
    chrome.storage.sync.get(["sessionConfig"], (data) => {
        const workMinutes = Math.max(1, Number(data.sessionConfig?.workMinutes) || DEFAULT_SESSION_CONFIG.workMinutes);
        const now = Date.now();
        chrome.storage.sync.set({
            sessionState: {
                isActive: true,
                phase: "work",
                startedAt: now,
                endsAt: now + workMinutes * 60 * 1000
            }
        }, renderState);
    });
}

function stopSession() {
    chrome.storage.sync.set({
        sessionState: {
            isActive: false,
            phase: "work",
            startedAt: 0,
            endsAt: 0
        }
    }, renderState);
}

async function connectGitHub() {
    try {
        githubConnectBtn.disabled = true;
        githubDeviceHint.hidden = false;
        githubDeviceHint.dataset.kind = "info";
        githubDeviceHint.textContent = "Opening GitHub login...";
        const codes = await sendMessage({ type: "GITHUB_START_DEVICE_CODES" });
        githubDeviceHint.innerHTML = `Enter code <b>${codes.userCode}</b> on the GitHub tab, then return here — waiting...`;

        const intervalMs = Math.max(5, Number(codes.interval) || 5) * 1000;
        const deadline = Date.now() + 14 * 60 * 1000;
        while (Date.now() < deadline) {
            await new Promise((r) => setTimeout(r, intervalMs));
            const poll = await sendMessage({ type: "GITHUB_POLL_DEVICE_ONCE" });
            if (poll.status === "pending") continue;
            if (poll.status === "slow_down") {
                await new Promise((r) => setTimeout(r, 5000));
                continue;
            }
            if (poll.status === "ok") {
                githubDeviceHint.textContent = `Logged in as ${poll.user?.login || "user"}`;
                githubDeviceHint.dataset.kind = "success";
                await refreshToolkitStatus();
                return;
            }
        }
        throw new Error("Timed out waiting for GitHub login");
    } catch (err) {
        githubDeviceHint.hidden = false;
        githubDeviceHint.dataset.kind = "error";
        githubDeviceHint.textContent = err.message;
        githubStatus.textContent = err.message;
        githubStatus.dataset.kind = "error";
    } finally {
        githubConnectBtn.disabled = false;
    }
}

addBlockedBtn.onclick = addBlockedSite;
addProductiveBtn.onclick = addProductiveSite;
saveDefaultBtn.onclick = saveDefaultProductive;
saveThresholdBtn.onclick = saveThreshold;
saveSessionConfigBtn.onclick = saveSessionConfig;
startSessionBtn.onclick = startSession;
stopSessionBtn.onclick = stopSession;

focusToggle.onchange = () => chrome.storage.sync.set({ focusMode: focusToggle.checked });
randomToggle.onchange = () => chrome.storage.sync.set({ randomMode: randomToggle.checked });
punishToggle.onchange = () => chrome.storage.sync.set({ punishmentMode: punishToggle.checked });
timerToggle.onchange = () => chrome.storage.sync.set({ timerMode: timerToggle.checked });

githubConnectBtn.onclick = connectGitHub;
githubDisconnectBtn.onclick = async () => {
    await sendMessage({ type: "GITHUB_DISCONNECT" });
    await refreshToolkitStatus();
};
githubPatSaveBtn.onclick = async () => {
    try {
        const result = await sendMessage({ type: "GITHUB_SET_PAT", token: githubPatInput.value });
        githubPatInput.value = "";
        githubStatus.textContent = `Logged in as ${result.user?.login || "user"} (PAT)`;
        githubStatus.dataset.kind = "success";
        githubDeviceHint.hidden = true;
        await refreshToolkitStatus();
    } catch (err) {
        githubStatus.textContent = err.message;
        githubStatus.dataset.kind = "error";
    }
};
githubRefreshReposBtn.onclick = () => refreshToolkitStatus();
githubRepoSelect.onchange = async () => {
    const value = githubRepoSelect.value;
    if (!value) return;
    const [owner, repo] = value.split("/");
    await sendMessage({ type: "GITHUB_SET_REPO", owner, repo });
    await refreshToolkitStatus();
};
githubCreateRepoBtn.onclick = async () => {
    const name = (githubNewRepoInput.value || "").trim();
    if (!name) return;
    try {
        await sendMessage({ type: "GITHUB_CREATE_REPO", name, private: false });
        githubNewRepoInput.value = "";
        await refreshToolkitStatus();
    } catch (err) {
        githubStatus.textContent = err.message;
        githubStatus.dataset.kind = "error";
    }
};
githubAutoPushToggle.onchange = async () => {
    await sendMessage({ type: "GITHUB_SET_AUTO", autoPush: githubAutoPushToggle.checked });
};
cfHandleSaveBtn.onclick = async () => {
    await sendMessage({ type: "SET_CF_HANDLE", handle: (cfHandleInput.value || "").trim() });
    githubStatus.textContent = "Codeforces handle saved — polling for new OK verdicts.";
    githubStatus.dataset.kind = "success";
};

googleConnectBtn.onclick = async () => {
    try {
        googleConnectBtn.disabled = true;
        sheetsStatus.textContent = "Opening Google login...";
        sheetsStatus.dataset.kind = "info";
        await sendMessage({ type: "GOOGLE_CONNECT" });
        sheetsStatus.textContent = "Logged in with Google";
        sheetsStatus.dataset.kind = "success";
        await refreshToolkitStatus();
    } catch (err) {
        sheetsStatus.textContent = err.message;
        sheetsStatus.dataset.kind = "error";
    } finally {
        googleConnectBtn.disabled = false;
    }
};
googleDisconnectBtn.onclick = async () => {
    await sendMessage({ type: "GOOGLE_DISCONNECT" });
    await refreshToolkitStatus();
};
sheetLinkBtn.onclick = async () => {
    try {
        const result = await sendMessage({ type: "SHEETS_LINK", urlOrId: sheetUrlInput.value });
        sheetsStatus.textContent = `Linked: ${result.title || result.spreadsheetId}`;
        sheetsStatus.dataset.kind = "success";
        await refreshToolkitStatus();
    } catch (err) {
        sheetsStatus.textContent = err.message;
        sheetsStatus.dataset.kind = "error";
    }
};
jobGoalSaveBtn.onclick = async () => {
    await sendMessage({ type: "SET_JOB_GOAL", goal: Number(jobGoalInput.value) || 5 });
    sheetsStatus.textContent = "Daily application goal saved.";
    sheetsStatus.dataset.kind = "success";
};

chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "sync" && areaName !== "local") return;
    if (Object.keys(changes).length > 0) {
        renderState();
        loadStats();
    }
});

migrateLegacyRules(() => {
    renderState();
    loadStats();
    refreshToolkitStatus();
});

function updateSessionTimer() {
    chrome.storage.sync.get(["sessionState", "sessionConfig"], (data) => {
        const sessionConfig = {
            workMinutes: Number(data.sessionConfig?.workMinutes) || DEFAULT_SESSION_CONFIG.workMinutes,
            breakMinutes: Number(data.sessionConfig?.breakMinutes) || DEFAULT_SESSION_CONFIG.breakMinutes
        };
        const sessionState = resolveSessionState(data.sessionState, sessionConfig);
        if (!sessionState.isActive) {
            sessionStatus.textContent = "Session inactive";
        } else {
            const timeLeft = formatTimeLeft(sessionState.endsAt - Date.now());
            sessionStatus.textContent = `${sessionState.phase.toUpperCase()} - ${timeLeft}`;
        }
    });
}

setInterval(updateSessionTimer, 1000);
