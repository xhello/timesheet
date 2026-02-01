import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Optimize for production
  poweredByHeader: false,
  
  // Enable React strict mode for better development
  reactStrictMode: true,
  
  // Configure headers for face detection models
  async headers() {
    return [
      {
        // Allow loading face detection models
        source: '/models/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
