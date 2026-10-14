import { createUser, currentUser, unauthorized } from "@/lib/auth";

/** Admin-only: create an account (works even when public sign-up is closed). */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return unauthorized();
  if (!user.isAdmin) return Response.json({ error: "Admins only." }, { status: 403 });
  const b = await req.json().catch(() => ({}));
  const email = String(b.email ?? "").trim();
  const password = String(b.password ?? "");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return Response.json({ error: "Enter a valid email." }, { status: 400 });
  if (password.length < 10) return Response.json({ error: "Use at least 10 characters for the password." }, { status: 400 });
  try {
    return Response.json(await createUser(email, password, String(b.name ?? "")), { status: 201 });
  } catch (err) {
    if (String((err as Error).message).includes("UNIQUE")) return Response.json({ error: "That email already has an account." }, { status: 409 });
    throw err;
  }
}
