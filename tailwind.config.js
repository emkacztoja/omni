/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: '#121212',
        surface: '#1e1e1e',
        border: '#27272a',
        primary: '#3b82f6',
        textMain: '#f4f4f5',
        textMuted: '#a1a1aa'
      }
    },
  },
  plugins: [],
}
