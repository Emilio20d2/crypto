import { execSync } from 'child_process';
import { resolve } from 'path';

const ROOT = resolve(process.cwd(), '../..');

export async function setup(): Promise<void> {
  try {
    // require() alone only loads the JS wrapper; instantiate to force dlopen of the .node binary
    execSync(
      `node -e "const bs = require('better-sqlite3'); new bs(':memory:').close()"`,
      { cwd: ROOT, stdio: 'pipe' }
    );
  } catch {
    console.log(
      `\n[vitest] better-sqlite3 NMV mismatch — rebuilding for Node.js ${process.version} (NMV ${process.versions.modules})...`
    );
    execSync('npm rebuild better-sqlite3', { cwd: ROOT, stdio: 'inherit' });
    console.log('[vitest] Rebuild complete.\n');
  }
}
