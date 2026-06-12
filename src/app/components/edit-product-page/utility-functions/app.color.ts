/**
 * Group products by Master's Id for color assignment
 * Products are already grouped and have Master flag set by ProductEditService
 * All products in the same unit group (same MasterUnitId chain) will have the same color
 */
function groupProductsByMaster(products: any[]): Record<string, any[]> {
    const grouped: Record<string, any[]> = {};

    // Build a map of all products by their MasterUnitId for quick lookup
    const productsByMasterUnitId = new Map<number, any[]>();
    const allProductsById = new Map<number, any>();

    products.forEach((product) => {
        allProductsById.set(product.Id, product);

        if (product.MasterUnitId !== null && product.MasterUnitId !== undefined) {
            if (!productsByMasterUnitId.has(product.MasterUnitId)) {
                productsByMasterUnitId.set(product.MasterUnitId, []);
            }
            productsByMasterUnitId.get(product.MasterUnitId)!.push(product);
        }
    });

    // Find the master for each product (Master flag is already set)
    const productToMaster = new Map<number, number>(); // productId -> masterId

    products.forEach((product) => {
        if (product.Master) {
            // This product IS the master
            productToMaster.set(product.Id, product.Id);

            // All products that share the same MasterUnitId should map to this master
            if (product.MasterUnitId !== null && product.MasterUnitId !== undefined) {
                const siblings = productsByMasterUnitId.get(product.MasterUnitId) || [];
                siblings.forEach(sibling => {
                    productToMaster.set(sibling.Id, product.Id);
                });
                // Also include the base unit (ConversionValue=1, MasterUnitId=null)
                const baseUnit = allProductsById.get(product.MasterUnitId);
                if (baseUnit) {
                    productToMaster.set(baseUnit.Id, product.Id);
                }
            }
        }
    });

    // Group all products by their master's Id
    products.forEach((product) => {
        let masterId = productToMaster.get(product.Id);

        if (!masterId) {
            // Fallback: try to find master through siblings
            if (product.MasterUnitId !== null && product.MasterUnitId !== undefined) {
                const siblings = productsByMasterUnitId.get(product.MasterUnitId) || [];
                const masterSibling = siblings.find(s => s.Master);
                masterId = masterSibling ? masterSibling.Id : product.Id;
            } else {
                // This might be the base unit - find if any product has this as MasterUnitId
                const children = productsByMasterUnitId.get(product.Id) || [];
                const masterChild = children.find(c => c.Master);
                masterId = masterChild ? masterChild.Id : product.Id;
            }
        }

        const groupKey = String(masterId);

        if (!grouped[groupKey]) {
            grouped[groupKey] = [];
        }
        grouped[groupKey].push(product);
    });

    return grouped;
}

function darkenColor(color: string): string {
    // Darken color by reducing all RGB components equally to maintain hue
    const colorValue = parseInt(color.slice(1), 16);
    const darkenAmount = 40; // Amount to darken (0-255)

    const r = Math.max((colorValue >> 16) - darkenAmount, 0);
    const g = Math.max(((colorValue >> 8) & 0x00ff) - darkenAmount, 0);
    const b = Math.max((colorValue & 0x0000ff) - darkenAmount, 0);

    return `#${(r << 16 | g << 8 | b).toString(16).padStart(6, '0')}`;
}

export function assignColorsToProductList(filteredProducts: any[], productColors: Record<string, string>) {
    // Group products by Master's Id (products already have Master flag set)
    const groupedProducts = groupProductsByMaster(filteredProducts);
    const colors = [
        '#e8edfb', // Màu xanh dương pastel
        '#eaf3e0', // Màu xanh lá pastel
        '#f6ede0', // Màu cam pastel
        '#fde0da', // Màu đỏ pastel
        '#ddf2f5', // Màu xanh ngọc pastel
        '#f5f4d0', // Màu vàng pastel
        '#f0e8e4', // Màu nâu pastel
        '#eeddf2', // Màu tím pastel
        '#e4e8eb', // Màu xám pastel
        '#fce0ea', // Màu hồng pastel
        '#fef0d0', // Màu vàng cam pastel
        '#d6edfa', // Màu xanh dương nhạt pastel
        '#e5f0d8', // Màu xanh lá cây pastel
        '#fdddd3', // Màu cam đỏ pastel
        '#eef2c8', // Màu xanh chanh pastel
        '#ddd4ee', // Màu tím đậm pastel
        '#d8ecf4', // Màu xanh biển pastel
        '#fbe8d2', // Màu cam sáng pastel
        '#f4e0e0', // Màu đỏ sáng pastel
    ];

    Object.keys(groupedProducts).forEach((groupKey, index) => {
        const groupColor = colors[index % colors.length];
        const darkerColor = darkenColor(groupColor);

        groupedProducts[groupKey].forEach((product: any) => {
            // Use Id as key for color mapping - it's immutable and unique
            // This ensures color persists even if user edits the Code field
            const colorKey = String(product.Id);

            if (product.Master) {
                // Master gets darker color
                productColors[colorKey] = darkerColor;
            } else {
                // Child products get lighter color
                productColors[colorKey] = groupColor;
            }
        });
    });
}
