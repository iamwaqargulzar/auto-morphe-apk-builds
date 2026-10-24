import { catalog, project } from "../lib";

export function GET() {
  const urls = [
    { loc: "/", lastmod: catalog.generatedAt },
    ...catalog.apps.map((a) => ({ loc: `/apps/${a.id}/`, lastmod: a.latest?.date ?? catalog.generatedAt })),
  ];
  const body = urls
    .map((u) => `  <url><loc>${new URL(u.loc, project.site)}</loc><lastmod>${u.lastmod.slice(0, 10)}</lastmod></url>`)
    .join("\n");
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`, {
    headers: { "Content-Type": "application/xml" },
  });
}
