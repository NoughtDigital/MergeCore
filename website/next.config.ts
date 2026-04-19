import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin output to the default folder (avoids stale `.next-prod` / symlink setups).
  distDir: ".next",
  // Cursor / some hosts open the dev server on 127.0.2.2; silence the cross-origin warning for `/_next/*`.
  allowedDevOrigins: ["127.0.2.2"],
};

export default nextConfig;
