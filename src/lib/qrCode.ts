import QRCode from "qrcode";

/** 把文本渲染为 QR 二维码图片（dataURL），局域网离线可用 */
export async function renderQrDataUrl(text: string, width = 220): Promise<string> {
  return QRCode.toDataURL(text, {
    width,
    margin: 1,
    color: { dark: "#1f2937", light: "#ffffff" },
  });
}