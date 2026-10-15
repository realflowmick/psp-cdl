// SPDX-License-Identifier: Apache-2.0
// jsdom lacks the layout APIs React Flow measures with. These stand-ins give every element a
// non-zero size so nodes and edges render; positions are not meaningful.
class ResizeObserverStub {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(target: Element) {
    const contentRect = { x: 0, y: 0, top: 0, left: 0, width: 1000, height: 700, right: 1000, bottom: 700 } as DOMRectReadOnly;
    // Resizable panels read the box sizes rather than contentRect.
    const size = [{ inlineSize: 1000, blockSize: 700 }];
    this.callback([{ target, contentRect, borderBoxSize: size, contentBoxSize: size, devicePixelContentBoxSize: size } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver);
  }
  unobserve() {}
  disconnect() {}
}
class DOMMatrixReadOnlyStub {
  m22: number;
  constructor(transform?: string) { const scale = transform?.match(/scale\(([1-9.])\)/)?.[1]; this.m22 = scale !== undefined ? +scale : 1; }
}
let installed = false;
export function mockReactFlow(): void {
  if (installed) return;
  installed = true;
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
  (globalThis as { DOMMatrixReadOnly?: unknown }).DOMMatrixReadOnly = DOMMatrixReadOnlyStub;
  Object.defineProperties(HTMLElement.prototype, {
    offsetHeight: { configurable: true, get() { return parseFloat((this as HTMLElement).style.height) || 80; } },
    offsetWidth: { configurable: true, get() { return parseFloat((this as HTMLElement).style.width) || 230; } }
  });
  (SVGElement.prototype as unknown as { getBBox(): DOMRect }).getBBox = () => ({ x: 0, y: 0, width: 0, height: 0 }) as DOMRect;
  if (!window.matchMedia) {
    window.matchMedia = (query: string) => ({ matches: false, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false }) as MediaQueryList;
  }
}
