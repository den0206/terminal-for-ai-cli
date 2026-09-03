import {describe, expect, it} from 'vitest';
import {RendererController} from './renderer-controller';
import type {RendererAddon, RendererTerminal} from './renderer-controller';
import {PANES} from './types';
import type {Pane} from './types';

class FakeAddon {
  disposed = false;
  clearedAtlas = 0;
  private contextLossListener?: () => void;

  activate(): void {}

  dispose(): void {
    this.disposed = true;
  }

  clearTextureAtlas(): void {
    this.clearedAtlas += 1;
  }

  onContextLoss(listener: () => void): {dispose(): void} {
    this.contextLossListener = listener;
    return {
      dispose: () => {
        this.contextLossListener = undefined;
      },
    };
  }

  /** テストから GPU コンテキストロスを起こす */
  loseContext(): void {
    this.contextLossListener?.();
  }

  get isListening(): boolean {
    return this.contextLossListener !== undefined;
  }
}

class FakeTerminal {
  readonly addons: RendererAddon[] = [];
  clearedAtlas = 0;

  loadAddon(addon: RendererAddon): void {
    this.addons.push(addon);
  }

  clearTextureAtlas(): void {
    this.clearedAtlas += 1;
  }
}

type Harness = {
  controller: RendererController;
  terminals: Record<Pane, FakeTerminal>;
  addons: FakeAddon[];
  createdCount: () => number;
};

function createHarness(
  options: {
    rendererType?: 'auto' | 'webgl' | 'dom';
    failCreate?: boolean;
  } = {}
): Harness {
  const terminals: Record<Pane, FakeTerminal> = {
    primary: new FakeTerminal(),
    secondary: new FakeTerminal(),
  };
  const addons: FakeAddon[] = [];
  let created = 0;
  const controller = new RendererController(
    {
      getTerminal: (pane) => terminals[pane] as RendererTerminal,
      createWebglAddon: () => {
        created += 1;
        if (options.failCreate) {
          throw new Error('WebGL2 is not available');
        }
        const addon = new FakeAddon();
        addons.push(addon);
        return addon as unknown as RendererAddon;
      },
    },
    options.rendererType ?? 'auto'
  );
  return {controller, terminals, addons, createdCount: () => created};
}

function applyAll(controller: RendererController): void {
  PANES.forEach((pane) => controller.applyToPane(pane));
}

describe('RendererController', () => {
  it('attaches the WebGL addon to every pane in auto mode', () => {
    const {controller, terminals, addons} = createHarness();
    applyAll(controller);

    expect(addons).toHaveLength(2);
    expect(terminals.primary.addons).toHaveLength(1);
    expect(terminals.secondary.addons).toHaveLength(1);
    expect(controller.isWebglActive('primary')).toBe(true);
    expect(controller.isWebglActive('secondary')).toBe(true);
  });

  it('never attaches the addon when the DOM renderer is requested', () => {
    const {controller, terminals, createdCount} = createHarness({
      rendererType: 'dom',
    });
    applyAll(controller);

    expect(createdCount()).toBe(0);
    expect(terminals.primary.addons).toHaveLength(0);
    expect(controller.isWebglActive('primary')).toBe(false);
  });

  it('does not attach twice when applied again for the same pane', () => {
    const {controller, createdCount} = createHarness();
    controller.applyToPane('primary');
    controller.applyToPane('primary');

    expect(createdCount()).toBe(1);
  });

  it('falls back to the DOM renderer when the addon cannot be created', () => {
    const {controller, terminals, createdCount} = createHarness({
      failCreate: true,
    });
    applyAll(controller);

    expect(controller.isWebglActive('primary')).toBe(false);
    expect(terminals.primary.addons).toHaveLength(0);
    // 1 度失敗したら、その環境では 2 つめのペインで試し直さない
    expect(createdCount()).toBe(1);
  });

  it('drops WebGL on every pane when the GL context is lost', () => {
    const {controller, addons, createdCount} = createHarness();
    applyAll(controller);

    addons[0].loseContext();

    expect(controller.isWebglActive('primary')).toBe(false);
    expect(controller.isWebglActive('secondary')).toBe(false);
    expect(addons.every((addon) => addon.disposed)).toBe(true);
    expect(addons.every((addon) => !addon.isListening)).toBe(true);

    // コンテキストロス後は再挑戦しない（点滅を避けるため）
    applyAll(controller);
    expect(createdCount()).toBe(2);
  });

  it('detaches the addon when switching to the DOM renderer', () => {
    const {controller, addons} = createHarness();
    applyAll(controller);

    controller.setRendererType('dom');

    expect(addons.every((addon) => addon.disposed)).toBe(true);
    expect(controller.isWebglActive('primary')).toBe(false);
  });

  it('retries WebGL when the setting changes after a failure', () => {
    const failing = createHarness({failCreate: true});
    applyAll(failing.controller);
    expect(failing.createdCount()).toBe(1);

    // 設定を変えたときだけ再挑戦する。再挑戦も最初のペインで失敗するので、
    // 2 つめのペインではまた試さない（合計 2 回）。
    failing.controller.setRendererType('webgl');
    expect(failing.createdCount()).toBe(2);
  });

  it('ignores a no-op setting change', () => {
    const {controller, createdCount} = createHarness();
    applyAll(controller);
    controller.setRendererType('auto');

    expect(createdCount()).toBe(2);
  });

  it('clears the texture atlas only while WebGL is active', () => {
    const {controller, terminals} = createHarness();
    controller.refreshTextureAtlas('primary');
    expect(terminals.primary.clearedAtlas).toBe(0);

    controller.applyToPane('primary');
    controller.refreshTextureAtlas('primary');
    expect(terminals.primary.clearedAtlas).toBe(1);

    controller.setRendererType('dom');
    controller.refreshTextureAtlas('primary');
    expect(terminals.primary.clearedAtlas).toBe(1);
  });

  it('does nothing for a pane whose terminal does not exist yet', () => {
    const controller = new RendererController(
      {
        getTerminal: () => undefined,
        createWebglAddon: () => {
          throw new Error('should not be called');
        },
      },
      'auto'
    );

    expect(() => controller.applyToPane('primary')).not.toThrow();
    expect(controller.isWebglActive('primary')).toBe(false);
  });

  it('disposes every attachment on dispose', () => {
    const {controller, addons} = createHarness();
    applyAll(controller);

    controller.dispose();

    expect(addons.every((addon) => addon.disposed)).toBe(true);
    expect(controller.isWebglActive('primary')).toBe(false);
  });
});
