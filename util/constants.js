/**
 * SHARED CONSTANTS
 *
 * Global constants used across popup, settings, and background scripts.
 */

const DEFAULT_FAVICON_FALLBACK = "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
        <rect width="64" height="64" rx="12" fill="#0f172a"/>
        <path d="M20 18h24a6 6 0 0 1 6 6v16a6 6 0 0 1-6 6H28l-8 8V24a6 6 0 0 1 6-6Z" fill="#22d3ee"/>
    </svg>
`);

const DEFAULT_PRODUCTIVE_SITES = [
    "https://developer.mozilla.org",
    "https://github.com/trending",
    "https://www.indeed.com",
    "https://stackoverflow.com"
];

const DEFAULT_SESSION_CONFIG = {
    workMinutes: 25,
    breakMinutes: 5
};

/** Replace with your GitHub OAuth App client ID (Device Flow, no secret). */
const GITHUB_OAUTH_CLIENT_ID = "YOUR_GITHUB_OAUTH_CLIENT_ID";

/** Replace with your Google OAuth client ID (Chrome extension type). */
const GOOGLE_OAUTH_CLIENT_ID = "YOUR_GOOGLE_OAUTH_CLIENT_ID.apps.googleusercontent.com";

const GOOGLE_SHEETS_SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets"
].join(" ");

const JOB_SHEET_HEADERS = [
    "Date Applied",
    "Company",
    "Role",
    "Location",
    "Source",
    "Link",
    "Status",
    "Follow-up Date",
    "Notes"
];

const LANG_EXTENSIONS = {
    python: "py",
    python3: "py",
    javascript: "js",
    typescript: "ts",
    java: "java",
    cpp: "cpp",
    c: "c",
    csharp: "cs",
    go: "go",
    rust: "rs",
    kotlin: "kt",
    swift: "swift",
    ruby: "rb",
    php: "php",
    scala: "scala",
    mysql: "sql",
    mssql: "sql",
    oraclesql: "sql"
};
