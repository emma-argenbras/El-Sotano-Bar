// QR en el navegador: generar el pase del invitado y leerlo en la puerta.
// Se empaqueta igual que el SDK, servido desde nuestro dominio.
export { toDataURL as qrDataURL } from 'qrcode';
export { default as leerQR } from 'jsqr';
