import {webviewLog} from './utils';

/** Keep candidate-selection keys out of xterm's premature composition flush. */
export class ImeController {
  private composing = false;
  private generation = 0;
  private activity = 0;
  private timers = new Set<ReturnType<typeof setTimeout>>();
  // Event names and timings only, never text: shows what preceded a missed compositionend.
  private trace: string[] = [];
  private readonly textarea: HTMLTextAreaElement;

  constructor(textarea: HTMLTextAreaElement) {
    this.textarea = textarea;
    textarea.addEventListener('compositionstart', this.start, {capture: true});
    textarea.addEventListener('compositionend', this.end, {capture: true});
    textarea.addEventListener('input', this.input, {capture: true});
    textarea.addEventListener('blur', this.note, {capture: true});
    textarea.addEventListener('focus', this.note, {capture: true});
  }

  ownsKey(event: KeyboardEvent): boolean {
    if (event.type !== 'keydown' && event.type !== 'keypress') return false;
    // Trust the event, not our flag: if compositionend is ever missed the flag
    // stays true and would swallow every key in this pane until reload.
    const composing = event.isComposing || event.keyCode === 229;
    if (this.composing && !composing && event.type === 'keydown') {
      webviewLog.warn('IME compositionend was not received', this.trace.join(' '));
      this.composing = false;
    }
    return composing;
  }

  private readonly note = (event: Event) => {
    this.trace.push(`${event.type}@${Math.round(performance.now())}`);
    if (this.trace.length > 12) this.trace.shift();
  };

  private readonly start = (event: Event) => {
    this.note(event);
    this.composing = true;
    this.generation++;
    this.cancelTimers();
  };
  private readonly input = () => { this.activity++; };
  private readonly end = (event: Event) => {
    this.note(event);
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
    this.textarea.removeEventListener('blur', this.note, {capture: true});
    this.textarea.removeEventListener('focus', this.note, {capture: true});
  }
}
