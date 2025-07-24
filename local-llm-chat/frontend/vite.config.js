import { defineConfig } from 'vite'

// https://vitejs.dev/config/
export default defineConfig({
  base: './',
  build: {
    rollupOptions: {
      input: {
        main: 'index.html'
      }
    }
  },
  ssr: {
    noExternal: ['svelte-select']
  }
})
