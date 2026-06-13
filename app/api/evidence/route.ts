import { buildEvidenceMarkdown } from "@/lib/observatory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const markdown = await buildEvidenceMarkdown();

  return new Response(markdown, {
    headers: {
      "content-disposition": 'attachment; filename="smart-tx-evidence.md"',
      "content-type": "text/markdown; charset=utf-8",
    },
  });
}
