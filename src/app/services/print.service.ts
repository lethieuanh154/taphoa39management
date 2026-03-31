import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class PrintService {
  
  printHtml(html: string): void {
    const printWindow = window.open('', '_blank', 'width=1200,height=800');
    if (!printWindow) return;

    printWindow.document.write(`
    <html>
      <head>
        <title>Hóa đơn</title>
        <style>
          body {
            font-family: Arial, sans-serif;
            font-size: 11px;
            margin: 0;
            padding: 10px;
          }
          table {
            width: 100%;
            border-collapse: collapse;
          }
       
          hr {
            border-top: 1px dashed black;
          }
        </style>
      </head>
      <body>
        ${html}
        <script>
          window.onload = function () {
            setTimeout(function () {
              window.print();
              window.close();
            }, 200); // chờ 200ms để nội dung render xong
          }
        </script>
      </body>
    </html>
  `);

    printWindow.document.close();
  }

}
