/**
 * NeetCode roadmap helper — tags upcoming LeetCode solves with roadmap category
 * via chrome.storage.session (shared across origins for this extension).
 */

(function neetcodeTagger() {
    function categoryFromPage() {
        const heading = document.querySelector("h1, h2");
        const text = (heading?.textContent || "").trim();
        if (text && text.length < 60) return text;
        const path = location.pathname.split("/").filter(Boolean);
        return path[path.length - 1] || "neetcode";
    }

    function persistCategory(category) {
        chrome.storage.session.set({ neetcodeCategory: category });
    }

    function tagOutboundLeetCodeLinks() {
        const category = categoryFromPage();
        persistCategory(category);
        document.querySelectorAll("a[href*='leetcode.com/problems']").forEach((a) => {
            if (a.dataset.b2rBound) return;
            a.dataset.b2rBound = "1";
            a.addEventListener("click", () => persistCategory(category));
        });
    }

    tagOutboundLeetCodeLinks();
    const observer = new MutationObserver(() => tagOutboundLeetCodeLinks());
    observer.observe(document.documentElement, { childList: true, subtree: true });
})();
