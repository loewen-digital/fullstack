import { sveltekit } from '@sveltejs/kit/vite'
import { fullstackPlugin } from '@loewen-digital/fullstack/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [
    sveltekit(),
    fullstackPlugin({ devUi: true }),
  ],
})
