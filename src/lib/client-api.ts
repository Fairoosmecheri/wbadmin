export async function apiFetch<T = unknown>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...options, headers: { ...(options?.body instanceof FormData ? {} : { "Content-Type": "application/json" }), ...options?.headers } });
  const body = await response.json();
  if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : body.error?.message ?? "The request could not be completed.");
  return body as T;
}
