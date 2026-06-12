/**
 * Model for Vietnamese Electronic Invoice Processing
 * Cấu trúc JSON cho hóa đơn điện tử Việt Nam
 */

export interface InvoiceMetadata {
  invoice_date: string;
  invoice_no: string;
  invoice_serial: string;
  tax_authority_code: string;
}

export interface Seller {
  company_name: string;
  tax_code: string;
  address: string;
}

export interface Buyer {
  company_name: string;
  tax_code: string;
  address: string;
}

export interface InvoiceItem {
  stt: number;
  description: string;
  unit: string;
  quantity: number;
  unit_price: number;
  amount: number;
  vat_rate?: string;
  vat_amount?: number;
  amount_after_vat?: number | null;
}

export interface InvoiceSummary {
  total_amount_before_vat: number;
  vat_rate: string;
  vat_amount: number;
  total_payment: number;
  total_payment_in_words: string;
}

export interface ProcessedInvoice {
  invoice_metadata: InvoiceMetadata;
  seller: Seller;
  buyer: Buyer;
  items: InvoiceItem[];
  summary: InvoiceSummary;
}

export interface ValidationError {
  field: string;
  message: string;
  severity: 'error' | 'warning';
}

export interface ProcessingStep {
  id: number;
  label: string;
  status: 'pending' | 'processing' | 'completed' | 'error';
  message?: string;
}

export interface ProcessingLogEntry {
  step: string;
  status: 'pending' | 'processing' | 'completed' | 'error';
  message: string;
  duration_ms?: number;
  details?: string;
}

export interface ProcessingResult {
  success: boolean;
  invoice?: ProcessedInvoice;
  raw_text?: string;
  validation_errors?: ValidationError[];
  processing_method: 'flash' | 'pro' | 'manual';
  processing_time_ms?: number;
  error?: string;
  processing_log?: ProcessingLogEntry[];
  confidence?: number;
  low_confidence_fields?: string[];
}
