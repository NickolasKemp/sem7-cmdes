/** Опис слайдів відеопояснення: заголовок, HTML-вміст і текст озвучення. */
export interface Slide {
  readonly id: string;
  readonly title: string;
  readonly kicker: string;
  /** HTML тіла слайда. */
  readonly body: string;
  /** Текст, який озвучується синтезатором мовлення. */
  readonly speech: string;
}

export const n1 = (x: number): string => x.toFixed(1);
export const n2 = (x: number): string => x.toFixed(2);
export const n3 = (x: number): string => x.toFixed(3);

/** Таблиця з простим масивом рядків. */
export const table = (head: readonly string[], rows: readonly (readonly string[])[]): string => `
<table>
  <thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead>
  <tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody>
</table>`;

export const chart = (file: string): string => `<div class="chart"><img src="${file}"></div>`;

export const bullets = (items: readonly string[]): string =>
  `<ul>${items.map((i) => `<li>${i}</li>`).join('')}</ul>`;

export const terminal = (text: string): string =>
  `<pre class="terminal">${text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')}</pre>`;
