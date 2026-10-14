/** Keep candidate-selection keys out of xterm's premature composition flush. */
export class ImeController {
  private composing = false;
  private generation = 0;
  private activity = 0;
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private readonly textarea: HTMLTextAreaElement;

  constructor(textarea: HTMLTextAreaElement) {
    this.textarea = textarea;
    textarea.addEventListener('compositionstart', this.start, {capture: true});
    textarea.addEventListener('compositionend', this.end, {capture: true});
    textarea.addEventListener('input', this.input, {capture: true});
  }

  ownsKey(event: KeyboardEvent): boolean {
    return (event.type === 'keydown' || event.type === 'keypress') &&
      (this.composing || event.isComposing);
  }

  private readonly start = () => {
    this.composing = true;
    this.generation++;
    this.cancelTimers();
  };
  private readonly input = () => { this.activity++; };
  private readonly end = () => {
    this.composing = false;
    const generation = ++this.generation;
    // Capture listener runs before xterm schedules its composition send. Wait
    // another turn so xterm has read the final value before we consider clearing.
    this.later(() => {
      if (this.composing || this.generation !== generation) return;
      const value = this.textarea.value;
      const activity = this.activity;
      this.later(() => {
        if (this.composing || this.generation !== generation ||
            this.activity !== activity || this.textarea.value !== value ||
            this.textarea.selectionStart !== this.textarea.selectionEnd) return;
        this.textarea.value = '';
      });
    });
  };

  private later(callback: () => void): void {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      callback();
    }, 0);
    this.timers.add(timer);
  }

  private cancelTimers(): void {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
  }

  dispose(): void {
    this.generation++;
    this.cancelTimers();
    this.textarea.removeEventListener('compositionstart', this.start, {capture: true});
    this.textarea.removeEventListener('compositionend', this.end, {capture: true});
    this.textarea.removeEventListener('input', this.input, {capture: true});
  }
}
