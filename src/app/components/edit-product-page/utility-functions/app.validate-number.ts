export function validateNumber(event: KeyboardEvent) {
  const allowedKeys = ['Backspace', 'ArrowLeft', 'ArrowRight', 'Delete', 'Tab'];

  const isCtrlOrMeta = event.ctrlKey || event.metaKey;
  const isCtrlCombination = isCtrlOrMeta && ['a', 'c', 'v', 'x'].includes(event.key.toLowerCase());

  // Cho phép các phím điều hướng, tổ hợp Ctrl (copy, paste, cut, select all)
  if (allowedKeys.includes(event.key) || isCtrlCombination) {
    return;
  }

  const isNumberOrSymbol = /^[0-9=+\-*/]$/.test(event.key);
  if (!isNumberOrSymbol) {
    event.preventDefault();
  }
}