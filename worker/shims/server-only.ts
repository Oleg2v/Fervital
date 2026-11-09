// The Worker is server code throughout. Next.js resolves `server-only` to an empty module on the server;
// the Worker bundle gets this one (wrangler.jsonc → alias), since the package's default entry throws.
export {};
