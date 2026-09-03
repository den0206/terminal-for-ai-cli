import {describe, expect, it} from 'vitest';
import {
  LinkPopoverController,
  computePopoverPosition,
  distanceBetween,
  isPlainClickActivation,
  isSupportedLinkScheme,
  truncateUrl,
} from './link-popover';
import type {LinkPopoverView, Point, Size} from './link-popover';

class FakeView implements LinkPopoverView {
  url = '';
  visible = false;
  position: Point | undefined;
  size: Size = {width: 200, height: 80};

  setUrl(text: string): void {
    this.url = text;
  }

  show(position: Point): void {
    this.visible = true;
    this.position = position;
  }

  hide(): void {
    this.visible = false;
  }

  getSize(): Size {
    return this.size;
  }
}

function createHarness(viewport: Size = {width: 400, height: 600}) {
  const view = new FakeView();
  const opened: string[] = [];
  const copied: string[] = [];
  const controller = new LinkPopoverController({
    view,
    getViewportSize: () => viewport,
    openLink: (uri) => opened.push(uri),
    copyLink: (uri) => copied.push(uri),
  });
  return {controller, view, opened, copied};
}

describe('isPlainClickActivation', () => {
  it('accepts a click that did not travel', () => {
    expect(
      isPlainClickActivation({travelledPx: 0, hasSelection: false})
    ).toBe(true);
  });

  it('tolerates a few pixels of hand movement', () => {
    expect(
      isPlainClickActivation({travelledPx: 4, hasSelection: false})
    ).toBe(true);
  });

  it('rejects a drag, which is a selection gesture', () => {
    expect(
      isPlainClickActivation({travelledPx: 12, hasSelection: false})
    ).toBe(false);
  });

  it('rejects a click that leaves text selected', () => {
    expect(isPlainClickActivation({travelledPx: 0, hasSelection: true})).toBe(
      false
    );
  });
});

describe('distanceBetween', () => {
  it('measures the straight-line distance', () => {
    expect(distanceBetween({x: 0, y: 0}, {x: 3, y: 4})).toBe(5);
  });
});

describe('isSupportedLinkScheme', () => {
  it.each(['http://example.com', 'https://example.com', 'HTTPS://EXAMPLE.COM'])(
    'accepts %s',
    (uri) => {
      expect(isSupportedLinkScheme(uri)).toBe(true);
    }
  );

  it.each([
    'file:///etc/passwd',
    'javascript:alert(1)',
    'mailto:someone@example.com',
    'example.com',
  ])('rejects %s', (uri) => {
    expect(isSupportedLinkScheme(uri)).toBe(false);
  });
});

describe('truncateUrl', () => {
  it('leaves a short URL alone', () => {
    expect(truncateUrl('https://example.com')).toBe('https://example.com');
  });

  it('elides the middle of a long URL', () => {
    const long = `https://example.com/${'a'.repeat(200)}`;
    const shortened = truncateUrl(long, 21);

    expect(shortened).toHaveLength(21);
    expect(shortened).toContain('…');
    expect(shortened.startsWith('https://')).toBe(true);
    expect(shortened.endsWith('aaaaaaaaaa')).toBe(true);
  });
});

describe('computePopoverPosition', () => {
  const size = {width: 200, height: 80};
  const viewport = {width: 400, height: 600};

  it('places the popover just below the click', () => {
    expect(computePopoverPosition({x: 20, y: 100}, size, viewport)).toEqual({
      x: 20,
      y: 108,
    });
  });

  it('flips above the click when there is no room below', () => {
    const position = computePopoverPosition({x: 20, y: 580}, size, viewport);
    expect(position.y).toBeLessThan(580);
  });

  it('keeps the popover inside the right edge of a narrow sidebar', () => {
    const position = computePopoverPosition({x: 390, y: 100}, size, viewport);
    expect(position.x + size.width).toBeLessThanOrEqual(viewport.width);
  });

  it('keeps a margin from the left edge', () => {
    const position = computePopoverPosition({x: 0, y: 100}, size, viewport);
    expect(position.x).toBeGreaterThan(0);
  });

  it('does not push the popover off-screen when it is taller than the viewport', () => {
    const position = computePopoverPosition(
      {x: 10, y: 10},
      {width: 200, height: 900},
      viewport
    );
    expect(position.y).toBeGreaterThanOrEqual(0);
  });
});

describe('LinkPopoverController', () => {
  it('shows the actions for an http(s) link', () => {
    const {controller, view} = createHarness();
    controller.present('https://example.com/a/b', {x: 10, y: 10});

    expect(controller.isOpen).toBe(true);
    expect(view.visible).toBe(true);
    expect(view.url).toBe('https://example.com/a/b');
  });

  it('ignores a link whose scheme the extension will not open', () => {
    const {controller, view} = createHarness();
    controller.present('javascript:alert(1)', {x: 10, y: 10});

    expect(controller.isOpen).toBe(false);
    expect(view.visible).toBe(false);
  });

  it('closes an open popover when an unsupported link is clicked', () => {
    const {controller, view} = createHarness();
    controller.present('https://example.com', {x: 10, y: 10});
    controller.present('file:///etc/passwd', {x: 10, y: 10});

    expect(controller.isOpen).toBe(false);
    expect(view.visible).toBe(false);
  });

  it('opens the link and closes on confirm', () => {
    const {controller, view, opened} = createHarness();
    controller.present('https://example.com', {x: 10, y: 10});
    controller.confirmOpen();

    expect(opened).toEqual(['https://example.com']);
    expect(controller.isOpen).toBe(false);
    expect(view.visible).toBe(false);
  });

  it('copies the link and closes on confirm', () => {
    const {controller, copied} = createHarness();
    controller.present('https://example.com', {x: 10, y: 10});
    controller.confirmCopy();

    expect(copied).toEqual(['https://example.com']);
    expect(controller.isOpen).toBe(false);
  });

  it('does nothing when confirming with no link shown', () => {
    const {controller, opened, copied} = createHarness();
    controller.confirmOpen();
    controller.confirmCopy();

    expect(opened).toEqual([]);
    expect(copied).toEqual([]);
  });

  it('keeps the full URL for the action, showing only a shortened one', () => {
    const {controller, view, opened} = createHarness();
    const long = `https://example.com/${'a'.repeat(120)}`;
    controller.present(long, {x: 10, y: 10});
    controller.confirmOpen();

    expect(view.url.length).toBeLessThan(long.length);
    expect(opened).toEqual([long]);
  });
});
