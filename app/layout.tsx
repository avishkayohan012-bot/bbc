import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Kling Motion — AI Motion Control Video Generator",
  description:
    "Generate Kling motion control videos using Magnific/Freepik API with Vercel Blob storage.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body>{children}</body>
    </html>
  );
}
