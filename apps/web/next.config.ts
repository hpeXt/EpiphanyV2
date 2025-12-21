import type { NextConfig } from "next";
import { fileURLToPath } from "url";
import path from "path";

const configDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(configDir, "../..");

const nextConfig: NextConfig = {
  output: "standalone",
  turbopack: {
    root: workspaceRoot,
  },
};

export default nextConfig;
