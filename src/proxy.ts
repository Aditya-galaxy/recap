import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

// Only active in local mode (desktop app). The engine listens on 127.0.0.1, but that alone isn't
// enough: any web page in the user's browser could call it (via DNS rebinding) and so could other
// local programs. So every request must (1) be addressed to 127.0.0.1 / localhost and (2) carry the
// secret the desktop app generated at launch, as a cookie (library window) or bearer token (recorder).
const TOKEN = process.env.RECAP_LOCAL_TOKEN || "";
const COOKIE = "recap_local";

const same = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

export function proxy(req: NextRequest) {
  if (!TOKEN) return NextResponse.next();

  const host = (req.headers.get("host") ?? "").replace(/:\d+$/, "");
  if (host !== "127.0.0.1" && host !== "localhost") {
    return new NextResponse("Forbidden", { status: 403 });
  }

  // One-time bootstrap from the desktop app: /__local?token=…&next=/path sets the cookie.
  if (req.nextUrl.pathname === "/__local") {
    if (!same(req.nextUrl.searchParams.get("token") ?? "", TOKEN)) return new NextResponse("Forbidden", { status: 403 });
    const next = req.nextUrl.searchParams.get("next") ?? "/";
    // Only plain same-site paths: "//host", "/\host" and control characters can all leave the site.
    const safe = /^\/(?![/\\])[^\\\s\x00-\x1f]*$/.test(next) ? next : "/";
    const res = NextResponse.redirect(new URL(safe, req.url));
    res.cookies.set(COOKIE, TOKEN, { httpOnly: true, sameSite: "strict", path: "/" });
    return res;
  }

  // There are no accounts in local mode.
  if (/^\/api\/(auth|users|tokens)(\/|$)/.test(req.nextUrl.pathname)) return new NextResponse("Not found", { status: 404 });

  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/, "") ?? "";
  if (same(req.cookies.get(COOKIE)?.value ?? "", TOKEN) || same(bearer, TOKEN)) return NextResponse.next();
  return new NextResponse("Unauthorized", { status: 401 });
}
