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
  // Loaded at runtime from node_modules instead of being bundled.
  // pdf-parse v2 wraps pdfjs-dist, which resolves its own worker/module URLs at
  // runtime and breaks when inlined into the route chunk — the failure was
  // silent, because app/api/upload/route.ts catches it and falls back to Gemini
  // vision. Vision still returns an answer, so the only visible symptom was
  // "(vision)" on the model name, an empty `text`, and therefore no
  // combined-report section detection at all.
  serverExternalPackages: ['xlsx', 'pdf-parse'],
  // Note: eslint key was removed in Next.js 15+. ESLint is disabled via --no-lint in build script.
};

module.exports = nextConfig;
