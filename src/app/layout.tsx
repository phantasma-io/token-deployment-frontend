import "./globals.css";
import type { Metadata } from "next";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from 'next-themes'
import { PhantasmaProvider } from "@/components/PhantasmaProvider";

export const metadata: Metadata = {
  title: "Token Deployment",
  description: "Deploy new tokens on Phantasma blockchain",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-background text-foreground antialiased">
        <PhantasmaProvider>
          <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
            {children}
          </ThemeProvider>
          <Toaster />
        </PhantasmaProvider>
      </body>
    </html>
  );
}
