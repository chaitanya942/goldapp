import { Plus_Jakarta_Sans, DM_Mono } from "next/font/google";
import "./globals.css";
import PWAUpdater from "../components/PWAUpdater";

const plusJakarta = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
  display: "swap",
});

const dmMono = DM_Mono({
  variable: "--font-dm-mono",
  subsets: ["latin"],
  weight: ["300", "400", "500"],
  display: "swap",
});

export const metadata = {
  title: "WhiteGold Portal",
  description: "Gold Operations Platform",
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'WhiteGold',
  },
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className={`${plusJakarta.variable} ${dmMono.variable} antialiased`}>
        {children}
        <PWAUpdater />
      </body>
    </html>
  );
}
