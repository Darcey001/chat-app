// In development the API runs separately on port 4000.
// In production the server also serves this app, so we use the same address ('').
export const API_URL =
  import.meta.env.VITE_API_URL ?? (import.meta.env.DEV ? 'http://localhost:4000' : '');

/** Small fetch wrapper that adds the token and turns API errors into exceptions. */
export async function api(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(API_URL + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong');
  return data;
}
