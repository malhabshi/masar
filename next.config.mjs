/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Disable build activity indicator which can cause connection issues in some cloud IDEs
  devIndicators: {
    buildActivity: false,
  },
  // Ensure chunks are loaded correctly through port forwarding
  webpack: (config) => {
    config.optimization.splitChunks = {
      cacheGroups: {
        default: false,
      },
    };
    return config;
  },
};

export default nextConfig;
