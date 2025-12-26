// Environment variables validation
const ANTIGRAVITY_CLIENT_ID = process.env.ANTIGRAVITY_CLIENT_ID;
const ANTIGRAVITY_CLIENT_SECRET = process.env.ANTIGRAVITY_CLIENT_SECRET;

if (!ANTIGRAVITY_CLIENT_ID) {
  const error = "ANTIGRAVITY_CLIENT_ID environment variable is required but not set";
  console.error(error);
  throw new Error(error);
}

if (!ANTIGRAVITY_CLIENT_SECRET) {
  const error = "ANTIGRAVITY_CLIENT_SECRET environment variable is required but not set";
  console.error(error);
  throw new Error(error);
}

export { ANTIGRAVITY_CLIENT_ID, ANTIGRAVITY_CLIENT_SECRET };

export const GOOGLE_OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_OAUTH_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";

export const ACCESS_TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;
export const REFRESH_TOKEN_EXPIRY_MARGIN_MS = 60 * 60 * 1000;
export const MAX_REFRESH_RETRIES = 3;
export const REFRESH_RETRY_BASE_MS = 1000;

export const ANTIGRAVITY_REDIRECT_URI = "http://localhost:51121/oauth-callback";

// This adapter is for Google-internal Antigravity (Cloud Code Assist API) only.
// The API endpoint uses /v1internal:loadCodeAssist which is not available to external applications.
// If this adapter were to be used externally, set ANTIGRAVITY_IS_INTERNAL_ONLY=false in environment.
export const IS_INTERNAL_ONLY = process.env.ANTIGRAVITY_IS_INTERNAL_ONLY !== 'false';

// OAuth scopes for Antigravity API access
// WARNING: The broad "cloud-platform" scope grants access to all Google Cloud Platform services.
//
// INTERNAL USE (IS_INTERNAL_ONLY=true):
// - Uses cloud-platform scope (required for /v1internal:loadCodeAssist internal API)
// - Includes Google-internal scopes (cclog, experimentsandconfigs)
//
// EXTERNAL USE (IS_INTERNAL_ONLY=false):
// - Uses minimal specific scopes instead of cloud-platform
// - Removes all Google-internal scopes
// - Uses more restrictive alternatives suitable for public APIs
//
// You can override scopes via ANTIGRAVITY_SCOPES environment variable (comma-separated)
const defaultScopes = [
  // User identity scopes (required for user context)
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",

  // API access scopes - conditional based on internal/external use
  ...(IS_INTERNAL_ONLY ? [
    // Internal use: broad cloud-platform scope (required for /v1internal APIs)
    // WARNING: This grants access to ALL GCP services
    "https://www.googleapis.com/auth/cloud-platform",
  ] : [
    // External use: specific minimal scopes
    // TODO: Replace with actual documented Cloud Code API scopes when available
    // For now, using read-only cloud-platform as a more restrictive alternative
    "https://www.googleapis.com/auth/cloud-platform.read-only",
  ]),

  // Google-internal scopes (only included when IS_INTERNAL_ONLY is true)
  // These MUST be removed for external applications
  ...(IS_INTERNAL_ONLY ? [
    "https://www.googleapis.com/auth/cclog",              // Internal logging
    "https://www.googleapis.com/auth/experimentsandconfigs", // Internal experiments
  ] : []),
];

// Allow scope override via environment variable for testing/flexibility
export const ANTIGRAVITY_SCOPES = process.env.ANTIGRAVITY_SCOPES
  ? process.env.ANTIGRAVITY_SCOPES.split(",").map(s => s.trim())
  : defaultScopes;

export const ANTIGRAVITY_ENDPOINT_DAILY =
  "https://daily-cloudcode-pa.sandbox.googleapis.com";
export const ANTIGRAVITY_ENDPOINT_AUTOPUSH =
  "https://autopush-cloudcode-pa.sandbox.googleapis.com";
export const ANTIGRAVITY_ENDPOINT_PROD = "https://cloudcode-pa.googleapis.com";

export const ANTIGRAVITY_DEFAULT_PROJECT_ID = "rising-fact-p41fc";

export const ANTIGRAVITY_CLIENT_METADATA =
  '{"ideType":"IDE_UNSPECIFIED","platform":"PLATFORM_UNSPECIFIED","pluginType":"GEMINI"}';
