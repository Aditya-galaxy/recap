import { connection } from "next/server";
import { founderStats } from "@/lib/auth";
import { config } from "@/lib/config";

/** Real founding-spot numbers for the website's counter. Public and cacheable for a few seconds. */
export async function GET() {
  await connection();
  const body = config.cloud ? { ...founderStats(), price: config.paidPriceLabel } : { limit: 0, taken: 0, left: 0, price: null };
  return Response.json(body, {
    headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=15" },
  });
}
