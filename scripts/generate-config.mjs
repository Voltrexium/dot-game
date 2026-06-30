import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = join(root, ".env");
const outPath = join(root, "config.js");

function loadEnv(path) {
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

function requireEnv(env, key) {
  const value = env[key]?.trim();
  if (!value) {
    throw new Error(`Missing ${key} in .env (copy .env.example to .env and fill in values)`);
  }
  return value;
}

const env = loadEnv(envPath);
const supabaseUrl = requireEnv(env, "SUPABASE_URL");
const supabasePublishableKey = requireEnv(env, "SUPABASE_PUBLISHABLE_KEY");

const contents = `export const SUPABASE_URL = ${JSON.stringify(supabaseUrl)};
export const SUPABASE_PUBLISHABLE_KEY = ${JSON.stringify(supabasePublishableKey)};
`;

writeFileSync(outPath, contents, "utf8");
console.log(`Wrote ${outPath}`);
