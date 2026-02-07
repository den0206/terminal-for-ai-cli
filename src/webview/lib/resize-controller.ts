import type {DOMElements} from './dom';
import type {UIStateManager} from './state-managers';
import {throttle, clampSplitRatio} from './utils';

/**
 * Manages terminal resize and split-pane drag operations.
 *
 * Extracted from AppController to reduce class size and isolate
 * resize/drag concerns.
 */
export class ResizeController {
  private readonly _activeDragCleanups = new Set<() => void>();

  constructor(
    private readonly dom: DOMElements,
    private readonly uiState: UIStateManager,
    private readonly fitVisibleTerminals: () => void,
    private readonly addEventListener: (
      target: EventTarget,
      event: string,
      handler: EventListener
    ) => void,
    private readonly onPersistState: () => void,
    private readonly onNotifyResize: () => void
  ) {}

  setupResizer(): void {
    if (!this.dom.resizer) {
      return;
    }
    const handlePointerDown = (event: PointerEvent) => {
      event.preventDefault();
      const pointerId = event.pointerId;
      const startY = event.clientY;
      const startHeight = this.uiState.terminalHeight;

      const throttledMove = throttle((delta: number) => {
        this.applyTerminalHeight(startHeight + delta, false);
      }, 16);

      const onMove = (moveEvent: PointerEvent) => {
        if (moveEvent.pointerId !== pointerId) {
          return;
        }
        const delta = moveEvent.clientY - startY;
        throttledMove(delta);
      };

      const cleanupFn = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        throttledMove.cancel();
        this._activeDragCleanups.delete(cleanupFn);
      };

      const onUp = (moveEvent?: PointerEvent) => {
        if (moveEvent && moveEvent.pointerId !== pointerId) {
          return;
        }
        cleanupFn();
        if (moveEvent) {
          this.onPersistState();
        }
      };

      this._activeDragCleanups.add(cleanupFn);

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    };
    this.addEventListener(
      this.dom.resizer,
      'pointerdown',
      handlePointerDown as EventListener
    );
  }

  setupSplitResizer(): void {
    if (!this.dom.splitResizer) {
      return;
    }
    const handlePointerDown = (event: PointerEvent) => {
      if (!this.uiState.isSplitModeActive()) {
        return;
      }
      const stackRect = this.dom.terminalStack?.getBoundingClientRect();
      if (!stackRect || stackRect.height <= 0) {
        return;
      }
      event.preventDefault();
      const pointerId = event.pointerId;
      const startY = event.clientY;
      const startRatio = this.uiState.splitRatio;

      const throttledMove = throttle((deltaRatio: number) => {
        this.setSplitRatio(startRatio + deltaRatio, false);
      }, 16);

      const onMove = (moveEvent: PointerEvent) => {
        if (moveEvent.pointerId !== pointerId) {
          return;
        }
        const delta = moveEvent.clientY - startY;
        const deltaRatio = delta / stackRect.height;
        throttledMove(deltaRatio);
      };

      const cleanupFn = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        throttledMove.cancel();
        this._activeDragCleanups.delete(cleanupFn);
      };

      const onUp = (moveEvent?: PointerEvent) => {
        if (moveEvent && moveEvent.pointerId !== pointerId) {
          return;
        }
        cleanupFn();
        if (moveEvent) {
          this.onPersistState();
        }
      };

      this._activeDragCleanups.add(cleanupFn);

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    };
    this.addEventListener(
      this.dom.splitResizer,
      'pointerdown',
      handlePointerDown as EventListener
    );
  }

  applyTerminalHeight(value: number, persist = true): void {
    this.uiState.terminalHeight = value;
    if (this.dom.terminalShell) {
      this.dom.terminalShell.style.setProperty(
        '--terminal-height',
        `${this.uiState.terminalHeight}px`
      );
    }
    this.fitVisibleTerminals();
    this.onNotifyResize();
    if (persist) {
      this.onPersistState();
    }
  }

  setSplitRatio(value: number, persistNow = true): void {
    const clamped = clampSplitRatio(value);
    if (Math.abs(clamped - this.uiState.splitRatio) < 0.001) {
      return;
    }
    this.uiState.splitRatio = clamped;
    if (persistNow) {
      this.onPersistState();
    }
    this.applySplitSizing();
    this.fitVisibleTerminals();
    this.onNotifyResize();
  }

  applySplitSizing(): void {
    const splitActive = this.uiState.isSplitModeActive();
    if (this.dom.paneElements.primary) {
      this.dom.paneElements.primary.style.flex = splitActive
        ? `${this.uiState.splitRatio} 1 0%`
        : '1 1 auto';
    }
    if (this.dom.paneElements.secondary) {
      const secondaryRatio = Math.max(0.01, 1 - this.uiState.splitRatio);
      this.dom.paneElements.secondary.style.flex = splitActive
        ? `${secondaryRatio} 1 0%`
        : '0 0 auto';
    }
    if (this.dom.splitResizer) {
      this.dom.splitResizer.style.display = splitActive ? 'flex' : 'none';
    }
  }

  cleanupActiveDrags(): void {
    for (const fn of this._activeDragCleanups) {
      fn();
    }
    this._activeDragCleanups.clear();
  }
}
