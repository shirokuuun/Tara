/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        cream: '#FFF9F1',
        ink: '#20302C',
        coral: '#F36F56',
        'coral-soft': '#FFE3DC',
        teal: '#248F83',
        'teal-soft': '#DDF3EE',
        gold: '#F7C767',
        line: '#E8E1D7',
        muted: '#71807C',
      },
    },
  },
  plugins: [],
};
