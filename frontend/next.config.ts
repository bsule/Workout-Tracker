import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@lift/core"],
  async redirects() {
    return [
      { source: "/ai-plan", destination: "/calendar", permanent: false },
      { source: "/settings/ai", destination: "/settings", permanent: false },
    ]
  },
};

export default nextConfig;
