export const metadata = {
  title: "Stade & Tribune — Suivi Abonnements & Billetterie",
  description: "Suivi des abonnements foot et billets concerts, saison 2026-2027",
};

export default function RootLayout({ children }) {
  return (
    <html lang="fr">
      <body style={{ margin: 0, padding: 0 }}>{children}</body>
    </html>
  );
}
