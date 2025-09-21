/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: { ignoreDuringBuilds: true },
  // Optional but nice for self-hosting too
  output: 'standalone',
};
module.exports = nextConfig;
