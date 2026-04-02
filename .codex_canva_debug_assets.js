const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1400 } });
  await page.goto('file:///tmp/canva_frame_case_pretty.html', { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(1500);
  const data = await page.evaluate(async () => {
    const isInsideForeignLayer = (element, ownerNode) => {
      const layerAncestor = element?.closest?.('[id^="LB"]');
      if (!layerAncestor) return false;
      if (!ownerNode) return true;
      return layerAncestor !== ownerNode;
    };
    const getScopedImageElements = (node) => Array.from(node.querySelectorAll('img, image')).filter((element) => !isInsideForeignLayer(element, node));
    const hasRenderableSvgContent = (svgElement) => {
      if (!(svgElement instanceof SVGElement)) return false;
      const renderableTags = ['path','rect','circle','ellipse','line','polyline','polygon','image','text','use'];
      return renderableTags.some((tagName) => Array.from(svgElement.querySelectorAll(tagName)).some((candidate) => !candidate.closest('defs')));
    };
    const findBestSvgRenderCandidate = (layerNode) => {
      if (!layerNode) return null;
      const candidates = [
        ...(String(layerNode.tagName || '').toLowerCase() === 'svg' ? [layerNode] : []),
        ...Array.from(layerNode.querySelectorAll('svg')).filter((candidate) => !isInsideForeignLayer(candidate, layerNode)),
      ];
      let best = null;
      let bestArea = 0;
      candidates.forEach((candidate) => {
        if (!(candidate instanceof SVGElement)) return;
        if (!hasRenderableSvgContent(candidate)) return;
        const rect = candidate.getBoundingClientRect();
        const style = getComputedStyle(candidate);
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity || 1) <= 0.01) return;
        const area = Math.max(1, rect.width * rect.height);
        if (area > bestArea) { best = candidate; bestArea = area; }
      });
      return best;
    };
    const copyComputedSvgStyles = (sourceNode, targetNode) => {
      if (!(sourceNode instanceof Element) || !(targetNode instanceof Element)) return;
      try {
        const computed = window.getComputedStyle(sourceNode);
        ['fill','fill-rule','fill-opacity','stroke','clip-rule','stroke-opacity','stroke-width','stroke-linecap','stroke-linejoin','stroke-dasharray','stroke-dashoffset','opacity','filter','clip-path','mask','transform','transform-origin','mix-blend-mode'].forEach((property) => {
          const value = computed.getPropertyValue(property);
          if (value) targetNode.style.setProperty(property, value);
        });
      } catch (_error) {}
      const sourceChildren = Array.from(sourceNode.children || []);
      const targetChildren = Array.from(targetNode.children || []);
      const childCount = Math.min(sourceChildren.length, targetChildren.length);
      for (let index = 0; index < childCount; index += 1) {
        copyComputedSvgStyles(sourceChildren[index], targetChildren[index]);
      }
    };
    const serializeSvgElementToDataUrl = (svgElement, targetWidth, targetHeight) => {
      if (!(svgElement instanceof SVGElement)) return '';
      try {
        const clone = svgElement.cloneNode(true);
        copyComputedSvgStyles(svgElement, clone);
        const rect = svgElement.getBoundingClientRect();
        const width = Math.max(1, Math.round(targetWidth || rect.width || 1));
        const height = Math.max(1, Math.round(targetHeight || rect.height || 1));
        clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
        clone.setAttribute('width', String(width));
        clone.setAttribute('height', String(height));
        if (!clone.getAttribute('viewBox')) clone.setAttribute('viewBox', `0 0 ${width} ${height}`);
        clone.setAttribute('preserveAspectRatio', clone.getAttribute('preserveAspectRatio') || 'none');
        const serialized = new XMLSerializer().serializeToString(clone);
        if (!serialized.includes('<svg')) return '';
        return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(serialized)}`;
      } catch (_error) {
        return '';
      }
    };
    const renderElementToDataUrl = (element, targetWidth, targetHeight) => {
      if (!element) return '';
      try {
        const elementWidth = Number(element.naturalWidth || element.width?.baseVal?.value || element.width || 0);
        const elementHeight = Number(element.naturalHeight || element.height?.baseVal?.value || element.height || 0);
        const width = Math.max(1, Math.round(targetWidth || elementWidth || 1));
        const height = Math.max(1, Math.round(targetHeight || elementHeight || 1));
        const rasterCanvas = document.createElement('canvas');
        rasterCanvas.width = width;
        rasterCanvas.height = height;
        const rasterContext = rasterCanvas.getContext('2d');
        if (!rasterContext) return '';
        rasterContext.drawImage(element, 0, 0, width, height);
        return rasterCanvas.toDataURL('image/png');
      } catch (error) {
        return `ERROR:${error?.message || 'unknown'}`;
      }
    };
    const ids = ['LBRtnfssFQdWJQl1','LBqYGlRfDMH47w8H','LB0GB3GfqpGb5MDQ','LBLgWb4kDYSFzrwf'];
    const result = [];
    for (const id of ids) {
      const node = document.getElementById(id);
      const imageElement = getScopedImageElements(node)[0] || null;
      const svgCandidate = findBestSvgRenderCandidate(node);
      const rect = node.getBoundingClientRect();
      const imageDataUrl = imageElement ? renderElementToDataUrl(imageElement, Math.round(rect.width), Math.round(rect.height)) : '';
      const svgDataUrl = svgCandidate ? serializeSvgElementToDataUrl(svgCandidate, Math.round(rect.width), Math.round(rect.height)) : '';
      result.push({
        id,
        imageElementTag: imageElement?.tagName || '',
        imageComplete: imageElement ? imageElement.complete : null,
        naturalWidth: imageElement ? Number(imageElement.naturalWidth || 0) : 0,
        naturalHeight: imageElement ? Number(imageElement.naturalHeight || 0) : 0,
        imageDataUrlPrefix: imageDataUrl.slice(0, 48),
        imageDataUrlLength: imageDataUrl.length,
        svgDataUrlPrefix: svgDataUrl.slice(0, 48),
        svgDataUrlLength: svgDataUrl.length,
      });
    }
    return result;
  });
  console.log(JSON.stringify(data, null, 2));
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
