import { t } from '../i18n';
import { h } from './dom';

export function modal(title: string, body: Node | string, buttons: { label: string; cls?: string; onClick?: () => void }[]): () => void {
  const root = document.getElementById('modal-root')!;
  const close = () => backdrop.remove();
  const backdrop = h('div', { class: 'modal-backdrop' },
    h('div', { class: 'modal', role: 'dialog' },
      h('header', null, title),
      h('div', { class: 'body' }, body),
      h('footer', null, ...buttons.map((b) =>
        h('button', { class: `btn ${b.cls ?? ''}`, onclick: () => { close(); b.onClick?.(); } }, b.label))),
    ),
  );
  root.appendChild(backdrop);
  return close;
}

export function confirmModal(title: string, text: string, okLabel: string, onOk: () => void): void {
  modal(title, text, [{ label: t('modal.cancel'), cls: 'ghost' }, { label: okLabel, cls: 'danger', onClick: onOk }]);
}

/** Big transient headline over the scene (discoveries, dry holes). */
export function banner(host: HTMLElement, title: string, sub: string, kind: 'jackpot' | 'dry' = 'jackpot'): void {
  host.querySelectorAll('.banner').forEach((b) => b.remove());
  const el = h('div', { class: `banner ${kind}` }, h('div', { class: 't1' }, title), h('div', { class: 't2' }, sub));
  host.appendChild(el);
  setTimeout(() => el.remove(), 4300);
}
