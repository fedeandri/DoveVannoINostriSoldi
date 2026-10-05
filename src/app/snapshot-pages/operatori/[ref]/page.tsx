import Page from "@/app/appalti/operatori/[ref]/page";
import { generateMetadata as metadata } from "@/app/appalti/operatori/[ref]/page";
export async function generateMetadata({ params }: { params: Promise<{ ref: string }> }) {
  return metadata({ params, searchParams: Promise.resolve({}) });
}

// dvns-app fork: rendered per request, never stored by Next. Self-hosted, Next's render cache is the
// release directory on disk with no bound (one file per entity visited); Cloudflare caches the HTML.
export const dynamic = "force-dynamic";

export default async function SnapshotPage({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  return Page({ params: Promise.resolve({ ref }), searchParams: Promise.resolve({}) });
}
