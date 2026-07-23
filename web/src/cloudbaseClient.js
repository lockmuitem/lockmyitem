const CLOUDBASE_ENV_ID = import.meta.env.VITE_CLOUDBASE_ENV_ID
  || import.meta.env.VITE_TCB_ENV_ID
  || 'cloud1-d9gnyuxf5b44b6b92';
const CLOUDBASE_ACCESS_KEY = import.meta.env.VITE_CLOUDBASE_ACCESS_KEY
  || import.meta.env.VITE_TCB_ACCESS_KEY
  || '';
const CLOUDBASE_REGION = import.meta.env.VITE_CLOUDBASE_REGION
  || import.meta.env.VITE_TCB_REGION
  || 'ap-shanghai';

export const cloudbaseConfigured = Boolean(CLOUDBASE_ENV_ID);
export const cloudbaseFunctionName = import.meta.env.VITE_CLOUDBASE_FUNCTION_NAME
  || import.meta.env.VITE_TCB_FUNCTION_NAME
  || 'lostfound';

let cloudbaseAppPromise = null;

async function readCloudbaseLoginState(auth) {
  const getters = [auth.hasLoginState, auth.getLoginState]
    .filter((getter) => typeof getter === 'function');
  for (const getter of getters) {
    try {
      const state = await Promise.resolve(getter.call(auth));
      if (state) return state;
    } catch {
      // Continue to the next SDK-compatible login-state API.
    }
  }
  return null;
}

async function ensureCloudbaseAuth(app) {
  const auth = typeof app.auth === 'function' ? app.auth({ persistence: 'local' }) : app.auth;
  if (!auth || await readCloudbaseLoginState(auth)) return;

  if (typeof auth.signInAnonymously === 'function') {
    await auth.signInAnonymously();
    return;
  }

  const provider = typeof auth.anonymousAuthProvider === 'function'
    ? auth.anonymousAuthProvider()
    : auth.anonymousAuthProvider;
  if (provider?.signIn) await provider.signIn();
}

export async function getCloudbaseApp() {
  if (!cloudbaseConfigured) throw new Error('CloudBase 环境未配置');
  if (!cloudbaseAppPromise) {
    cloudbaseAppPromise = import('@cloudbase/js-sdk').then(async ({ default: cloudbase }) => {
      try {
        const app = cloudbase.init({ env: CLOUDBASE_ENV_ID, region: CLOUDBASE_REGION });
        await ensureCloudbaseAuth(app);
        return app;
      } catch (error) {
        if (!CLOUDBASE_ACCESS_KEY) throw error;
        console.warn('CloudBase anonymous auth unavailable; continuing with publishable key fallback.', error);
      }
      return cloudbase.init({
        env: CLOUDBASE_ENV_ID,
        region: CLOUDBASE_REGION,
        accessKey: CLOUDBASE_ACCESS_KEY
      });
    });
  }
  return cloudbaseAppPromise;
}
