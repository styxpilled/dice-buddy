import { defineConfig } from "astro/config";
import svelte from "@astrojs/svelte";

export default defineConfig({
  site: process.env.SITE_URL,
  base: process.env.BASE_PATH ?? "/",
  integrations: [svelte()],
});
