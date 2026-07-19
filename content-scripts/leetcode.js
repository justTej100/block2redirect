/**
 * LeetCode Accepted-submission detector.
 * Uses MutationObserver in the content-script world + an injected page script
 * for GraphQL/fetch interception (isolated worlds cannot patch page fetch).
 */

(function leetcodeDetector() {
    let lastKey = "";

    function sendSolve(problem) {
        const key = `${problem.slug}|${problem.language}|${(problem.code || "").length}`;
        if (key === lastKey) return;
        lastKey = key;
        chrome.runtime.sendMessage({ type: "SOLVE_DETECTED", problem }, () => {
            void chrome.runtime.lastError;
        });
    }

    function getSlugFromUrl() {
        const match = location.pathname.match(/\/problems\/([^/]+)/);
        return match ? match[1] : "";
    }

    function scrapeTitle() {
        const el =
            document.querySelector('[data-cy="question-title"]') ||
            document.querySelector("div[class*='text-title']") ||
            document.querySelector("a[href*='/problems/']");
        const text = (el?.textContent || "").trim();
        const numbered = text.match(/^(\d+)\.\s*(.+)$/);
        if (numbered) {
            return { id: numbered[1], title: numbered[2].trim() };
        }
        return { id: null, title: text || getSlugFromUrl() };
    }

    function scrapeDifficulty() {
        const el =
            document.querySelector("[diff]") ||
            document.querySelector("div[class*='text-difficulty']") ||
            document.querySelector(".text-difficulty-easy, .text-difficulty-medium, .text-difficulty-hard");
        return (el?.textContent || "").trim() || "";
    }

    function scrapeLanguage() {
        const btn =
            document.querySelector("[id^=headlessui-listbox-button]") ||
            document.querySelector("button[class*='lang']") ||
            document.querySelector(".ant-select-selection-item");
        return (btn?.textContent || "python3").trim().toLowerCase();
    }

    function scrapeCode() {
        const lines = document.querySelectorAll(".view-line");
        if (lines.length) {
            return Array.from(lines).map((l) => l.textContent || "").join("\n");
        }
        const textarea = document.querySelector("textarea.inputarea");
        if (textarea?.value) return textarea.value;
        return "";
    }

    function buildProblem(extra = {}) {
        const { id, title } = scrapeTitle();
        const slug = getSlugFromUrl();
        return new Promise((resolve) => {
            chrome.storage.session.get(["neetcodeCategory"], (data) => {
                const neetCategory = data.neetcodeCategory || "";
                resolve({
                    platform: neetCategory ? "neetcode" : "leetcode",
                    category: neetCategory || undefined,
                    id: extra.id || id,
                    title: extra.title || title,
                    slug: extra.slug || slug,
                    difficulty: scrapeDifficulty(),
                    language: extra.language || scrapeLanguage(),
                    code: extra.code || scrapeCode(),
                    url: location.href.split("?")[0]
                });
            });
        });
    }

    function looksAccepted(text) {
        return /\bAccepted\b/i.test(text);
    }

    async function maybeSend(extra) {
        const problem = await buildProblem(extra || {});
        if (!problem.code || problem.code.length < 5) return;
        sendSolve(problem);
    }

    const observer = new MutationObserver(() => {
        const resultRoot =
            document.querySelector("[data-e2e-locator='submission-result']") ||
            document.querySelector("#qd-content") ||
            document.body;
        const text = resultRoot?.innerText || "";
        if (!looksAccepted(text)) return;
        maybeSend();
    });

    observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        characterData: true
    });

    // Bridge: page script posts Accepted events here
    window.addEventListener("message", (event) => {
        if (event.source !== window) return;
        if (event.data?.source !== "b2r-leetcode" || event.data?.type !== "ACCEPTED") return;
        maybeSend({
            id: event.data.id,
            language: event.data.language
        });
    });

    // Inject fetch/XHR hooks via web_accessible_resources (page CSP blocks inline scripts)
    const script = document.createElement("script");
    script.src = chrome.runtime.getURL("content-scripts/leetcode-inject.js");
    script.onload = () => script.remove();
    (document.head || document.documentElement).appendChild(script);
})();
