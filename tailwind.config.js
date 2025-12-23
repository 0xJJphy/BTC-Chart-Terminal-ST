/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{svelte,js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            colors: {
                bg: '#0b0e11', panel: '#151a23', border: '#242b3b', text: '#94a3b8',
                white: '#e2e8f0', accent: '#2962ff', bull: '#089981', bear: '#f23645',
                fvg: '#a855f7', ob: '#eab308', trend: '#e879f9', reg: '#3b82f6', strat: '#f59e0b',
                pending: '#64748b'
            },
            fontFamily: {
                sans: ['Inter', 'sans-serif'],
                mono: ['JetBrains Mono', 'monospace']
            }
        }
    },
    plugins: [],
}
