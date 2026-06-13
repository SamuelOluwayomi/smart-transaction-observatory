import { NextResponse } from "next/server";
import { getSnapshot } from "@/lib/observatory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await getSnapshot());
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to build observatory snapshot",
      },
      { status: 500 }
    );
  }
}
