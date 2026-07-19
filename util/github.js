/**
 * GITHUB OAUTH (DEVICE FLOW) + CONTENT COMMIT
 *
 * Tokens stay in chrome.storage.local. Used only from the service worker.
 */

const GITHUB_DEVICE_CODE_URL = "https://github.com/login/device/code";
const GITHUB_ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GITHUB_API = "https://api.github.com";

/**
 * Start GitHub Device Flow. Returns { user_code, verification_uri, device_code, interval, expires_in }.
 */
async function startGitHubDeviceFlow() {
    if (!GITHUB_OAUTH_CLIENT_ID || GITHUB_OAUTH_CLIENT_ID.startsWith("YOUR_")) {
        throw new Error("Set GITHUB_OAUTH_CLIENT_ID in util/constants.js");
    }
    const body = new URLSearchParams({
        client_id: GITHUB_OAUTH_CLIENT_ID,
        scope: "repo"
    });
    const res = await fetch(GITHUB_DEVICE_CODE_URL, {
        method: "POST",
        headers: {
            Accept: "application/json",
            "Content-Type": "application/x-www-form-urlencoded"
        },
        body
    });
    if (!res.ok) {
        throw new Error(`GitHub device code failed (${res.status})`);
    }
    return res.json();
}

/**
 * Poll until the user completes Device Flow authorization.
 */
async function pollGitHubDeviceToken(deviceCode, intervalSec = 5, expiresIn = 900) {
    const started = Date.now();
    let interval = Math.max(5, Number(intervalSec) || 5) * 1000;

    while (Date.now() - started < expiresIn * 1000) {
        await new Promise((r) => setTimeout(r, interval));
        const body = new URLSearchParams({
            client_id: GITHUB_OAUTH_CLIENT_ID,
            device_code: deviceCode,
            grant_type: "urn:ietf:params:oauth:grant-type:device_code"
        });
        const res = await fetch(GITHUB_ACCESS_TOKEN_URL, {
            method: "POST",
            headers: {
                Accept: "application/json",
                "Content-Type": "application/x-www-form-urlencoded"
            },
            body
        });
        const data = await res.json();
        if (data.access_token) {
            return data.access_token;
        }
        if (data.error === "authorization_pending") {
            continue;
        }
        if (data.error === "slow_down") {
            interval += 5000;
            continue;
        }
        if (data.error === "expired_token" || data.error === "access_denied") {
            throw new Error(data.error_description || data.error);
        }
        throw new Error(data.error_description || data.error || "GitHub auth failed");
    }
    throw new Error("GitHub device authorization timed out");
}

async function githubApi(path, options = {}) {
    const config = await new Promise((resolve) => getGitHubConfig(resolve));
    if (!config.token) {
        throw new Error("Connect GitHub in settings first");
    }
    const res = await fetch(`${GITHUB_API}${path}`, {
        ...options,
        headers: {
            Accept: "application/vnd.github+json",
            Authorization: `Bearer ${config.token}`,
            "X-GitHub-Api-Version": "2022-11-28",
            ...(options.headers || {})
        }
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`GitHub API ${res.status}: ${text.slice(0, 200)}`);
    }
    if (res.status === 204) return null;
    return res.json();
}

async function fetchGitHubUser() {
    return githubApi("/user");
}

async function listGitHubRepos() {
    return githubApi("/user/repos?per_page=100&sort=updated");
}

async function createGitHubRepo(name, isPrivate = false) {
    return githubApi("/user/repos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            name,
            private: isPrivate,
            description: "Coding practice archive (Block2Redirect)",
            auto_init: true
        })
    });
}

function buildSolvePath(problem) {
    const platform = (problem.platform || "leetcode").toLowerCase();
    const ext = languageToExtension(problem.language);
    const slug = slugify(problem.slug || problem.title);

    if (platform === "neetcode") {
        const category = slugify(problem.category || "general");
        return `neetcode/${category}/${slug}.${ext}`;
    }
    if (platform === "codeforces") {
        const contest = problem.contestId || "0";
        const index = problem.problemIndex || "";
        return `codeforces/${contest}${index}-${slug}/solution.${ext}`;
    }
    const id = problem.id != null ? String(problem.id) : "0";
    return `leetcode/${id}-${slug}/solution.${ext}`;
}

function buildCommitMessage(problem) {
    const title = problem.title || "Problem";
    const platform = problem.platform || "LeetCode";
    if (platform.toLowerCase() === "leetcode" && problem.id != null) {
        return `Solved: ${title} (LeetCode #${problem.id})`;
    }
    if (platform.toLowerCase() === "codeforces") {
        return `Solved: ${title} (Codeforces ${problem.contestId}${problem.problemIndex || ""})`;
    }
    return `Solved: ${title} (${platform})`;
}

async function getFileSha(owner, repo, path) {
    try {
        const data = await githubApi(`/repos/${owner}/${repo}/contents/${encodeURI(path)}`);
        return data?.sha || null;
    } catch (_err) {
        return null;
    }
}

/**
 * Create or update a file for a solved problem.
 * @param {object} solvedProblem
 * @returns {Promise<{ path: string, commitMessage: string }>}
 */
async function pushToGitHub(solvedProblem) {
    const config = await new Promise((resolve) => getGitHubConfig(resolve));
    if (!config.token) throw new Error("Connect GitHub in settings first");
    if (!config.owner || !config.repo) throw new Error("Select a GitHub repo in settings");
    if (!solvedProblem?.code) throw new Error("No solution code to push");

    const path = buildSolvePath(solvedProblem);
    const message = buildCommitMessage(solvedProblem);
    const sha = await getFileSha(config.owner, config.repo, path);
    const body = {
        message,
        content: utf8ToBase64(solvedProblem.code),
        branch: "main"
    };
    if (sha) body.sha = sha;

    try {
        await githubApi(`/repos/${config.owner}/${config.repo}/contents/${encodeURI(path)}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
        });
    } catch (err) {
        // Retry without assuming main if default branch differs
        if (String(err.message).includes("422") || String(err.message).includes("sha")) {
            delete body.branch;
            await githubApi(`/repos/${config.owner}/${config.repo}/contents/${encodeURI(path)}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body)
            });
        } else {
            throw err;
        }
    }

    // Optional notes stub alongside the solution
    if (solvedProblem.writeNotes !== false) {
        const notesPath = path.replace(/\/[^/]+$/, "/README.md");
        const notesSha = await getFileSha(config.owner, config.repo, notesPath);
        if (!notesSha) {
            const notes = [
                `# ${solvedProblem.title || "Problem"}`,
                "",
                `- Platform: ${solvedProblem.platform || "leetcode"}`,
                solvedProblem.difficulty ? `- Difficulty: ${solvedProblem.difficulty}` : "",
                solvedProblem.url ? `- Link: ${solvedProblem.url}` : "",
                "",
                "## Notes",
                "",
                "_Add your approach here._",
                ""
            ].filter(Boolean).join("\n");
            const notesBody = {
                message: `Notes: ${solvedProblem.title || "Problem"}`,
                content: utf8ToBase64(notes)
            };
            try {
                await githubApi(`/repos/${config.owner}/${config.repo}/contents/${encodeURI(notesPath)}`, {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(notesBody)
                });
            } catch (_notesErr) {
                // Non-fatal
            }
        }
    }

    return { path, commitMessage: message };
}

/**
 * Full connect flow: device auth → store token → fetch user.
 */
async function connectGitHub() {
    const device = await startGitHubDeviceFlow();
    return {
        userCode: device.user_code,
        verificationUri: device.verification_uri || "https://github.com/login/device",
        poll: async () => {
            const token = await pollGitHubDeviceToken(
                device.device_code,
                device.interval,
                device.expires_in
            );
            await new Promise((resolve) => setGitHubConfig({ token }, resolve));
            const user = await fetchGitHubUser();
            await new Promise((resolve) => setGitHubConfig({ user, owner: user.login }, resolve));
            return user;
        }
    };
}
