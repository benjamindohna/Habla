import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";

const PUBLIC_PATHS = ["/login", "/api/auth"];

function unauthorizedResponse(request: NextRequest, clearCookie: boolean): NextResponse {
  // API requests get a JSON 401; page navigations get redirected to /login.
  const isApi = request.nextUrl.pathname.startsWith("/api");
  const response = isApi
    ? NextResponse.json({ error: "Not authenticated" }, { status: 401 })
    : NextResponse.redirect(new URL("/login", request.url));
  if (clearCookie) response.cookies.delete("auth-token");
  return response;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow login page and auth API through without a token
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const token = request.cookies.get("auth-token")?.value;

  if (!token) {
    return unauthorizedResponse(request, false);
  }

  try {
    const secret = new TextEncoder().encode(process.env.AUTH_SECRET!);
    const { payload } = await jwtVerify(token, secret);
    if (typeof payload.userId !== "number") throw new Error("legacy token");
    return NextResponse.next();
  } catch {
    // Token invalid, expired, or in legacy shape — force re-login.
    return unauthorizedResponse(request, true);
  }
}

export const config = {
  matcher: [
    // Run on all paths except Next.js internals and static files
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
