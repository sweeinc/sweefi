---
"@sweefi/hono": major
---

Rename `@sweefi/server` → `@sweefi/hono`.

**Breaking change.** The old package name is no longer published. Consumers must update their `package.json`:

```diff
{
  "dependencies": {
-   "@sweefi/server": "^0.1.0"
+   "@sweefi/hono": "^0.2.0"
  }
}
```

Import paths and the public API are unchanged — only the package name moved. The rename was made for honesty: the package has always been the Hono middleware specifically (not a generic "server"), and x402's ecosystem uses the same framework-suffixed convention (`x402-hono`, `x402-express`, `x402-next`). Keeping the vague name invited downstream confusion about whether a future Express/Fastify/Nitro adapter would live here.

**Migration:**
1. Bump the dep in `package.json` as shown above
2. Run your package manager's install
3. No source edits required
