import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lead Follow-up Tracker",
  description: "Manage leads, follow-ups, and task exports."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
