import type { Metadata, Viewport } from "next";
import "./app.css";

export const metadata: Metadata = {
  title: "Stem Player",
  description: "Upload any song, separate it into stems, and mix it live in your browser.",
};

export const viewport: Viewport = {
  themeColor: "#E8E3D4",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Geist+Mono:wght@400;500;600&display=swap"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
