import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { handleApiRequest } from './server/api.js'

function gliApiPlugin() {
    return {
        name: 'gli-api-middleware',
        configureServer(server) {
            server.middlewares.use((req, res, next) => {
                if (req.url && req.url.startsWith('/api')) {
                    handleApiRequest(req, res);
                } else {
                    next();
                }
            });
        },
    };
}

// https://vitejs.dev/config/
export default defineConfig({
    plugins: [svelte(), gliApiPlugin()],
    server: {
        host: '0.0.0.0',
        port: 5173,
    },
})

