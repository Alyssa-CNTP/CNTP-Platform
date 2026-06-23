/** @type {import('next').NextConfig} */
const nextConfig = {
  // Build directory. Defaults to `.next`; the staging deploy script overrides it
  // via NEXT_DIST_DIR to `.next-build` so it can build into a side dir without
  // clearing the live `.next` mid-build (the cause of "Could not find a
  // production build" 502s during overlapping deploys). See scripts/staging-deploy.sh.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  typescript: {
    ignoreBuildErrors: true,
  },
  // Note: eslint key was removed in Next.js 15+. ESLint is disabled via --no-lint in build script.
};

module.exports = nextConfig;
