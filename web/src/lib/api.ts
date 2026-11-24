const API_URL = process.env.NEXT_PUBLIC_LOOP_API_URL ?? 'http://127.0.0.1:3000';

export type ApiError = { error: { code: string; message: string } };

export async function apiRequest<T>(
  path: string,
  accessToken?: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set('Content-Type', 'application/json');
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);

  const response = await fetch(`${API_URL}${path}`, { ...options, headers, cache: 'no-store' });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const err = data as ApiError;
    throw new Error(err?.error?.message ?? 'No se pudo completar la solicitud');
  }

  return data as T;
}
