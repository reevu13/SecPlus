/** @type {import('next').NextConfig} */
const allowedDevOrigins = (process.env.NEXT_ALLOWED_DEV_ORIGINS || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

const nextConfig = {
  reactStrictMode: true,
  ...(allowedDevOrigins.length > 0 ? { allowedDevOrigins } : {})
};

export default nextConfig;
