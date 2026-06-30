export interface TemplateAttachment {
  url: string;
  filename: string;
  mimeType: string;
  size: number;
}

export interface Template {
  id: string;
  name: string;
  messageText: string;
  attachments?: TemplateAttachment[] | null;
  usageCount: number;
  createdById: string;
  createdByName?: string;
  organizationId: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTemplateInput {
  name: string;
  messageText: string;
  attachments?: TemplateAttachment[];
}

export interface UpdateTemplateInput {
  name?: string;
  messageText?: string;
  attachments?: TemplateAttachment[] | null;
}
