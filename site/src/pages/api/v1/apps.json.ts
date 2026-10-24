import { catalog } from "../../../lib";

// Feed for the Auto Morphe Android app (see updater/ in the repo).
export function GET() {
  return new Response(JSON.stringify(catalog.feed), { headers: { "Content-Type": "application/json" } });
}
