
export function sortByGroup(products: any[]): any[] {

  return products.sort((a, b) => {
    const nameA = a.FullName.toLowerCase(); // Chuyển tên về chữ thường để so sánh
    const nameB = b.FullName.toLowerCase();

    if (nameA < nameB) return -1; // Sắp xếp tăng dần
    if (nameA > nameB) return 1;
    return 0; // Nếu bằng nhau, giữ nguyên thứ tự
  });
}
