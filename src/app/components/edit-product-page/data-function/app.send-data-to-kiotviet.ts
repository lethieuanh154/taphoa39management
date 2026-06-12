import { Injectable } from "@angular/core";
import { KiotvietService } from "../../../services/kiotviet.service";
@Injectable({
  providedIn: 'root'
})
export class SendDataToKiotVietService {
    constructor( private kiotvietService: KiotvietService) { }

    /**
     * Extract the base Name from a full product name by stripping ProductAttributes and Unit suffix.
     *
     * Our IndexedDB stores product.Name as the FULL name (from KiotViet suggest API),
     * e.g. "Test - Cam1 (chai)". But KiotViet's update API expects the BASE name only
     * (e.g. "Test"). If we send the full name as Name, KiotViet auto-appends attributes + unit
     * again, causing duplication like "Test - Cam1 (chai) - Cam1 (chai)".
     *
     * This method strips the attribute values and unit from the edited name to recover the base name.
     */
    private extractBaseName(editedName: string, payloadProduct: any): string {
        if (!editedName) return editedName;

        let baseName = editedName.trim();

        // Get unit and attributes from the KiotViet payload (source of truth for structure)
        const unit = payloadProduct?.Unit || '';
        const attributes: string[] = [];
        if (Array.isArray(payloadProduct?.ProductAttributes)) {
            for (const attr of payloadProduct.ProductAttributes) {
                const val = attr?.Value || attr?.value;
                if (val) attributes.push(val);
            }
        }

        // Strip trailing unit in parentheses, e.g. " (chai)" or "(chai)"
        if (unit) {
            // Match patterns like " (chai)", "(chai)", " chai"
            const unitPatterns = [
                new RegExp(`\\s*\\(${this.escapeRegex(unit)}\\)\\s*$`, 'i'),
                new RegExp(`\\s+${this.escapeRegex(unit)}\\s*$`, 'i'),
            ];
            // Only strip using a pattern if the original KiotViet FullName also ended with
            // that same pattern. This prevents stripping when the user intentionally added
            // the unit word as part of the product name (e.g. "3.6kg/4 túi").
            const originalFullName = (payloadProduct?.FullName || '').trim();
            for (const pattern of unitPatterns) {
                if (originalFullName && !pattern.test(originalFullName)) continue;
                const before = baseName;
                baseName = baseName.replace(pattern, '');
                if (baseName !== before) break; // Only strip once
            }
        }

        // Strip trailing attribute values, e.g. " - Cam1" or " Cam1"
        for (const attrValue of attributes) {
            if (!attrValue) continue;
            const attrPatterns = [
                new RegExp(`\\s*-\\s*${this.escapeRegex(attrValue)}\\s*$`, 'i'),
                new RegExp(`\\s+${this.escapeRegex(attrValue)}\\s*$`, 'i'),
            ];
            for (const pattern of attrPatterns) {
                const before = baseName;
                baseName = baseName.replace(pattern, '');
                if (baseName !== before) break;
            }
        }

        baseName = baseName.trim();
        if (baseName !== editedName.trim()) {
            console.log(`🔧 [extractBaseName] "${editedName}" → "${baseName}" (stripped attrs/unit)`);
        }
        return baseName || editedName.trim(); // Fallback to original if stripping removed everything
    }

    private escapeRegex(str: string): string {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    /**
     * Send ALL product groups to KiotViet API.
     * Splits Cost and OnHand into separate calls when both change to produce distinct CB/KK documents.
     */
    async sendAllProductData(groups: Array<{ master: any; children: any[] }>): Promise<any> {
        console.log('🚀 [SendAllData] Received', groups.length, 'groups to send');

        if (groups.length === 0) {
            console.warn('⚠️ No groups to send');
            return;
        }

        const firstMaster = groups[0].master;
        console.log('🔵 [SendAllData] Using master product Id:', firstMaster.Id);

        const payload = await this.kiotvietService.getRequestBody(firstMaster.Id);

        if (!payload?.Product) {
            throw new Error('Không thể lấy dữ liệu sản phẩm từ KiotViet');
        }

        console.log('🟢 [SendAllData] Payload from KiotViet:', {
            ProductId: payload.Product.Id,
            ProductCode: payload.Product.Code,
            Product_BasePrice: payload.Product.BasePrice,
            Product_Cost: payload.Product.Cost,
            Product_OnHand: payload.Product.OnHand,
            ProductUnitsCount: payload.Product.ProductUnits?.length || 0
        });

        const allEditedProducts: any[] = [];
        groups.forEach(group => {
            allEditedProducts.push(group.master);
            allEditedProducts.push(...group.children);
        });

        console.log('🟡 [SendAllData] Total edited products:', allEditedProducts.length);

        const editedMap = new Map<string, any>();
        allEditedProducts.forEach((item) => {
            const key = item?.OriginalCode ?? item?.Code;
            if (key) {
                editedMap.set(String(key), item);
            }
        });

        console.log('🟡 [SendAllData] editedMap keys:', Array.from(editedMap.keys()));

        // Helper: numeric equality (rounded) — used to detect real cost/onhand changes
        const numEq = (a: any, b: any) => Math.round(Number(a)) === Math.round(Number(b));

        const oldCode = payload.Product.Code;
        const oldName = payload.Product.Name;
        const oldBasePrice = payload.Product.BasePrice;
        const oldCost = payload.Product.Cost;
        const oldOnHand = payload.Product.OnHand;

        console.log('🔵 [SendAllData] OLD values from KiotViet:', {
            oldCode, oldName, oldBasePrice, oldCost, oldOnHand
        });

        let masterMatch = editedMap.get(String(payload.Product.Code));
        if (!masterMatch) {
            for (const item of allEditedProducts) {
                if (item.Id === payload.Product.Id) {
                    masterMatch = item;
                    console.log(`✅ [SendAllData] Found master by Id: ${item.Id}`);
                    break;
                }
            }
        }

        const basePriceChanged = masterMatch?.BasePrice !== undefined &&
                                  masterMatch?.FinalBasePrice !== undefined &&
                                  masterMatch.BasePrice !== masterMatch.FinalBasePrice;

        console.log('----------------', {
            FinalBasePrice: masterMatch?.FinalBasePrice,
            BasePrice: masterMatch?.BasePrice,
            basePriceChanged: basePriceChanged
        });

        if (masterMatch) {
            if (masterMatch.Code && masterMatch.Code !== payload.Product.Code) {
                console.log(`🔄 [SendAllData] Updating Code: ${payload.Product.Code} → ${masterMatch.Code}`);
                payload.Product.Code = masterMatch.Code;
                payload.Product.CompareCode = oldCode;
            }

            {
                const editedFullName = masterMatch.Name;
                const kvFullName = payload.Product.FullName || '';
                const hasOriginalName = !!(masterMatch as any).OriginalName;
                const nameActuallyChanged = hasOriginalName
                    ? (masterMatch as any).OriginalName !== editedFullName
                    : (editedFullName !== kvFullName && editedFullName !== payload.Product.Name);

                if (editedFullName && nameActuallyChanged) {
                    const baseName = this.extractBaseName(editedFullName, payload.Product);
                    console.log(`🔄 [SendAllData] Updating Name: "${payload.Product.Name}" → "${baseName}" (from edited: "${editedFullName}")`);
                    payload.Product.Name = baseName;
                    payload.Product.CompareName = oldName;
                    payload.Product.FullName = editedFullName;
                }
            }

            let basePriceToUse: number;
            if (basePriceChanged) {
                basePriceToUse = masterMatch.BasePrice;
                console.log(`✅ [SendAllData] BasePrice changed by user: ${masterMatch.FinalBasePrice} → ${masterMatch.BasePrice}`);
            } else {
                basePriceToUse = masterMatch.FinalBasePrice || masterMatch.BasePrice;
                console.log(`ℹ️ [SendAllData] BasePrice unchanged, using: ${basePriceToUse}`);
            }

            if (basePriceToUse !== undefined) {
                payload.Product.BasePrice = basePriceToUse;
                payload.Product.CompareBasePrice = oldBasePrice;
            }

            console.log('✏️ [SendAllData] Updated main product fields (Code/Name/BasePrice):', {
                Code: payload.Product.Code,
                CompareCode: payload.Product.CompareCode,
                Name: payload.Product.Name,
                CompareName: payload.Product.CompareName,
                BasePrice: payload.Product.BasePrice,
                CompareBasePrice: payload.Product.CompareBasePrice
            });
        }

        // Detect cost/onhand changes for split-call logic
        const costChanged = masterMatch?.Cost !== undefined && !numEq(masterMatch.Cost, oldCost);
        // ✅ FIX: Only treat OnHand as changed if user entered stock data (Box/Retail > 0).
        // Without stock input, local OnHand may be stale from IndexedDB (not synced after previous send),
        // causing accidental stock overwrite (e.g., KV=8, stale local=0 → sends 0, losing 8 units).
        const hasStockInput = (Number(masterMatch?.Box || 0) > 0 || Number(masterMatch?.Retail || 0) > 0);
        const onHandChanged = hasStockInput && masterMatch?.OnHand !== undefined && !numEq(masterMatch.OnHand, oldOnHand);
        console.log(`🔍 [SendAllData] costChanged=${costChanged}, onHandChanged=${onHandChanged}, hasStockInput=${hasStockInput}`);

        // Build ProductUnits (Code/Name/BasePrice only); collect Cost/OnHand for split-call
        interface UnitData { unit: any; matchCost: any; matchOnHand: any; oldCost: number; oldOnHand: number; hasStockInput: boolean; }
        const unitDataList: UnitData[] = [];

        if (Array.isArray(payload.Product.ProductUnits)) {
            payload.Product.ProductUnits = payload.Product.ProductUnits.map((unit: any) => {
                const unitCode = unit?.Code ?? unit?.ProductCode;
                let match = editedMap.get(String(unitCode));

                if (!match && unit.Id) {
                    for (const item of allEditedProducts) {
                        if (item.Id === unit.Id) {
                            match = item;
                            console.log(`✅ [SendAllData] Found unit by Id: ${unit.Id}`);
                            break;
                        }
                    }
                }

                console.log(`🔍 [SendAllData] Checking unit ${unitCode}: match =`, match ? 'FOUND' : 'NOT FOUND');

                if (match) {
                    const oldUnitCode = unitCode;
                    const oldUnitBasePrice = unit.BasePrice;
                    const oldUnitCost = unit.Cost;
                    const oldUnitOnHand = unit.OnHand;

                    const childBasePriceChanged = match.BasePrice !== undefined &&
                                                   match.FinalBasePrice !== undefined &&
                                                   match.BasePrice !== match.FinalBasePrice;

                    let unitBasePriceToUse: number;
                    if (childBasePriceChanged) {
                        unitBasePriceToUse = match.BasePrice;
                    } else {
                        unitBasePriceToUse = match.FinalBasePrice || match.BasePrice;
                    }

                    console.log(`✅ [SendAllData] Updating unit ${unitCode}:`, {
                        OldCode: unitCode, NewCode: match.Code, Name: match.Name,
                        NewBasePrice: unitBasePriceToUse, OldBasePrice: oldUnitBasePrice,
                        BasePriceChanged: childBasePriceChanged,
                        NewCost: match.Cost, OldCost: oldUnitCost,
                        NewOnHand: match.OnHand, OldOnHand: oldUnitOnHand
                    });

                    if (match.Code && match.Code !== unitCode) {
                        console.log(`🔄 [SendAllData] Updating unit Code: ${unitCode} → ${match.Code}`);
                        if ('Code' in unit) { unit.Code = match.Code; unit.CompareCode = oldUnitCode; }
                        if ('ProductCode' in unit) { unit.ProductCode = match.Code; }
                    }

                    {
                        const editedUnitFullName = match.Name;
                        const kvUnitFullName = unit.FullName || '';
                        const hasOrigName = !!(match as any).OriginalName;
                        const unitNameChanged = hasOrigName
                            ? (match as any).OriginalName !== editedUnitFullName
                            : (editedUnitFullName && 'Name' in unit &&
                               editedUnitFullName !== kvUnitFullName && editedUnitFullName !== unit.Name);

                        if (unitNameChanged && editedUnitFullName) {
                            const unitBaseName = this.extractBaseName(editedUnitFullName, unit);
                            console.log(`🔄 [SendAllData] Updating unit Name: "${unit.Name}" → "${unitBaseName}" (from edited: "${editedUnitFullName}")`);
                            const oldUnitName = unit.Name;
                            unit.Name = unitBaseName;
                            if ('CompareName' in unit) { unit.CompareName = oldUnitName; }
                            if ('FullName' in unit) { unit.FullName = editedUnitFullName; }
                        }
                    }

                    if (unitBasePriceToUse !== undefined) {
                        unit.BasePrice = unitBasePriceToUse;
                        unit.CompareBasePrice = oldUnitBasePrice;
                        if ('Price' in unit) { unit.Price = unitBasePriceToUse; }
                    }

                    // Track for Cost/OnHand split-call (applied below)
                    // ✅ FIX: Also treat unit as having stock input when its OnHand was recalculated
                    // from master's Box/Retail (Edited=true, OnHand differs from KiotViet payload)
                    const unitDirectStock = (Number(match.Box || 0) > 0 || Number(match.Retail || 0) > 0);
                    const unitOnHandRecalculated = match.Edited && match.OnHand !== undefined && !numEq(match.OnHand, oldUnitOnHand);
                    unitDataList.push({
                        unit, matchCost: match.Cost, matchOnHand: match.OnHand,
                        oldCost: oldUnitCost, oldOnHand: oldUnitOnHand,
                        hasStockInput: unitDirectStock || unitOnHandRecalculated
                    });
                }

                return unit;
            });
        }

        // Apply Cost/OnHand with split-call logic
        let response: any;

        if (costChanged && onHandChanged) {
            // Case C: 2 API calls — Call 1: Cost (CB), OnHand unchanged (no KK)
            if (masterMatch) {
                payload.Product.Cost = masterMatch.Cost;
                payload.Product.CompareCost = oldCost;
                payload.Product.OnHand = oldOnHand;
                payload.Product.CompareOnHand = oldOnHand;
            }
            unitDataList.forEach(({ unit, matchCost, oldCost: uOC, oldOnHand: uOOH }) => {
                if (matchCost !== undefined) { unit.Cost = matchCost; unit.CompareCost = uOC; }
                unit.OnHand = uOOH; unit.CompareOnHand = uOOH;
            });

            console.log('🚀 [SendAllData] Call 1/2 — Cost (CB), product Id:', payload.Product.Id);
            await this.kiotvietService.updateProductToKiotviet(payload);

            // Call 2: OnHand (KK), Cost unchanged (no CB)
            if (masterMatch) {
                payload.Product.CompareCost = masterMatch.Cost;          // same → no CB
                payload.Product.OnHand = masterMatch.OnHand;
                payload.Product.CompareOnHand = oldOnHand;
                payload.Product.CompareBasePrice = payload.Product.BasePrice; // same → no dup
            }
            unitDataList.forEach(({ unit, matchOnHand, oldOnHand: uOOH }) => {
                unit.CompareCost = unit.Cost;                             // same → no CB
                if (matchOnHand !== undefined) { unit.OnHand = matchOnHand; unit.CompareOnHand = uOOH; }
            });

            console.log('🚀 [SendAllData] Call 2/2 — OnHand (KK), product Id:', payload.Product.Id);
            response = await this.kiotvietService.updateProductToKiotviet(payload);

        } else if (costChanged) {
            // Case A: Cost only (CB, no KK)
            if (masterMatch) {
                payload.Product.Cost = masterMatch.Cost;
                payload.Product.CompareCost = oldCost;
                // ✅ FIX: Use KiotViet's fresh OnHand when user didn't enter stock data
                const oh = hasStockInput ? (masterMatch.OnHand ?? oldOnHand) : oldOnHand;
                payload.Product.OnHand = oh;
                payload.Product.CompareOnHand = oh; // same → no KK
            }
            unitDataList.forEach(({ unit, matchCost, oldCost: uOC, matchOnHand, oldOnHand: uOOH, hasStockInput: unitHasStock }) => {
                if (matchCost !== undefined) { unit.Cost = matchCost; unit.CompareCost = uOC; }
                const oh = unitHasStock ? (matchOnHand ?? uOOH) : uOOH;
                unit.OnHand = oh; unit.CompareOnHand = oh; // same → no KK
            });

            console.log('🚀 [SendAllData] Single call — Cost (CB), product Id:', payload.Product.Id);
            response = await this.kiotvietService.updateProductToKiotviet(payload);

        } else {
            // Case B: OnHand only (KK, no CB) — or nothing changed
            if (masterMatch) {
                const c = masterMatch.Cost ?? payload.Product.Cost;
                payload.Product.Cost = c;
                payload.Product.CompareCost = c; // same → no CB
                if (masterMatch.OnHand !== undefined) {
                    // ✅ FIX: Use KiotViet's fresh OnHand when user didn't enter stock data
                    const effectiveOnHand = hasStockInput ? masterMatch.OnHand : oldOnHand;
                    payload.Product.OnHand = effectiveOnHand;
                    payload.Product.CompareOnHand = onHandChanged ? oldOnHand : effectiveOnHand;
                }
            }
            unitDataList.forEach(({ unit, matchCost, matchOnHand, oldOnHand: uOOH, hasStockInput: unitHasStock }) => {
                const c = matchCost ?? unit.Cost;
                unit.Cost = c; unit.CompareCost = c; // same → no CB
                if (matchOnHand !== undefined) {
                    const effectiveOnHand = unitHasStock ? matchOnHand : uOOH;
                    unit.OnHand = effectiveOnHand;
                    unit.CompareOnHand = (unitHasStock && !numEq(matchOnHand, uOOH)) ? uOOH : effectiveOnHand;
                }
            });

            console.log('🚀 [SendAllData] Single call — OnHand/None, product Id:', payload.Product.Id);
            response = await this.kiotvietService.updateProductToKiotviet(payload);
        }

        console.log('✅ [SendAllData] Response from KiotViet:', response);
        if (response) {
            console.log('✅ [SendAllData] Successfully sent to KiotViet!');
        } else {
            console.error('❌ [SendAllData] KiotViet returned empty response');
        }
        return response;
    }

    /**
     * Send SINGLE group (1 master + its children) to KiotViet API.
     * Splits Cost and OnHand into separate calls when both change to produce distinct CB/KK documents.
     * IMPORTANT: For sub unit products, we must get payload from MasterUnitId (real master)
     *            to ensure ProductUnits array is populated correctly
     */
    async sendSingleGroupData(masterProduct: any, childProducts: any[]): Promise<any> {
        console.log('🔵 [SendSingleGroup] Master product:', {
            Id: masterProduct.Id,
            Code: masterProduct.Code,
            BasePrice: masterProduct.BasePrice,
            Cost: masterProduct.Cost,
            MasterUnitId: masterProduct.MasterUnitId
        });
        console.log('🔵 [SendSingleGroup] Child products count:', childProducts.length);

        let productIdForPayload = masterProduct.Id;
        if (masterProduct.MasterUnitId) {
            productIdForPayload = masterProduct.MasterUnitId;
            console.log(`⚠️ [SendSingleGroup] Product is sub unit, using MasterUnitId=${productIdForPayload} for payload`);
        }

        const payload = await this.kiotvietService.getRequestBody(productIdForPayload);

        if (!payload?.Product) {
            throw new Error(`Không thể lấy dữ liệu sản phẩm từ KiotViet cho Id=${masterProduct.Id}`);
        }

        console.log('🟢 [SendSingleGroup] Payload from KiotViet:', {
            ProductId: payload.Product.Id,
            ProductCode: payload.Product.Code,
            Product_BasePrice: payload.Product.BasePrice,
            Product_Cost: payload.Product.Cost,
            Product_OnHand: payload.Product.OnHand,
            ProductUnitsCount: payload.Product.ProductUnits?.length || 0
        });

        const allEdited = [masterProduct, ...childProducts];
        const editedMap = new Map<string, any>();
        allEdited.forEach((item) => {
            const key = item?.OriginalCode ?? item?.Code;
            if (key) {
                editedMap.set(String(key), item);
            }
        });

        const editedByIdMap = new Map<number, any>();
        allEdited.forEach((item) => {
            if (item.Id) {
                editedByIdMap.set(item.Id, item);
            }
        });

        console.log('🟡 [SendSingleGroup] editedMap keys:', Array.from(editedMap.keys()));

        // Helper: numeric equality (rounded) — used to detect real cost/onhand changes
        const numEq = (a: any, b: any) => Math.round(Number(a)) === Math.round(Number(b));

        const oldCode = payload.Product.Code;
        const oldName = payload.Product.Name;
        const oldBasePrice = payload.Product.BasePrice;
        const oldCost = payload.Product.Cost;
        const oldOnHand = payload.Product.OnHand;

        let masterMatch = editedByIdMap.get(payload.Product.Id);
        if (!masterMatch) {
            masterMatch = editedMap.get(String(payload.Product.Code));
        }

        const basePriceChanged = masterMatch?.BasePrice !== undefined &&
                                  masterMatch?.FinalBasePrice !== undefined &&
                                  masterMatch.BasePrice !== masterMatch.FinalBasePrice;

        if (masterMatch) {
            if (masterMatch.Code && masterMatch.Code !== payload.Product.Code) {
                console.log(`🔄 [SendSingleGroup] Updating Code: ${payload.Product.Code} → ${masterMatch.Code}`);
                payload.Product.Code = masterMatch.Code;
                payload.Product.CompareCode = oldCode;
            }

            {
                const editedFullName = masterMatch.Name;
                const kvFullName = payload.Product.FullName || '';
                const hasOriginalName = !!(masterMatch as any).OriginalName;
                const nameActuallyChanged = hasOriginalName
                    ? (masterMatch as any).OriginalName !== editedFullName
                    : (editedFullName !== kvFullName && editedFullName !== payload.Product.Name);

                if (editedFullName && nameActuallyChanged) {
                    const baseName = this.extractBaseName(editedFullName, payload.Product);
                    console.log(`🔄 [SendSingleGroup] Updating Name: "${payload.Product.Name}" → "${baseName}" (from edited: "${editedFullName}")`);
                    payload.Product.Name = baseName;
                    payload.Product.CompareName = oldName;
                    payload.Product.FullName = editedFullName;
                }
            }

            let basePriceToUse: number;
            if (basePriceChanged) {
                basePriceToUse = masterMatch.BasePrice;
                console.log(`✅ [SendSingleGroup] BasePrice changed by user: ${masterMatch.FinalBasePrice} → ${masterMatch.BasePrice}`);
            } else {
                basePriceToUse = masterMatch.FinalBasePrice || masterMatch.BasePrice;
                console.log(`ℹ️ [SendSingleGroup] BasePrice unchanged, using: ${basePriceToUse}`);
            }

            if (basePriceToUse !== undefined) {
                payload.Product.BasePrice = basePriceToUse;
                payload.Product.CompareBasePrice = oldBasePrice;
            }

            console.log('✏️ [SendSingleGroup] Updated main product fields (Code/Name/BasePrice):', {
                Code: payload.Product.Code,
                Name: payload.Product.Name,
                BasePrice: payload.Product.BasePrice
            });
        }

        // Detect cost/onhand changes for split-call logic
        const costChanged = masterMatch?.Cost !== undefined && !numEq(masterMatch.Cost, oldCost);
        // ✅ FIX: Only treat OnHand as changed if user entered stock data (Box/Retail > 0).
        // Without stock input, local OnHand may be stale from IndexedDB (not synced after previous send),
        // causing accidental stock overwrite (e.g., KV=8, stale local=0 → sends 0, losing 8 units).
        const hasStockInput = (Number(masterMatch?.Box || 0) > 0 || Number(masterMatch?.Retail || 0) > 0);
        const onHandChanged = hasStockInput && masterMatch?.OnHand !== undefined && !numEq(masterMatch.OnHand, oldOnHand);
        console.log(`🔍 [SendSingleGroup] costChanged=${costChanged}, onHandChanged=${onHandChanged}, hasStockInput=${hasStockInput}`);

        // Build ProductUnits (Code/Name/BasePrice only); collect Cost/OnHand for split-call
        interface UnitData { unit: any; matchCost: any; matchOnHand: any; oldCost: number; oldOnHand: number; hasStockInput: boolean; }
        const unitDataList: UnitData[] = [];

        if (Array.isArray(payload.Product.ProductUnits)) {
            payload.Product.ProductUnits = payload.Product.ProductUnits.map((unit: any) => {
                let match = editedByIdMap.get(unit.Id);
                if (!match) {
                    const unitCode = unit?.Code ?? unit?.ProductCode;
                    match = editedMap.get(String(unitCode));
                }

                console.log(`🔍 [SendSingleGroup] Checking unit Id=${unit.Id}, Code=${unit.Code}: match =`, match ? 'FOUND' : 'NOT FOUND');

                if (match) {
                    const oldUnitCode = unit.Code ?? unit.ProductCode;
                    const oldUnitBasePrice = unit.BasePrice;
                    const oldUnitCost = unit.Cost;
                    const oldUnitOnHand = unit.OnHand;

                    const childBasePriceChanged = match.BasePrice !== undefined &&
                                                   match.FinalBasePrice !== undefined &&
                                                   match.BasePrice !== match.FinalBasePrice;

                    let unitBasePriceToUse: number;
                    if (childBasePriceChanged) {
                        unitBasePriceToUse = match.BasePrice;
                    } else {
                        unitBasePriceToUse = match.FinalBasePrice || match.BasePrice;
                    }

                    console.log(`✅ [SendSingleGroup] Updating unit ${unit.Code}:`, {
                        OldCode: oldUnitCode, NewCode: match.Code, Name: match.Name,
                        NewBasePrice: unitBasePriceToUse, BasePriceChanged: childBasePriceChanged,
                        NewCost: match.Cost, NewOnHand: match.OnHand
                    });

                    if (match.Code && match.Code !== oldUnitCode) {
                        console.log(`🔄 [SendSingleGroup] Updating unit Code: ${oldUnitCode} → ${match.Code}`);
                        if ('Code' in unit) { unit.Code = match.Code; unit.CompareCode = oldUnitCode; }
                        if ('ProductCode' in unit) { unit.ProductCode = match.Code; }
                    }

                    {
                        const editedUnitFullName = match.Name;
                        const kvUnitFullName = unit.FullName || '';
                        const hasOrigName = !!(match as any).OriginalName;
                        const unitNameChanged = hasOrigName
                            ? (match as any).OriginalName !== editedUnitFullName
                            : (editedUnitFullName && 'Name' in unit &&
                               editedUnitFullName !== kvUnitFullName && editedUnitFullName !== unit.Name);

                        if (unitNameChanged && editedUnitFullName) {
                            const unitBaseName = this.extractBaseName(editedUnitFullName, unit);
                            console.log(`🔄 [SendSingleGroup] Updating unit Name: "${unit.Name}" → "${unitBaseName}" (from edited: "${editedUnitFullName}")`);
                            const oldUnitName = unit.Name;
                            unit.Name = unitBaseName;
                            if ('CompareName' in unit) { unit.CompareName = oldUnitName; }
                            if ('FullName' in unit) { unit.FullName = editedUnitFullName; }
                        }
                    }

                    if (unitBasePriceToUse !== undefined) {
                        unit.BasePrice = unitBasePriceToUse;
                        unit.CompareBasePrice = oldUnitBasePrice;
                        if ('Price' in unit) { unit.Price = unitBasePriceToUse; }
                    }

                    // Track for Cost/OnHand split-call (applied below)
                    // ✅ FIX: Also treat unit as having stock input when its OnHand was recalculated
                    // from master's Box/Retail (Edited=true, OnHand differs from KiotViet payload)
                    const unitDirectStock = (Number(match.Box || 0) > 0 || Number(match.Retail || 0) > 0);
                    const unitOnHandRecalculated = match.Edited && match.OnHand !== undefined && !numEq(match.OnHand, oldUnitOnHand);
                    unitDataList.push({
                        unit, matchCost: match.Cost, matchOnHand: match.OnHand,
                        oldCost: oldUnitCost, oldOnHand: oldUnitOnHand,
                        hasStockInput: unitDirectStock || unitOnHandRecalculated
                    });
                }

                return unit;
            });
        }

        // Apply Cost/OnHand with split-call logic
        let response: any;

        if (costChanged && onHandChanged) {
            // Case C: 2 API calls — Call 1: Cost (CB), OnHand unchanged (no KK)
            if (masterMatch) {
                payload.Product.Cost = masterMatch.Cost;
                payload.Product.CompareCost = oldCost;
                payload.Product.OnHand = oldOnHand;
                payload.Product.CompareOnHand = oldOnHand;
            }
            unitDataList.forEach(({ unit, matchCost, oldCost: uOC, oldOnHand: uOOH }) => {
                if (matchCost !== undefined) { unit.Cost = matchCost; unit.CompareCost = uOC; }
                unit.OnHand = uOOH; unit.CompareOnHand = uOOH;
            });

            console.log('🚀 [SendSingleGroup] Call 1/2 — Cost (CB), product Id:', payload.Product.Id);
            await this.kiotvietService.updateProductToKiotviet(payload);

            // Call 2: OnHand (KK), Cost unchanged (no CB)
            if (masterMatch) {
                payload.Product.CompareCost = masterMatch.Cost;          // same → no CB
                payload.Product.OnHand = masterMatch.OnHand;
                payload.Product.CompareOnHand = oldOnHand;
                payload.Product.CompareBasePrice = payload.Product.BasePrice; // same → no dup
            }
            unitDataList.forEach(({ unit, matchOnHand, oldOnHand: uOOH }) => {
                unit.CompareCost = unit.Cost;                             // same → no CB
                if (matchOnHand !== undefined) { unit.OnHand = matchOnHand; unit.CompareOnHand = uOOH; }
            });

            console.log('🚀 [SendSingleGroup] Call 2/2 — OnHand (KK), product Id:', payload.Product.Id);
            response = await this.kiotvietService.updateProductToKiotviet(payload);

        } else if (costChanged) {
            // Case A: Cost only (CB, no KK)
            if (masterMatch) {
                payload.Product.Cost = masterMatch.Cost;
                payload.Product.CompareCost = oldCost;
                // ✅ FIX: Use KiotViet's fresh OnHand when user didn't enter stock data
                const oh = hasStockInput ? (masterMatch.OnHand ?? oldOnHand) : oldOnHand;
                payload.Product.OnHand = oh;
                payload.Product.CompareOnHand = oh; // same → no KK
            }
            unitDataList.forEach(({ unit, matchCost, oldCost: uOC, matchOnHand, oldOnHand: uOOH, hasStockInput: unitHasStock }) => {
                if (matchCost !== undefined) { unit.Cost = matchCost; unit.CompareCost = uOC; }
                const oh = unitHasStock ? (matchOnHand ?? uOOH) : uOOH;
                unit.OnHand = oh; unit.CompareOnHand = oh; // same → no KK
            });

            console.log('🚀 [SendSingleGroup] Single call — Cost (CB), product Id:', payload.Product.Id);
            response = await this.kiotvietService.updateProductToKiotviet(payload);

        } else {
            // Case B: OnHand only (KK, no CB) — or nothing changed
            if (masterMatch) {
                const c = masterMatch.Cost ?? payload.Product.Cost;
                payload.Product.Cost = c;
                payload.Product.CompareCost = c; // same → no CB
                if (masterMatch.OnHand !== undefined) {
                    // ✅ FIX: Use KiotViet's fresh OnHand when user didn't enter stock data
                    const effectiveOnHand = hasStockInput ? masterMatch.OnHand : oldOnHand;
                    payload.Product.OnHand = effectiveOnHand;
                    payload.Product.CompareOnHand = onHandChanged ? oldOnHand : effectiveOnHand;
                }
            }
            unitDataList.forEach(({ unit, matchCost, matchOnHand, oldOnHand: uOOH, hasStockInput: unitHasStock }) => {
                const c = matchCost ?? unit.Cost;
                unit.Cost = c; unit.CompareCost = c; // same → no CB
                if (matchOnHand !== undefined) {
                    const effectiveOnHand = unitHasStock ? matchOnHand : uOOH;
                    unit.OnHand = effectiveOnHand;
                    unit.CompareOnHand = (unitHasStock && !numEq(matchOnHand, uOOH)) ? uOOH : effectiveOnHand;
                }
            });

            console.log('🚀 [SendSingleGroup] Single call — OnHand/None, product Id:', payload.Product.Id);
            response = await this.kiotvietService.updateProductToKiotviet(payload);
        }

        console.log('✅ [SendSingleGroup] Response from KiotViet:', response);
        if (response) {
            console.log('✅ [SendSingleGroup] Successfully sent to KiotViet!');
        } else {
            console.error('❌ [SendSingleGroup] KiotViet returned empty response');
        }
        return response;
    }

    /**
     * Send single product group to KiotViet API
     */
    async sendProductData(editedProduct: any, remainEditedProducts: any[]): Promise<any> {
        console.log('🔵 [SendData] editedProduct (lowest ConversionValue):', {
            Id: editedProduct.Id,
            Code: editedProduct.Code,
            FullName: editedProduct.FullName,
            ConversionValue: editedProduct.ConversionValue,
            BasePrice: editedProduct.BasePrice,
            Cost: editedProduct.Cost
        });
        console.log('🔵 [SendData] remainEditedProducts:', remainEditedProducts.map(p => ({
            Id: p.Id,
            Code: p.Code,
            ConversionValue: p.ConversionValue
        })));

        // Get fresh payload from KiotViet API
        const payload = await this.kiotvietService.getRequestBody(editedProduct.Id);

        if (!payload?.Product) {
            throw new Error('Không thể lấy dữ liệu sản phẩm từ KiotViet');
        }

        console.log('🟢 [SendData] Payload from KiotViet:', {
            ProductId: payload.Product.Id,
            ProductCode: payload.Product.Code,
            Product_BasePrice: payload.Product.BasePrice,
            Product_CompareBasePrice: payload.Product.CompareBasePrice,
            Product_Cost: payload.Product.Cost,
            Product_CompareCost: payload.Product.CompareCost,
            Product_OnHand: payload.Product.OnHand,
            Product_CompareOnHand: payload.Product.CompareOnHand,
            ProductUnits: payload.Product.ProductUnits?.map((u: any) => ({
                Id: u.Id,
                Code: u.Code,
                Unit: u.Unit,
                ConversionValue: u.ConversionValue,
                BasePrice: u.BasePrice,
                CompareBasePrice: u.CompareBasePrice,
                Cost: u.Cost,
                OnHand: u.OnHand
            }))
        });

        // Create map of edited products using OriginalCode as key
        const allEdited = [editedProduct, ...remainEditedProducts];
        const editedMap = new Map<string, any>();

        allEdited.forEach((item) => {
            const key = item?.OriginalCode ?? item?.Code;
            if (key) {
                editedMap.set(String(key), item);
            }
        });

        console.log('🟡 [SendData] editedMap keys:', Array.from(editedMap.keys()));

        // Only update fields that exist in the payload and have changed
        // Update main product fields
        if (editedProduct.FullName) {
            payload.Product.FullName = editedProduct.FullName;
        }
        // Use FinalBasePrice if available, otherwise BasePrice
        const basePriceToUse = editedProduct.FinalBasePrice > 0 ? editedProduct.FinalBasePrice : editedProduct.BasePrice;
        if (basePriceToUse !== undefined) {
            payload.Product.BasePrice = basePriceToUse;
        }
        if (editedProduct.Cost !== undefined) {
            payload.Product.Cost = editedProduct.Cost;
        }
        // ✅ FIX: Only use local OnHand if user entered stock data (Box/Retail > 0)
        // Otherwise local OnHand may be stale from IndexedDB, overwriting KiotViet's current stock
        const hasStockInputForProduct = (Number(editedProduct.Box || 0) > 0 || Number(editedProduct.Retail || 0) > 0);
        if (editedProduct.OnHand !== undefined && hasStockInputForProduct) {
            payload.Product.OnHand = editedProduct.OnHand;
        }

        console.log('✏️ [SendData] Updated main product fields:', {
            FullName: payload.Product.FullName,
            BasePrice: payload.Product.BasePrice,
            Cost: payload.Product.Cost,
            OnHand: payload.Product.OnHand
        });

        // Update ProductUnits array (child products)
        if (Array.isArray(payload.Product.ProductUnits)) {
            payload.Product.ProductUnits = payload.Product.ProductUnits.map((unit: any) => {
                // Find matching edited product by Code
                const unitCode = unit?.Code ?? unit?.ProductCode;
                const match = editedMap.get(String(unitCode));

                console.log(`🔍 [SendData] Checking unit ${unitCode}: match =`, match ? 'FOUND' : 'NOT FOUND');

                if (match) {
                    // Use FinalBasePrice if available, otherwise BasePrice
                    const unitBasePriceToUse = match.FinalBasePrice > 0 ? match.FinalBasePrice : match.BasePrice;

                    console.log(`✅ [SendData] Updating unit ${unitCode}:`, {
                        FullName: match.FullName,
                        BasePrice: unitBasePriceToUse,
                        Cost: match.Cost,
                        OnHand: match.OnHand
                    });

                    // Update all fields - add them even if they don't exist in the payload
                    if (match.FullName && 'FullName' in unit) {
                        unit.FullName = match.FullName;
                    }
                    if (match.FullName && 'ProductName' in unit) {
                        unit.ProductName = match.FullName;
                    }
                    if (unitBasePriceToUse !== undefined) {
                        unit.BasePrice = unitBasePriceToUse;
                        if ('Price' in unit) {
                            unit.Price = unitBasePriceToUse;
                        }
                    }
                    // ALWAYS add Cost and OnHand, even if not in original payload
                    if (match.Cost !== undefined) {
                        unit.Cost = match.Cost;
                    }
                    // ✅ FIX: Only use local OnHand if user entered stock data
                    const unitHasStockInput = (Number(match.Box || 0) > 0 || Number(match.Retail || 0) > 0);
                    if (match.OnHand !== undefined && unitHasStockInput) {
                        unit.OnHand = match.OnHand;
                    }
                }

                return unit;
            });
        }

        console.log('🚀 [SendData] Final payload being sent to KiotViet:', JSON.stringify(payload, null, 2));

        await this.kiotvietService.updateProductToKiotviet(payload);
    }

}
