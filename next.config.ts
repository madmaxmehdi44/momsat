import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**' },
      { protocol: 'http', hostname: '**' },
    ],
  },
  outputFileTracingIncludes: {
    '/*': ['./prisma/seed-data/seed-data.csv'],
  },
};

export default nextConfig;
