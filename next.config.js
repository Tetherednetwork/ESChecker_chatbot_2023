/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    // Don’t run ESLint during `next build`
    ignoreDuringBuilds: true,
  },
};

module.exports = nextConfig;