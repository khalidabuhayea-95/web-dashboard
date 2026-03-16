/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Needed for large PSD/PDF uploads routed through Next proxy/middleware.
    proxyClientMaxBodySize: "64mb",
  },
};

export default nextConfig;
