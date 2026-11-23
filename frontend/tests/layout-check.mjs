export function pageLayout(page, selectors) {
  return page.evaluate(anchors => ({
    scrollY: Math.round(window.scrollY),
    height: document.scrollingElement.scrollHeight,
    anchors: anchors.map(selector => {
      const node = document.querySelector(selector)
      if (!node) throw new Error('Missing layout anchor ' + selector)
      const box = node.getBoundingClientRect()
      return [selector, Math.round(box.top + window.scrollY), Math.round(box.height)]
    }),
  }), selectors)
}
