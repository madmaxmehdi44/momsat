/** @type {import('next').NextConfig} */
const nextConfig = {
  // Next.js 16 blocks cross-origin development requests by default.
  // The dev server is commonly accessed through this Docker/VM bridge origin.
  allowedDevOrigins: ['172.17.144.1'],
};

module.exports = nextConfig;
