import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class CostService {

  constructor() { }

  masterCode = '';
  masterOnHand = '';
  masterConversionValue = '';
  masterCost = '';
  masterDiscount = '';
  masterFinalBasePrice = '';

  private parseNumber(value: any): number {
    if (typeof value === 'string') {
      const normalized = value.replace(/[^0-9.-]/g, '');
      const parsed = Number(normalized);
      return Number.isFinite(parsed) ? parsed : 0;
    }

    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private getOldProductsMaster(code: any) {
    const oldProduct = Object.entries(localStorage)
      .filter(([key]) => key.startsWith("grouped_"))
      .map(([key, value]) => ({ key: key.replace('grouped_', ''), value: JSON.parse(value) }));


    const oldItem = oldProduct.map((k) => {
      return k.value[code]?.find((c: { Code: any }) => c.Code == code);
    }).find(item => item !== undefined); // Find the first non-undefined result

    return oldItem
  }

  updateCostMaster(element: any) {
    let currentBaseprice: any;
    let currentCost: any;
    let currentOnHand: any;
    const oldProduct: any = this.getOldProductsMaster(element.Code) || {};
    currentBaseprice = this.parseNumber(oldProduct?.BasePrice ?? element.BasePrice);
    currentOnHand = this.parseNumber(oldProduct?.OnHand ?? element.OnHand);
    currentCost = this.parseNumber(oldProduct?.Cost ?? element.Cost);

    this.masterCode = element.Code;

    const conversionValue = this.parseNumber(element.ConversionValue) || 1;
    const originalRetail = this.parseNumber(element.Retail);
    let retail = originalRetail;
    let box = this.parseNumber(element.Box);

    if (originalRetail > conversionValue) {
      retail = originalRetail % conversionValue;
      box = (originalRetail - retail) / conversionValue;
    }

    const totalPrice = this.parseNumber(element.TotalPrice);
    const discountOnTotal = this.parseNumber(element.Discount2);
    const totalUnits = (box * conversionValue) + retail;
    const addedOnHand = conversionValue > 0 ? totalUnits / conversionValue : 0;

    if (box === 0 && retail === 0 && totalPrice === 0) {
    } else if ((box > 0 || retail > 0) && totalPrice === 0) {
      element.Cost = currentCost
    } else {
      if (element.AverageCheckPoint === true) {
        const netTotalPrice = Math.max(totalPrice - discountOnTotal, 0);
        const newCostPerUnit = addedOnHand > 0 ? netTotalPrice / addedOnHand : 0;
        const combinedOnHand = currentOnHand + addedOnHand;

        if (addedOnHand > 0 && combinedOnHand > 0) {
          element.Cost = ((currentCost * currentOnHand) + (newCostPerUnit * addedOnHand)) / combinedOnHand;
        } else if (addedOnHand > 0) {
          element.Cost = newCostPerUnit || currentCost;
        } else {
          element.Cost = currentCost;
        }
      } else {
        if (totalUnits > 0) {
          element.Cost = (totalPrice / totalUnits) * conversionValue || 0;
          if (discountOnTotal > 0) {
            element.Cost = ((totalPrice - discountOnTotal) / totalUnits) * conversionValue || 0;
          }
        } else {
          element.Cost = 0;
        }

      }
    }
    element.OnHand = (currentOnHand + addedOnHand) || 0

    element.BasePrice = Math.round((parseInt(currentBaseprice) + (parseInt(element.Cost) - parseInt(currentCost))) / 1000) * 1000;
    this.masterOnHand = element.OnHand
    this.masterConversionValue = element.ConversionValue
    this.masterCost = element.Cost
    this.masterDiscount = element.Discount
    this.masterFinalBasePrice = element.FinalBasePrice
    localStorage.setItem(`editing_childProduct_${element.Code}`, JSON.stringify(element));
  }



  updateCostChildItems(filteredProducts: any[]) {

    const oldProducts = Object.entries(localStorage)
      .filter(([key]) => key.startsWith("grouped_"))
      .map(([_, value]) => JSON.parse(value || "[]"));

    filteredProducts.forEach((currentItem) => {
      oldProducts.forEach((oP) => {
        const productGroup = oP[this.masterCode];
        if (productGroup) {
          const matchingProduct = productGroup.find((o: any) => o.Code === currentItem.Code);
          if (matchingProduct) {
            if (currentItem.Master) {
              currentItem.Cost = Math.round(currentItem.Cost) || 0;
              currentItem.BasePrice = Math.round(currentItem.BasePrice * 100) / 100 || 0;
            } else {

              currentItem.OnHand = (parseFloat(this.masterOnHand) * parseFloat(this.masterConversionValue)) / parseFloat(currentItem.ConversionValue) || 0;
              currentItem.Cost = Math.round((parseInt(this.masterCost) / parseInt(this.masterConversionValue) * parseInt(currentItem.ConversionValue)) || 0);
              if (parseInt(this.masterDiscount) > 0) {
                currentItem.Cost = (currentItem.Cost - (parseInt(this.masterDiscount) * parseInt(currentItem.ConversionValue))) || 0;
              }
              currentItem.BasePrice = Math.round((matchingProduct.BasePrice + (currentItem.Cost - matchingProduct.Cost)) / 500) * 500 || 0;

              if (parseInt(this.masterFinalBasePrice) > 0) {
                currentItem.FinalBasePrice = Math.round((parseInt(this.masterFinalBasePrice) / parseInt(this.masterConversionValue) * parseInt(currentItem.ConversionValue)) / 500) * 500 || 0;
              }
            }

            currentItem.Edited = true;
            if (!currentItem.Master) {
              localStorage.setItem(`editing_childProduct_${currentItem.Code}`, JSON.stringify(currentItem));
            }
          }
        }
      });
    });
  }
  saveFinal( filteredProducts: any[]) {
    filteredProducts.forEach((currentItem) => {
      localStorage.setItem(`editing_childProduct_${currentItem.Code}`, JSON.stringify(currentItem));
    });
  }
}
