/// <reference types="vitest" />
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { execSync } from 'child_process'

function getBuildInfo() {
  try {
    const commit = execSync('git rev-parse HEAD', { cwd: process.cwd() }).toString().trim();
    const branch = execSync('git branch --show-current', { cwd: process.cwd() }).toString().trim();
    return { commit, commitShort: commit.slice(0, 7), branch };
  } catch {
    return { commit: 'unknown', commitShort: 'unknown', branch: 'unknown' };
  }
}

const { commit, commitShort, branch } = getBuildInfo();
const builtAt = new Date().toISOString();

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: './',
  define: {
    __BUILD_COMMIT__: JSON.stringify(commit),
    __BUILD_COMMIT_SHORT__: JSON.stringify(commitShort),
    __BUILD_BRANCH__: JSON.stringify(branch),
    __BUILD_AT__: JSON.stringify(builtAt),
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/setupTests.ts'
  }
})
