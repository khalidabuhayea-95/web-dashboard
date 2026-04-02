const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1400 } });
  await page.goto('file:///tmp/canva_frame_case_pretty.html', { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(1500);
  const data = await page.evaluate(() => {
    const visible = (element, rect) => {
      if (!element || !rect) return false;
      if (rect.width < 40 || rect.height < 40) return false;
      const style = window.getComputedStyle(element);
      return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0.01;
    };
    const pickLargestVisibleNode = (nodes) => {
      let best = null;
      (Array.isArray(nodes) ? nodes : []).forEach((node) => {
        if (!node || typeof node.getBoundingClientRect !== 'function') return;
        const rect = node.getBoundingClientRect();
        if (!visible(node, rect)) return;
        const area = rect.width * rect.height;
        if (!best || area > best.area) best = { node, rect, area };
      });
      return best;
    };
    const bestPage = pickLargestVisibleNode(Array.from(document.querySelectorAll('[data-page-id]')));
    const rect = bestPage.rect;
    const scaleRoot = bestPage.node.querySelector('div[style*="transform: scale"]');
    const parseStyleDimension = (styleText, key) => {
      const match = String(styleText || '').match(new RegExp(`${key}\\s*:\\s*([0-9.]+)px`, 'i'));
      const numeric = Number(match?.[1]);
      return Number.isFinite(numeric) ? numeric : 0;
    };
    const designWidth = parseStyleDimension(scaleRoot?.getAttribute('style') || '', 'width') || rect.width;
    const designHeight = parseStyleDimension(scaleRoot?.getAttribute('style') || '', 'height') || rect.height;
    const designScaleX = Math.max(0.0001, Number(designWidth || rect.width) / Math.max(Number(rect.width || 1), 1));
    const designScaleY = Math.max(0.0001, Number(designHeight || rect.height) / Math.max(Number(rect.height || 1), 1));

    const rectArea = (r) => Math.max(0, Number(r?.width || 0)) * Math.max(0, Number(r?.height || 0));
    const intersectRects = (a, b) => {
      if (!a || !b) return null;
      const left = Math.max(Number(a.left ?? a.x ?? 0), Number(b.left ?? b.x ?? 0));
      const top = Math.max(Number(a.top ?? a.y ?? 0), Number(b.top ?? b.y ?? 0));
      const right = Math.min(Number((a.left ?? a.x ?? 0) + (a.width ?? 0)), Number((b.left ?? b.x ?? 0) + (b.width ?? 0)));
      const bottom = Math.min(Number((a.top ?? a.y ?? 0) + (a.height ?? 0)), Number((b.top ?? b.y ?? 0) + (b.height ?? 0)));
      const width = Math.max(0, right - left);
      const height = Math.max(0, bottom - top);
      if (width < 1 || height < 1) return null;
      return { x: left, y: top, left, top, width, height, right, bottom };
    };
    const parseComputedTransform = (transformText = '') => {
      const value = String(transformText || '').trim();
      if (!value || value === 'none') {
        return { angle: 0, scaleX: 1, scaleY: 1, flipX: false, flipY: false, hasReflection: false };
      }
      try {
        const matrix = new DOMMatrixReadOnly(value);
        const a = Number(matrix.a) || 0;
        const b = Number(matrix.b) || 0;
        const c = Number(matrix.c) || 0;
        const d = Number(matrix.d) || 0;
        const magnitudeX = Math.hypot(a, b);
        const safeScaleX = magnitudeX > 0.000001 ? magnitudeX : 1;
        const determinant = a * d - b * c;
        let signedScaleY = determinant / safeScaleX;
        if (!Number.isFinite(signedScaleY) || Math.abs(signedScaleY) < 0.000001) {
          const magnitudeY = Math.hypot(c, d);
          signedScaleY = magnitudeY > 0.000001 ? magnitudeY : 1;
        }
        const angle = (Math.atan2(b, a) * 180) / Math.PI;
        const flipX = false;
        const flipY = signedScaleY < 0;
        return {
          angle,
          scaleX: Math.max(0.001, safeScaleX),
          scaleY: Math.max(0.001, Math.abs(signedScaleY)),
          flipX,
          flipY,
          hasReflection: flipX !== flipY,
        };
      } catch (_error) {
        return { angle: 0, scaleX: 1, scaleY: 1, flipX: false, flipY: false, hasReflection: false };
      }
    };
    const parseStyleTransform = (styleText = '') => {
      const source = String(styleText || '');
      const translateMatch = source.match(/translate\(\s*([-0-9.e]+)px\s*,\s*([-0-9.e]+)px\s*\)/i);
      const rotateMatch = source.match(/rotate\(\s*([-0-9.e]+)deg\s*\)/i);
      return {
        hasTranslate: Boolean(translateMatch),
        x: Number.isFinite(Number(translateMatch?.[1])) ? Number(translateMatch[1]) : 0,
        y: Number.isFinite(Number(translateMatch?.[2])) ? Number(translateMatch[2]) : 0,
        hasAngle: Boolean(rotateMatch),
        angle: Number.isFinite(Number(rotateMatch?.[1])) ? Number(rotateMatch[1]) : 0,
      };
    };
    const getTransformedViewportRect = (element, frameRect) => {
      if (!element || !frameRect) return null;
      const rawRect = element.getBoundingClientRect();
      const intersection = intersectRects(rawRect, {
        left: frameRect.x,
        top: frameRect.y,
        width: frameRect.width,
        height: frameRect.height,
      });
      if (!intersection) return null;
      const rawArea = rectArea(rawRect);
      const visibleArea = rectArea(intersection);
      const coverage = rawArea > 0 ? visibleArea / rawArea : 0;
      return { x: intersection.x, y: intersection.y, width: intersection.width, height: intersection.height, rawRect, rawArea, visibleArea, coverage };
    };
    const isInsideForeignLayer = (element, ownerNode) => {
      const layerAncestor = element?.closest?.('[id^="LB"]');
      if (!layerAncestor) return false;
      if (!ownerNode) return true;
      return layerAncestor !== ownerNode;
    };
    const getScopedTextPreview = (node) => {
      if (!node) return '';
      const parts = [];
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
      let current = walker.nextNode();
      while (current) {
        const parentElement = current.parentElement || null;
        if (!isInsideForeignLayer(parentElement, node)) {
          const value = String(current.textContent || '').trim();
          if (value) parts.push(value);
        }
        current = walker.nextNode();
      }
      return parts.join('\n').trim();
    };
    const isVisibleTiny = (element, rect) => {
      if (!element || !rect) return false;
      if (rect.width < 2 || rect.height < 2) return false;
      const style = window.getComputedStyle(element);
      return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0.01;
    };
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
        if (!isVisibleTiny(candidate, rect)) return;
        const area = Math.max(1, rect.width * rect.height);
        if (area > bestArea) {
          best = candidate;
          bestArea = area;
        }
      });
      return best;
    };
    const getScopedImageElements = (node) => {
      if (!node) return [];
      return Array.from(node.querySelectorAll('img, image')).filter((element) => !isInsideForeignLayer(element, node));
    };
    const getCompositeScaleToAncestor = (element, stopAtNode) => {
      let scaleX = 1;
      let scaleY = 1;
      let node = element;
      let depth = 0;
      while (node && node !== stopAtNode && depth < 16) {
        const style = window.getComputedStyle(node);
        const parsed = parseComputedTransform(style.transform);
        scaleX *= Number(parsed?.scaleX || 1);
        scaleY *= Number(parsed?.scaleY || 1);
        node = node.parentElement;
        depth += 1;
      }
      return { x: Math.max(0.01, scaleX), y: Math.max(0.01, scaleY) };
    };

    const ids = ['LBRtnfssFQdWJQl1','LBqYGlRfDMH47w8H','LB0GB3GfqpGb5MDQ','LBLgWb4kDYSFzrwf'];
    return ids.map((id) => {
      const node = document.getElementById(id);
      const styleText = node.getAttribute('style') || '';
      const styleTransform = parseStyleTransform(styleText);
      const computedNodeStyle = window.getComputedStyle(node);
      const transform = parseComputedTransform(computedNodeStyle.transform || styleText);
      const viewportInfo = getTransformedViewportRect(node, rect);
      const viewportRect = viewportInfo ? { x: viewportInfo.x, y: viewportInfo.y, width: viewportInfo.width, height: viewportInfo.height } : null;
      const minLayerSide = Math.max(14, Math.min(rect.width, rect.height) * 0.012);
      const minLayerArea = Math.max(320, rect.width * rect.height * 0.00035);
      const textPreview = getScopedTextPreview(node);
      const hasTextPreview = textPreview.length >= 2;
      const hasVectorSignal = Boolean(findBestSvgRenderCandidate(node));
      const minTextLayerSide = Math.max(4, Math.min(rect.width, rect.height) * 0.004);
      const minTextLayerArea = Math.max(16, rect.width * rect.height * 0.00001);
      const minVectorLayerSide = Math.max(1, Math.min(rect.width, rect.height) * 0.0012);
      const minVectorLayerArea = Math.max(4, rect.width * rect.height * 0.000003);
      const viewportArea = viewportRect ? viewportRect.width * viewportRect.height : 0;
      const isLargeEnough = viewportRect ? viewportRect.width >= minLayerSide && viewportRect.height >= minLayerSide : false;
      const hasEnoughArea = viewportArea >= minLayerArea;
      const isTextLayerLargeEnough = viewportRect ? viewportRect.width >= minTextLayerSide && viewportRect.height >= minTextLayerSide : false;
      const hasEnoughTextArea = viewportArea >= minTextLayerArea;
      const isVectorLayerLargeEnough = viewportRect ? viewportRect.width >= minVectorLayerSide && viewportRect.height >= 1.5 : false;
      const hasEnoughVectorArea = viewportArea >= minVectorLayerArea;
      const isInsidePageFrame = viewportInfo ? viewportInfo.coverage >= 0.2 : false;
      const passesDefaultSizeGate = isLargeEnough && hasEnoughArea;
      const passesSmallTextGate = hasTextPreview && isTextLayerLargeEnough && hasEnoughTextArea;
      const passesThinVectorGate = hasVectorSignal && isVectorLayerLargeEnough && hasEnoughVectorArea;
      const imageElements = getScopedImageElements(node);
      const imageElement = imageElements.map((element) => ({ element, rect: element.getBoundingClientRect() })).sort((a, b) => rectArea(b.rect) - rectArea(a.rect))[0]?.element || null;
      const nodeScale = getCompositeScaleToAncestor(node, bestPage.node);
      const rawRect = viewportInfo ? (viewportInfo.rawRect || viewportRect) : null;
      const rawDesignWidth = rawRect ? Math.max(1, rawRect.width * designScaleX) : 0;
      const rawDesignHeight = rawRect ? Math.max(1, rawRect.height * designScaleY) : 0;
      const styleWidth = parseStyleDimension(styleText, 'width');
      const styleHeight = parseStyleDimension(styleText, 'height');
      const styledWidth = styleWidth > 0 ? Math.max(1, styleWidth * nodeScale.x * Math.max(0.01, Number(transform.scaleX || 1))) : 0;
      const styledHeight = styleHeight > 0 ? Math.max(1, styleHeight * nodeScale.y * Math.max(0.01, Number(transform.scaleY || 1))) : 0;
      const styleWidthRatio = styledWidth > 0 ? styledWidth / rawDesignWidth : 0;
      const styleHeightRatio = styledHeight > 0 ? styledHeight / rawDesignHeight : 0;
      const styleGeometryMatchesViewport = styleWidth >= 2 && styleHeight >= 2 && styleWidthRatio >= 0.8 && styleWidthRatio <= 1.25 && styleHeightRatio >= 0.8 && styleHeightRatio <= 1.25;
      return {
        id,
        viewportRect,
        coverage: viewportInfo?.coverage,
        textPreview,
        hasVectorSignal,
        passesDefaultSizeGate,
        passesSmallTextGate,
        passesThinVectorGate,
        hasImageElement: Boolean(imageElement),
        imageElementTag: imageElement?.tagName || '',
        imageAlt: imageElement?.getAttribute('alt') || '',
        styleTransform,
        computedTransform: computedNodeStyle.transform,
        parsedTransform: transform,
        rawDesignWidth,
        rawDesignHeight,
        styledWidth,
        styledHeight,
        styleWidthRatio,
        styleHeightRatio,
        styleGeometryMatchesViewport,
      };
    });
  });
  console.log(JSON.stringify(data, null, 2));
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
