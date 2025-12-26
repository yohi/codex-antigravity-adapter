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
export const ANTIGRAVITY_SCOPES = [
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/cclog",
  "https://www.googleapis.com/auth/experimentsandconfigs",
];

export const ANTIGRAVITY_ENDPOINT_DAILY =
  "https://daily-cloudcode-pa.sandbox.googleapis.com";
export const ANTIGRAVITY_ENDPOINT_AUTOPUSH =
  "https://autopush-cloudcode-pa.sandbox.googleapis.com";
export const ANTIGRAVITY_ENDPOINT_PROD = "https://cloudcode-pa.googleapis.com";

export const ANTIGRAVITY_DEFAULT_PROJECT_ID = "rising-fact-p41fc";

export const ANTIGRAVITY_CLIENT_METADATA =
  '{"ideType":"IDE_UNSPECIFIED","platform":"PLATFORM_UNSPECIFIED","pluginType":"GEMINI"}';
