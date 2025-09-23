/** @type {import('next').NextConfig} */
const nextConfig = {
  async redirects() {
    return [
      {
        source: '/upload',
        destination: '/chat',
        permanent: true,
      },
    ];
  },
};

module.exports = nextConfig;