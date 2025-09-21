import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Keep Pages Router only
  // Optional Turbopack root if you ever see root warnings
  // @ts-ignore
  turbopack: { root: process.cwd() }
};

export default nextConfig;
