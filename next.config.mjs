/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  staticPageGenerationTimeout: 180,
  // Serve OAuth well-known metadata from normal route handlers (app-router ignores dot-folders).
  async rewrites() {
    return [
      { source: '/.well-known/oauth-protected-resource', destination: '/api/mcp-oauth/protected-resource' },
      { source: '/.well-known/oauth-protected-resource/api/mcp', destination: '/api/mcp-oauth/protected-resource' },
      { source: '/.well-known/oauth-authorization-server', destination: '/api/mcp-oauth/authorization-server' },
      { source: '/.well-known/oauth-authorization-server/api/mcp', destination: '/api/mcp-oauth/authorization-server' },
    ];
  },
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
