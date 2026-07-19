/**
 * Runs in the LeetCode page world (not the content-script isolated world).
 * Posts Accepted submission events to the content script via window.postMessage.
 */
(function () {
    function notify(payload) {
        window.postMessage(Object.assign({ source: "b2r-leetcode", type: "ACCEPTED" }, payload || {}), "*");
    }

    function inspectJson(data) {
        try {
            const check = data?.data?.check || data?.data?.submit || data;
            const status = check?.status_msg || check?.statusDisplay || check?.state;
            if (status === "Accepted" || status === "SUCCESS" || check?.status_code === 10) {
                notify({
                    id: check?.question_id || check?.questionId || null,
                    language: check?.lang || null
                });
            }
        } catch (_e) {
            // ignore
        }
    }

    const originalFetch = window.fetch;
    window.fetch = async function (...args) {
        const response = await originalFetch.apply(this, args);
        try {
            const url = typeof args[0] === "string" ? args[0] : args[0]?.url || "";
            if (/graphql|submissions\/detail|check/i.test(url)) {
                response.clone().json().then(inspectJson).catch(() => {});
            }
        } catch (_e) {
            // ignore
        }
        return response;
    };

    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (method, url) {
        this._b2rUrl = url;
        return originalOpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function () {
        this.addEventListener("load", function () {
            try {
                if (!/check|submit|graphql/i.test(String(this._b2rUrl || ""))) return;
                inspectJson(JSON.parse(this.responseText));
            } catch (_e) {
                // ignore
            }
        });
        return originalSend.apply(this, arguments);
    };
})();
