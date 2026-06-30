import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = join(root, ".env");
const outPath = join(root, "config.js");

function loadEnvFile(path) {
  const env = {};
  const lines = readFileSync(path, "utf8").split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;

    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    env[key] = value;
  }

  return env;
}

function pickEnv(...keys) {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) return value;
  }
  return "";
}

let supabaseUrl = pickEnv("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL");
let supabasePublishableKey = pickEnv(
  "SUPABASE_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"
);

if (!supabaseUrl || !supabasePublishableKey) {
  if (existsSync(envPath)) {
    const fileEnv = loadEnvFile(envPath);
    supabaseUrl ||= fileEnv.SUPABASE_URL?.trim() ?? "";
    supabasePublishableKey ||= fileEnv.SUPABASE_PUBLISHABLE_KEY?.trim() ?? "";
  }
}

if (!supabaseUrl || !supabasePublishableKey) {
  throw new Error(
    "Missing Supabase credentials. Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY " +
      "(or NEXT_PUBLIC_* equivalents) in the environment, or provide a local .env file."
  );
}

const contents = `export const SUPABASE_URL = ${JSON.stringify(supabaseUrl)};
export const SUPABASE_PUBLISHABLE_KEY = ${JSON.stringify(supabasePublishableKey)};
`;

writeFileSync(outPath, contents, "utf8");
console.log(`Wrote ${outPath}`);
