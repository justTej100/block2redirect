/**
 * POPUP SCRIPT
 *
 * Quick-access blocking + daily dashboard.
 */

const blockedSiteInput = document.getElementById("blockedSite");
const addBlockedSiteButton = document.getElementById("addBlockedSite");
const blockCurrentSiteButton = document.getElementById("blockCurrentSite");
const blockedSitesList = document.getElementById("blockedSitesList");
const statusMessage = document.getElementById("statusMessage");
const followUpBanner = document.getElementById("followUpBanner");

const PLACEHOLDER_EXAMPLES = [
    "Try blocking x.com",
    "blockexample.com (won't work, just an example)",
    "Block youtube.com",
    "Enter a site like github.com",
    "Type a domain to block",
    "something funny.com (probably doesn't exist)"
];

function setRandomPlaceholder() {
    if (!blockedSiteInput) return;
    const nextPlaceholder = PLACEHOLDER_EXAMPLES[Math.floor(Math.random() * PLACEHOLDER_EXAMPLES.length)];
    blockedSiteInput.placeholder = nextPlaceholder;
}

function setStatus(message, kind = "info") {
    if (!statusMessage) return;
    statusMessage.textContent = message || "";
    statusMessage.dataset.kind = kind;
}

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

async function redirectTabIfBlocked(host, tabId, tabUrl) {
    if (!host || !tabId || !tabUrl || !/^https?:/i.test(tabUrl)) return;
    const defaultRedirect = await getDefaultProductiveSite();
    if (!defaultRedirect || tabUrl.startsWith(defaultRedirect)) return;
    chrome.tabs.update(tabId, { url: defaultRedirect });
}

function renderBlockedSites() {
    chrome.storage.sync.get(["blockedSites", "blockedSiteMeta"], (data) => {
        const blockedSites = data.blockedSites || [];
        const blockedSiteMeta = data.blockedSiteMeta || {};
        blockedSitesList.innerHTML = "";

        blockedSites.forEach((site, index) => {
            const meta = blockedSiteMeta[site] || {};
            const li = document.createElement("li");
            const faviconUrl = meta.faviconUrl || getFaviconUrl(site, meta.sourceUrl || ensureUrl(site));
            li.innerHTML = `
                <div class="site-entry">
                    <img class="site-icon" src="${faviconUrl}" alt="${site} icon" onerror="this.src='${DEFAULT_FAVICON_FALLBACK}'">
                    <div class="site-labels">
                        <span class="site-host">${site}</span>
                        <span class="site-source">${meta.title || meta.sourceUrl || "Blocked site"}</span>
                    </div>
                </div>
                <button data-index="${index}" type="button">X</button>
            `;
            blockedSitesList.appendChild(li);
        });

        document.querySelectorAll("button[data-index]").forEach((btn) => {
            btn.onclick = () => {
                removeBlockedSite(Number(btn.dataset.index), loadBlockedSites);
            };
        });
    });
}

function loadBlockedSites() {
    renderBlockedSites();
}

async function addBlockedSite() {
    const blockedSite = normalizeHost(blockedSiteInput.value);
    if (!blockedSite) {
        setStatus("Enter a site to block.", "error");
        return;
    }
    if (!isLikelyHost(blockedSite)) {
        setStatus("That does not look like a valid site.", "error");
        return;
    }

    setStatus(`Checking ${blockedSite}...`);
    const exists = await checkSiteExists(blockedSite);
    if (!exists) {
        setStatus("That site could not be reached. Check the spelling and try again.", "error");
        return;
    }

    getCurrentTab((currentTab) => {
        saveBlockedSite(blockedSite, {
            sourceUrl: ensureUrl(blockedSite),
            faviconUrl: getFaviconUrl(blockedSite, ensureUrl(blockedSite)),
            title: blockedSite
        }, () => {
            blockedSiteInput.value = "";
            setStatus(`${blockedSite} added to blocked sites.`, "success");
            loadBlockedSites();
            if (currentTab?.id && currentTab.url && getTabHostname(currentTab.url) === blockedSite) {
                redirectTabIfBlocked(blockedSite, currentTab.id, currentTab.url);
            }
        });
    });
}

function blockCurrentSite() {
    getCurrentTab((tab) => {
        if (!tab?.url) {
            setStatus("Open a web page first.", "error");
            return;
        }
        if (!/^https?:\/\//i.test(tab.url)) {
            setStatus("That tab cannot be blocked from here.", "error");
            return;
        }

        let host = "";
        try {
            host = new URL(tab.url).hostname;
        } catch (_error) {
            setStatus("Could not read the current site.", "error");
            return;
        }
        if (!host) {
            setStatus("Could not read the current site.", "error");
            return;
        }

        saveBlockedSite(host, {
            sourceUrl: tab.url,
            faviconUrl: tab.favIconUrl || getFaviconUrl(host, tab.url),
            title: tab.title || host
        }, () => {
            setStatus(`${host} blocked from the current tab.`, "success");
            loadBlockedSites();
            redirectTabIfBlocked(host, tab.id, tab.url);
        });
    });
}

async function refreshDashboard() {
    try {
        const status = await sendMessage({ type: "GET_SYNC_STATUS" });
        document.getElementById("dashSolves").textContent = String(status.daily?.solves || 0);
        document.getElementById("dashApps").textContent = String(status.daily?.apps || 0);
        document.getElementById("dashCommits").textContent = String(status.daily?.commits || 0);
        const goal = status.jobAppGoal || 5;
        const apps = status.daily?.apps || 0;
        document.getElementById("dashGoal").textContent = `${apps}/${goal}`;
        if (status.staleFollowUps > 0 && followUpBanner) {
            followUpBanner.hidden = false;
            followUpBanner.dataset.kind = "error";
            followUpBanner.textContent = `${status.staleFollowUps} job follow-up(s) overdue (7+ days).`;
        } else if (followUpBanner) {
            followUpBanner.hidden = true;
        }
    } catch (_err) {
        // Dashboard is best-effort
    }
}

addBlockedSiteButton.onclick = addBlockedSite;
if (blockCurrentSiteButton) blockCurrentSiteButton.onclick = blockCurrentSite;

blockedSiteInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
        event.preventDefault();
        addBlockedSite();
    }
});

document.getElementById("settingsButton").onclick = () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("settings/settings.html") });
};

migrateLegacyRules(loadBlockedSites);
setRandomPlaceholder();
refreshDashboard();
