import { Injectable } from '@angular/core';
import { Product } from '../models/product.model';

@Injectable({
  providedIn: 'root'
})
export class GroupService {

  constructor() { }
  group(products: any[]): Record<number, any[]> {
    const groupedProducts: Record<number, any[]> = {};

    // Pass 1: Find all master products
    // Master = MasterUnitId === null OR MasterUnitId === Id (self-reference, e.g., clones)
    products.forEach((product: any) => {
      const productId = Number(product.Id);
      const masterUnitId = product.MasterUnitId;

      // Check if this is a master product:
      // 1. MasterUnitId === null (regular master)
      // 2. MasterUnitId === Id (self-reference, common for clone products)
      const isMaster = masterUnitId === null ||
                       masterUnitId === undefined ||
                       Number(masterUnitId) === productId;

      if (isMaster) {
        if (!groupedProducts[productId]) {
          groupedProducts[productId] = [];
        }
        groupedProducts[productId].push(product);
      }
    });

    // Pass 2: Add child products to their respective master groups
    products.forEach((product: any) => {
      const productId = Number(product.Id);
      const masterUnitId = product.MasterUnitId;

      // Skip if this is a master (already processed) or has no MasterUnitId
      if (masterUnitId === null || masterUnitId === undefined) {
        return;
      }

      const masterId = Number(masterUnitId);

      // Skip self-reference (already processed as master)
      if (masterId === productId) {
        return;
      }

      // Add to master group if exists
      if (groupedProducts[masterId]) {
        groupedProducts[masterId].push(product);
      }
    });

    return groupedProducts;
  }


  // transformApiData(data: Product[]): any[] {
  //   return data.map(item => ({
  //     Id: item.Id || null,
  //     Code: item.Code || null,
  //     Name: item.Name || null,
  //     FullName: item.FullName || null,
  //     CategoryId: item.CategoryId || null,
  //     isActive: item.isActive || null,
  //     isDeleted: item.isDeleted || null,
  //     Cost: item.Cost || null,
  //     BasePrice: item.BasePrice || null,
  //     OnHand: item.OnHand || null,
  //     Unit: item.Unit || null,
  //     MasterUnitId: item.MasterUnitId || null,
  //     MasterProductId: item.MasterProductId || null,
  //     ConversionValue: item.ConversionValue || null,
  //     Description: item.Description || null,
  //     IsRewardPoint: item.IsRewardPoint || null,
  //     ModifiedDate: item.ModifiedDate || null,
  //     Image: item.Image || null,
  //     CreatedDate: item.CreatedDate || null,
  //     ProductAttributes: item.ProductAttributes || [],
  //     NormalizedName: item.NormalizedName || null,
  //     NormalizedCode: item.NormalizedCode || null,
  //   }));
  // }
}
