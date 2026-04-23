export default function manifest() {
  return {
    name: 'WhiteGold Portal',
    short_name: 'WhiteGold',
    description: 'Gold Operations Platform',
    start_url: '/',
    display: 'standalone',
    background_color: '#0a0a0a',
    theme_color: '#c9a84c',
    orientation: 'portrait',
    icons: [
      {
        src: '/images.png',
        sizes: '192x192',
        type: 'image/png',
      },
      {
        src: '/images.png',
        sizes: '512x512',
        type: 'image/png',
      },
    ],
  }
}
