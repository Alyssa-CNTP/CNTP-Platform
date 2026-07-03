import type { Metadata, Viewport } from 'next'
import { Inter, Playfair_Display } from 'next/font/google'
import './globals.css'
import { AuthProvider } from '@/lib/auth/context'
import { ToastProvider } from '@/components/ui/Toast'

// Inter — clean, neutral, premium. Used by Vercel, Linear, Notion.
const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
})

// Playfair Display — editorial serif for display headings.
const playfair = Playfair_Display({
  subsets: ['latin'],
  variable: '--font-playfair',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'CNTP Platform',
  description: 'Cape Natural Tea Products — Operations Platform',
  manifest: '/manifest.json',
  icons: {
    icon:    [{ url: '/icon.svg', type: 'image/svg+xml' }],
    apple:   [{ url: '/icon.svg', type: 'image/svg+xml' }],
    shortcut: '/icon.svg',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'CNTP Platform',
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  themeColor: '#1A3A0E',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${inter.variable} ${playfair.variable}`}>
      <head>
        {/* Initialise theme synchronously before first paint — prevents the green flash when settings page loads */}
        <script dangerouslySetInnerHTML={{ __html: `
          try {
            var t = localStorage.getItem('cntp_theme') || 'system';
            if (t === 'dark') document.documentElement.dataset.theme = 'dark';
            else if (t === 'light') document.documentElement.dataset.theme = 'light';
            else document.documentElement.dataset.theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
          } catch(e) {}
        `}} />
      </head>
      <body>
        <AuthProvider>
          <ToastProvider>
            {children}
          </ToastProvider>
        </AuthProvider>
      </body>
    </html>
  )
}
