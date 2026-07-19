/**
 * Codeforces page helper — ensures handle is known and triggers a poll after submissions.
 */

(function codeforcesHelper() {
    function detectHandle() {
        const link = document.querySelector("a[href^='/profile/']");
        if (!link) return "";
        const match = link.getAttribute("href")?.match(/\/profile\/([^/?#]+)/);
        return match ? decodeURIComponent(match[1]) : "";
    }

    const handle = detectHandle();
    if (handle) {
        chrome.runtime.sendMessage({ type: "SET_CF_HANDLE", handle }, () => {
            void chrome.runtime.lastError;
        });
    }

    // After visiting a submission status page, nudge a poll
    if (/\/submission\//i.test(location.pathname) || /\/my\b/i.test(location.pathname)) {
        setTimeout(() => {
            chrome.runtime.sendMessage({ type: "POLL_CODEFORCES" }, () => {
                void chrome.runtime.lastError;
            });
        }, 2000);
    }
})();
