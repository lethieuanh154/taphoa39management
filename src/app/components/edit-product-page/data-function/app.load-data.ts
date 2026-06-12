import { catchError, map, of } from "rxjs";
import { sortByGroup } from "../utility-functions/app.sort";
import { environment } from '../../../../environments/environment';

export function loadData(
  category: string,
  http: any,
  setFilteredProducts: (products: any[]) => void, // Callback để cập nhật filteredProducts
  setLoading: (isLoading: boolean) => void, // Callback để cập nhật trạng thái loading
  setShowLowStockWarning: (show: boolean) => void // Callback để cập nhật cảnh báo tồn kho thấp
) {
  const cachedProducts = localStorage.getItem(`products_${category}`);
  setLoading(true); // Bắt đầu loading

  // Nếu có dữ liệu trong Local Storage, sử dụng dữ liệu đó
  if (cachedProducts) {
    const products = JSON.parse(cachedProducts);
    const sortedProducts = sortByGroup(products);
    setFilteredProducts(sortedProducts); // Cập nhật filteredProducts
    setShowLowStockWarning(
      sortedProducts.some(
        (product) => product.OnHand < 3 && !/thùng/i.test(product.Unit) && !/lốc/i.test(product.Unit)
      )
    );
    setLoading(false); // Kết thúc loading
    return;
  }

  const apiUrl = `${environment.domainUrl}/api/items/${category}`;

  if (category === 'all') {
    setFilteredProducts([]); // Xóa danh sách nếu chọn "TẤT CẢ"
    setLoading(false);
    setShowLowStockWarning(false); // Không có cảnh báo cho danh mục "TẤT CẢ"
    return;
  }

  http
    .get(apiUrl)
    .pipe(
      map((data: any) => {
        const products: any[] = [];
        data.forEach((item: any) => {
          if (item.UnitList && item.UnitList.length > 0) {
            // item.UnitList.forEach((unit: any) => {
            products.push({
              Image: item.Image || '',
              Code: item.Code || '',
              FullName: item.FullName || '',
              AverageCheckPoint: item.AverageCheckPoint || false,
              BasePrice: item.BasePrice || 0,
              FinalBasePrice: item.FinalBasePrice || 0,
              OnHand: item.OnHand || 0,
              Cost: item.LatestPurchasePrice || 0,
              PackCost: item.PackCost || 0,
              OriginalBoxPrice: item.OriginalBoxPrice || 0,
              Description: item.Description
                ? item.Description.replace(/<\/?[^>]+(>|$)/g, '')
                : '',
              Unit: item.UnitName || '',
              PackingSpec: item.PackingSpec || 0,
              UnitSpec: item.UnitSpec || 0,
              Retail: item.Retail || 0,
              Box: item.Box || 0,
              Discount: item.Discount || 0,
              Discoun2: item.Discount2 || 0,
              ConversionValue: item.ConversionValue || 0,
              TotalPrice: item.TotalPrice || 0,
              GroupName: item.Name,
              Edited: false,
              Master: false,
              Id: item.Id

            });
            // });
          } else {
            products.push({
              Image: item.Image,
              Code: item.Code,
              FullName: item.FullName,
              AverageCheckPoint: item.AverageCheckPoint || false,
              BasePrice: item.BasePrice || 0,
              FinalBasePrice: item.FinalBasePrice || 0,
              OnHand: item.OnHand || 0,
              Cost: item.Cost || 0,
              PackCost: item.PackCost || 0,
              OriginalBoxPrice: item.OriginalBoxPrice || 0,
              Description: item.Description
                ? item.Description.replace(/<\/?[^>]+(>|$)/g, '')
                : '',
              Unit: item.Unit || '',
              PackingSpec: item.PackingSpec || 0,
              UnitSpec: item.UnitSpec || 0,
              Retail: item.Retail || 0,
              Box: item.Box || 0,
              Discount: item.Discount || 0,
              Discount2: item.Discount2 || 0,
              ConversionValue: item.ConversionValue || 0,
              TotalPrice: item.TotalPrice || '0',
              GroupName: item.Name,
              Master: false,
              Id: item.Id
            });
          }
        });
        return products;
      }),
      catchError((err) => {
        console.error('❌ Lỗi API:', err);
        setLoading(false);
        return of([]);
      })
    )
    .subscribe((products: any[]) => {
      const sortedProducts = sortByGroup(products);
      setFilteredProducts(sortedProducts); // Cập nhật filteredProducts
      localStorage.setItem(`products_${category}`, JSON.stringify(products)); // Lưu sản phẩm vào Local Storage
      setShowLowStockWarning(
        sortedProducts.some(
          (product) => product.OnHand < 3 && !/thùng/i.test(product.Unit) && !/lốc/i.test(product.Unit)
        )
      );
      setLoading(false); // Kết thúc loading
    });
}