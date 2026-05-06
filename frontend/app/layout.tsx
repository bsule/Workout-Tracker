import type { Metadata } from "next"
import { Inter, Archivo_Black, JetBrains_Mono } from "next/font/google"
import "./globals.css"
import { Navbar } from "@/components/layout/Navbar"
import { AuthProvider } from "@/components/auth/AuthProvider"
import { ConfirmDialogProvider } from "@/components/ui/ConfirmDialog"
import { CategoryStylesProvider } from "@/components/categories/CategoryStylesProvider"
import { SettingsProvider } from "@/components/settings/SettingsProvider"
import { StoreProvider } from "@/components/store/StoreProvider"
import { ThemeProvider, themeBootstrapScript } from "@/components/settings/ThemeProvider"

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
})

const archivoBlack = Archivo_Black({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["400"],
})

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
})

export const metadata: Metadata = {
  title: "LIFT — Workout Tracker",
  description: "Track every rep. Own every PR.",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className={`${inter.variable} ${archivoBlack.variable} ${jetbrainsMono.variable} dark antialiased h-full`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrapScript }} />
      </head>
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <ThemeProvider>
          <AuthProvider>
            <StoreProvider>
              <SettingsProvider>
                <CategoryStylesProvider>
                  <ConfirmDialogProvider>
                    <Navbar />
                    <main className="flex-1">{children}</main>
                  </ConfirmDialogProvider>
                </CategoryStylesProvider>
              </SettingsProvider>
            </StoreProvider>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
