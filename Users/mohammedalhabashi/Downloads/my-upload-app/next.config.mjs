/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config) => {
    // This can help resolve errors like "Module not found: Can't resolve 'fs'"
    // for libraries that were intended for server-side use.
    config.resolve.fallback = { fs: false, net: false, tls: false };
    return config;
  },
};

export default nextConfig;
