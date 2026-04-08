import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Market Dashboard",
  description: "Weekly trader-style market dashboard",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-white text-zinc-800 antialiased">{children}</body>
    </html>
  );
}
