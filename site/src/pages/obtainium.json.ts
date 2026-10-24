import { catalog } from "../lib";

export function GET() {
  return new Response(JSON.stringify(catalog.obtainiumImport, null, 2), {
    headers: { "Content-Type": "application/json" },
  });
}
