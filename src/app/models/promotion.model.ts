export interface Promotion {
  id: string;
  name: string;
  type: 'gift' | 'percentage' | 'fixed_amount'; // backward compat - primary type
  isEnabled: boolean;
  priority: number;

  // Type flags
  hasGift?: boolean;
  hasPercentDiscount?: boolean;
  hasFixedDiscount?: boolean;

  // Target product (trigger)
  targetProductId: string;
  targetProductCode: string;
  targetProductName: string;

  // Condition
  minQuantity: number;

  // Discount (for percentage/fixed_amount)
  discountPercent?: number;
  discountAmount?: number;

  // Gift (for gift type)
  giftProductId?: string;
  giftProductCode?: string;
  giftProductName?: string;
  giftProductBasePrice?: number;
  giftQuantity?: number;

  // Date range
  fromDate: string;
  toDate: string;

  // Metadata
  createdDate: string;
  modifiedDate: string;

  // KiotViet sync
  kiotVietCampaignId?: number;           // Campaign.Id từ KiotViet response (= PromotionId in invoice)
  kiotVietSalePromotionId?: number;    // SalePromotions[0].Id từ KiotViet response (= SalePromotionId in invoice)
  kiotVietPromotionType?: 5 | 6;       // 5 = giảm giá hàng, 6 = tặng hàng
  kiotVietSynced?: boolean;
}

export interface ApplyPromotionResult {
  appliedPromotions: AppliedPromotion[];
  giftItems: GiftItem[];
  totalDiscount: number;
}

export interface AppliedPromotion {
  promotionId: string;
  promotionName: string;
  type: string;
  targetProductId: string;
  discountAmount: number;
  discountPercent?: number;
  giftProductId?: string;
  giftProductName?: string;
  giftQuantity?: number;
}

export interface GiftItem {
  productId: string;
  code: string;
  name: string;
  quantity: number;
  basePrice: number;
  isGift: boolean;
  promotionId: string;
}
