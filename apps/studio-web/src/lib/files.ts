// SPDX-License-Identifier: Apache-2.0
/** Browser file helpers: read what the user picked, and hand text back as a download or clipboard copy. */
export function readAsBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ""));
    reader.onerror = () => reject(reader.error ?? new Error("The file could not be read."));
    reader.readAsDataURL(file);
  });
}
export function readAsText(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("The file could not be read."));
    reader.readAsText(file);
  });
}
export function download(name: string, text: string, type = "text/plain;charset=utf-8"): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function copyText(text: string): Promise<void> {
  if (!navigator.clipboard?.writeText) throw new Error("The clipboard is not available in this browser.");
  await navigator.clipboard.writeText(text);
}
export const baseName = (path: string): string => path.slice(path.lastIndexOf("/") + 1);
/** Same path with a different extension, for example support.psp to support.pspx. */
export const withExtension = (path: string, extension: string): string => path.replace(/\.[^./]*$/, "") + extension;
