export function groupProducts(products: any[]): Record<string, any[]> {
    const groupedProducts: Record<string, any[]> = {};

    if (!Array.isArray(products) || products.length === 0) {
        return groupedProducts;
    }

    // ✅ Build lookup maps for faster access
    const productById = new Map<string, any>();
    const productByCode = new Map<string, any>();
    products.forEach((p) => {
        if (p?.Id) productById.set(String(p.Id), p);
        if (p?.Code) productByCode.set(p.Code, p);
    });

    const findByOriginalOrCurrentCode = (code: string | null | undefined) => {
        if (!code) {
            return undefined;
        }
        return products.find((p) => (p?.OriginalCode ?? p?.Code) === code);
    };

    // ✅ Helper: Find master product for a child (by MasterUnitId or ParentCode)
    const findMasterProduct = (product: any): any | undefined => {
        // 1. Try MasterUnitId first
        if (product?.MasterUnitId) {
            const master = productById.get(String(product.MasterUnitId));
            if (master) return master;
        }
        // 2. Try ParentCode
        if (product?.ParentCode) {
            const master = productByCode.get(product.ParentCode);
            if (master) return master;
        }
        // 3. Try CloneSourceId (for clone products)
        if (product?.CloneSourceId) {
            const master = productById.get(String(product.CloneSourceId));
            if (master) return master;
        }
        return undefined;
    };

    products.forEach((product) => {
        if (product) {
            product.Master = false;
        }

        // ✅ Determine group key: use master's code if this is a child, otherwise use own code
        let groupKey: string | undefined;
        const masterProduct = findMasterProduct(product);

        if (masterProduct) {
            // This is a child - group by master's code
            groupKey = masterProduct?.OriginalCode ?? masterProduct?.Code;
        } else {
            // This is a master or standalone - use own code
            groupKey = product?.ParentCode ?? product?.OriginalParentCode ?? product?.OriginalCode ?? product?.Code;
        }

        if (!groupKey) {
            return;
        }

        if (!groupedProducts[groupKey]) {
            groupedProducts[groupKey] = [];
        }

        const currentGroup = groupedProducts[groupKey];

        const ensureInGroup = (item: any) => {
            if (!item) {
                return;
            }
            if (!currentGroup.some((existing: any) => existing?.Id === item?.Id)) {
                currentGroup.push(item);
            }
        };

        ensureInGroup(product);

        // Also add master product to group if found
        if (masterProduct) {
            ensureInGroup(masterProduct);
        }

        if (Array.isArray(product?.ListProduct) && product.ListProduct.length > 0) {
            product.ListProduct.forEach((childProduct: any) => {
                const childOriginalCode = childProduct?.OriginalCode ?? childProduct?.Code;
                const matched = findByOriginalOrCurrentCode(childOriginalCode) ?? childProduct;

                if (matched && matched !== product) {
                    ensureInGroup(matched);
                }
            });
        }
    });

    Object.values(groupedProducts).forEach((group) => {
        if (group.length === 0) {
            return;
        }
        const masterCandidate = group.reduce((prev: any, curr: any) => {
            const prevConversion = Number(prev?.ConversionValue ?? 1);
            const currConversion = Number(curr?.ConversionValue ?? 1);

            return currConversion < prevConversion ? curr : prev;
        }, group[0]);

        if (masterCandidate) {
            masterCandidate.Master = true;
        }
    });

    return groupedProducts;
}