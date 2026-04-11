// ─── WAHA HTTP Client ───
// Typed HTTP client for WAHA (WhatsApp HTTP API) REST endpoints.
// Uses native fetch — no external dependencies required.
// Docs: https://waha.devlike.pro/docs/overview/introduction/

// ─── Configuration ───

const WAHA_API_URL = process.env.WAHA_API_URL ?? 'http://localhost:3003';
const WAHA_API_KEY = process.env.WAHA_API_KEY ?? '';

// ─── Types: Session ───

export type WahaSessionStatus =
  | 'STARTING'
  | 'SCAN_QR_CODE'
  | 'WORKING'
  | 'FAILED'
  | 'STOPPED';

export interface WahaWebhookConfig {
  url: string;
  events: string[];
}

export interface WahaSessionConfig {
  webhooks?: WahaWebhookConfig[];
}

export interface WahaCreateSessionBody {
  name: string;
  config?: WahaSessionConfig;
}

export interface WahaSessionInfo {
  name: string;
  status: WahaSessionStatus;
  engine?: string;
  me?: { id: string; pushName?: string };
}

// ─── Types: QR Code ───

export interface WahaQrResponse {
  value: string;   // base64-encoded image data
  mimetype: string; // e.g. "image/png"
}

// ─── Types: Messaging ───

export interface WahaSendTextBody {
  session: string;
  chatId: string;
  text: string;
}

export interface WahaSendImageBody {
  session: string;
  chatId: string;
  file: { url: string };
  caption?: string;
}

export interface WahaSendFileBody {
  session: string;
  chatId: string;
  file: { url: string; filename?: string };
  caption?: string;
}

export interface WahaSendResult {
  id: string;
  // WAHA returns more fields, but we only need the message ID
}

// ─── Types: Chats ───

export interface WahaChat {
  id: string | { _serialized: string; server: string; user: string };
  name: string;
  isGroup: boolean;
  timestamp?: number;
  lastMessage?: { body?: string };
}

// ─── Types: Contacts ───

export interface WahaContact {
  id: string;
  name?: string;
  pushname?: string;
  shortName?: string;
  isMyContact?: boolean;
  isUser?: boolean;
  isGroup?: boolean;
  isBusiness?: boolean;
}

// ─── Types: Messages ───

export interface WahaMessage {
  id: string;
  body: string;
  fromMe: boolean;
  timestamp: number;
  from: string;
  to: string;
  hasMedia: boolean;
  /** Sender's push name (display name) */
  _data?: { notifyName?: string };
}

// ─── Types: Typing ───

export interface WahaTypingBody {
  chatId: string;
  duration?: number;
}

// ─── Error ───

export class WahaApiError extends Error {
  constructor(
    public statusCode: number,
    public responseBody: string,
    message?: string,
  ) {
    super(message ?? `WAHA API error ${statusCode}: ${responseBody}`);
    this.name = 'WahaApiError';
  }
}

// ─── Client ───

export class WahaClient {
  private baseUrl: string;
  private apiKey: string;

  constructor(options?: { baseUrl?: string; apiKey?: string }) {
    this.baseUrl = (options?.baseUrl ?? WAHA_API_URL).replace(/\/+$/, '');
    this.apiKey = options?.apiKey ?? WAHA_API_KEY;
  }

  // ─── Internal request helper ───

  private async request<T>(
    method: 'GET' | 'POST' | 'DELETE' | 'PUT' | 'PATCH',
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      'Accept': 'application/json',
    };

    if (this.apiKey) {
      headers['X-Api-Key'] = this.apiKey;
    }

    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (err) {
      throw new WahaApiError(0, '', `WAHA request failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    // 204 No Content — return empty
    if (response.status === 204) {
      return undefined as T;
    }

    const text = await response.text();

    if (!response.ok) {
      throw new WahaApiError(response.status, text, `WAHA ${method} ${path} → ${response.status}`);
    }

    // Parse JSON if there is a body
    if (!text) return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new WahaApiError(response.status, text, `WAHA returned non-JSON response for ${method} ${path}`);
    }
  }

  // ─── Session management ───

  /**
   * Create AND start a new WAHA session with optional webhook config.
   * Uses /api/sessions/start which both creates and starts the session.
   * Plain POST /api/sessions only saves config without starting.
   */
  async createSession(name: string, config?: WahaSessionConfig): Promise<WahaSessionInfo> {
    return this.request<WahaSessionInfo>('POST', '/api/sessions/start', {
      name,
      config,
    } satisfies WahaCreateSessionBody);
  }

  /** Get info about an existing session. */
  async getSession(session: string): Promise<WahaSessionInfo> {
    return this.request<WahaSessionInfo>('GET', `/api/sessions/${encodeURIComponent(session)}`);
  }

  /** Delete (remove) a session entirely. */
  async deleteSession(session: string): Promise<void> {
    await this.request<void>('DELETE', `/api/sessions/${encodeURIComponent(session)}`);
  }

  /** Start a stopped session. */
  async startSession(session: string): Promise<void> {
    await this.request<void>('POST', `/api/sessions/${encodeURIComponent(session)}/start`);
  }

  /** Stop a running session. */
  async stopSession(session: string): Promise<void> {
    await this.request<void>('POST', `/api/sessions/${encodeURIComponent(session)}/stop`);
  }

  // ─── QR Code ───

  /**
   * Get the QR code for a session that is in SCAN_QR_CODE status.
   * WAHA returns a PNG image by default; we fetch it as binary and
   * convert to base64 so the frontend can display it directly.
   * Returns null if QR is not ready yet (404/422).
   */
  async getQr(session: string): Promise<WahaQrResponse | null> {
    const url = `${this.baseUrl}/api/${encodeURIComponent(session)}/auth/qr`;
    const headers: Record<string, string> = {};
    if (this.apiKey) {
      headers['X-Api-Key'] = this.apiKey;
    }

    let response: Response;
    try {
      response = await fetch(url, { method: 'GET', headers });
    } catch {
      return null;
    }

    if (!response.ok) {
      if (response.status === 404 || response.status === 422) {
        return null;
      }
      const text = await response.text().catch(() => '');
      throw new WahaApiError(response.status, text, `WAHA GET QR → ${response.status}`);
    }

    const contentType = response.headers.get('content-type') || '';

    if (contentType.startsWith('image/')) {
      const buffer = Buffer.from(await response.arrayBuffer());
      return {
        value: buffer.toString('base64'),
        mimetype: contentType.split(';')[0].trim(),
      };
    }

    const text = await response.text();
    try {
      return JSON.parse(text) as WahaQrResponse;
    } catch {
      return null;
    }
  }

  // ─── Messaging ───

  /** Send a text message. */
  async sendText(session: string, chatId: string, text: string): Promise<WahaSendResult> {
    return this.request<WahaSendResult>('POST', '/api/sendText', {
      session,
      chatId,
      text,
    } satisfies WahaSendTextBody);
  }

  /** Send an image with optional caption. */
  async sendImage(session: string, chatId: string, imageUrl: string, caption?: string): Promise<WahaSendResult> {
    return this.request<WahaSendResult>('POST', '/api/sendImage', {
      session,
      chatId,
      file: { url: imageUrl },
      caption,
    } satisfies WahaSendImageBody);
  }

  /** Send a file (document) with optional caption. */
  async sendFile(session: string, chatId: string, fileUrl: string, filename?: string, caption?: string): Promise<WahaSendResult> {
    return this.request<WahaSendResult>('POST', '/api/sendFile', {
      session,
      chatId,
      file: { url: fileUrl, filename },
      caption,
    } satisfies WahaSendFileBody);
  }

  // ─── Chats ───

  /** List all chats for a session. */
  async listChats(session: string): Promise<WahaChat[]> {
    return this.request<WahaChat[]>('GET', `/api/${encodeURIComponent(session)}/chats`);
  }

  /** Get all contacts for a session. */
  async getContacts(session: string): Promise<WahaContact[]> {
    return this.request<WahaContact[]>('GET', `/api/contacts?session=${encodeURIComponent(session)}`);
  }

  /** Get messages from a specific chat. */
  async getMessages(session: string, chatId: string, limit = 50, downloadMedia = false): Promise<WahaMessage[]> {
    const params = new URLSearchParams({
      limit: String(limit),
      downloadMedia: String(downloadMedia),
    });
    return this.request<WahaMessage[]>(
      'GET',
      `/api/${encodeURIComponent(session)}/chats/${encodeURIComponent(chatId)}/messages?${params}`,
    );
  }

  /** Delete a message in a chat. */
  async deleteMessage(session: string, chatId: string, messageId: string): Promise<void> {
    await this.request<void>(
      'DELETE',
      `/api/${encodeURIComponent(session)}/chats/${encodeURIComponent(chatId)}/messages`,
      { messageId },
    );
  }

  // ─── Typing indicator ───

  /** Start a typing indicator in a chat. Duration in ms (default 3000). */
  async startTyping(session: string, chatId: string, duration = 3000): Promise<void> {
    await this.request<void>(
      'POST',
      `/api/${encodeURIComponent(session)}/typing`,
      { chatId, duration } satisfies WahaTypingBody,
    );
  }
}
