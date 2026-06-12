
export function showNotification(mesage: string, type: 'success' | 'error' = 'success') {
    const notification = document.createElement('div');
    notification.innerText = mesage;
    notification.style.position = 'fixed';
    notification.style.bottom = '20px';
    notification.style.right = '-300px'; // Bắt đầu từ ngoài màn hình
    notification.style.backgroundColor = type === 'error' ? '#f44336' : '#4caf50';
    notification.style.color = 'white';
    notification.style.padding = '20px 20px';
    notification.style.borderRadius = '5px';
    notification.style.boxShadow = '0 2px 5px rgba(0, 0, 0, 0.3)';
    notification.style.zIndex = '1000';
    notification.style.fontSize = '20px';
    notification.style.transition = 'right 0.5s ease'; // Thêm hiệu ứng chuyển động
  
    document.body.appendChild(notification);
  
    // Kéo thông báo vào màn hình
    setTimeout(() => {
      notification.style.right = '20px';
    }, 10);
  
    // Xóa thông báo sau 2 giây
    setTimeout(() => {
      notification.style.right = '-300px'; // Kéo ra khỏi màn hình
      setTimeout(() => {
        document.body.removeChild(notification);
      }, 500); // Đợi hiệu ứng chuyển động hoàn tất trước khi xóa
    }, 2000);
  }