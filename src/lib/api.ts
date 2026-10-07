import { headers } from "next/headers";
import { ZodError } from "zod";

export class AppError extends Error {
  constructor(public readonly status: number, message: string) { super(message); this.name = "AppError"; }
}

/** Cookie-authenticated mutations must originate from the configured application. */
export function validateOrigin(requestHeaders: Headers, method?: string) {
  const origin = requestHeaders.get("origin");
  const site = requestHeaders.get("sec-fetch-site");
  if (site === "cross-site") throw new AppError(403, "Cross-site requests are not allowed.");
  const mutation = method && !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());
  if (mutation && !origin) throw new AppError(403, "An Origin header is required for this action.");
  if (origin) {
    const configured = process.env.APP_URL;
    if (!configured || new URL(configured).origin !== origin) throw new AppError(403, "This request did not originate from the application.");
  }
}

export async function handleApi(handler: () => Promise<Response>, request?: Request): Promise<Response> {
  try {
    validateOrigin(request?.headers ?? await headers(), request?.method);
    return await handler();
  } catch (error) {
    if (error instanceof AppError) return Response.json({ error: error.message }, { status: error.status });
    if (error instanceof ZodError) return Response.json({ error: "Please check the submitted information.", details: error.flatten() }, { status: 422 });
    if (error instanceof SyntaxError) return Response.json({ error: "The request body must contain valid JSON." }, { status: 400 });
    if (error && typeof error === "object" && "code" in error) {
      if (error.code === "P2002") return Response.json({ error: "A record with these unique details already exists." }, { status: 409 });
      if (error.code === "P2025") return Response.json({ error: "The requested record was not found." }, { status: 404 });
      if (error.code === "P2003") return Response.json({ error: "A linked record could not be found or is still in use." }, { status: 409 });
      if (error.code === "P2034") return Response.json({ error: "Another update was made at the same time. Please retry." }, { status: 409 });
    }
    // Avoid logging request bodies, provider responses, or credentials.
    console.error("API operation failed", { type: error instanceof Error ? error.name : "UnknownError" });
    return Response.json({ error: "This operation could not be completed. Please retry or contact your administrator." }, { status: 500 });
  }
}
