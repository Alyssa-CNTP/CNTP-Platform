/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  // Note: eslint key was removed in Next.js 15+. ESLint is disabled via --no-lint in build script.
};

module.exports = nextConfig;
