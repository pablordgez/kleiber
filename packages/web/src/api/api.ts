import type {
  AgentCli,
  Project,
  RemoteApiSessionOptions,
  SessionRecord,
  SessionType,
} from "@kleiber/shared";

const API_BASE = ""; // Relative URLs for HTTP/HTTPS compatibility

export interface CreateRemoteSessionRequest {
  name: string;
  type: SessionType;
  cli?: AgentCli;
  role?: string;
  yolo?: boolean;
}

export class ApiClient {
  private static getToken(): string | null {
    return sessionStorage.getItem("kleiber_token");
  }

  static setToken(token: string) {
    sessionStorage.setItem("kleiber_token", token);
  }

  static clearToken() {
    sessionStorage.removeItem("kleiber_token");
  }

  private static async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const token = this.getToken();
    const headers = new Headers(options.headers);
    headers.set("Accept", "application/json");
    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }
    if (!headers.has("Content-Type") && options.body && typeof options.body === "string") {
      headers.set("Content-Type", "application/json");
    }

    const response = await fetch(`${API_BASE}${path}`, { ...options, headers });

    if (!response.ok) {
      if (response.status === 401) {
        this.clearToken();
        window.dispatchEvent(new Event("auth_error"));
      }
      const errorText = await response.text();
      throw new Error(`API Error ${response.status}: ${errorText}`);
    }

    if (response.status === 204) {
      return {} as T;
    }

    return response.json() as Promise<T>;
  }

  static async login(username: string, password: string): Promise<{ token: string; expiresAt: string }> {
    const res = await fetch(`${API_BASE}/auth`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ username, password }),
    });

    if (!res.ok) {
      throw new Error("Invalid credentials");
    }
    return res.json();
  }

  static async getProjects(): Promise<Project[]> {
    return this.request<Project[]>("/projects");
  }

  static async getSessions(projectId: string): Promise<SessionRecord[]> {
    return this.request<SessionRecord[]>(`/projects/${projectId}/sessions`);
  }

  static async getSessionOptions(projectId: string): Promise<RemoteApiSessionOptions> {
    return this.request<RemoteApiSessionOptions>(`/projects/${projectId}/session-options`);
  }

  static async createSession(projectId: string, data: CreateRemoteSessionRequest): Promise<SessionRecord> {
    return this.request<SessionRecord>(`/projects/${projectId}/sessions`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  static async killSession(projectId: string, sessionId: string): Promise<void> {
    return this.request<void>(`/projects/${projectId}/sessions/${sessionId}/kill`, {
      method: "POST",
    });
  }

  static async deleteSession(projectId: string, sessionId: string): Promise<void> {
    return this.request<void>(`/projects/${projectId}/sessions/${sessionId}`, {
      method: "DELETE",
    });
  }

  static async resizeSession(projectId: string, sessionId: string, columns: number, rows: number): Promise<void> {
    return this.request<void>(`/projects/${projectId}/sessions/${sessionId}/resize`, {
      method: "POST",
      body: JSON.stringify({ columns, rows }),
    });
  }
}
