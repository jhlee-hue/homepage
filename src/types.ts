export interface EditHistoryItem {
  id: string;
  originalImage: string; // base64 URL
  referenceImage?: string; // base64 URL (optional)
  prompt: string;
  resultImage: string; // base64 URL or reference
  timestamp: number;
}

export interface EditRequest {
  originalImage: string; // base64 (stripped of mime syntax)
  originalMimeType: string;
  referenceImage?: string; // base64 (stripped of mime syntax)
  referenceMimeType?: string;
  prompt: string;
}

export interface EditResponse {
  resultImage: string; // base64 Image URL with correct mime header
  success: boolean;
  error?: string;
}
