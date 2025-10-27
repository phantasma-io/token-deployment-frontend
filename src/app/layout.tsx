import "./globals.css";
import type { Metadata } from "next";
import { Toaster } from "@/components/ui/sonner";
import ThemeToggle from "@/components/ThemeToggle";
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
    <html lang="en">
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
        try {
          var s = localStorage.getItem('theme');
          document.documentElement.classList.toggle('dark', s ? s==='dark' : true);
        } catch {}
        `,
          }}
        />
      </head>
      <body className="min-h-screen bg-background text-foreground antialiased">
        <PhantasmaProvider>
          {children}
          <Toaster />
          <ThemeToggle />
        </PhantasmaProvider>
      </body>
    </html>
  );
}
