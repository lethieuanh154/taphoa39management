import { catchError, forkJoin, map, Observable, of, switchMap } from "rxjs";
import { assignColorsToProductList } from "../utility-functions/app.color";
import { sortByGroup } from "../utility-functions/app.sort";
import { groupProducts } from "../utility-functions/app.group-item";
import { environment } from '../../../../environments/environment';
import { HttpClient } from "@angular/common/http";

interface Product {
    Image: string;
    Code: string;
    FullName: string;
    Name: string;
    AverageCheckPoint: false,
    BasePrice: number;
    FinalBasePrice: number,
    OnHand: number;
    Cost: number;
    PackCost: number;
    OriginalBoxPrice: number;
    Description: string;
    Unit: string;
    PackingSpec: number;
    UnitSpec: number;
    Retail: number;
    Box: number;
    Discount: number;
    Discount2: number;
    TotalPrice: number;
    ListProduct: [];
    ConversionValue: number;
    GroupName: string;
    Edited: boolean;
    Master: boolean;
    Id: number
}

const item_search_url="/api/kiotviet/item/"

export function onSearch(
    http: HttpClient,
    productColors: Record<string, string>,
    filteredProducts: Product[],
    setLoading: (loading: boolean) => void,
    searchTerm: string,
    loadData: (data: Product[]) => void
) {
    if (!searchTerm) {
        filteredProducts = [];
        loadData(filteredProducts);
        return;
    }

    // Try to get data from localStorage first
    const cachedData = getCachedData(searchTerm);
    if (cachedData) {
        handleCachedData(cachedData, filteredProducts, productColors, setLoading, loadData,);
        return;
    }

    // If no cached data, fetch from API
    fetchFromAPI(http, searchTerm, productColors, filteredProducts, setLoading, loadData);
}

function getCachedData(searchTerm: string): Record<string, Product[]> | null {
    const st = searchTerm.replace(/ /g, '_');
    const groupedKey = `grouped_${st}`;
    const groupedData = localStorage.getItem(groupedKey);

    if (groupedData) {
        return JSON.parse(groupedData);
    }
    return null;
}

function handleCachedData(
    cachedData: Record<string, Product[]>,
    filteredProducts: Product[],
    productColors: Record<string, string>,
    setLoading: (loading: boolean) => void,
    loadData: (data: Product[]) => void,
) {
    const seenIds = new Set<number>();
    filteredProducts = Object.values(cachedData).reduce((acc, group) => {
        if (!Array.isArray(group)) {
            return acc;
        }

        group.forEach((product) => {
            if (!product || typeof product.Id !== 'number') {
                return;
            }

            if (!seenIds.has(product.Id)) {
                acc.push(product);
                seenIds.add(product.Id);
            }
        });

        return acc;
    }, [] as Product[]);

    assignColorsToProductList(filteredProducts, productColors);
    filteredProducts = sortByGroup(filteredProducts);
    setLoading(false)
    loadData(filteredProducts);
}

function fetchFromAPI(
    http: any,
    searchTerm: string,
    productColors: Record<string, string>,
    filteredProducts: Product[],
    setLoading: (loading: boolean) => void,
    loadData: (data: Product[]) => void
) {
    setLoading(true);
    const st = searchTerm.replace(/ /g, '_');

    http.get(`${environment.domainUrl}${item_search_url}${searchTerm}`).pipe(
        switchMap((data: any[]) => {
            const products = transformApiData(data);
            const requests: Observable<Product[]>[] = [];

            const fetchedCodes = new Set<string>(); // Để lưu những item.Code đã gọi API

            products.forEach((product) => {
                if (product.ListProduct && product.ListProduct.length > 0) {
                    product.ListProduct.forEach((item: any) => {
                        const exists = products.some(p => p.Code === item.Code);
                        const alreadyFetched = fetchedCodes.has(item.Code);

                        if (!exists && !alreadyFetched) {
                            console.log(`Không tìm thấy item ${item.Code} từ KiotViet API`);

                            fetchedCodes.add(item.Code); // Đánh dấu đã fetch

                            // Push observable request vào mảng
                            requests.push(
                                http.get(`${environment.domainUrl}${item_search_url}${item.Code}`).pipe(
                                    map((res: Product[]) => res[0])
                                )
                            );
                        }
                    });
                }
            });


            // Nếu không có request nào => trả về nguyên products
            if (requests.length === 0) {
                return of(products);
            }

            // Đợi tất cả request hoàn tất rồi merge vào products
            return forkJoin(requests).pipe(
                map((results: any[][]) => {
                    const c = transformApiData(results);

                    c.forEach((childArray) => {
                        if (childArray) {
                            products.push(childArray);
                        }
                    });

                    return products;
                })
            );
        }),
        map((products: Product[]) => {
            const groupedProducts = groupProducts(products);

            localStorage.setItem(`grouped_${st}`, JSON.stringify(groupedProducts));


            return products;
        }),
        catchError((err) => {
            console.error('❌ Lỗi khi tìm kiếm:', err);
            setLoading(false);
            return of([]);
        })
    ).subscribe((products: Product[]) => {

        const newProducts = processProducts(products, searchTerm);
        filteredProducts = newProducts;

        assignColorsToProductList(filteredProducts, productColors);
        filteredProducts = sortByGroup(filteredProducts);

        localStorage.setItem(`search_${st}`, JSON.stringify(products));

        setLoading(false);
        loadData(filteredProducts);
    });


}

function transformApiData(data: any[]): Product[] {
    return data.map(item => ({
        Image: item.Image,
        Name: item.Name,
        Code: item.Code,
        FullName: item.Name,
        AverageCheckPoint: item.AverageCheckPoint || false,
        BasePrice: item.BasePrice || 0,
        FinalBasePrice: item.FinalBasePrice || 0,
        OnHand: item.OnHand || 0,
        Cost: item.Cost || 0,
        PackCost: item.PackCost || 0,
        OriginalBoxPrice: item.OriginalBoxPrice || 0,
        Description: item.Description ? item.Description.replace(/<\/?[^>]+(>|$)/g, '') : '',
        Unit: item.Unit || '',
        PackingSpec: item.PackingSpec || 0,
        UnitSpec: item.UnitSpec || 0,
        Retail: item.Retail || 0,
        Box: item.Box || 0,
        Discount: item.Discount || 0,
        Discount2: item.Discoun2 || 0,
        TotalPrice: item.TotalPrice || 0,
        ListProduct: item.ListProductUnit || 0,
        ConversionValue: item.ConversionValue || 0,
        GroupName: item.Name,
        Edited: false,
        Master: false,
        Id: item.Id
    }));
}

function processProducts(_products: Product[], searchTerm: string): Product[] {
    const newProducts: Product[] = [];
    const seenIds = new Set<number>();
    const groupedKey = `grouped_${searchTerm.replace(/ /g, '_')}`;
    const groupedProductsResult = JSON.parse(localStorage.getItem(groupedKey) || '{}') as Record<string, Product[]>;

    Object.values(groupedProductsResult).forEach((group) => {
        if (!Array.isArray(group)) {
            return;
        }

        group.forEach((product) => {
            if (!product || typeof product.Id !== 'number') {
                return;
            }

            if (!seenIds.has(product.Id)) {
                newProducts.push(product);
                seenIds.add(product.Id);
            }
        });
    });

    // Apply edited data if exists
    const cachedEditedProducts = localStorage.getItem(`edited_${searchTerm}`);
    if (cachedEditedProducts) {
        const editedProducts = JSON.parse(cachedEditedProducts);
        newProducts.forEach((product) => {
            const editedProduct = editedProducts.find((p: Product) => p.Code === product.Code);
            if (editedProduct) {
                Object.assign(product, editedProduct);
            }
        });
    }

    return newProducts;
}


