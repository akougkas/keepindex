/** Site name. Appended to every page title and used as `og:site_name`. */
export const SITE_NAME = "KeepIndex";
/** Canonical promise and tagline. */
export const SITE_TAGLINE = "Search your world. Keep it yours.";
/** Fallback meta description for pages that don't set their own. */
export const SITE_DESCRIPTION =
  "Private search on your computer. Your choice of AI. Search selected folders, vaults, browser history, and the web with KeepIndex. Install locally; keep your own index.";
/** Canonical origin. Resolves canonical URLs, social images, and the sitemap. */
export const SITE_URL = "https://keepindex.ing";
/** BCP 47 locale tag used to format dates and numbers. */
export const SITE_LOCALE = "en-US";
/**
 * Routes kept out of search results. Each is excluded from the sitemap and
 * served with a `robots: noindex, nofollow` tag, so the two can't disagree.
 *
 * Surrounding slashes are optional: `"/thanks"`, `"thanks"` and `"/thanks/"`
 * all match the same route.
 */
export const NOINDEX_ROUTES: string[] = ["/404"];
