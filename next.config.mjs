// One stamp per build, inlined into both the client bundle and /api/version,
// so an open app (iPhone home-screen app resumes without reloading) can tell
// it's running an old build. See components/AppVersionWatcher.js.
const APP_BUILD = process.env.RAILWAY_GIT_COMMIT_SHA || String(Date.now())

/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['@napi-rs/canvas', 'imapflow'],
  env: {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
    NEXT_PUBLIC_APP_BUILD: APP_BUILD,
  },
};

export default nextConfig;
