export interface Template {
  id: string;
  name: string;
  messageText: string;
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
}

export interface UpdateTemplateInput {
  name?: string;
  messageText?: string;
}
