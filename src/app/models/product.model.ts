export interface Product {
  Id: number;
  Code: string;
  Name: string;
  FullName: string;
  CategoryId: number | null;  // ✅ Cho phép null
  isActive: boolean;
  isDeleted: boolean;
  isClone?: boolean;  // ✅ Đánh dấu product là clone (NV variant)
  Cost: number;
  BasePrice: number;
  OnHand: number;
  OnHandNV?: number;  // ✅ Thêm field này (optional)
  Unit: string;
  MasterUnitId: number | null;  // ✅ Cho phép null (master product không có)
  MasterProductId: number | null;  // ✅ Cho phép null (master product không có)
  ConversionValue: number;
  Description: string;
  IsRewardPoint: boolean;
  ModifiedDate: Date | string;  // ✅ Cho phép string (ISO format từ API)
  Image: string | null;  // ✅ Cho phép null
  CreatedDate: Date | string;  // ✅ Cho phép string
  ProductAttributes: any[];
  NormalizedName: string;
  NormalizedCode: string;
  OrderTemplate: string;
  Tax?: number | string;  // ✅ Thuế suất: 0, 5, 8, 10 (number) hoặc "KCT", "KKKNT" (string, không chịu thuế)
  CloneSourceId?: number | string;  // ✅ ID của product gốc (cho clones)
}