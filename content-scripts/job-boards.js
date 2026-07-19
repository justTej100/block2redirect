/**
 * Job board apply/submit detector (LinkedIn, Greenhouse, Indeed, Lever, Workday).
 */

(function jobBoardDetector() {
    const host = location.hostname;

    function parseLinkedIn() {
        const role =
            document.querySelector(".job-details-jobs-unified-top-card__job-title")?.textContent?.trim() ||
            document.querySelector("h1")?.textContent?.trim() ||
            document.title;
        const company =
            document.querySelector(".job-details-jobs-unified-top-card__company-name")?.textContent?.trim() ||
            document.querySelector("a[data-tracking-control-name*='company']")?.textContent?.trim() ||
            "";
        const locationText =
            document.querySelector(".job-details-jobs-unified-top-card__bullet")?.textContent?.trim() || "";
        return {
            company,
            role,
            location: locationText,
            source: "LinkedIn",
            link: location.href.split("?")[0]
        };
    }

    function parseGreenhouse() {
        const role = document.querySelector("h1")?.textContent?.trim() || document.title;
        const company =
            document.querySelector(".company-name")?.textContent?.trim() ||
            document.querySelector("meta[property='og:site_name']")?.content ||
            host.split(".")[0];
        const locationText =
            document.querySelector(".location")?.textContent?.trim() ||
            document.querySelector("[class*='location']")?.textContent?.trim() ||
            "";
        return {
            company,
            role,
            location: locationText,
            source: "Greenhouse",
            link: location.href.split("?")[0]
        };
    }

    function parseIndeed() {
        const role =
            document.querySelector("[data-testid='jobsearch-JobInfoHeader-title']")?.textContent?.trim() ||
            document.querySelector("h1")?.textContent?.trim() ||
            document.title;
        const company =
            document.querySelector("[data-testid='inlineHeader-companyName']")?.textContent?.trim() ||
            document.querySelector("[data-company-name='true']")?.textContent?.trim() ||
            "";
        const locationText =
            document.querySelector("[data-testid='inlineHeader-companyLocation']")?.textContent?.trim() || "";
        return {
            company,
            role,
            location: locationText,
            source: "Indeed",
            link: location.href.split("?")[0]
        };
    }

    function parseLever() {
        const role = document.querySelector(".posting-headline h2")?.textContent?.trim() ||
            document.querySelector("h2")?.textContent?.trim() ||
            document.title;
        const company = host.replace(/\.lever\.co$/i, "").split(".")[0] || "Company";
        const locationText =
            document.querySelector(".posting-categories .location")?.textContent?.trim() || "";
        return {
            company,
            role,
            location: locationText,
            source: "Lever",
            link: location.href.split("?")[0]
        };
    }

    function parseWorkday() {
        const role =
            document.querySelector("[data-automation-id='jobPostingHeader']")?.textContent?.trim() ||
            document.querySelector("h2")?.textContent?.trim() ||
            document.title;
        const company =
            document.querySelector("[data-automation-id='company']")?.textContent?.trim() ||
            host.split(".")[0];
        const locationText =
            document.querySelector("[data-automation-id='locations']")?.textContent?.trim() || "";
        return {
            company,
            role,
            location: locationText,
            source: "Workday",
            link: location.href.split("?")[0]
        };
    }

    function parseCurrent() {
        if (host.includes("linkedin.com")) return parseLinkedIn();
        if (host.includes("greenhouse.io") || host.includes("boards.greenhouse")) return parseGreenhouse();
        if (host.includes("indeed.com")) return parseIndeed();
        if (host.includes("lever.co")) return parseLever();
        if (host.includes("myworkdayjobs.com") || host.includes("workday.com")) return parseWorkday();
        return {
            company: "",
            role: document.title,
            location: "",
            source: host,
            link: location.href.split("?")[0]
        };
    }

    function saveJob() {
        const job = {
            ...parseCurrent(),
            dateApplied: new Date().toISOString().slice(0, 10),
            status: "Applied",
            followUpDate: "",
            notes: ""
        };
        chrome.runtime.sendMessage({ type: "SAVE_JOB", job }, () => {
            void chrome.runtime.lastError;
        });
    }

    function isApplyControl(el) {
        if (!el) return false;
        const text = (el.textContent || el.value || el.getAttribute("aria-label") || "").toLowerCase();
        return (
            /\b(submit application|easy apply|apply now|apply|submit)\b/i.test(text) &&
            !/\b(applied|application submitted)\b/i.test(text)
        );
    }

    document.addEventListener("click", (event) => {
        let node = event.target;
        for (let i = 0; i < 5 && node; i += 1) {
            if (
                (node.tagName === "BUTTON" || node.tagName === "A" || node.getAttribute?.("role") === "button") &&
                isApplyControl(node)
            ) {
                // Delay slightly so confirmation UIs can settle; still capture intent
                setTimeout(saveJob, 800);
                return;
            }
            node = node.parentElement;
        }
    }, true);

    // Confirmation pages
    const bodyText = document.body?.innerText || "";
    if (
        /application (was )?submitted|thanks for applying|you applied/i.test(bodyText) &&
        !sessionStorage.getItem("b2r_job_saved")
    ) {
        sessionStorage.setItem("b2r_job_saved", "1");
        saveJob();
    }
})();
