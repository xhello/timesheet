import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Shiftboard | Front Desk Scheduling",
  description: "Employee shift requests, custom priority, and a schedule that works for your team.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
