export function showEditedProducts(searchTerm: string, filteredProducts: any[]) {
    const cachedEditedProducts = localStorage.getItem(`edited_${searchTerm}`);
    if (cachedEditedProducts) {
        filteredProducts = JSON.parse(cachedEditedProducts);
        console.log('Hiển thị các sản phẩm đã chỉnh sửa:', filteredProducts);
    } else {
        console.log('Không có sản phẩm nào đã chỉnh sửa.');
        filteredProducts = [];
    }
}