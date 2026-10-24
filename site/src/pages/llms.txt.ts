import { catalog, microgUrl, project, repoUrl } from "../lib";

// Plain-text summary for AI assistants and answer engines (llms.txt convention).
export function GET() {
  const lines = [
    `# ${project.name}`,
    "",
    `> Free, non-root patched Android APKs built automatically on GitHub Actions from the official Google Play apps, using open-source Morphe patches. Website: ${project.site}. Source: ${repoUrl}.`,
    "",
    "## Apps",
    ...catalog.apps.map((a) => {
      const r = a.latest;
      const files = r ? r.assets.map((x) => `${x.arch}: ${x.url}`).join("; ") : "not built yet";
      return `- [${a.name}](${new URL(`/apps/${a.id}/`, project.site)}): package ${a.package}; version ${r?.version ?? "n/a"}; patches ${a.source.repo} ${r?.patchesVersion ?? ""}; ${r?.applied.length ?? 0} patches applied. ${a.about} Files: ${files}`;
    }),
    "",
    "## Key facts",
    "- Choose arm64-v8a for almost all phones since 2017; armeabi-v7a for older 32-bit phones.",
    "- No root needed. Builds run daily; a new release appears when the patches or the supported app version change.",
    `- YouTube needs MicroG-RE (${microgUrl}) for Google sign-in and installs alongside the official app.`,
    "- Apps that keep their package name (e.g. Reddit) require uninstalling the Play Store version first.",
    `- Every APK is signed with one certificate, SHA-256 ${project.certSha256}.`,
    `- Auto-updates: Obtainium, import ${new URL("/obtainium.json", project.site)}.`,
    `- Request apps: ${repoUrl}/issues/new?template=request-app.yml`,
    "",
  ];
  return new Response(lines.join("\n"), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
