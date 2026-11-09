import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "UPI Payments Analytics | PhonePe Pulse",
  description: "Explore UPI transaction trends across Indian states with the PhonePe Pulse analytics copilot.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className="dark h-full antialiased"
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
