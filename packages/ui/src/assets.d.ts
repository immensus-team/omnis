/** Vite resolves asset imports to URL strings, but this package does not pull in `vite/client`
 *  (it is a library compiled by tsc, not an app) — without this declaration `import x from
 *  "../assets/brands/slack@1x.png"` is a TS2307 error in `pnpm typecheck`. */
declare module "*.png" {
  const url: string;
  export default url;
}
