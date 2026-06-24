declare const __BUILD_COMMIT__: string;
declare const __BUILD_COMMIT_SHORT__: string;
declare const __BUILD_BRANCH__: string;
declare const __BUILD_AT__: string;

export interface BuildInfo {
  commit: string;
  commitShort: string;
  branch: string;
  builtAt: string;
}

function resolveBuildInfo(): BuildInfo {
  try {
    return {
      commit: __BUILD_COMMIT__,
      commitShort: __BUILD_COMMIT_SHORT__,
      branch: __BUILD_BRANCH__,
      builtAt: __BUILD_AT__,
    };
  } catch {
    return {
      commit: 'dev',
      commitShort: 'dev',
      branch: 'dev',
      builtAt: new Date().toISOString(),
    };
  }
}

export const BUILD_INFO: BuildInfo = resolveBuildInfo();
