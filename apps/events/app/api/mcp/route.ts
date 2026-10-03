import { revalidatePath } from "next/cache";
import { createMcpHandler } from "../../../src/mcp/handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const handle = createMcpHandler({ changed: () => revalidatePath("/", "layout") });
export const POST = handle;
export const GET = handle;
export const DELETE = handle;
