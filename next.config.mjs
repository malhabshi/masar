/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Disable build activity indicator which can cause connection issues in some cloud IDEs
  devIndicators: {
    buildActivity: false,
  },
  // Disable chunk splitting only in dev to avoid port-forwarding issues in cloud IDEs
  webpack: (config, { dev }) => {
    if (dev) {
      config.optimization.splitChunks = {
        cacheGroups: {
          default: false,
        },
      };
    }
    return config;
  },
};

export default nextConfig;
