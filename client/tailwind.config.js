/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        panel: {
          900: "#0b1020",
          800: "#11162a",
          700: "#161c33",
          600: "#1e2540",
          500: "#2a3357",
        },
      },
      fontFamily: {
        sans: ["Vazirmatn", "Segoe UI", "Tahoma", "sans-serif"],
      },
    },
  },
  plugins: [],
};
