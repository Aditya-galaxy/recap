import { currentUser, revokeApiToken, unauthorized } from "@/lib/auth";

export async function DELETE(_req: Request, ctx: RouteContext<"/api/tokens/[tid]">) {
  const user = await currentUser();
  if (!user) return unauthorized();
  const { tid } = await ctx.params;
  return revokeApiToken(user.id, tid) ? new Response(null, { status: 204 }) : Response.json({ error: "not found" }, { status: 404 });
}
