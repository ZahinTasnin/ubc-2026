import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript source.
  transpilePackages: ["@hedged/shared", "@hedged/solana"],
};

export default nextConfig;
