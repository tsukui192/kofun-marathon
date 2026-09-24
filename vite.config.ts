import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  base: process.env.GITHUB_PAGES === 'true' ? '/kofun-marathon/' : '/',
  plugins: [react()],
  server: { allowedHosts: true },
  preview: { allowedHosts: true },
})
