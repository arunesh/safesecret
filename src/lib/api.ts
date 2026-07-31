import type {
  ApiErrorBody,
  CreateSecretRequest,
  CreateSecretResponse,
  RevealResponse,
  SecretMetaResponse,
} from "../../shared/types.js";

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: { ...(init?.body ? { "content-type": "application/json" } : {}), ...init?.headers },
    });
  } catch {
    throw new ApiRequestError(0, "network", "Could not reach the server. Check your connection.");
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as ApiErrorBody | null;
    throw new ApiRequestError(
      response.status,
      body?.error.code ?? "unknown",
      body?.error.message ?? "Something went wrong.",
    );
  }

  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

export const createSecret = (payload: CreateSecretRequest) =>
  request<CreateSecretResponse>("/api/secrets", { method: "POST", body: JSON.stringify(payload) });

/** Metadata only — safe to call on page load, never consumes the secret. */
export const fetchSecretMeta = (id: string) => request<SecretMetaResponse>(`/api/secrets/${id}`);

/** Consumes the secret. Only ever call this from a deliberate user action. */
export const revealSecret = (id: string) =>
  request<RevealResponse>(`/api/secrets/${id}/reveal`, { method: "POST" });

export const burnSecret = (id: string, burnToken: string) =>
  request<void>(`/api/secrets/${id}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${burnToken}` },
  });
