import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://apk.iamwaqargulzar.com",
  outDir: "../dist",
  trailingSlash: "ignore",
  build: { format: "directory" },
});
