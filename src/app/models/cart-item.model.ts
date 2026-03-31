import { Product } from "./product.model";

export interface CartItem {
  product: Product;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  unitPriceSaleOff: number;

  // Promotion fields
  isGift?: boolean;            // true = hàng tặng, Price=0 khi gửi KiotViet
  isPromotionItem?: boolean;   // true = hàng KM (gift hoặc discounted)
  promotionId?: string;        // ID promotion đã apply (Firestore doc ID)
  promotionName?: string;      // tên KM để hiển thị
  parentProductId?: string;    // ID sản phẩm trigger (liên kết gift → trigger)

  // KiotViet promotion fields (dùng khi build invoice payload)
  kiotVietCampaignId?: number;        // = PromotionId in KV invoice payload
  kiotVietSalePromotionId?: number;   // = SalePromotionId in KV invoice payload
  kiotVietPromotionType?: 5 | 6;      // 5 = discount, 6 = gift
  discountPercent?: number;            // % giảm giá (cho Type 5 percentage-based)
}