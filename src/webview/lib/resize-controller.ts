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
    this.onDrag(this.dom.resizer, () => {
      const startHeight = this.uiState.terminalHeight;
      return (deltaY) => this.applyTerminalHeight(startHeight + deltaY, false);
    });
  }

  setupSplitResizer(): void {
    this.onDrag(this.dom.splitResizer, () => {
      if (!this.uiState.isSplitModeActive()) {
        return undefined;
      }
      const stackHeight = this.dom.terminalStack?.getBoundingClientRect().height;
      if (!stackHeight || stackHeight <= 0) {
        return undefined;
      }
      const startRatio = this.uiState.splitRatio;
      return (deltaY) =>
        this.setSplitRatio(startRatio + deltaY / stackHeight, false);
    });
  }

  /**
   * Wires a vertical pointer drag on `handle`.
   *
   * `begin` runs on pointerdown and returns the per-drag move handler
   * (receiving the Y delta from the drag origin), or undefined to skip the drag.
   * Moves are throttled to one frame; state is persisted on pointerup.
   */
  private onDrag(
    handle: Element | null,
    begin: () => ((deltaY: number) => void) | undefined
  ): void {
    if (!handle) {
      return;
    }
    const handlePointerDown = (event: PointerEvent) => {
      const onDelta = begin();
      if (!onDelta) {
        return;
      }
      event.preventDefault();
      const {pointerId, clientY: startY} = event;
      const throttledMove = throttle(onDelta, 16);

      const onMove = (moveEvent: PointerEvent) => {
        if (moveEvent.pointerId === pointerId) {
          throttledMove(moveEvent.clientY - startY);
        }
      };

      const cleanup = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        throttledMove.cancel();
        this._activeDragCleanups.delete(cleanup);
      };

      const onUp = (upEvent: PointerEvent) => {
        if (upEvent.pointerId !== pointerId) {
          return;
        }
        cleanup();
        this.onPersistState();
      };

      this._activeDragCleanups.add(cleanup);
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    };
    this.addEventListener(
      handle,
      'pointerdown',
      handlePointerDown as EventListener
    );
  }

  applyTerminalHeight(value: number, persist = true): void {
    this.uiState.terminalHeight = value;
    this.dom.terminalShell?.style.setProperty(
      '--terminal-height',
      `${this.uiState.terminalHeight}px`
    );
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
