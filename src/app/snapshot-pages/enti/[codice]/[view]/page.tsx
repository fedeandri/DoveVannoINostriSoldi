import Page from "@/app/enti/[codice]/appalti/page";
export { generateMetadata } from "@/app/enti/[codice]/appalti/page";

// dvns-app fork: rendered per request, never stored by Next. Self-hosted, Next's render cache is the
// release directory on disk with no bound (one file per entity visited); Cloudflare caches the HTML.
export const dynamic = "force-dynamic";

export default async function SnapshotPage({ params }: { params: Promise<{ codice: string; view: string }> }) {
  const { codice, view } = await params;
  return Page({ snapshotCache: true, params: Promise.resolve({ codice }), searchParams: Promise.resolve({ view }) });
}
