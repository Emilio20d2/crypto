import { CoinbaseV2Client } from "./packages/coinbase-sync/src/v2-client.js";
import { getDb } from "./packages/database/src/db.js";
import { settings } from "./packages/database/src/schema.js";
import { eq } from "drizzle-orm";

async function run() {
  const db = getDb();
  const settingRows = await db.select().from(settings).where(eq(settings.key, "coinbase_cdp_api_key"));
  if (settingRows.length === 0) {
    console.log("No key found");
    return;
  }
  const keyInfo = JSON.parse(settingRows[0].value);
  
  // Actually we can just use the credentials if we know them, but better to use the IPC or key store.
  // Wait, credentials are in macOS Keychain!
  console.log("We need to fetch from macOS keychain. I will read the API directly using a mocked or direct call if possible, or print the normalizer logs.");
}
run();
