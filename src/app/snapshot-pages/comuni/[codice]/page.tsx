import Page from "@/app/comuni/page";
export { metadata } from "@/app/comuni/page";

// dvns-app fork: rendered per request, never stored by Next. Self-hosted, Next's render cache is the
// release directory on disk with no bound (one file per entity visited); Cloudflare caches the HTML.
export const dynamic = "force-dynamic";

export default async function SnapshotPage({ params }: { params: Promise<{ codice: string }> }) {
  const { codice } = await params;
  return Page({ searchParams: Promise.resolve({ ente: codice }) });
}
